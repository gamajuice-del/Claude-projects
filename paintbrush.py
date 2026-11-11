#!/usr/bin/env python3
"""
paintbrush.py - a small oil-painting program.

It has three parts:

  1. A brush.  Every stroke is a bundle of individual bristles dragged along a
     curved path.  Each bristle carries its own slightly different colour and
     paint load, the brush is loaded with two colours at once, it picks up a
     little wet paint from the canvas, and its ends are ragged.  Paint thickness
     is tracked in a height map so the finished picture can be lit from the
     side like real impasto.

  2. A picture in the painter's head: a sunset over a mountain lake, described
     with maths (colour, and the direction the brush should move, everywhere).

  3. A painter, who works the way people do: toned ground, big brushes first,
     then smaller ones only where the picture still looks wrong, then accents
     by hand - glitter on the water, grasses, flowers, a sail.

Usage:  python3 paintbrush.py [output.png]
"""
import colorsys
import math
import random
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SEED = 11
random.seed(SEED)
rng = np.random.default_rng(SEED)

FW, FH = 1800, 1200          # finished painting
SS = 2                       # painted at 2x, then reduced
W, H = FW * SS, FH * SS      # working canvas
RW, RH = 900, 600            # resolution of the picture in the painter's head
K = W / RW
ASPECT = RW / RH


def configure(fw, fh, ref_scale=0.5):
    """Change the canvas size (and how finely the painter sees the subject)."""
    global FW, FH, W, H, RW, RH, K, ASPECT
    FW, FH = fw, fh
    W, H = FW * SS, FH * SS
    RW, RH = int(FW * ref_scale), int(FH * ref_scale)
    K = W / RW
    ASPECT = RW / RH


HOR = 0.56                   # horizon
SUN = (0.66, 0.468)


# ----------------------------------------------------------------------------
# small maths helpers
# ----------------------------------------------------------------------------
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    return a + (b - a) * np.asarray(t, np.float32)[..., None]


def ramp(stops, t):
    xs = [s[0] for s in stops]
    out = np.empty(t.shape + (3,), np.float32)
    for k in range(3):
        out[..., k] = np.interp(t, xs, [s[1][k] for s in stops])
    return out


def vnoise(cx, cy, seed):
    r = np.random.default_rng(seed).random((cy + 3, cx + 3)).astype(np.float32)
    return np.asarray(Image.fromarray(r, mode="F").resize((RW, RH), Image.BICUBIC))


def fbm(cx, cy, seed, octaves=5, gain=0.5):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * vnoise(cx * 2 ** o, cy * 2 ** o, seed + o * 101)
        tot += amp
        amp *= gain
    n = out / tot
    lo, hi = np.percentile(n, 1), np.percentile(n, 99)
    return np.clip((n - lo) / (hi - lo), 0, 1)


def noise1d(cells, seed, octaves=4):
    x = np.linspace(0, 1, RW)
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        n = cells * 2 ** o
        r = np.random.default_rng(seed + o).random(n + 2)
        xi = x * n
        i = xi.astype(int)
        f = xi - i
        f = f * f * (3 - 2 * f)
        out = out + amp * (r[i] * (1 - f) + r[i + 1] * f)
        tot += amp
        amp *= 0.5
    return out / tot


def tri(du, wl, wr):
    return np.clip(np.where(du < 0, 1 + du / wl, 1 - du / wr), 0, 1)


