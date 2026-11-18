"""ShellStream game host: run ANY unmodified game and stream it with input-predicted reprojection.

The shell renderer needs a cooperating engine (camera control, depth).  A closed game -- Roblox, a Steam game,
anything -- exposes only pixels.  This module makes such games playable through the same browser client:

  * VirtualDisplay  : an X display for the game (Xvfb here; an NVIDIA-backed X server or VirtualGL/EGL on a
                      GPU machine -- see `launcher`)
  * XInjector       : the player's mouse/keyboard events, injected with XTest the moment they arrive
  * XGrabber        : the game window's pixels
  * Calibrator      : learns, while you play, how far the image moves per mouse count and how many frames the
                      game takes to show it (phase correlation of consecutive frames vs. injected counts)
  * VideoEncoder    : H.264 through NVENC on a chosen T4 (PyAV / FFmpeg), x264 or JPEG as fallbacks
  * GameHost        : the frame source the server streams from

Every frame carries the mouse counts it already reflects.  The browser knows how many counts it has sent
since, and re-projects the newest frame by that much rotation before every display refresh, inside an
overscanned field of view.  Look latency becomes local even though the game itself runs remotely.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
from collections import deque

import numpy as np

# ---------------------------------------------------------------------------------------------- keys
KEYMAP = {"Space": "space", "Enter": "Return", "Tab": "Tab", "Backspace": "BackSpace", "Escape": "Escape",
          "ShiftLeft": "Shift_L", "ShiftRight": "Shift_R", "ControlLeft": "Control_L", "ControlRight": "Control_R",
          "AltLeft": "Alt_L", "AltRight": "Alt_R", "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left",
          "ArrowRight": "Right", "Minus": "minus", "Equal": "equal", "BracketLeft": "bracketleft",
          "BracketRight": "bracketright", "Semicolon": "semicolon", "Quote": "apostrophe", "Backquote": "grave",
          "Backslash": "backslash", "Comma": "comma", "Period": "period", "Slash": "slash", "CapsLock": "Caps_Lock",
          "Delete": "Delete", "Home": "Home", "End": "End", "PageUp": "Prior", "PageDown": "Next", "Insert": "Insert"}
for _c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    KEYMAP["Key" + _c] = _c.lower()
for _d in "0123456789":
    KEYMAP["Digit" + _d] = _d
for _f in range(1, 13):
    KEYMAP[f"F{_f}"] = f"F{_f}"


def _free_display():
    for n in range(60, 160):
        if not os.path.exists(f"/tmp/.X11-unix/X{n}") and not os.path.exists(f"/tmp/.X{n}-lock"):
            return n
    raise RuntimeError("no free X display number")


class VirtualDisplay:
    """Xvfb for development and CPU-only machines.  On a T4 machine, point GameHost at a GPU-backed X server
    (nvidia-xconfig --virtual=WxH, one screen per GPU) or keep Xvfb and launch the game through VirtualGL
    (launcher=['vglrun', '-d', 'egl0']) so its OpenGL/Vulkan work runs on the T4."""

    def __init__(self, w, h, num=None):
        self.num = num if num is not None else _free_display()
        self.name = f":{self.num}"
        self.proc = subprocess.Popen(["Xvfb", self.name, "-screen", "0", f"{w}x{h}x24", "-nolisten", "tcp"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if os.path.exists(f"/tmp/.X11-unix/X{self.num}"):
                break
            time.sleep(0.05)
        time.sleep(0.2)

    def stop(self):
        self.proc.terminate()


class XInjector:
    def __init__(self, display_name, window_id, rect=(0, 0, 0, 0)):
        from Xlib import X, XK, display
        from Xlib.ext import xtest
        self.X, self.XK, self.xtest = X, XK, xtest
        self.d = display.Display(display_name)
        self.win = self.d.create_resource_object("window", window_id)
        self.rect = rect
        self.dc = display.Display(display_name)         # own connection for cursor queries (capture thread)
        try:
            self.dc.xfixes_query_version()
            self.has_xfixes = True
        except Exception:
            self.has_xfixes = False
        self.lock = threading.Lock()
        self.cx = self.cy = 0           # cumulative relative mouse counts injected
        self.hist = deque([(0.0, 0, 0)], maxlen=4096)   # (time, cx, cy) after every injection
        self.focus()

    def counts_at(self, t):
        """cumulative counts injected up to time t"""
        with self.lock:
            for tt, cx, cy in reversed(self.hist):
                if tt <= t:
                    return cx, cy
            return self.hist[0][1], self.hist[0][2]

    def focus(self):
        # no window manager on a virtual display: give the game keyboard focus explicitly
        self.win.set_input_focus(self.X.RevertToParent, self.X.CurrentTime)
        self.d.sync()

    def inject(self, events):
        X, xt = self.X, self.xtest
        with self.lock:
            for ev in events:
                kind = ev[0]
                if kind == "m":
                    dx, dy = int(ev[1]), int(ev[2])
                    if dx or dy:
                        xt.fake_input(self.d, X.MotionNotify, detail=True, x=dx, y=dy)
                        self.cx += dx; self.cy += dy
                        self.hist.append((time.perf_counter(), self.cx, self.cy))
                elif kind == "k":
                    name = KEYMAP.get(ev[1])
                    if name:
                        kc = self.d.keysym_to_keycode(self.XK.string_to_keysym(name))
                        if kc:
                            xt.fake_input(self.d, X.KeyPress if ev[2] else X.KeyRelease, kc)
                elif kind == "a":                     # absolute pointer position in the captured area
                    x = self.rect[0] + int(min(max(float(ev[1]), 0), max(self.rect[2] - 1, 0)))
                    y = self.rect[1] + int(min(max(float(ev[2]), 0), max(self.rect[3] - 1, 0)))
                    xt.fake_input(self.d, X.MotionNotify, x=x, y=y)
                elif kind == "b":
                    btn = {0: 1, 1: 2, 2: 3, 3: 8, 4: 9}.get(int(ev[1]), 1)
                    xt.fake_input(self.d, X.ButtonPress if ev[2] else X.ButtonRelease, btn)
                elif kind in ("w", "wh"):
                    btn = (4 if ev[1] < 0 else 5) if kind == "w" else (6 if ev[1] < 0 else 7)
                    xt.fake_input(self.d, X.ButtonPress, btn); xt.fake_input(self.d, X.ButtonRelease, btn)
            self.d.sync()
            return self.cx, self.cy

    def cursor(self):
        """(visible, x, y) in the captured area.  Games hide the pointer while it turns the camera."""
        if not self.has_xfixes:
            return False, None, None
        r = self.dc.xfixes_get_cursor_image(self.dc.screen().root)
        visible = any((p >> 24) & 0xFF for p in r.cursor_image)
        return visible, r.x - self.rect[0], r.y - self.rect[1]


class XGrabber:
    def __init__(self, display_name, x, y, w, h):
        from Xlib import X, display
        self.X = X
        self.d = display.Display(display_name)
        self.root = self.d.screen().root
        self.rect = (x, y, w, h)

    def grab(self):
        x, y, w, h = self.rect
        raw = self.root.get_image(x, y, w, h, self.X.ZPixmap, 0xFFFFFFFF)
        return np.frombuffer(raw.data, np.uint8).reshape(h, w, 4)[:, :, 2::-1]   # BGRX -> RGB view


# ---------------------------------------------------------------------------------------------- calibration
def phase_shift(a, b):
    """translation (dx, dy) that maps a onto b (b(x) ~ a(x - d)), with sub-pixel peak refinement"""
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    A, B = np.fft.rfft2(a * win), np.fft.rfft2(b * win)
    R = B * np.conj(A)
    R /= np.abs(R) + 1e-6
    r = np.fft.irfft2(R, s=a.shape)
    iy, ix = np.unravel_index(np.argmax(r), r.shape)
    peak = float(r[iy, ix])
    # parabolic sub-pixel refinement along each axis
    def para(v_m, v_0, v_p):
        den = v_m - 2 * v_0 + v_p
        return 0.0 if abs(den) < 1e-12 else 0.5 * (v_m - v_p) / den
    fx = para(r[iy, (ix - 1) % w], r[iy, ix], r[iy, (ix + 1) % w])
    fy = para(r[(iy - 1) % h, ix], r[iy, ix], r[(iy + 1) % h, ix])
    dx = ix + fx; dy = iy + fy
    if dx > w / 2: dx -= w
    if dy > h / 2: dy -= h
    return dx, dy, peak


class Calibrator:
    """Learns image shift per injected mouse count (kx, ky, px/count) and the game's display lag, online.

    For candidate lags L (0..max_lag capture frames) it fits shift_k = K * dcounts_{k-L} by least squares over a
    sliding window and keeps the lag with the best fit.  Frames where the HUD-free crop barely correlates
    (scene cuts, menus) or where nothing was injected are ignored.

    With the game's vertical field of view known, the crop is resampled to angle coordinates first (column
    azimuth atan(t_x), row elevation atan(t_y)).  A turn is then a uniform shift, and kx, ky come out as the
    rotation per count, in pixels at the image centre.  In plain pixels, a turn moves the edges of a wide view
    up to three times as far as the centre, so the fitted value depended on where the texture happened to be."""

    def __init__(self, crop=(0.12, 0.44, 0.12, 0.88), scale=None, window=240, max_lag=4, fov_v=None):
        # scale=None: sample grid and HUD blocks grow with the frame, so 1080p costs what 640x360 does
        self.crop, self.scale, self.window, self.max_lag = crop, scale, window, max_lag
        self.auto = scale is None
        self.fov_v = fov_v
        self._map = None                           # cached angle-space resampling for one frame size
        self._ux = self._uy = float(scale or 2)    # centre-equivalent pixels per resampled sample
        self.prev = None
        self.horizon = 6                                      # captures per fitting window
        self.gbuf = deque(maxlen=self.horizon + 1)            # the last horizon+1 resampled crops
        self.hist = deque(maxlen=window + max_lag + 2)       # (cx, cy, sx, sy, peak, t, span sx, span sy, span peak)
        self.counts = deque(maxlen=max_lag + 2)
        self.lag_s = 0.0
        self.kx = self.ky = 0.0
        self.lag = 0
        self.r2 = 0.0
        self.n = 0
        # screen-fixed overlay (HUD, crosshair, first-person hand, chat) learned from the frames themselves:
        # while the world visibly moves, pixels that stay identical belong to the overlay
        self.hud_block = 4 if scale is not None else None
        self.hud_prev = None
        self.hud_score = None
        self.hud_votes = 0
        self.hud_n = None                          # informative votes per block
        self.hud_version = 0

    def _small(self, rgb):
        h, w = rgb.shape[:2]
        y0, y1, x0, x1 = (int(self.crop[0] * h), int(self.crop[1] * h), int(self.crop[2] * w), int(self.crop[3] * w))
        if not self.fov_v:
            g = rgb[y0:y1:self.scale, x0:x1:self.scale].astype(np.float32).mean(axis=2)
            return g - g.mean()
        if self._map is None or self._map[0] != (h, w):
            tfy = math.tan(math.radians(self.fov_v) / 2); tfx = tfy * w / h
            fx, fy = (w / 2) / tfx, (h / 2) / tfy
            ax = np.arctan((2 * (np.array([x0, x1 - 1]) + 0.5) / w - 1) * tfx)      # azimuth of the crop's edges
            ay = np.arctan((1 - 2 * (np.array([y0, y1 - 1]) + 0.5) / h) * tfy)      # elevation (top > bottom)
            nx, ny = (x1 - x0) // self.scale, (y1 - y0) // self.scale
            a, b = np.meshgrid(np.linspace(ax[0], ax[1], nx), np.linspace(ay[0], ay[1], ny))
            to_px = lambda tx, ty: (np.clip(np.round((1 - ty / tfy) * h / 2 - 0.5), 0, h - 1).astype(np.intp),
                                    np.clip(np.round((tx / tfx + 1) * w / 2 - 0.5), 0, w - 1).astype(np.intp))
            # yaw map: (azimuth, elevation about the camera's horizontal plane): a turn shifts it uniformly
            tx = np.tan(a); yaw_map = to_px(tx, np.tan(b) * np.sqrt(1 + tx * tx))
            # pitch map: (elevation, azimuth about the camera's vertical plane): a nod shifts it uniformly
            ty = np.tan(b); pitch_map = to_px(np.tan(a) * np.sqrt(1 + ty * ty), ty)
            self._map = ((h, w), yaw_map, pitch_map)
            self._ux = float((ax[1] - ax[0]) / (nx - 1) * fx)     # radians per sample x focal length
            self._uy = float((ay[0] - ay[1]) / (ny - 1) * fy)
        _, (yr, yc), (pr, pc) = self._map
        gy = rgb[yr, yc].astype(np.float32).mean(axis=2)
        gp = rgb[pr, pc].astype(np.float32).mean(axis=2)
        return np.stack([gy - gy.mean(), gp - gp.mean()])

    def _shift(self, a, b):
        """image motion a -> b in centre-equivalent pixels, and the correlation peak"""
        if a.ndim == 3:                           # angle space: horizontal from the yaw map, vertical from the pitch map
            dx, _, p1 = phase_shift(a[0], b[0])
            _, dy, p2 = phase_shift(a[1], b[1])
            return dx * self._ux, dy * self._uy, min(p1, p2)
        dx, dy, p = phase_shift(a, b)
        return dx * self._ux, dy * self._uy, p

    def update(self, rgb, cx, cy, t=None, look=True):
        """one captured frame and the counts injected so far.  look=False: the game shows a pointer (menus), so
        counts moved the pointer, not the camera; such frames don't enter the fit or the HUD mask."""
        if self.auto and self.hud_block is None:
            w = rgb.shape[1]
            self.scale, self.hud_block = max(2, int(round(w / 320))), max(4, w // 160)
            self._ux = self._uy = float(self.scale)
        g = self._small(rgb)
        t = time.perf_counter() if t is None else t
        self.counts.append((cx, cy))
        small = rgb[::self.hud_block, ::self.hud_block].astype(np.float32).mean(axis=2)
        if self.gbuf and self.gbuf[-1].shape != g.shape:
            self.gbuf.clear()
        self.gbuf.append(g)
        if self.prev is not None and self.prev.shape == g.shape:
            dx, dy, peak = self._shift(self.prev, g)
            # the shift over the whole fitting window, measured in one correlation: summing per-pair shifts
            # accumulated their sub-pixel bias (the online fit came out 5 % high on the game)
            span = self._shift(self.gbuf[0], g) if len(self.gbuf) == self.horizon + 1 else (np.nan, np.nan, 0.0)
            self.hist.append([cx, cy, dx, dy, peak, t, *span, float(look)])
            if look and peak > 0.1 and np.hypot(dx, dy) >= 4 and self.hud_prev is not None \
                    and self.hud_prev.shape == small.shape:
                # Only *discriminating* blocks vote.  A block that changed is world.  A block that stayed put is
                # overlay only if moving it with the world would have visibly changed it; a plain block (sky,
                # flat walls) looks the same either way and says nothing.  The first version counted every
                # unchanged block as overlay and marked a quarter of the screen, sky included, as HUD.
                sx = int(round(dx / self.hud_block)); sy = int(round(dy / self.hud_block))
                moved = np.roll(self.hud_prev, (sy, sx), axis=(0, 1))         # prev(x - d): the world's next view
                valid = np.ones(small.shape, bool)
                if sy > 0: valid[:sy] = False
                elif sy < 0: valid[sy:] = False
                if sx > 0: valid[:, :sx] = False
                elif sx < 0: valid[:, sx:] = False
                changed = np.abs(small - self.hud_prev) >= 2.5
                overlay = ~changed & (np.abs(moved - self.hud_prev) > 8.0) & valid
                vote = changed | overlay
                if self.hud_score is None or self.hud_score.shape != small.shape:
                    self.hud_score = np.zeros(small.shape, np.float32)
                    self.hud_n = np.zeros(small.shape, np.int32)
                self.hud_n += vote
                # running mean for a block's first votes, then an exponential average (overlays can change)
                rate = np.maximum(0.08, 1.0 / np.maximum(self.hud_n, 1))
                self.hud_score = np.where(vote, (1 - rate) * self.hud_score + rate * overlay, self.hud_score)
                self.hud_votes += 1
                if self.hud_votes % 15 == 0:
                    self.hud_version += 1
        self.hud_prev = small
        self.prev = g
        if len(self.hist) > 20 and len(self.hist) % 5 == 0:
            self._fit()

    def _fit(self):
        """Fit image shift = K * injected counts over *multi-frame windows* (the shift across `horizon` captures vs.
        the counts injected over the same span, shifted by a candidate lag).  Windows make the fit immune to
        duplicate captures (game slower than capture) and frame-time jitter, which biased a per-frame fit by
        +-15 %."""
        horizon = self.horizon
        H = np.array(self.hist, np.float64)
        n = len(H)
        if n < horizon + self.max_lag + 12:
            return
        c, ok = H[:, :2], (H[:, 8] > 0.08) & np.isfinite(H[:, 6])
        span = np.nan_to_num(H[:, 6:8])
        menu = np.concatenate([[0], np.cumsum(H[:, 9] < 0.5)])       # frames with a visible pointer
        best = None
        for L in range(0, self.max_lag + 1):
            ks = np.arange(horizon + L, n)
            dS = span[ks]                                              # shift from capture k - horizon to k
            dC = c[ks - L] - c[ks - L - horizon]
            m = ok[ks] & (np.abs(dC).sum(1) > 2) & (menu[ks + 1] - menu[ks - L - horizon] == 0)
            if m.sum() < 10:
                continue
            k, res, tot = [], 0.0, 0.0
            for axis in (0, 1):
                x, y = dC[m, axis], dS[m, axis]
                kk = float((x * y).sum() / max((x * x).sum(), 1e-9))
                k.append(kk)
                res += float(((y - kk * x) ** 2).sum()); tot += float(((y - y.mean()) ** 2).sum() + 1e-9)
            r2 = 1 - res / tot
            if best is None or r2 > best[0]:
                best = (r2, L, k, int(m.sum()))
        if best and (best[0] >= 0.8 or best[0] >= self.r2):
            # Pixels per count follow from the game's settings and don't drift.  Keep a good calibration through
            # stretches the image can't confirm (night, menus, a blank wall); replace it when a window fits well
            # or fits better.  Overwriting it with every window's fit turned prediction off when the test world
            # reached night.
            self.r2, self.lag, (self.kx, self.ky), self.n = best
            dts = np.diff(H[:, 5])
            self.lag_s = float(self.lag * np.median(dts)) if len(dts) else 0.0

    def hud_mask(self):
        """uint8 mask (255 = screen-fixed overlay) at 1/hud_block resolution, or None until learned"""
        if self.hud_score is None or self.hud_votes < 20:
            return None
        known = self.hud_n >= 6
        m = known & (self.hud_score > 0.85)
        # Flat interiors of opaque panels never vote (they look the same moved or not).  An unknown block whose
        # nearest known neighbours on both sides, along a row or a column, are overlay and less than a tenth of
        # the frame apart is inside a panel: count it as overlay.  Plain sky between world blocks stays world.
        lab = np.where(known, m.astype(np.int8), np.int8(-1))
        gap = max(lab.shape) // 10
        m = m | _between(lab, gap) | _between(lab.T, gap).T
        # one block of dilation: overlay edges are anti-aliased
        d = m.copy()
        d[1:] |= m[:-1]; d[:-1] |= m[1:]; d[:, 1:] |= m[:, :-1]; d[:, :-1] |= m[:, 1:]
        return (d * 255).astype(np.uint8)

    def state(self):
        return dict(kx=round(self.kx, 4), ky=round(self.ky, 4), lag=self.lag, lag_ms=round(self.lag_s * 1000, 1),
                    r2=round(self.r2, 3), n=self.n)


def _between(lab, maxgap):
    """unknown (-1) cells of each row whose nearest known cells left and right are both 1, at most maxgap apart"""
    h, w = lab.shape
    idx = np.broadcast_to(np.arange(w), (h, w))
    known = lab >= 0
    li = np.maximum.accumulate(np.where(known, idx, -1), axis=1)
    ri = np.minimum.accumulate(np.where(known, idx, w)[:, ::-1], axis=1)[:, ::-1]
    rows = np.arange(h)[:, None]
    lv = np.where(li >= 0, lab[rows, li.clip(0)], -1)
    rv = np.where(ri < w, lab[rows, ri.clip(max=w - 1)], -1)
    return ~known & (lv == 1) & (rv == 1) & (ri - li <= maxgap)


# ---------------------------------------------------------------------------------------------- encoding
class VideoEncoder:
    """Low-latency H.264: NVENC on the chosen GPU when the driver provides it, else x264.  One packet per frame,
    no B-frames, no lookahead.  Packets are Annex-B, which WebCodecs decodes directly."""

    def __init__(self, w, h, fps=60, bitrate=8_000_000, gpu=0, prefer=("h264_nvenc", "libx264")):
        import av
        self.av = av
        self.w, self.h = w, h
        self.name = None
        last = None
        for name in prefer:
            try:
                cc = av.CodecContext.create(name, "w")
                cc.width, cc.height, cc.pix_fmt = w, h, "yuv420p"
                cc.framerate = int(round(fps))
                cc.bit_rate = int(bitrate)
                cc.gop_size = 600
                if name == "h264_nvenc":
                    cc.options = {"preset": "p1", "tune": "ull", "zerolatency": "1", "delay": "0", "bf": "0",
                                  "rc": "cbr", "gpu": str(gpu), "forced-idr": "1"}
                else:
                    cc.options = {"preset": "ultrafast", "tune": "zerolatency", "bf": "0"}
                cc.open()
                self.cc, self.name = cc, name
                break
            except Exception as e:  # driver without NVENC, or no GPU
                last = e
        if self.name is None:
            raise RuntimeError(f"no H.264 encoder available: {last!r}")
        self.force_key = True
        self.pts = 0

    def encode(self, rgb):
        f = self.av.VideoFrame.from_ndarray(np.ascontiguousarray(rgb), format="rgb24").reformat(format="yuv420p")
        f.pts = self.pts; self.pts += 1
        if self.force_key:
            f.pict_type = self.av.video.frame.PictureType.I
            self.force_key = False
        out = b"".join(bytes(p) for p in self.cc.encode(f))
        key = out[:64].find(b"\x00\x00\x01\x67") >= 0 or out[:64].find(b"\x00\x00\x01\x65") >= 0 \
            or b"\x00\x00\x01\x65" in out[:4096]
        return out, key


class GameHost:
    """Frame source for ShellServer: streams any game's window, injects input, publishes calibration."""
    kind = "host"

    def __init__(self, cmd=None, size=(960, 540), display=None, fov_v=None, overscan=1.0, codec="auto", jpeg_q=80,
                 fps=60, bitrate=None, gpu=0, cwd=None, env=None, launcher=(), window_name=None, settle=90.0,
                 desktop=False):
        """cmd: the game's command line (None: stream what's already on the screen).  desktop=True streams the
        whole screen (menus, launcher, browser, the game), otherwise the game's window.  On Windows the
        screen is the primary monitor; elsewhere an X display (a new Xvfb unless `display` is given)."""
        self.size = size
        self.fov_v, self.overscan, self.fps = fov_v, overscan, fps
        self.vd = None
        self.proc = None
        if sys.platform == "win32":
            import host_win as W
            if cmd:
                self.proc = subprocess.Popen(list(launcher) + list(cmd), cwd=cwd, env=dict(os.environ, **(env or {})))
            hwnd, rect = (None, W.desktop_rect()) if (desktop or not window_name) else W.find_window(window_name, settle)
            self.inj = W.WinInjector(rect, hwnd=hwnd)
            self.grab = W.WinGrabber(rect)
            self.display = "windows:" + ("desktop" if hwnd is None else window_name)
        else:
            if display is None:
                self.vd = VirtualDisplay(*size)
                display = self.vd.name
            self.display = display
            e = dict(os.environ, DISPLAY=display, **(env or {}))
            if cmd:
                self.proc = subprocess.Popen(list(launcher) + list(cmd), cwd=cwd, env=e,
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if cmd and not desktop:
                self.wid, rect = self._find_window(window_name, settle)
            else:
                from Xlib import display as xd
                root = xd.Display(display).screen().root
                g = root.get_geometry()
                self.wid, rect = root.id, (0, 0, g.width, g.height)
            self.inj = XInjector(display, self.wid, rect)
            self.grab = XGrabber(display, *rect)
        self._setup(rect, codec, jpeg_q, bitrate, gpu)

    @classmethod
    def from_backend(cls, inj, grab, rect, fov_v=None, overscan=1.0, fps=60, codec="auto", jpeg_q=80, bitrate=None, gpu=0):
        """a host around any injector/grabber pair (tests, benchmarks, other capture backends)"""
        self = cls.__new__(cls)
        self.size, self.fov_v, self.overscan, self.fps = rect[2:], fov_v, overscan, fps
        self.vd = self.proc = None
        self.display, self.inj, self.grab = "custom", inj, grab
        self._setup(rect, codec, jpeg_q, bitrate, gpu)
        return self

    def _setup(self, rect, codec, jpeg_q, bitrate, gpu):
        fps, fov_v = self.fps, self.fov_v
        self.w, self.h = rect[2], rect[3]
        if bitrate is None:                         # about 0.1 bit per pixel: 1080p60 -> 12 Mbit/s
            bitrate = int(max(4e6, 0.1 * self.w * self.h * fps))
        self.cal = Calibrator(fov_v=fov_v)
        self.jpeg = None
        self.video = None
        self.codec = codec
        if codec in ("auto", "h264"):
            try:
                self.video = VideoEncoder(self.w - self.w % 2, self.h - self.h % 2, fps=fps, bitrate=bitrate, gpu=gpu)
                self.codec = "h264"
            except Exception as ex:
                if codec == "h264":
                    raise
                self.codec = "jpeg"
                self.video_error = repr(ex)
        if self.codec == "jpeg":
            import engine as E
            self.jpeg = E.JpegEncoder(jpeg_q, prefer_gpu=False)
        self.last_hash = None
        self.lock = threading.Lock()
        # the calibrator runs beside capture and encoding, on the newest frame, so it never costs frame rate
        self._cal_item = None
        self._cal_ev = threading.Event()
        self._alive = True
        threading.Thread(target=self._cal_loop, daemon=True).start()

    def _cal_loop(self):
        while self._alive:
            if not self._cal_ev.wait(0.2):
                continue
            self._cal_ev.clear()
            item, self._cal_item = self._cal_item, None
            if item is not None:
                try:
                    self.cal.update(*item)
                    self.cal_updates = getattr(self, "cal_updates", 0) + 1
                except Exception:
                    import traceback; traceback.print_exc()

    # -------------------------------------------------------------- window discovery
    def _find_window(self, name, settle):
        from Xlib import X, display as xd
        d = xd.Display(self.display)
        root = d.screen().root
        t0 = time.time()
        while time.time() - t0 < settle:
            best = None
            for c in root.query_tree().children:
                try:
                    a = c.get_attributes(); g = c.get_geometry()
                    if a.map_state != X.IsViewable or g.width < 64 or g.height < 64:
                        continue
                    title = c.get_wm_name() or ""
                    if name and name.lower() not in str(title).lower():
                        continue
                    if best is None or g.width * g.height > best[1]:
                        best = (c.id, g.width * g.height, (g.x, g.y, g.width, g.height))
                except Exception:
                    continue
            if best:
                # games often replace their first window during start-up: accept a window only once it has
                # stayed the same (id and geometry) for 1.5 s
                if getattr(self, "_cand", None) == best[0] and time.time() - self._cand_t >= 1.5:
                    return best[0], best[2]
                if getattr(self, "_cand", None) != best[0]:
                    self._cand, self._cand_t = best[0], time.time()
            time.sleep(0.25)
        raise RuntimeError("game window did not appear")

    # -------------------------------------------------------------- server interface
    def world_info(self):
        return {"type": "world", "mode": "host", "w": self.w - self.w % 2, "h": self.h - self.h % 2,
                "fov_v": self.fov_v, "overscan": self.overscan, "codec": self.codec,
                "encoder": self.video.name if self.video else "jpeg"}

    def spawn_points(self):
        return []

    def inject(self, events):
        return self.inj.inject(events)

    def set_codec(self, codec):
        """the browser can't decode H.264: fall back to JPEG for this session"""
        if codec == "jpeg" and self.codec != "jpeg":
            import engine as E
            self.jpeg = self.jpeg or E.JpegEncoder(80, prefer_gpu=False)
            self.video, self.codec = None, "jpeg"

    def request_keyframe(self):
        if self.video:
            self.video.force_key = True

    def produce(self, frame_id, force=False):
        t0 = time.perf_counter()
        rgb = self.grab.grab()
        cx, cy = self.inj.cx, self.inj.cy
        t_cap = time.perf_counter()
        visible, px, py = self.inj.cursor()
        self._cal_item = (rgb, cx, cy, t_cap, not visible)
        self._cal_ev.set()
        hsh = hashlib.blake2b(rgb[::16, ::16].tobytes(), digest_size=8).digest()
        if hsh == self.last_hash and not force:
            return None, None
        self.last_hash = hsh
        rx, ry = self.inj.counts_at(t_cap - self.cal.lag_s)      # counts this frame already shows
        if self.video:
            frame = rgb[: self.video.h, : self.video.w]
            data, key = self.video.encode(frame)
        else:
            data, key = self.jpeg.encode_host(np.ascontiguousarray(rgb)), True
        t_enc = time.perf_counter()
        hdr = dict(type="gframe", id=frame_id, codec=self.codec, key=key, w=self.w - self.w % 2, h=self.h - self.h % 2,
                   cx=rx, cy=ry, cal=self.cal.state(), fov_v=self.fov_v, overscan=self.overscan,
                   look=not visible, cur=[px, py] if visible and px is not None else None,
                   stats=dict(capture_ms=round((t_cap - t0) * 1000, 2), encode_ms=round((t_enc - t_cap) * 1000, 2),
                              bytes=len(data)))
        extra = b""
        if self.cal.hud_version != getattr(self, "_hud_sent", -1) or key:
            m = self.cal.hud_mask()
            if m is not None:
                import zlib
                z = zlib.compress(m.tobytes(), 6)
                hdr["hud"] = dict(off=len(data), len=len(z), w=m.shape[1], h=m.shape[0])
                extra = z
                self._hud_sent = self.cal.hud_version
                if os.environ.get("SS_HUD_DUMP"):                  # debugging aid: the mask the browser gets
                    from PIL import Image
                    Image.fromarray(m).save(os.environ["SS_HUD_DUMP"])
        hdr["dlen"] = len(data)
        hb = json.dumps(hdr, separators=(",", ":")).encode()
        return len(hb).to_bytes(4, "little") + hb + data + extra, hdr["stats"]

    def close(self):
        self._alive = False
        try:
            if self.proc:
                self.proc.terminate()
        except Exception:
            pass
        if self.vd:
            self.vd.stop()


def minetest_command(workdir, w=960, h=540, fov=90, sensitivity=0.2):
    """A real third-party game for testing: Minetest (open-source voxel FPS), launched straight into a world."""
    exe = shutil.which("minetest") or "/usr/games/minetest"
    os.makedirs(os.path.join(workdir, "world"), exist_ok=True)
    # every launch is the same experiment: fresh player at the spawn point, 10:00 in the game, clock stopped
    # (the clock had carried over between runs and reached night, where dark frames don't correlate)
    for f in ("players.sqlite", "env_meta.txt"):
        if os.path.exists(os.path.join(workdir, "world", f)):
            os.remove(os.path.join(workdir, "world", f))
    with open(os.path.join(workdir, "world", "world.mt"), "w") as f:
        f.write("gameid = minetest\nbackend = sqlite3\nplayer_backend = sqlite3\ncreative_mode = true\nenable_damage = false\n")
    conf = os.path.join(workdir, "minetest.conf")
    with open(conf, "w") as f:
        f.write(f"screen_w = {w}\nscreen_h = {h}\nfullscreen = false\nenable_shaders = false\nviewing_range = 80\n"
                f"fps_max = 60\nfps_max_unfocused = 60\npause_on_lost_focus = false\nenable_sound = false\nfov = {fov}\n"
                f"enable_clouds = false\nmouse_sensitivity = {sensitivity}\nfixed_map_seed = 42\n"
                f"time_speed = 0\nworld_start_time = 10000\n")
    return [exe, "--config", conf, "--go", "--world", os.path.join(workdir, "world"), "--gameid", "minetest",
            "--name", "player", "--password", ""]
