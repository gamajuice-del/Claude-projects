"""Effects: slashes, sparks, bursts, smoke, speed lines, impact frames, film look."""
import math
import random

import numpy as np
import skia

from .draw import TAU, mix, paint, radial, rect, rgb, soft_dot, tapered

W, H = 1920, 1080
BAR = 138                       # letterbox bar height (2.39:1)


def slash(cv, cx, cy, r, a0, a1, age, width=1.0, color=(255, 255, 255), life=0.22):
    """A nail stroke: a tapered crescent with a glow, fading over 'life' s."""
    if age < 0 or age > life:
        return
    f = age / life
    sweep = min(1.0, age / (life * 0.35))
    n = 40
    pts = []
    for k in range(n + 1):
        u = k / n * sweep
        a = a0 + (a1 - a0) * u
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    if len(pts) < 3:
        return
    w = r * 0.22 * width * (1 - f * 0.6)
    tapered(cv, pts, 1.0, w, (200, 190, 255), a=0.7 * (1 - f), blur=w * 0.8,
            blend=skia.BlendMode.kPlus)
    tapered(cv, pts, 0.5, w * 0.55, color, a=1 - f)


def sparks(cv, x, y, age, seed, n=16, reach=80, color=(255, 246, 220), life=0.35):
    if age < 0 or age > life:
        return
    r = random.Random(seed)
    f = age / life
    for _ in range(n):
        a = r.uniform(0, TAU)
        L = reach * r.uniform(0.4, 1.0)
        d0, d1 = L * f, L * min(1, f + 0.25)
        tapered(cv, [(x + math.cos(a) * d0, y + math.sin(a) * d0),
                     (x + math.cos(a) * d1, y + math.sin(a) * d1)], 3 * (1 - f) + 0.5, 0.5,
                color, a=1 - f)
    soft_dot(cv, x, y, reach * 0.6 * (1 - f), (255, 240, 220), a=1 - f)


class Burst:
    """Particles thrown from a point; drawn at any time without state."""

    def __init__(self, t0, x, y, n, speed, colors, seed, size=(3, 8), rise=0.0, life=1.0,
                 spread=(0, TAU), glow=False):
        r = random.Random(seed)
        self.t0, self.x, self.y, self.rise, self.colors, self.glow = t0, x, y, rise, colors, glow
        self.parts = [(r.uniform(*spread), speed * r.uniform(0.25, 1.0), life * r.uniform(0.5, 1),
                       r.uniform(*size), r.randrange(len(colors))) for _ in range(n)]

    def draw(self, cv, t):
        age = t - self.t0
        if age < 0:
            return
        k = 3.0

        def pos(a, sp, tt):
            d = sp * (1 - math.exp(-k * tt)) / k
            return (self.x + math.cos(a) * d, self.y + math.sin(a) * d - self.rise * tt * tt * 60)
        for a, sp, life, sz, ci in self.parts:
            if age > life:
                continue
            x, y = pos(a, sp, age)
            f = age / life
            c = self.colors[ci]
            if self.glow:
                soft_dot(cv, x, y, sz * 2.5 * (1 - f * 0.5), c, a=1 - f)
            else:
                # a shard, stretched along its flight
                px, py = pos(a, sp, max(0.0, age - 0.05))
                if math.hypot(x - px, y - py) < sz * 0.6:
                    cv.drawCircle(x, y, sz * 0.5 * (1 - f * 0.6), paint(c, 1 - f * f))
                else:
                    tapered(cv, [(px, py), (x, y)], 0.5, sz * (1 - f * 0.6), c, a=1 - f * f)


def smoke(cv, x, y, t, scale=1.0, amount=1.0, seed=0, rise=1.0):
    """Void smoke: soft dark puffs with a violet edge, rising."""
    r = random.Random(seed)
    for k in range(9):
        ph = (t * 0.35 * r.uniform(0.6, 1.4) + r.random()) % 1.0
        px = x + scale * (r.uniform(-30, 30) + 20 * math.sin(t + k))
        py = y - scale * ph * 120 * rise
        rr = scale * (18 + 30 * ph)
        a = amount * (1 - ph) * 0.8
        cv.drawCircle(px, py, rr * 1.2, paint((60, 36, 110), a * 0.35, blur=rr * 0.6))
        cv.drawCircle(px, py, rr, paint((6, 5, 12), a, blur=rr * 0.35))


