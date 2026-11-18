"""Windows backend for the game host: stream the desktop or a window of a Windows machine, e.g. a cloud VM with
NVIDIA T4s running the official Roblox client.

  * WinInjector : the player's input through SendInput -- relative mouse counts (mouse-look), absolute pointer
                  positions (menus), buttons, wheel, and keys as hardware scan codes (games read those)
  * WinGrabber  : DXGI Desktop Duplication through dxcam (GPU copy, no cursor in the image), GDI via mss as a
                  fallback
  * cursor()    : whether the game shows the pointer.  A hidden or pinned pointer means mouse-look: relative
                  counts turn the camera and the browser may predict them; a visible one means menus: the
                  browser draws its own pointer and sends absolute positions.

Same interface as the X11 backend in host.py (XInjector / XGrabber), so GameHost, the calibrator, the HUD mask,
NVENC and the browser client are shared.  The structures use fixed-width types so their layout can be checked
on any platform (tests/test_host_win.py).
"""
from __future__ import annotations

import ctypes
import sys
import threading
import time
from collections import deque
from ctypes import c_int32 as LONG, c_size_t as ULONG_PTR, c_uint16 as WORD, c_uint32 as DWORD

import numpy as np


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", LONG), ("dy", LONG), ("mouseData", DWORD), ("dwFlags", DWORD), ("time", DWORD),
                ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", WORD), ("wScan", WORD), ("dwFlags", DWORD), ("time", DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", DWORD), ("wParamL", WORD), ("wParamH", WORD)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", DWORD), ("u", _INPUTUNION)]


class POINT(ctypes.Structure):
    _fields_ = [("x", LONG), ("y", LONG)]


class RECT(ctypes.Structure):
    _fields_ = [("left", LONG), ("top", LONG), ("right", LONG), ("bottom", LONG)]


class CURSORINFO(ctypes.Structure):
    _fields_ = [("cbSize", DWORD), ("flags", DWORD), ("hCursor", ctypes.c_void_p), ("ptScreenPos", POINT)]


INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
MOUSEEVENTF_MOVE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_VIRTUALDESK = 0x0001, 0x8000, 0x4000
MOUSEEVENTF_WHEEL, MOUSEEVENTF_HWHEEL = 0x0800, 0x1000
BUTTON_FLAGS = {0: (0x0002, 0x0004), 1: (0x0020, 0x0040), 2: (0x0008, 0x0010), 3: (0x0080, 0x0100), 4: (0x0080, 0x0100)}
XBUTTON = {3: 1, 4: 2}                      # browser buttons 3/4 (back/forward) -> XBUTTON1/2
KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x0001, 0x0002, 0x0008
CURSOR_SHOWING = 0x1
SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN = 76, 77, 78, 79

# KeyboardEvent.code -> (set-1 scan code, extended).  Scan codes, not virtual keys: games read the physical key.
SCAN = {"Escape": 0x01, "Minus": 0x0C, "Equal": 0x0D, "Backspace": 0x0E, "Tab": 0x0F, "BracketLeft": 0x1A,
        "BracketRight": 0x1B, "Enter": 0x1C, "ControlLeft": 0x1D, "Semicolon": 0x27, "Quote": 0x28, "Backquote": 0x29,
        "ShiftLeft": 0x2A, "Backslash": 0x2B, "Comma": 0x33, "Period": 0x34, "Slash": 0x35, "ShiftRight": 0x36,
        "NumpadMultiply": 0x37, "AltLeft": 0x38, "Space": 0x39, "CapsLock": 0x3A, "NumLock": 0x45, "ScrollLock": 0x46,
        "Numpad7": 0x47, "Numpad8": 0x48, "Numpad9": 0x49, "NumpadSubtract": 0x4A, "Numpad4": 0x4B, "Numpad5": 0x4C,
        "Numpad6": 0x4D, "NumpadAdd": 0x4E, "Numpad1": 0x4F, "Numpad2": 0x50, "Numpad3": 0x51, "Numpad0": 0x52,
        "NumpadDecimal": 0x53, "IntlBackslash": 0x56, "F11": 0x57, "F12": 0x58}
for _i, _c in enumerate("1234567890"):
    SCAN["Digit" + _c] = 0x02 + _i
