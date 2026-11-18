"""Windows host backend, tested on any OS with a fake user32: what would be handed to SendInput, and how the
pointer state is read.  Run: python -m pytest tests/ (or python tests/test_host_win.py)."""
import ctypes
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import host_win as W  # noqa: E402


class FakeUser32:
    """records SendInput calls; a 2560x1440 primary monitor with a second one to its left (virtual desktop
    starts at x=-1920)"""

    def __init__(self, showing=True, clip=None, pos=(700, 400)):
        self.sent, self.showing, self.clip, self.pos = [], showing, clip, pos

    def GetSystemMetrics(self, i):
        return {0: 2560, 1: 1440, 76: -1920, 77: 0, 78: 4480, 79: 1440}[i]

    def SendInput(self, n, arr, size):
        assert size == ctypes.sizeof(W.INPUT)
        self.sent.extend(arr[i] for i in range(n))
        return n

    def SetForegroundWindow(self, h):
        return 1

    def GetCursorInfo(self, p):
        ci = ctypes.cast(p, ctypes.POINTER(W.CURSORINFO)).contents
        assert ci.cbSize == ctypes.sizeof(W.CURSORINFO)
        ci.flags = W.CURSOR_SHOWING if self.showing else 0
        ci.ptScreenPos.x, ci.ptScreenPos.y = self.pos
        return 1

    def GetClipCursor(self, p):
        r = ctypes.cast(p, ctypes.POINTER(W.RECT)).contents
        r.left, r.top, r.right, r.bottom = self.clip or (-1920, 0, 2560, 1440)
        return 1


def test_struct_layout():
    # SendInput rejects records of the wrong size: 40 bytes on 64-bit Windows, 28 on 32-bit
    assert ctypes.sizeof(W.INPUT) == (40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28)
    assert ctypes.sizeof(W.MOUSEINPUT) == (32 if ctypes.sizeof(ctypes.c_void_p) == 8 else 24)
    assert ctypes.sizeof(W.CURSORINFO) == (24 if ctypes.sizeof(ctypes.c_void_p) == 8 else 20)


def test_relative_mouse_counts():
    u = FakeUser32(); inj = W.WinInjector((0, 0, 2560, 1440), user32=u)
    inj.inject([["m", 5, -3], ["m", 0, 0], ["m", -2, 1]])
    assert [(r.u.mi.dx, r.u.mi.dy, r.u.mi.dwFlags) for r in u.sent] == [(5, -3, W.MOUSEEVENTF_MOVE), (-2, 1, W.MOUSEEVENTF_MOVE)]
    assert (inj.cx, inj.cy) == (3, -2) and inj.counts_at(1e18) == (3, -2)


def test_absolute_maps_into_virtual_desktop():
    u = FakeUser32(); inj = W.WinInjector((0, 0, 2560, 1440), user32=u)
    inj.inject([["a", 0, 0], ["a", 2559, 1439], ["a", 99999, -5]])
    pts = [(r.u.mi.dx, r.u.mi.dy) for r in u.sent]
    # x=0 on the primary monitor is 1920 px into a 4480-px virtual desktop
    assert pts[0] == (round(1920 * 65535 / 4479), 0)
    assert pts[1] == (65535, 65535)
    assert pts[2] == (65535, 0)                          # clamped to the captured area
    f = u.sent[0].u.mi.dwFlags
    assert f & W.MOUSEEVENTF_ABSOLUTE and f & W.MOUSEEVENTF_VIRTUALDESK and f & W.MOUSEEVENTF_MOVE


def test_buttons_wheel_keys():
    u = FakeUser32(); inj = W.WinInjector((0, 0, 2560, 1440), user32=u)
    inj.inject([["b", 0, 1], ["b", 0, 0], ["b", 2, 1], ["b", 4, 1], ["w", 3], ["wh", -1],
                ["k", "KeyW", 1], ["k", "KeyW", 0], ["k", "ArrowUp", 1], ["k", "NoSuchKey", 1]])
    mi = [r.u.mi for r in u.sent if r.type == W.INPUT_MOUSE]
    assert [m.dwFlags for m in mi[:4]] == [0x0002, 0x0004, 0x0008, 0x0080]
    assert mi[3].mouseData == 2                          # forward = XBUTTON2
    assert mi[4].dwFlags == W.MOUSEEVENTF_WHEEL and ctypes.c_int32(mi[4].mouseData).value == -120
    assert mi[5].dwFlags == W.MOUSEEVENTF_HWHEEL and ctypes.c_int32(mi[5].mouseData).value == -120
    ki = [r.u.ki for r in u.sent if r.type == W.INPUT_KEYBOARD]
    assert len(ki) == 3                                  # unknown codes are dropped
    assert (ki[0].wScan, ki[0].dwFlags) == (0x11, W.KEYEVENTF_SCANCODE)
    assert (ki[1].wScan, ki[1].dwFlags) == (0x11, W.KEYEVENTF_SCANCODE | W.KEYEVENTF_KEYUP)
    assert (ki[2].wScan, ki[2].dwFlags) == (0x48, W.KEYEVENTF_SCANCODE | W.KEYEVENTF_EXTENDEDKEY)


def test_scan_codes_cover_a_keyboard():
    for code in ["KeyA", "KeyZ", "Digit0", "Digit9", "F1", "F12", "Space", "Enter", "Escape", "Tab", "ShiftLeft",
                 "ControlRight", "AltLeft", "Slash", "Backquote", "Delete", "PageDown", "MetaLeft"]:
        assert code in W.SCAN, code
    assert W.SCAN["KeyA"] == (0x1E, False) and W.SCAN["KeyM"] == (0x32, False) and W.SCAN["F10"] == (0x44, False)
    assert W.SCAN["Digit1"] == (0x02, False) and W.SCAN["Digit0"] == (0x0B, False)


def test_cursor_state():
    rect = (100, 50, 1280, 720)
    vis = W.WinInjector(rect, user32=FakeUser32(showing=True, pos=(740, 410)))
    assert vis.cursor() == (True, 640, 360)               # menus: pointer visible, in captured-area pixels
    hidden = W.WinInjector(rect, user32=FakeUser32(showing=False))
    assert hidden.cursor()[0] is False                     # mouse-look: hidden pointer
    pinned = W.WinInjector(rect, user32=FakeUser32(showing=True, clip=(740, 410, 741, 411)))
    assert pinned.cursor()[0] is False                     # visible but clipped to a pixel: still mouse-look


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); print("ok", name)