def focus_lines(cv, cx, cy, t, amount=1.0, color=(255, 255, 255), inner=260, seed=0):
    """Radial anime speed lines converging on a point; new every frame."""
    if amount <= 0:
        return
    r = random.Random(int(t * 24) * 31 + seed)
    for _ in range(90):
        a = r.uniform(0, TAU)
        r0 = inner * r.uniform(0.9, 1.6)
        r1 = 1500
        w = r.uniform(2, 9)
        tapered(cv, [(cx + math.cos(a) * r0, cy + math.sin(a) * r0),
                     (cx + math.cos(a) * r1, cy + math.sin(a) * r1)], 0.5, w, color,
                a=amount * r.uniform(0.3, 0.9))


def speed_streaks(cv, t, direction=1, amount=1.0, color=(255, 255, 255), seed=0):
    """Parallel streaks rushing past (an abstract speed background)."""
    if amount <= 0:
        return
    r = random.Random(seed)
    for k in range(70):
        y = r.uniform(BAR, H - BAR)
        L = r.uniform(200, 700)
        sp = r.uniform(2500, 5000)
        x = (r.uniform(0, W + L) + direction * t * sp) % (W + L) - L
        tapered(cv, [(x, y), (x + L, y)], 0.5, r.uniform(1.5, 5), color,
                a=amount * r.uniform(0.15, 0.6))


def bloom_ring(cv, x, y, r, a, color=(230, 220, 255)):
    if a <= 0:
        return
    cv.drawCircle(x, y, r, paint((0, 0, 0), shader=radial(
        (x, y), r, [(color, a), (color, a * 0.3), ((0, 0, 0), 0)]), blend=skia.BlendMode.kPlus))


# --- post-processing in numpy ------------------------------------------------------------
def impact(img, mode='light'):
    """An impact frame: the picture reduced to stark silhouettes."""
    lum = img.astype(np.float32).mean(axis=2)
    thr = np.percentile(lum[BAR:H - BAR], 62)
    m = lum > thr
    out = np.empty_like(img)
    if mode == 'light':
        out[m] = (250, 248, 255)
        out[~m] = (14, 10, 26)
    else:
        out[m] = (14, 10, 26)
        out[~m] = (250, 248, 255)
    return out


def flash(img, a, color=(250, 248, 255)):
    if a <= 0:
        return img
    return (img * (1 - a) + np.array(color, np.float32) * a).astype(np.uint8)


def fade(img, a):
    if a <= 0:
        return img
    return (img * (1 - a)).astype(np.uint8)


_VIG = None


def film_look(img, t, grain=3.0):
    """Vignette, a little grain, and the letterbox bars."""
    global _VIG
    if _VIG is None:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2))
        _VIG = (1 - 0.38 * np.clip(d - 0.45, 0, 1) ** 1.4)[..., None]
    f = img.astype(np.float32) * _VIG
    rng = np.random.default_rng(int(t * 1000))
    f += rng.normal(0, grain, (H, W, 1))
    out = np.clip(f, 0, 255).astype(np.uint8)
    out[:BAR] = 0
    out[H - BAR:] = 0
    return out


def shake(img, amp, t):
    if amp <= 0.3:
        return img
    r = random.Random(int(t * 24))
    dx, dy = int(r.uniform(-amp, amp)), int(r.uniform(-amp, amp))
    return np.roll(np.roll(img, dy, 0), dx, 1)


_TYPE = None


def title(cv, text, cy, a, size=96, spacing=0.32, color=(236, 232, 252)):
    global _TYPE
    if a <= 0:
        return
    if _TYPE is None:
        _TYPE = skia.Typeface('DejaVu Serif')
    font = skia.Font(_TYPE, size)
    widths = [font.measureText(ch) for ch in text]
    total = sum(widths) + spacing * size * (len(text) - 1)
    x = W / 2 - total / 2
    for ch, w in zip(text, widths):
        p = paint(color, a)
        g = paint((150, 130, 240), a * 0.3, blur=22)
        cv.drawString(ch, x, cy, font, g)
        cv.drawString(ch, x, cy, font, p)
        x += w + spacing * size


_TITLE = {}


def overlay_title(img, text, a, cy=572, size=96):
    """Lay a title over a finished frame (so fades beneath it leave it alone)."""
    if text not in _TITLE:
        surf = skia.Surface(W, H)
        c = surf.getCanvas()
        c.clear(skia.Color(0, 0, 0, 0))
        title(c, text, cy, 1.0, size=size)
        rgba = surf.makeImageSnapshot().toarray(colorType=skia.kRGBA_8888_ColorType)
        _TITLE[text] = (rgba[..., :3].astype(np.float32), rgba[..., 3:4].astype(np.float32) / 255)
    col, al = _TITLE[text]
    al = al * a
    return (img * (1 - al) + col * al).clip(0, 255).astype(np.uint8)