for _row, _start in (("QWERTYUIOP", 0x10), ("ASDFGHJKL", 0x1E), ("ZXCVBNM", 0x2C)):
    for _i, _c in enumerate(_row):
        SCAN["Key" + _c] = _start + _i
for _f in range(1, 11):
    SCAN[f"F{_f}"] = 0x3A + _f
SCAN = {k: (v, False) for k, v in SCAN.items()}
SCAN.update({k: (v, True) for k, v in {
    "NumpadEnter": 0x1C, "ControlRight": 0x1D, "NumpadDivide": 0x35, "PrintScreen": 0x37, "AltRight": 0x38,
    "Home": 0x47, "ArrowUp": 0x48, "PageUp": 0x49, "ArrowLeft": 0x4B, "ArrowRight": 0x4D, "End": 0x4F,
    "ArrowDown": 0x50, "PageDown": 0x51, "Insert": 0x52, "Delete": 0x53, "MetaLeft": 0x5B, "MetaRight": 0x5C,
    "ContextMenu": 0x5D}.items()})


def _user32():
    if sys.platform != "win32":
        raise OSError("the Windows host backend needs Windows")
    u = ctypes.WinDLL("user32", use_last_error=True)
    try:                                            # physical pixels everywhere, whatever the display scaling
        u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        pass
    return u


class WinInjector:
    """SendInput.  `rect` is the captured area (x, y, w, h) in desktop pixels: absolute positions arrive in its
    coordinates.  `user32` can be replaced for tests."""

    def __init__(self, rect, user32=None, hwnd=None):
        self.u = user32 or _user32()
        self.rect, self.hwnd = rect, hwnd
        self.lock = threading.Lock()
        self.cx = self.cy = 0
        self.hist = deque([(0.0, 0, 0)], maxlen=4096)
        self.focus()

    def counts_at(self, t):
        with self.lock:
            for tt, cx, cy in reversed(self.hist):
                if tt <= t:
                    return cx, cy
            return self.hist[0][1], self.hist[0][2]

    def focus(self):
        if self.hwnd:
            self.u.SetForegroundWindow(self.hwnd)

    # ---------------------------------------------------------------- building INPUT records
    @staticmethod
    def _mouse(dx=0, dy=0, data=0, flags=0):
        i = INPUT(type=INPUT_MOUSE)
        i.u.mi = MOUSEINPUT(dx=dx, dy=dy, mouseData=data & 0xFFFFFFFF, dwFlags=flags, time=0, dwExtraInfo=0)
        return i

    @staticmethod
    def _key(code, down):
        sc, ext = SCAN[code]
        i = INPUT(type=INPUT_KEYBOARD)
        flags = KEYEVENTF_SCANCODE | (KEYEVENTF_EXTENDEDKEY if ext else 0) | (0 if down else KEYEVENTF_KEYUP)
        i.u.ki = KEYBDINPUT(wVk=0, wScan=sc, dwFlags=flags, time=0, dwExtraInfo=0)
        return i

    def _absolute(self, x, y):
        """a position in the captured area -> SendInput's 0..65535 virtual-desktop coordinates"""
        vx, vy = self.u.GetSystemMetrics(SM_XVIRTUALSCREEN), self.u.GetSystemMetrics(SM_YVIRTUALSCREEN)
        vw, vh = self.u.GetSystemMetrics(SM_CXVIRTUALSCREEN), self.u.GetSystemMetrics(SM_CYVIRTUALSCREEN)
        px = self.rect[0] + min(max(float(x), 0.0), self.rect[2] - 1)
        py = self.rect[1] + min(max(float(y), 0.0), self.rect[3] - 1)
        return (int(round((px - vx) * 65535 / max(vw - 1, 1))), int(round((py - vy) * 65535 / max(vh - 1, 1))))

    def records(self, events):
        """browser events -> INPUT records (separate from sending, so it can be tested anywhere)"""
        out = []
        for ev in events:
            kind = ev[0]
            if kind == "m":
                dx, dy = int(ev[1]), int(ev[2])
                if dx or dy:
                    out.append(self._mouse(dx, dy, flags=MOUSEEVENTF_MOVE))
                    self.cx += dx; self.cy += dy
            elif kind == "a":
                ax, ay = self._absolute(ev[1], ev[2])
                out.append(self._mouse(ax, ay, flags=MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK))
            elif kind == "b":
                b = int(ev[1]) if int(ev[1]) in BUTTON_FLAGS else 0
                down, up = BUTTON_FLAGS[b]
                out.append(self._mouse(data=XBUTTON.get(b, 0), flags=down if ev[2] else up))
            elif kind == "w":                         # browser deltaY > 0 scrolls down: negative wheel delta
                out.append(self._mouse(data=-120 * int(np.sign(ev[1])), flags=MOUSEEVENTF_WHEEL))
            elif kind == "wh":
                out.append(self._mouse(data=120 * int(np.sign(ev[1])), flags=MOUSEEVENTF_HWHEEL))
            elif kind == "k" and ev[1] in SCAN:
                out.append(self._key(ev[1], bool(ev[2])))
        return out

    def inject(self, events):
        with self.lock:
            recs = self.records(events)
            if recs:
                arr = (INPUT * len(recs))(*recs)
                self.u.SendInput(len(recs), arr, ctypes.sizeof(INPUT))
            self.hist.append((time.perf_counter(), self.cx, self.cy))
            return self.cx, self.cy

    # ---------------------------------------------------------------- pointer state
    def cursor(self):
        """(visible, x, y) with x, y in the captured area.  Hidden, or clipped to a few pixels, means the game
        has taken the mouse for looking around."""
        ci = CURSORINFO(cbSize=ctypes.sizeof(CURSORINFO))
        if not self.u.GetCursorInfo(ctypes.byref(ci)):
            return True, None, None
        clip = RECT()
        pinned = bool(self.u.GetClipCursor(ctypes.byref(clip))) and \
            (clip.right - clip.left) <= 8 and (clip.bottom - clip.top) <= 8
        visible = bool(ci.flags & CURSOR_SHOWING) and not pinned
        return visible, ci.ptScreenPos.x - self.rect[0], ci.ptScreenPos.y - self.rect[1]


