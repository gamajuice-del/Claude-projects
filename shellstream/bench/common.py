"""Shared helpers for the measurement harnesses (headless Chromium + in-process server)."""
from __future__ import annotations

import base64
import glob
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import engine as E  # noqa: E402
import server as S  # noqa: E402

RESULTS = os.path.join(ROOT, "results")
os.makedirs(RESULTS, exist_ok=True)


def chromium_path():
    for pat in ["/opt/pw-browsers/chromium-*/chrome-linux64/chrome", "/opt/pw-browsers/chromium-*/chrome-linux/chrome"]:
        c = sorted(glob.glob(pat))
        if c:
            return c[-1]
    return None   # let playwright use its own download


def launch(p):
    exe = chromium_path()
    kw = dict(args=["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    if exe:
        kw["executable_path"] = exe
    return p.chromium.launch(**kw)


def decode_capture(cap):
    w, h = cap["w"], cap["h"]
    px = np.frombuffer(base64.b64decode(cap["b64"]), np.uint8).reshape(h, w, 4)[::-1, :, :3]
    return np.ascontiguousarray(px)


def ground_truth(be, pos, yaw, pitch, w, h, fov_deg=90.0, quality="high", t=0.0, spp=1, ss=1):
    """spp: rotated-grid samples per pixel; ss: additional ordered ss x ss supersampling (box filtered)"""
    r, u, f = E.basis_from_yaw_pitch(yaw, pitch)
    tx = math.tan(math.radians(fov_deg) / 2)
    ty = tx * h / w
    W, H = w * ss, h * ss
    v = E.make_view(pos, r, u, f, -tx, tx, -ty, ty, (0, 0, W, H))
    rgb, _, _ = be.render(E.pack_params([v], t=t, quality=quality, spp=spp), W, H, E.MODE_COLOR)
    if ss > 1:
        rgb = (rgb.reshape(h, ss, w, ss, 3).astype(np.float32).mean(axis=(1, 3)) + 0.5).astype(np.uint8)
    return rgb


def psnr(a, b):
    mse = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    return 99.0 if mse == 0 else 10 * math.log10(255.0 ** 2 / mse)


def ssim(a, b):
    from skimage.metrics import structural_similarity
    return float(structural_similarity(a, b, channel_axis=2, data_range=255))


def wait_for(pg, js, timeout=60.0, poll=0.1):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = pg.evaluate(js)
        if v:
            return v
        time.sleep(poll)
    raise TimeoutError(js)