def blur(a, sigma):
    r = int(math.ceil(2.5 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k = (k / k.sum()).astype(np.float32)
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r, r)
        p = np.pad(a, pad, mode="edge")
        out = np.zeros_like(a)
        n = a.shape[axis]
        for i, kv in enumerate(k):
            sl = [slice(None), slice(None)]
            sl[axis] = slice(i, i + n)
            out += kv * p[tuple(sl)]
        a = out
    return a


# ----------------------------------------------------------------------------
# 2. the picture in the painter's head
# ----------------------------------------------------------------------------
def compose():
    u = np.linspace(0, 1, RW, dtype=np.float32)[None, :]
    v = np.linspace(0, 1, RH, dtype=np.float32)[:, None]
    U = np.broadcast_to(u, (RH, RW))
    V = np.broadcast_to(v, (RH, RW))
    su, sv = SUN
    d = np.sqrt(((U - su) * ASPECT) ** 2 + (V - sv) ** 2)
    prox = np.exp(-(d / 0.55) ** 2)

    # --- sky -----------------------------------------------------------------
    t = np.clip(V / HOR, 0, 1)
    sky = ramp([(0.00, (22, 24, 76)), (0.20, (40, 50, 118)), (0.40, (86, 84, 152)),
                (0.56, (164, 104, 146)), (0.70, (230, 126, 110)),
                (0.85, (252, 174, 96)), (1.00, (255, 212, 138))], t)
    teal = smooth(0.25, 0.8, np.abs(U - su)) * np.exp(-((t - 0.46) / 0.2) ** 2) * 0.4
    sky = lerp(sky, (50, 118, 150), teal)
    sky = lerp(sky, (255, 190, 104), np.exp(-(d / 0.30) ** 2) * 0.55)
    sky = lerp(sky, (255, 232, 160), np.exp(-(d / 0.10) ** 2) * 0.85)

    n = fbm(5, 14, 40)
    env = np.exp(-((V - 0.25) / 0.17) ** 2) + 0.55 * np.exp(-((V - 0.455) / 0.045) ** 2)
    cloud = smooth(0.46, 0.68, n * (0.5 + 0.66 * env))
    below = np.roll(cloud, -7, axis=0)
    lit = np.clip((cloud - below) * 3.2 + 0.18, 0, 1) * (0.45 + 0.55 * prox)
    lit = np.clip(lit + 0.35 * np.exp(-(d / 0.3) ** 2), 0, 1)
    shadow = lerp((66, 58, 112), (126, 86, 132), t)
    hot = lerp(lerp((238, 104, 132), (255, 164, 88), t), (255, 222, 150), prox * 0.55)
    sky = lerp(sky, lerp(shadow, hot, lit), cloud * 0.93)
    sky = lerp(sky, (255, 251, 230), 1 - smooth(0.021, 0.030, d))
    cloud_lit = cloud * lit * (V < HOR - 0.03)

    upper = sky.copy()
    ax = np.ones((RH, RW), np.float32)       # stroke direction field (vector)
    ay = np.zeros((RH, RW), np.float32)

    # sky strokes wheel around the sun and flatten out far from it
    tx, ty = -(V - sv), (U - su) * ASPECT
    ln = np.hypot(tx, ty) + 1e-6
    tx, ty = tx / ln, ty / ln
    flip = np.where(tx < 0, -1.0, 1.0)
    tx, ty = tx * flip, ty * flip
    wt = np.exp(-(d / 0.36) ** 2) * 0.85 * (1 - 0.6 * cloud)
    vx, vy = wt * tx + (1 - wt), wt * ty
    rot = (fbm(4, 4, 77, 3) - 0.5) * 1.1 * (1 - 0.5 * cloud)
    ax = vx * np.cos(rot) - vy * np.sin(rot)
    ay = vx * np.sin(rot) + vy * np.cos(rot)

    # --- far ridge -----------------------------------------------------------
    far_h = (0.02 + 0.06 * noise1d(5, 3)) * (1 - 0.62 * np.exp(-((u[0] - su) / 0.13) ** 2))
    far = (V > HOR - far_h[None, :]) & (V <= HOR)
    far_c = lerp((122, 96, 152), (222, 142, 126), np.exp(-(np.abs(U - su) / 0.25) ** 2))
    far_c = lerp(far_c, (236, 170, 140), smooth(HOR - 0.03, HOR, V) * 0.4)
    upper[far] = far_c[far]
    ax[far], ay[far] = 1.0, ((fbm(6, 6, 5, 2) - 0.5) * 0.3)[far]

    # --- the two massifs -----------------------------------------------------
    m = fbm(10, 8, 21)
    dm = np.gradient(m, axis=1)
    dm = dm / (np.abs(dm).max() + 1e-6)
    jag = (noise1d(40, 9, 3) - 0.5) * 0.02
    rough = 1 + 0.3 * (noise1d(7, 13) - 0.5)
    uu = u[0]
    hl = np.maximum.reduce([0.315 * tri(uu - 0.33, 0.42, 0.25) ** 1.25,
                            0.20 * tri(uu - 0.15, 0.20, 0.15) ** 1.2,
                            0.13 * tri(uu - 0.46, 0.10, 0.12) ** 1.1])
    hr = np.maximum(0.225 * tri(uu - 0.96, 0.20, 0.2) ** 1.2,
                    0.12 * tri(uu - 0.835, 0.08, 0.1) ** 1.1)
    massifs = []
    for hgt, peak, side in ((hl, (0.33, HOR - 0.315), -1.0), (hr, (0.96, HOR - 0.225), 1.0)):
        hh = hgt * rough + jag * (hgt > 0.01)
        mask = (V > HOR - hh[None, :]) & (V <= HOR) & (hh[None, :] > 0.004)
        elev = HOR - V
        facet = np.clip(side * dm * 3.0, 0, 1)
        sunside = smooth(-0.05, 0.12, -side * (U - peak[0]))
        light = np.clip(facet * 0.75 + sunside * 0.3, 0, 1)
        col = lerp((44, 42, 98), (112, 88, 140), smooth(0.22, 0.0, elev))
        col = lerp(col, (216, 118, 110), light * 0.62)
        snow = smooth(0.185, 0.255, elev + 0.07 * (m - 0.5)) * (0.55 + 0.45 * fbm(30, 20, 31, 3))
        col = lerp(col, lerp((132, 124, 186), (255, 198, 168), light), snow * 0.9)
        col = lerp(col, (232, 160, 138), smooth(HOR - 0.035, HOR, V) * 0.45 * prox)
        upper[mask] = col[mask]
        rx, ry = (U - peak[0]) * ASPECT, (V - peak[1]) + 0.02
        ln = np.hypot(rx, ry) + 1e-6
        r2 = (fbm(8, 8, 55, 3) - 0.5) * 0.9
        ax[mask] = (rx / ln * np.cos(r2) - ry / ln * np.sin(r2))[mask]
        ay[mask] = (rx / ln * np.sin(r2) + ry / ln * np.cos(r2))[mask]
        massifs.append(mask)

    mist = np.exp(-((V - HOR) / 0.012) ** 2) * (V <= HOR) * 0.5
    upper = lerp(upper, lerp((186, 150, 176), (255, 212, 160), prox), mist)

    # --- water: the sky, mirrored and broken by ripples ------------------------
    ref = upper.copy()
    q = np.clip((V - HOR) / (1 - HOR), 0, 1)
    rn = fbm(3, 60, 61, 4) - 0.5
    rn2 = fbm(5, 40, 62, 3) - 0.5
    vm = HOR - (V - HOR) * 1.12 + rn * 0.042 * (0.25 + 2.2 * q)
    yi = np.clip(vm * (RH - 1), 0, RH - 1).astype(int)
    xi = np.clip((U + rn2 * 0.03) * (RW - 1), 0, RW - 1).astype(int)
    water = upper[yi, xi] * (0.9 - 0.22 * q)[..., None]
    water = lerp(water, (22, 44, 86), 0.10 + 0.34 * q)
    wv = 0.008 + 0.15 * q
    streak = smooth(0.42, 0.68, fbm(22, 110, 63, 3))
    glit = np.exp(-((U - su) / wv) ** 2) * (0.3 + 0.7 * streak) * (1 - 0.25 * q)
    water = lerp(water, (255, 224, 148), np.clip(glit, 0, 1) * 0.95)
    is_water = V > HOR
    ref[is_water] = water[is_water]
    ax[is_water] = 1.0
    ay[is_water] = ((fbm(6, 30, 64, 2) - 0.5) * 0.14)[is_water]

    # --- the near bank and its meadow ------------------------------------------
    shore = (0.725 + 0.135 * smooth(0.05, 0.7, uu) - 0.03 * smooth(0.75, 1.0, uu)
             + 0.014 * (noise1d(9, 71) - 0.5))
    bank = V > shore[None, :]
    gn = fbm(14, 10, 72)
    grass = ramp([(0, (18, 36, 44)), (0.5, (40, 72, 48)), (1, (96, 116, 52))], gn)
    grass = lerp(grass, (140, 128, 58), smooth(0.6, 0.95, fbm(9, 12, 73)) * 0.4)
    rim = np.exp(-((V - shore[None, :]) / 0.022) ** 2) * (0.35 + 0.6 * np.exp(-((U - su) / 0.35) ** 2))
    grass = lerp(grass, (196, 164, 76), rim * (0.35 + 0.65 * gn) * 0.85)
    grass = lerp(grass, (16, 30, 46), smooth(0.86, 1.02, V) * 0.35)
    ref[bank] = grass[bank]
    lean = -math.pi / 2 + (fbm(7, 5, 74, 3) - 0.5) * 1.0
    ax[bank], ay[bank] = np.cos(lean)[bank], np.sin(lean)[bank]

    # --- pines -----------------------------------------------------------------
    tn = fbm(34, 30, 81, 4)
    en = fbm(60, 60, 82, 3)
    tree = np.zeros((RH, RW), bool)
    for x0, vt, wmax in ((-0.012, 0.20, 0.085), (0.07, 0.055, 0.09), (0.158, 0.30, 0.062),
                         (0.218, 0.47, 0.04), (0.905, 0.50, 0.036), (0.978, 0.41, 0.052)):
        vb = shore[int(np.clip(x0, 0, 1) * (RW - 1))] + 0.045
        s = np.clip((V - vt) / (vb - vt), 0, 1)
        tiers = int(9 + 16 * (vb - vt))
        frac = (s * tiers) % 1.0
        wdt = wmax * s ** 0.8 * (0.45 + 0.55 * frac) * (0.75 + 0.5 * en) + 0.0035
        dxv = np.abs(U - x0) * ASPECT
        mask = (dxv < wdt) & (V > vt) & (V < vb)
        col = lerp((10, 24, 34), (34, 62, 52), tn)
        edge = smooth(0.45, 1.0, dxv / wdt) * (U > x0)
        col = lerp(col, (128, 108, 62), edge * 0.6 * (0.4 + 0.6 * tn))
        col = lerp(col, (8, 16, 30), smooth(0.5, 1.0, frac) * 0.35 * (U <= x0))
        ref[mask] = col[mask]
        sgn = np.where(U > x0, 1.0, -1.0)
        r3 = (en - 0.5) * 0.7
        bx, by = sgn * 0.86, 0.5
        ax[mask] = (bx * np.cos(r3) - by * np.sin(r3))[mask]
        ay[mask] = (bx * np.sin(r3) + by * np.cos(r3))[mask]
        tree |= mask

    ln = np.hypot(ax, ay) + 1e-6
    return dict(ref=np.clip(ref, 0, 255).astype(np.float32), ax=(ax / ln).astype(np.float32),
                ay=(ay / ln).astype(np.float32), shore=shore, bank=bank & ~tree, tree=tree,
                water=is_water & ~bank & ~tree, cloud_lit=cloud_lit, sky=(V < HOR) & ~tree)


# ----------------------------------------------------------------------------
# 1. the brush
# ----------------------------------------------------------------------------
def jitter(c, dh=0.02, ds=0.12, dv=0.07):
    h, s, v = colorsys.rgb_to_hsv(c[0] / 255.0, c[1] / 255.0, c[2] / 255.0)
    h = (h + random.uniform(-dh, dh)) % 1.0
    s = min(1.0, max(0.0, s * (1 + random.uniform(-ds, ds))))
    v = min(1.0, max(0.0, v * (1 + random.uniform(-dv, dv))))
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (r * 255, g * 255, b * 255)


def blend(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


class Canvas:
    def __init__(self, ground=(152, 98, 62)):
        self.img = Image.new("RGB", (W, H), ground)
        self.height = np.zeros((H, W), np.float32)
        self.count = 0

    def wet(self, x, y):
        return self.img.getpixel((min(W - 1, max(0, int(x))), min(H - 1, max(0, int(y)))))

    def stroke(self, pts, width, c1, c2=None, lw=3, thick=0.8, dry=0.08,
               alpha=(200, 255), taper=(0.14, 0.28)):
        """Drag a loaded bristle brush along the polyline `pts`."""
        pts = np.asarray(pts, np.float32)
        n = len(pts)
        if n < 2:
            return
        c2 = c1 if c2 is None else c2
        dv = np.gradient(pts, axis=0)
        ln = np.hypot(dv[:, 0], dv[:, 1]) + 1e-6
        tx, ty = dv[:, 0] / ln, dv[:, 1] / ln
        nx, ny = -ty, tx
        t = np.linspace(0, 1, n)
        press = (np.minimum(1, 0.5 + 0.5 * t / taper[0])
                 * (1 - 0.55 * np.clip((t - (1 - taper[1])) / taper[1], 0, 1) ** 2))
        half = width / 2.0
        nb = max(1, int(round(width / (lw * 0.8))))
        pad = half + lw + 3
        x0, y0 = int(pts[:, 0].min() - pad), int(pts[:, 1].min() - pad)
        x1, y1 = int(pts[:, 0].max() + pad) + 1, int(pts[:, 1].max() + pad) + 1
        if x1 <= 0 or y1 <= 0 or x0 >= W or y0 >= H:
            return
        patch = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
        dr = ImageDraw.Draw(patch)
        seg = float(ln.mean())
        g = random.random()
        order = list(range(nb))
        random.shuffle(order)
        mixes = []
        for _ in range(nb):                       # two colours streaked across the brush
            g = min(1.0, max(0.0, g + random.uniform(-0.3, 0.3)))
            mixes.append(g)
        for i in order:
            if nb > 2 and random.random() < dry:
                continue                          # a bristle that ran dry
            o = ((i + 0.5) / nb * 2 - 1 + random.uniform(-0.5, 0.5) / nb) * half
            i0 = 1 if (n > 4 and random.random() < 0.3) else 0
            i1 = n - (random.randint(0, n // 4) if n > 4 else 0)
            px = pts[i0:i1, 0] + nx[i0:i1] * o * press[i0:i1] - x0
            py = pts[i0:i1, 1] + ny[i0:i1] * o * press[i0:i1] - y0
            j0, j1 = random.uniform(-0.45, 0.3) * seg, random.uniform(-0.3, 0.45) * seg
            px[0] += tx[i0] * j0
            py[0] += ty[i0] * j0
            px[-1] += tx[i1 - 1] * j1
            py[-1] += ty[i1 - 1] * j1
            xy = np.empty(2 * len(px), np.float32)
            xy[0::2], xy[1::2] = px, py
            col = blend(c1, c2, mixes[i])
            k = 1 + random.gauss(0, 0.045)
            fill = (int(min(255, max(0, col[0] * k))), int(min(255, max(0, col[1] * k))),
                    int(min(255, max(0, col[2] * k))), random.randint(alpha[0], alpha[1]))
            dr.line(xy.tolist(), fill=fill, width=lw, joint="curve")
        cx0, cy0, cx1, cy1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
        if (cx0, cy0, cx1, cy1) != (x0, y0, x1, y1):
            patch = patch.crop((cx0 - x0, cy0 - y0, cx1 - x0, cy1 - y0))
        self.img.paste(patch, (cx0, cy0), patch)
        a = np.asarray(patch)[..., 3].astype(np.float32)
        m = (a > 0).astype(np.float32)
        lo, hi = alpha[0] - 12, alpha[1]
        ridge = np.clip((a - lo) / max(1, hi - lo), 0.08, 1.0)
        hs = self.height[cy0:cy1, cx0:cx1]
        hs *= 1 - 0.65 * m
        hs += m * thick * ridge
        self.count += 1

    def finish(self, relief=1.0):
        """Light the paint relief from the upper left and reduce to final size."""
        hgt = self.height
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        weave = 0.035 * (np.sin(xx * (2 * math.pi / 7.0)) * np.sin(yy * (2 * math.pi / 7.0)))
        weave += 0.03 * (rng.random((H, W), dtype=np.float32) - 0.5)
        hgt = blur(hgt + weave * (0.35 + 0.65 * np.exp(-2.5 * hgt)), 1.3)
        gx = np.zeros_like(hgt)
        gy = np.zeros_like(hgt)
        gx[:, 1:-1] = hgt[:, 2:] - hgt[:, :-2]
        gy[1:-1, :] = hgt[2:, :] - hgt[:-2, :]
        slope = gx * 0.55 + gy * 0.65
        shade = np.clip(1 + 1.9 * relief * slope, 0.62, 1.4)
        spec = np.clip(slope - 0.045, 0, 0.2) * 190 * relief
        img = np.asarray(self.img, np.float32) * shade[..., None] + spec[..., None]
        out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
        return out.resize((FW, FH), Image.LANCZOS)


# ----------------------------------------------------------------------------
# 3. the painter
# ----------------------------------------------------------------------------
class Painter:
    def __init__(self, scene, levels=(12, 5, 2, 1, 0)):
        self.s = scene
        self.c = Canvas()
        ref8 = Image.fromarray(scene["ref"].astype(np.uint8))
        self.levels = {r: np.asarray(ref8.filter(ImageFilter.GaussianBlur(r)), np.float32)
                       if r else scene["ref"] for r in levels}
        self.ax, self.ay = scene["ax"], scene["ay"]

    # -- looking at the picture ---------------------------------------------
    @staticmethod
    def cell(x, y):
        return (min(RH - 1, max(0, int(y / K))), min(RW - 1, max(0, int(x / K))))

    def error(self, level):
        cur = np.asarray(self.c.img.resize((RW, RH), Image.BOX), np.float32)
        return np.abs(cur - self.levels[level]).mean(axis=2)

    @staticmethod
    def sample(prob, n):
        cdf = np.cumsum(prob.ravel().astype(np.float64))
        idx = np.searchsorted(cdf, rng.random(n) * cdf[-1])
        ys, xs = np.divmod(idx, RW)
        return np.stack([(xs + rng.random(n)) * K, (ys + rng.random(n)) * K], 1)

    @staticmethod
    def grid(spacing):
        xs = np.arange(-spacing / 2, W + spacing, spacing)
        ys = np.arange(-spacing / 2, H + spacing, spacing)
        gx, gy = np.meshgrid(xs, ys)
        p = np.stack([gx.ravel(), gy.ravel()], 1) + rng.uniform(-0.5, 0.5, (gx.size, 2)) * spacing
        rng.shuffle(p)
        return p

    # -- moving the hand ------------------------------------------------------
    def trace(self, x, y, dx, dy, length, step, ref=None, col=None, thr=None, curv=0.35):
        pts = []
        for _ in range(max(1, int(length / step))):
            x += dx * step
            y += dy * step
            if x < -60 or y < -60 or x > W + 60 or y > H + 60:
                break
            i, j = self.cell(x, y)
            if thr is not None:
                r = ref[i, j]
                if (abs(r[0] - col[0]) + abs(r[1] - col[1]) + abs(r[2] - col[2])) > 3 * thr:
                    break
            ex, ey = float(self.ax[i, j]), float(self.ay[i, j])
            if ex * dx + ey * dy < 0:
                ex, ey = -ex, -ey
            dx, dy = dx * (1 - curv) + ex * curv, dy * (1 - curv) + ey * curv
            ln = math.hypot(dx, dy) + 1e-9
            dx, dy = dx / ln, dy / ln
            pts.append((x, y))
        return pts

    def layer(self, name, pos, width, lmin, lmax, level, thr, lw, thick,
              jit=(0.02, 0.12, 0.07), wet=0.2, dry=0.08, alpha=(200, 255)):
        t0 = time.time()
        ref = self.levels[level]
        step = min(44.0, max(5.0, width * 0.42))
        for x, y in pos:
            i, j = self.cell(x, y)
            base = ref[i, j]
            dx, dy = float(self.ax[i, j]), float(self.ay[i, j])
            if random.random() < 0.5:
                dx, dy = -dx, -dy
            length = random.uniform(lmin, lmax)
            back = self.trace(x, y, -dx, -dy, length / 2, step, ref, base, thr)
            fwd = self.trace(x, y, dx, dy, length / 2, step, ref, base, thr)
            pts = back[::-1] + [(x, y)] + fwd
            if len(pts) < 2:
                pts = [(x - dx * step * 0.5, y - dy * step * 0.5), (x + dx * step * 0.5, y + dy * step * 0.5)]
            c1 = jitter(base, *jit)
            c2 = jitter(base, jit[0] * 1.8, jit[1] * 1.5, jit[2] * 1.7)
            if wet:
                c1 = blend(c1, self.c.wet(x, y), wet * random.random())
            self.c.stroke(pts, width * random.uniform(0.8, 1.2), c1, c2, lw=lw, thick=thick,
                          dry=dry, alpha=alpha)
        print(f"  {name:<22}{len(pos):>6} strokes  {time.time() - t0:5.1f}s", flush=True)

    # -- the session ----------------------------------------------------------
    def paint(self):
        print("blocking in")
        self.layer("big brush", self.grid(70), 150, 300, 720, 12, None, 5, 0.55, wet=0.1,
                   jit=(0.02, 0.10, 0.06), alpha=(225, 255))
        e = self.error(5)
        self.layer("medium brush", self.sample(0.5 + np.clip(e - 6, 0, 60) / 14, 5200),
                   64, 150, 400, 5, 60, 4, 0.7, jit=(0.025, 0.14, 0.08))
        print("building form")
        e = self.error(2)
        self.layer("small brush", self.sample(0.16 + np.clip(e - 8, 0, 80) / 12, 15000),
                   30, 70, 210, 2, 44, 3, 0.8, jit=(0.025, 0.14, 0.08))
        for k in range(2):
            e = self.error(1)
            self.layer(f"detail brush {k + 1}", self.sample(0.03 + np.clip(e - 9, 0, 90) / 10, 14000),
                       14, 36, 120, 1, 36, 3, 0.8, jit=(0.02, 0.12, 0.07), wet=0.15)
        for k in range(2):
            e = self.error(0)
            self.layer(f"fine brush {k + 1}", self.sample(np.clip(e - 10, 0, 100) ** 1.3 + 0.01, 13000),
                       7, 18, 70, 0, 30, 2, 0.7, jit=(0.015, 0.1, 0.06), wet=0.1, dry=0.0)
        print("accents")
        self.clouds()
        self.sun()
        self.ripples()
        self.glitter()
        self.boat()
        self.meadow()

    # -- accents, placed by hand -------------------------------------------------
    def follow(self, x, y, length, step=10):
        i, j = self.cell(x, y)
        dx, dy = float(self.ax[i, j]), float(self.ay[i, j])
        back = self.trace(x, y, -dx, -dy, length / 2, step, curv=0.3)
        return back[::-1] + [(x, y)] + self.trace(x, y, dx, dy, length / 2, step, curv=0.3)

    def clouds(self):
        for x, y in self.sample(self.s["cloud_lit"] ** 2 + 1e-9, 420):
            base = self.levels[1][self.cell(x, y)]
            c = jitter(blend(base, (255, 224, 164), 0.38), 0.02, 0.1, 0.04)
            self.c.stroke(self.follow(x, y, random.uniform(50, 170)), random.uniform(10, 22), c,
                          jitter(c, 0.03, 0.15, 0.06), lw=3, thick=1.2, alpha=(190, 255))

    def sun(self):
        cx, cy = SUN[0] * W, SUN[1] * H
        r0 = 0.027 * H
        for rad, wd, col, al, k in ((4.4, 34, (255, 196, 116), (70, 130), 10),
                                    (3.1, 32, (255, 212, 132), (80, 150), 10),
                                    (2.0, 28, (255, 228, 156), (110, 180), 9),
                                    (0.85, 20, (255, 244, 200), (215, 255), 5),
                                    (0.4, 22, (255, 252, 234), (230, 255), 3)):
            for _ in range(k):
                a0 = random.uniform(0, 2 * math.pi)
                span = random.uniform(0.5, 1.1)
                rr = r0 * rad * random.uniform(0.82, 1.18)
                mx, my = cx + rr * math.cos(a0 + span / 2), cy + rr * math.sin(a0 + span / 2)
                if my > HOR * H - 60:
                    continue
                if rad > 1:                       # halo: mostly the sky's own colour, warmed
                    col = blend(self.levels[2][self.cell(mx, my)], col, 0.45)
                pts = [(cx + rr * math.cos(a0 + span * i / 8), cy + rr * math.sin(a0 + span * i / 8))
                       for i in range(9)]
                self.c.stroke(pts, wd, jitter(col, 0.01, 0.08, 0.02), lw=3, thick=1.0 if rad > 1 else 1.3,
                              alpha=al)

    def ripples(self):
        pos = self.sample(self.s["water"].astype(np.float32), 520)
        for x, y in pos:
            qq = (y / H - HOR) / (1 - HOR)
            base = self.levels[2][self.cell(x, y)]
            if random.random() < 0.55:
                c = blend(base, random.choice([(214, 180, 214), (255, 206, 170), (178, 190, 226)]), 0.45)
            else:
                c = blend(base, (18, 30, 70), 0.5)
            ln = random.uniform(40, 120) * (0.5 + 2.2 * qq)
            pts = [(x - ln / 2 + ln * i / 4, y + random.uniform(-1.5, 1.5)) for i in range(5)]
            self.c.stroke(pts, random.uniform(4, 7) * (0.7 + 1.5 * qq), c, lw=2, thick=0.9,
                          alpha=(150, 235), dry=0.0)

    def glitter(self):
        su = SUN[0]
        vend = float(self.s["shore"][int(su * (RW - 1))]) - 0.004
        for _ in range(900):
            v = HOR + 0.003 + random.random() ** 1.6 * (vend - HOR - 0.003)
            qq = (v - HOR) / (1 - HOR)
            wv = 0.006 + 0.13 * qq
            off = random.gauss(0, 0.5)
            x, y = (su + off * wv) * W, v * H
            heat = math.exp(-off * off * 2)
            c = blend((255, 176, 92), (255, 246, 206), min(1, heat * random.uniform(0.6, 1.3)))
            ln = (10 + 150 * qq) * random.uniform(0.5, 1.4)
            pts = [(x - ln / 2 + ln * i / 3, y + random.uniform(-1, 1)) for i in range(4)]
            self.c.stroke(pts, 4 + 16 * qq * random.uniform(0.6, 1.2), c, jitter(c, 0.02, 0.2, 0.03),
                          lw=2 if qq < 0.25 else 3, thick=1.4, alpha=(215, 255), dry=0.0,
                          taper=(0.3, 0.4))

    def boat(self):
        x, y = 0.495 * W, 0.589 * H
        st = self.c.stroke
        for j in range(5):                                  # mainsail, glowing against the light
            xx, top = x + 3 + j * 6, y - 96 + j * 20
            st([(xx, y - 9), (xx - 1, (y - 9 + top) / 2), (xx - 3 - j * 0.5, top)], 7,
               blend((255, 240, 204), (255, 190, 132), j / 4), lw=2, thick=1.3, dry=0.0, taper=(0.2, 0.5))
        for j in range(3):                                  # jib, in shadow
            xx, top = x - 5 - j * 6, y - 74 + j * 22
            st([(xx, y - 9), (xx + 1, (y - 9 + top) / 2), (xx + 3, top)], 6,
               blend((206, 160, 176), (160, 120, 160), j / 2), lw=2, thick=1.1, dry=0.0, taper=(0.2, 0.5))
        st([(x - 28, y - 3), (x - 8, y), (x + 14, y), (x + 34, y - 4)], 9, (30, 26, 54), (58, 40, 66),
           lw=2, thick=1.2, dry=0.0)
        for j in range(6):                                  # its reflection, broken by ripples
            yy = y + 9 + j * 8
            wob = random.uniform(-6, 6)
            c = blend((250, 214, 170), (150, 120, 150), j / 5)
            st([(x - 9 + wob, yy), (x + 4 + wob, yy + 1), (x + 20 - j * 2 + wob, yy)], 4, c,
               lw=2, thick=0.9, alpha=(120 + (5 - j) * 20, 230), dry=0.0)

    def blade(self, x, y, depth, col, over=False):
        hgt = (46 + 190 * depth) * random.uniform(0.55, 1.3)
        a = -math.pi / 2 + random.gauss(0, 0.3)
        curl = random.gauss(0, 0.012)
        step = hgt / 7
        pts = [(x, y)]
        for _ in range(7):
            x += math.cos(a) * step
            y += math.sin(a) * step
            a += curl * step
            pts.append((x, y))
        self.c.stroke(pts, (3.5 + 6 * depth) * random.uniform(0.7, 1.3), col, jitter(col, 0.03, 0.2, 0.15),
                      lw=2, thick=1.0 if over else 0.8, dry=0.0, alpha=(190, 255), taper=(0.1, 0.7))

    def meadow(self):
        s = self.s
        shore = s["shore"]
        bank = s["bank"].astype(np.float32)

        def depth(x, y):
            sh = float(shore[min(RW - 1, max(0, int(x / K)))])
            return min(1.0, max(0.0, (y / H - sh) / (1 - sh)))

        def grasses(n, over):
            pos = self.sample(bank, n)
            pos = pos[np.argsort(pos[:, 1])]                # far blades first
            for x, y in pos:
                dp = depth(x, y)
                near_sun = math.exp(-((x / W - SUN[0]) / 0.3) ** 2)
                r = random.random()
                if r < 0.12 + 0.35 * (1 - dp) * near_sun:
                    col = random.choice([(206, 178, 84), (176, 160, 70), (228, 196, 110)])
                elif r < 0.5:
                    col = random.choice([(22, 44, 40), (30, 58, 46), (18, 36, 52)])
                elif r < 0.85:
                    col = random.choice([(52, 90, 52), (72, 108, 54), (44, 84, 70)])
                else:
                    col = random.choice([(110, 128, 56), (92, 122, 84)])
                self.blade(x, y + 14, dp, jitter(col, 0.02, 0.15, 0.12), over)

        grasses(3600, False)

        # flowers grow in drifts, so each kind gets its own patchy map
        def drift(seed, lo, hi):
            return bank * smooth(lo, hi, fbm(7, 9, seed, 3)) + 1e-9

        def order(p):
            return p[np.argsort(p[:, 1])]

        st = self.c.stroke
        for x, y in order(self.sample(drift(201, 0.35, 0.7), 150)):      # lupin spires
            dp = depth(x, y)
            sc = 0.55 + 1.5 * dp
            hgt = random.uniform(60, 120) * sc
            leanx = random.gauss(0, 0.12)
            hue = random.choice([(96, 74, 190), (128, 92, 214), (150, 100, 206), (104, 110, 222)])
            st([(x, y), (x + leanx * hgt * 0.3, y - hgt * 0.4)], 3 * sc, (44, 84, 52), lw=2, dry=0.0)
            k = int(7 + 5 * sc)
            for i in range(k):
                f = i / (k - 1)
                px, py = x + leanx * hgt * (0.3 + 0.7 * f), y - hgt * (0.3 + 0.7 * f)
                wdt = (11 - 7 * f) * sc
                for sgn in (-1, 1):
                    c = jitter(blend(hue, (226, 204, 250), 0.15 + 0.55 * f * random.random()), 0.02, 0.15, 0.1)
                    st([(px, py), (px + sgn * wdt * 0.8, py - wdt * 0.35)], wdt * 0.75, c,
                       lw=2, thick=1.3, dry=0.0, taper=(0.3, 0.5))
        for x, y in order(self.sample(drift(202, 0.4, 0.75), 330)):      # poppies
            dp = depth(x, y)
            sc = 0.55 + 1.7 * dp
            red = random.choice([(226, 44, 34), (240, 70, 36), (250, 104, 44), (206, 30, 44)])
            st([(x, y + 2), (x + random.uniform(-4, 4) * sc, y + 30 * sc)], 2.5 * sc, (40, 78, 46),
               lw=2, dry=0.0)
            for _ in range(random.randint(3, 5)):
                a = random.uniform(0, 2 * math.pi)
                r = random.uniform(5, 11) * sc
                c = jitter(red, 0.015, 0.1, 0.1)
                st([(x - math.cos(a) * r * 0.2, y - math.sin(a) * r * 0.12),
                    (x + math.cos(a) * r, y + math.sin(a) * r * 0.6)], 12 * sc * random.uniform(0.8, 1.2),
                   c, blend(c, (255, 170, 90), 0.5), lw=2 if sc < 1.2 else 3, thick=1.5, dry=0.0,
                   taper=(0.3, 0.5))
            if sc > 1.1:
                st([(x - 2 * sc, y), (x + 2 * sc, y + 1)], 4 * sc, (34, 20, 40), lw=2, thick=1.2, dry=0.0)
        for x, y in order(self.sample(drift(203, 0.4, 0.8), 420)):       # daisies and buttercups
            dp = depth(x, y)
            sc = 0.5 + 1.3 * dp
            c = random.choice([(252, 244, 222), (246, 236, 206), (255, 214, 84), (252, 196, 60),
                               (250, 226, 236)])
            for _ in range(random.randint(1, 3)):
                a = random.uniform(0, math.pi)
                r = random.uniform(3, 6) * sc
                st([(x - math.cos(a) * r, y - math.sin(a) * r * 0.5),
                    (x + math.cos(a) * r, y + math.sin(a) * r * 0.5)], 6.5 * sc, jitter(c, 0.01, 0.1, 0.04),
                   lw=2, thick=1.4, dry=0.0, taper=(0.3, 0.4))
        grasses(650, True)                                               # a few blades in front


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "painting.png"
    t0 = time.time()
    print("composing the picture")
    painter = Painter(compose())
    painter.paint()
    print("lighting the paint")
    painter.c.finish().save(out, optimize=True)
    print(f"{painter.c.count} brushstrokes in {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