class WinGrabber:
    """DXGI Desktop Duplication (dxcam): the GPU copies only changed frames, the cursor isn't in the image.
    Falls back to GDI (mss), which works everywhere but costs more CPU per frame."""

    def __init__(self, rect, output=0):
        self.rect = rect
        x, y, w, h = rect
        self.last = None
        try:
            import dxcam
            self.cam = dxcam.create(output_idx=output, output_color="RGB")
            self.region = (x, y, x + w, y + h)
            self.kind = "dxgi"
        except Exception as e:                   # no dxcam, or no duplication on this adapter/session
            import mss
            self.cam, self.kind, self.why = mss.mss(), "gdi", repr(e)
            self.mon = {"left": x, "top": y, "width": w, "height": h}

    def grab(self):
        if self.kind == "dxgi":
            f = self.cam.grab(region=self.region)
            if f is None:                         # nothing changed since the last frame
                if self.last is None:
                    time.sleep(0.005)
                    return self.grab()
                return self.last
            self.last = f
            return f
        raw = np.frombuffer(self.cam.grab(self.mon).bgra, np.uint8)
        return raw.reshape(self.mon["height"], self.mon["width"], 4)[:, :, 2::-1]


def desktop_rect(user32=None, monitor=0):
    """the primary monitor (monitor=0) as (x, y, w, h)"""
    u = user32 or _user32()
    return (0, 0, u.GetSystemMetrics(0), u.GetSystemMetrics(1))


def find_window(title, settle=60.0, user32=None):
    """(hwnd, client rect in desktop pixels) of the largest visible window whose title contains `title`"""
    u = user32 or _user32()
    proto = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    t0 = time.time()
    while time.time() - t0 < settle:
        found = []

        def cb(hwnd, _):
            if not u.IsWindowVisible(hwnd):
                return True
            n = u.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(hwnd, buf, n + 1)
            if title.lower() in buf.value.lower():
                r = RECT(); u.GetClientRect(hwnd, ctypes.byref(r))
                p = POINT(0, 0); u.ClientToScreen(hwnd, ctypes.byref(p))
                if r.right >= 64 and r.bottom >= 64:
                    found.append((r.right * r.bottom, hwnd, (p.x, p.y, r.right, r.bottom)))
            return True
        u.EnumWindows(proto(cb), 0)
        if found:
            _, hwnd, rect = max(found)
            return hwnd, rect
        time.sleep(0.5)
    raise RuntimeError(f"no window with '{title}' in its title")
