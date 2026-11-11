#!/usr/bin/env python3
"""
easel.py - a paint program with a physical brush, driven by hand.

Nothing here decides where paint goes.  The program only simulates the tools:

  * tubes of paint and a palette to mix them on,
  * brushes (flat or round) made of bristles that each hold paint, run dry,
    leave streaks, and pick up wet colour from the canvas as they pass,
  * a canvas with tooth that stays wet until it is left to dry.

A painting is a plain text file of the painter's own movements, one per line:

    canvas 1200 900  214 180 130      size and toned ground
    tube   ultramarine 30 45 150      a tube of paint
    mix    sky = ultramarine 2, white 3
    brush  flat 80                    pick up a clean brush (flat | round)
    load   sky                        charge it with paint
    dip                               recharge from the same mix
    clean                             wipe it (a clean brush blends wet paint)
    stroke 40,60 600,48 1180,70       drag it through these points
    stroke 300,200,0.4 340,150,1.0    ...optionally with pressure 0..1
    dab    512,300                    press and lift
    dry                               let the surface dry before going on

Usage:  python3 easel.py painting.paint out.png [--grid preview.png]
"""
import math
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

from paintbrush import blur


class Easel:
    def __init__(self, w, h, ground, ss=2, seed=3):
        self.w, self.h, self.ss = w, h, ss
        self.W, self.H = w * ss, h * ss
        self.rng = np.random.default_rng(seed)
        r = self.rng.random((h // 40 + 2, w // 40 + 2)).astype(np.float32)
        mottle = np.asarray(Image.fromarray(r, "F").resize((self.W, self.H), Image.BICUBIC))
        self.C = np.asarray(ground, np.float32) * (0.96 + 0.08 * mottle)[..., None]
        self.T = np.zeros((self.H, self.W), np.float32)          # paint thickness
        self.wet = np.zeros((self.H, self.W), np.float32)
        yy, xx = np.mgrid[0:self.H, 0:self.W].astype(np.float32)
        weave = np.sin(xx * (2 * math.pi / 7)) * np.sin(yy * (2 * math.pi / 7))
        self.weave = weave
        self.tooth = np.clip(0.5 + 0.25 * weave + 0.5 * (self.rng.random((self.H, self.W), dtype=np.float32) - 0.5), 0, 1)
        self.palette = {}
        self.b = None
        self.well = None
        self.strokes = 0

    # -- palette --------------------------------------------------------------
    def tube(self, name, rgb):
        self.palette[name] = np.asarray(rgb, np.float32)

    def mix(self, name, parts):
        """Mix paints by parts.  Pigments darken each other, so this leans on a
        geometric mean (blue + yellow gives green, not grey)."""
        w = np.asarray([p for _, p in parts], np.float32)
        w = w / w.sum()
        cols = np.stack([self.palette[n] for n, _ in parts]) / 255.0
        geo = np.exp((np.log(np.maximum(cols, 0.03)) * w[:, None]).sum(0))
        ari = (cols * w[:, None]).sum(0)
        self.palette[name] = (0.55 * geo + 0.45 * ari) * 255.0
        return self.palette[name]

    # -- brushes --------------------------------------------------------------
    def brush(self, kind, size, pickup=0.03, flow=0.6, impasto=1.0):
        rng, s = self.rng, size * self.ss
        ncol = max(2, int(s / 1.6))
        if kind == "flat":
            thick = max(5.0, s * 0.16)
            n = int(s * thick * 1.5)
            u = rng.uniform(-0.5, 0.5, n) * s
            col = np.clip(((u / s) + 0.5) * ncol, 0, ncol - 1).astype(int)
            v = rng.uniform(-0.5, 0.5, n) * thick * rng.uniform(0.75, 1.0, ncol)[col]   # ragged tip
            spacing = max(1.0, thick * 0.3)
        else:
            rad = s / 2
            n = int(math.pi * rad * rad * 1.5) + 8
            rr, an = rad * np.sqrt(rng.random(n)), rng.uniform(0, 2 * math.pi, n)
            u, v = rr * np.cos(an), rr * np.sin(an)
            col = np.clip(((u / s) + 0.5) * ncol, 0, ncol - 1).astype(int)
            spacing = max(1.0, rad * 0.25)
        gain = 0.8 + 0.3 * rng.random(ncol)
        gain[rng.random(ncol) < 0.07] *= 0.6                   # a few split bristles
        self.b = dict(kind=kind, s=s, u=u.astype(np.float32), v=v.astype(np.float32), col=col, ncol=ncol,
                      gain=gain.astype(np.float32), spacing=spacing, pickup=pickup, flow=flow,
                      impasto=impasto, capacity=30.0 * s)
        self.bcol = np.zeros((ncol, 3), np.float32)
        self.bload = np.zeros(ncol, np.float32)
        self.fresh = self.blending = True

    def load(self, name, amount=1.0):
        b = self.b
        self.well = (name, amount)
        c = self.palette[name]
        self.bcol = (c[None, :] * (1 + 0.035 * self.rng.standard_normal((b["ncol"], 1)))
                     + 2.5 * self.rng.standard_normal((b["ncol"], 3))).astype(np.float32)
        self.bload = (amount * (0.9 + 0.1 * self.rng.random(b["ncol"]))).astype(np.float32)
        self.fresh = self.blending = False

    def dip(self):
        self.load(*self.well)

    def clean(self):
        self.bload[:] = 0
        self.fresh = self.blending = True

    def dry(self):
        self.wet[:] = 0

    # -- the brush touching the canvas ---------------------------------------
    def _step(self, x, y, th, p, step_len):
        b = self.b
        c, s = math.cos(th), math.sin(th)
        if b["kind"] == "flat":
            k = 0.6 + 0.4 * p                                    # pressure splays the bristles
            px, py = x + c * b["v"] - s * b["u"] * k, y + s * b["v"] + c * b["u"] * k
        else:
            k = 0.3 + 0.7 * p                                    # a round brush comes to a point
            px, py = x + (c * b["v"] - s * b["u"]) * k, y + (s * b["v"] + c * b["u"]) * k
        xi, yi = np.floor(px).astype(np.int32), np.floor(py).astype(np.int32)
        ok = (xi >= 0) & (xi < self.W) & (yi >= 0) & (yi < self.H)
        if not ok.any():
            return
        xi, yi, col = xi[ok], yi[ok], b["col"][ok]
        n = b["ncol"]
        cur = self.C[yi, xi]
        wv = self.wet[yi, xi]
        cnt = np.bincount(col, minlength=n) + 1e-6
        wsum = np.bincount(col, weights=wv, minlength=n)
        if self.fresh:                                           # a clean brush takes on what it touches
            mean = np.stack([np.bincount(col, weights=cur[:, k], minlength=n) for k in range(3)], 1) / cnt[:, None]
            self.bcol = np.where((cnt > 1)[:, None], mean, mean[cnt > 1].mean(0)).astype(np.float32)
            self.fresh = False
        le = np.minimum(1.0, self.bload * 1.6)
        if self.blending:                                        # a clean damp brush drags wet paint along
            a = np.clip(b["flow"] * p * b["gain"][col] * 0.5, 0, 1)
        else:
            a = b["flow"] * p * b["gain"][col] * (0.18 + 0.82 * le[col])
            dryness = np.clip(1 - self.bload[col] / 0.35, 0, 1)  # a dry brush only catches the weave
            a = np.clip(a * (1 - dryness * (self.tooth[yi, xi] < 0.6)), 0, 1)
        self.C[yi, xi] = cur + (self.bcol[col] - cur) * a[:, None]
        self.T[yi, xi] = self.T[yi, xi] * (1 - 0.6 * a) + a * (0.25 + 0.75 * le[col]) * b["gain"][col] * b["impasto"]
        self.wet[yi, xi] = 1.0
        # the bristles pick up wet paint from the canvas
        has = wsum > 0
        if has.any():
            mean = np.stack([np.bincount(col, weights=cur[:, k] * wv, minlength=n) for k in range(3)], 1)
            mean = mean / np.maximum(wsum, 1e-6)[:, None]
            pk = b["pickup"] * p * (1 - 0.85 * le) * np.minimum(1, wsum / cnt)
            self.bcol[has] += (mean[has] - self.bcol[has]) * pk[has, None]
        pad = np.pad(self.bcol, ((1, 1), (0, 0)), mode="edge")
        self.bcol = 0.96 * self.bcol + 0.02 * (pad[:-2] + pad[2:])
        self.bload = np.maximum(0, self.bload - step_len / b["capacity"] * p)

    def stroke(self, pts):
        """Drag the brush through the points (x, y[, pressure]) in one movement."""
        pts = np.asarray([(q[0], q[1], q[2] if len(q) > 2 else 1.0) for q in pts], np.float32)
        pts[:, :2] *= self.ss
        if len(pts) > 2:                                         # Catmull-Rom through the points
            P = np.vstack([pts[0], pts, pts[-1]])
            segs = []
            for i in range(1, len(P) - 2):
                t = np.linspace(0, 1, 24, endpoint=False)[:, None]
                a, b_, c, d = P[i - 1], P[i], P[i + 1], P[i + 2]
                segs.append(0.5 * ((2 * b_) + (-a + c) * t + (2 * a - 5 * b_ + 4 * c - d) * t ** 2
                                   + (-a + 3 * b_ - 3 * c + d) * t ** 3))
            dense = np.vstack(segs + [pts[-1:]])
        else:
            dense = pts
        seg = np.hypot(np.diff(dense[:, 0]), np.diff(dense[:, 1]))
        dist = np.concatenate([[0], np.cumsum(seg)])
        sp = self.b["spacing"]
        n = max(2, int(dist[-1] / sp) + 1)
        s = np.linspace(0, dist[-1], n)
        x, y = np.interp(s, dist, dense[:, 0]), np.interp(s, dist, dense[:, 1])
        p = np.clip(np.interp(s, dist, dense[:, 2]), 0.05, 1)
        kin, kout = min(6, max(1, n // 4)), min(8, max(1, n // 3))
        env = np.ones(n)
        env[:kin] = np.linspace(0.4, 1, kin)                     # touching down, lifting off
        env[-kout:] = np.minimum(env[-kout:], np.linspace(1, 0.3, kout))
        dx, dy = np.gradient(x), np.gradient(y)
        if n > 6:
            ker = np.ones(5) / 5
            dx = np.convolve(np.pad(dx, 2, mode="edge"), ker, "valid")
            dy = np.convolve(np.pad(dy, 2, mode="edge"), ker, "valid")
        th = np.arctan2(dy, dx)
        step_len = dist[-1] / (n - 1) if dist[-1] > 0 else sp
        for i in range(n):
            self._step(x[i], y[i], th[i], float(p[i] * env[i]), step_len)
        self.strokes += 1

    def dab(self, x, y, p=1.0, angle=0.0):
        d = self.b["spacing"] / self.ss
        c, s = math.cos(math.radians(angle)) * d, math.sin(math.radians(angle)) * d
        self.stroke([(x - c, y - s, p), (x, y, p), (x + c, y + s, p)])

    # -- finishing --------------------------------------------------------------
    def image(self, relief=0.55):
        hgt = self.T + (0.035 * self.weave + 0.03 * (self.tooth - 0.5)) * (0.35 + 0.65 * np.exp(-2.5 * self.T))
        hgt = blur(hgt, 1.3)
        gx, gy = np.zeros_like(hgt), np.zeros_like(hgt)
        gx[:, 1:-1] = hgt[:, 2:] - hgt[:, :-2]
        gy[1:-1, :] = hgt[2:, :] - hgt[:-2, :]
        slope = gx * 0.55 + gy * 0.65                           # light from the upper left
        shade = np.clip(1 + 1.9 * relief * slope, 0.62, 1.4)
        spec = np.clip(slope - 0.045, 0, 0.2) * 190 * relief
        img = np.clip(self.C * shade[..., None] + spec[..., None], 0, 255).astype(np.uint8)
        return Image.fromarray(img).resize((self.w, self.h), Image.LANCZOS)


def run(path, verbose=True):
    """Carry out a painter's script, line by line."""
    e = None
    for ln, raw in enumerate(open(path), 1):
        line = raw.split("#")[0].strip()
        if not line:
            continue
        cmd, *a = line.split()
        try:
            if cmd == "canvas":
                e = Easel(int(a[0]), int(a[1]), [float(v) for v in a[2:5]])
            elif cmd == "tube":
                e.tube(a[0], [float(v) for v in a[1:4]])
            elif cmd == "mix":
                name, recipe = line[3:].split("=")
                parts = [(t.split()[0], float(t.split()[1]) if len(t.split()) > 1 else 1.0)
                         for t in recipe.split(",")]
                rgb = e.mix(name.strip(), parts)
                if verbose:
                    print(f"  mix {name.strip():<14} -> {tuple(int(v) for v in rgb)}")
            elif cmd == "brush":
                e.brush(a[0], float(a[1]), **{a[i]: float(a[i + 1]) for i in range(2, len(a), 2)})
            elif cmd == "load":
                e.load(a[0], float(a[1]) if len(a) > 1 else 1.0)
            elif cmd == "dip":
                e.dip()
            elif cmd == "clean":
                e.clean()
            elif cmd == "dry":
                e.dry()
            elif cmd == "stroke":
                e.stroke([tuple(float(v) for v in t.split(",")) for t in a])
            elif cmd == "dab":
                q = [float(v) for v in a[0].split(",")]
                e.dab(q[0], q[1], q[2] if len(q) > 2 else 1.0, float(a[1]) if len(a) > 1 else 0.0)
            else:
                raise ValueError(f"unknown command {cmd!r}")
        except Exception as ex:
            raise SystemExit(f"{path}:{ln}: {raw.strip()}\n  {type(ex).__name__}: {ex}")
    return e


def main():
    args = sys.argv[1:]
    grid = None
    if "--grid" in args:
        i = args.index("--grid")
        grid = args[i + 1]
        del args[i:i + 2]
    src, out = args[0], args[1]
    t0 = time.time()
    e = run(src)
    img = e.image()
    img.save(out, optimize=True)
    print(f"{e.strokes} strokes by hand in {time.time() - t0:.0f}s -> {out}")
    if grid:                                                     # a ruled copy, for stepping back to look
        g = img.copy()
        d = ImageDraw.Draw(g)
        for x in range(100, e.w, 100):
            d.line([(x, 0), (x, e.h)], fill=(255, 255, 255), width=1)
            d.text((x + 3, 2), str(x), fill=(255, 255, 0))
        for y in range(100, e.h, 100):
            d.line([(0, y), (e.w, y)], fill=(255, 255, 255), width=1)
            d.text((3, y + 2), str(y), fill=(255, 255, 0))
        g.save(grid)


if __name__ == "__main__":
    main()
