#!/usr/bin/env python3
"""Render a saved world as an MP4: whole world (left) + close-up (right).

Colours
  green     food species that is nutritious right now
  magenta   food species that is toxic right now (they swap every half-period)
  grey      walls        yellow  caches        dark red  meat
  dots      organisms, in their own heritable colour with a white outline;
            white tick = heading; yellow ring = calling (radius ~ loudness);
            darker background = night

  python scripts/render_video.py --world W.pkl --steps 600 --fps 15 --out video.mp4
"""
import argparse
import os
import pickle
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.backend import to_numpy  # noqa: E402
from noogenesis.world import F_DIR  # noqa: E402


def field_rgb(w):
    K = w.cfg.K_max
    veg = to_numpy(w.veg)
    val = to_numpy(w.species_value)
    H, W = veg.shape[1:]
    img = np.zeros((H, W, 3), np.float32)
    img[:] = (0.10, 0.08, 0.06)                              # soil
    good = np.array([0.20, 0.85, 0.30], np.float32)
    toxic = np.array([0.85, 0.25, 0.80], np.float32)
    for k in range(min(2, K)):
        a = np.clip(veg[k] / 1.0, 0, 1)[:, :, None]
        col = good if val[k] > 0 else toxic
        img = img * (1 - 0.85 * a) + col * 0.85 * a
    cache = np.clip(to_numpy(w.cache).sum(0), 0, 1)[:, :, None]
    img = img * (1 - cache) + np.array([0.95, 0.85, 0.20]) * cache
    meat = np.clip(to_numpy(w.meat) / 2, 0, 1)[:, :, None]
    img = img * (1 - meat) + np.array([0.55, 0.10, 0.08]) * meat
    wall = (to_numpy(w.wall) > 0.5)[:, :, None]
    img = np.where(wall, np.array([0.55, 0.55, 0.58]), img)
    if w.is_night:
        img *= 0.45
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


def draw_agents(draw, w, s_emit, scale, ox=0, oy=0, crop=None, r_body=None):
    A = w.agents
    n = A.n
    pos = to_numpy(A["pos"][:n])
    hd = to_numpy(A["heading"][:n])
    col = ((0.5 + 0.5 * to_numpy(A["color"][:n])) * 255).astype(int)
    loud = np.abs(s_emit).max(1) if s_emit is not None and len(s_emit) == n else np.zeros(n)
    r = r_body or max(2, scale // 2)
    for i in range(n):
        y, x = int(pos[i, 0]), int(pos[i, 1])
        if crop is not None:
            y0, x0, size = crop
            y = (y - y0) % w.cfg.H
            x = (x - x0) % w.cfg.W
            if y >= size or x >= size:
                continue
        cx, cy = ox + x * scale + scale // 2, oy + y * scale + scale // 2
        if loud[i] > 0.15:
            rr = r + 2 + int(loud[i] * scale)
            draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(255, 220, 40), width=1)
        c = tuple(int(v) for v in col[i])
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c, outline=(250, 250, 250))
        dy, dx = F_DIR[hd[i]]
        draw.line([cx, cy, cx + dx * (r + 2), cy + dy * (r + 2)], fill=(255, 255, 255), width=1)


def densest(w, size):
    H, W = w.cfg.H, w.cfg.W
    occ = np.zeros((H, W))
    p = to_numpy(w.agents["pos"][:w.agents.n])
    occ[p[:, 0], p[:, 1]] = 1
    veg = to_numpy(w.veg).sum(0)
    score = np.zeros((H, W))
    for y0 in range(0, H - size + 1, 4):          # keep the box inside the map (no wrap)
        for x0 in range(0, W - size + 1, 4):
            ys = (np.arange(size) + y0) % H
            xs = (np.arange(size) + x0) % W
            score[y0, x0] = occ[np.ix_(ys, xs)].sum() + 0.2 * veg[np.ix_(ys, xs)].sum()
    y0, x0 = np.unravel_index(score.argmax(), score.shape)
    return int(y0), int(x0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--world", required=True)
    ap.add_argument("--steps", type=int, default=600)
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--scale", type=int, default=6)
    ap.add_argument("--zoom", type=int, default=36, help="close-up side length (cells)")
    ap.add_argument("--warmup", type=int, default=0)
    ap.add_argument("--title", default="")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    w = pickle.load(open(a.world, "rb")).clone()
    for _ in range(a.warmup):
        w.step()
    H, W = w.cfg.H, w.cfg.W
    s = a.scale
    zs = max(4, (H * s) // a.zoom)
    head = 54
    left_w, right_w = W * s, a.zoom * zs
    FW, FH = left_w + 10 + right_w, head + max(H * s, a.zoom * zs)
    FW += FW % 2
    FH += FH % 2
    crop = (*densest(w, a.zoom), a.zoom)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 15)
        small = ImageFont.truetype("DejaVuSans.ttf", 12)
    except OSError:
        font = small = ImageFont.load_default()
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{FW}x{FH}", "-r", str(a.fps), "-i", "-", "-c:v", "libx264",
           "-pix_fmt", "yuv420p", "-crf", "27", "-preset", "slow", "-movflags", "+faststart", a.out]
    ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for t in range(a.steps):
        rec = w.step(record=True)
        s_emit = to_numpy(rec["s_emit"]) if rec is not None else None
        # rec is pre-physics; after deaths/births slots differ, so only use it if aligned
        if s_emit is not None and len(s_emit) != w.agents.n:
            s_emit = None
        f = field_rgb(w)
        frame = Image.new("RGB", (FW, FH), (12, 12, 16))
        frame.paste(Image.fromarray(f).resize((W * s, H * s), Image.NEAREST), (0, head))
        y0, x0, size = crop
        ys = (np.arange(size) + y0) % H
        xs = (np.arange(size) + x0) % W
        z = f[np.ix_(ys, xs)]
        frame.paste(Image.fromarray(z).resize((size * zs, size * zs), Image.NEAREST),
                    (left_w + 10, head))
        d = ImageDraw.Draw(frame)
        draw_agents(d, w, s_emit, s, 0, head, r_body=max(1, s // 2 - 1))
        draw_agents(d, w, s_emit, zs, left_w + 10, head, crop=crop, r_body=zs // 3)
        d.rectangle([x0 * s, head + y0 * s, (x0 + size) * s, head + (y0 + size) * s],
                    outline=(255, 255, 255), width=1)
        val = to_numpy(w.species_value)
        tox = [k for k in range(2) if val[k] <= 0]
        A = w.agents
        e = float(to_numpy(A["energy"][:A.n]).mean()) if A.n else 0
        d.text((8, 6), f"{a.title}  t = {w.t:,}   population {A.n}   mean energy {e:.2f}   "
                       f"{'NIGHT' if w.is_night else 'day'}", fill=(235, 235, 235), font=font)
        d.text((8, 30), "green = nutritious now   magenta = toxic now"
                        f" (species {tox[0] if tox else '-'})   yellow ring = calling   "
                        "right: close-up of the white box", fill=(170, 170, 180), font=small)
        ff.stdin.write(np.asarray(frame, np.uint8).tobytes())
    ff.stdin.close()
    ff.wait()
    print("wrote", a.out, f"{a.steps} frames at {a.fps} fps ({a.steps / a.fps:.0f} s), {FW}x{FH}")


if __name__ == "__main__":
    main()
