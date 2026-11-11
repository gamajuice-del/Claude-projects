#!/usr/bin/env python3
"""
spongebob.py - a hyperrealistic SpongeBob, painted with the paintbrush.py engine.

The subject is first imagined in relief: every part of him (a real, porous
cellulose sponge, glassy eyes, enamel teeth, cotton shirt, leather shoes) is a
height map with its own colour and shininess, lit by a single underwater key
light with cast shadows, ambient occlusion and caustics.  That picture is then
painted stroke by stroke, from a large block-in down to hairline brushes.

Usage:  python3 spongebob.py [output.png] [--ref reference.png]
"""
import math
import random
import sys
import time

import numpy as np
from PIL import Image, ImageFilter

import paintbrush as pb

pb.configure(1500, 1800, 1.0)
from paintbrush import blur, fbm, lerp, noise1d, ramp, smooth  # noqa: E402

RW, RH = pb.RW, pb.RH
rng = np.random.default_rng(23)
random.seed(23)

jj, ii = np.meshgrid(np.arange(RW, dtype=np.float32), np.arange(RH, dtype=np.float32))
X = (jj + 0.5) / RW - 0.5          # -0.5 .. 0.5 across the canvas
Y = (ii + 0.5) / RW                # same unit downwards (0 .. 1.2)
LIGHT = np.array([-0.42, -0.62, 0.66])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
EYES = ((-0.099, 0.272), (0.099, 0.272))
EYE_R = 0.1


def box(x0, x1, y0, y1):
    return (slice(max(0, int(y0 * RW)), min(RH, int(y1 * RW) + 2)),
            slice(max(0, int((x0 + 0.5) * RW)), min(RW, int((x1 + 0.5) * RW) + 2)))


def gblur(a, sigma):
    if sigma <= 5:
        return blur(a, sigma)
    f = int(sigma // 2.5)
    h, w = a.shape
    small = np.asarray(Image.fromarray(a.astype(np.float32), "F").resize((w // f, h // f), Image.BOX))
    small = blur(small, sigma / f)
    return np.asarray(Image.fromarray(small, "F").resize((w, h), Image.BICUBIC))


def rbox(x, y, hx, hy, r):
    qx, qy = np.abs(x) - (hx - r), np.abs(y) - (hy - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


# ----------------------------------------------------------------------------
# the model: a z-buffered relief with colour and material per pixel
# ----------------------------------------------------------------------------
class Model:
    def __init__(self):
        self.z = np.full((RH, RW), -1.0, np.float32)
        self.alb = np.zeros((RH, RW, 3), np.float32)
        self.spec = np.zeros((RH, RW), np.float32)
        self.shin = np.full((RH, RW), 16.0, np.float32)
        self.sss = np.zeros((RH, RW), np.float32)
        self.kind = np.zeros((RH, RW), np.uint8)

    def put(self, sl, mask, z, alb, spec=0.06, shin=14.0, sss=0.0, kind=1):
        z = np.broadcast_to(np.asarray(z, np.float32), mask.shape)
        m = mask & (z > self.z[sl])
        self.z[sl][m] = z[m]
        self.alb[sl][m] = np.broadcast_to(np.asarray(alb, np.float32), mask.shape + (3,))[m]
        self.spec[sl][m] = spec
        self.shin[sl][m] = shin
        self.sss[sl][m] = sss
        self.kind[sl][m] = kind

    def capsule(self, a, b, ra, rb, za, zb, alb, **mat):
        pad = max(ra, rb) + 0.004
        sl = box(min(a[0], b[0]) - pad, max(a[0], b[0]) + pad, min(a[1], b[1]) - pad, max(a[1], b[1]) + pad)
        x, y = X[sl], Y[sl]
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = np.clip(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy + 1e-12), 0, 1)
        d = np.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))
        r = ra + (rb - ra) * t
        z = za + (zb - za) * t + np.sqrt(np.clip(r * r - d * d, 0, None))
        self.put(sl, d < r, z, alb(x, y, sl) if callable(alb) else alb, **mat)

    def ellipsoid(self, c, rx, ry, rz, z0, alb, clip=None, **mat):
        sl = box(c[0] - rx, c[0] + rx, c[1] - ry, c[1] + ry)
        x, y = X[sl] - c[0], Y[sl] - c[1]
        rho2 = (x / rx) ** 2 + (y / ry) ** 2
        m = rho2 < 1
        if clip is not None:
            m &= clip[sl]
        z = z0 + rz * np.sqrt(np.clip(1 - rho2, 0, None))
        self.put(sl, m, z, alb(x, y, sl) if callable(alb) else alb, **mat)


def mouth_curves():
    xm = np.clip(X / 0.185, -1, 1)
    yu = 0.502 - 0.047 * xm ** 2
    yl = yu + 0.058 * (1 - xm ** 2) ** 0.75
    return yu, yl


def stamp_pores(P, pts, radii, depth, warp):
    for (cx, cy), r in zip(pts, radii):
        a, b, th = r * rng.uniform(0.85, 1.3), r * rng.uniform(0.7, 1.1), rng.uniform(0, math.pi)
        pad = max(a, b) * 1.7
        sl = box(cx - pad, cx + pad, cy - pad, cy + pad)
        x, y = X[sl] - cx, Y[sl] - cy
        xr, yr = x * math.cos(th) + y * math.sin(th), -x * math.sin(th) + y * math.cos(th)
        rho = np.sqrt((xr / a) ** 2 + (yr / b) ** 2) * (1 + 0.7 * (warp[sl] - 0.5))
        np.maximum(P[sl], smooth(1.0, 0.5, rho) * depth(r), out=P[sl])


def build_sponge(M):
    cyb, hh = 0.37, 0.27
    hw = 0.30 - 0.035 * (Y - 0.10) / 0.66
    d = rbox(X * (0.285 / hw), Y - cyb, 0.285, hh, 0.035)
    d = (d + 0.010 * np.sin(2 * np.pi * Y / 0.108 + 0.6) + 0.007 * np.sin(2 * np.pi * X / 0.098 + 1.1)
         + (fbm(26, 30, 400, 3) - 0.5) * 0.012)
    inside = d < 0
    prof = np.sqrt(1 - (1 - np.clip(-d / 0.04, 0, 1)) ** 2)
    z = (0.10 * prof + 0.035 * (1 - (X / 0.3) ** 2) + 0.02 * (1 - ((Y - cyb) / hh) ** 2)
         + 0.006 * (fbm(10, 12, 401, 3) - 0.5))
    alb = lerp((240, 204, 50), (228, 182, 34), fbm(7, 8, 402, 4))
    alb = lerp(alb, (204, 148, 28), (1 - prof) * 0.7)

    # cheeks: blushing bumps with three freckles each
    for sgn in (-1, 1):
        cx, cy = sgn * 0.222, 0.44
        rho = np.hypot(X - cx, Y - cy) / 0.05
        z += 0.02 * np.cos(np.clip(rho, 0, 1) * np.pi / 2) ** 2
        alb = lerp(alb, (232, 118, 66), (1 - smooth(0.25, 1.0, rho)) * 0.55)
        for fx, fy in ((-0.018, -0.008), (0.001, 0.013), (0.019, -0.006)):
            alb = lerp(alb, (150, 62, 30), 1 - smooth(0.003, 0.0055, np.hypot(X - cx - fx, Y - cy - fy)))

    # lips and the corners of the smile
    yu, yl = mouth_curves()
    mouth = (np.abs(X) < 0.185) & (Y > yu) & (Y < yl)
    dm = np.where(np.abs(X) < 0.185, np.maximum(yu - Y, Y - yl), np.hypot(np.abs(X) - 0.185, Y - 0.455))
    lip = np.exp(-(dm / 0.008) ** 2) * (dm > 0)
    z += 0.006 * lip
    alb = lerp(alb, (212, 140, 36), lip * 0.5)
    for sgn in (-1, 1):
        ax_, ay_, bx_, by_ = sgn * 0.176, 0.436, sgn * 0.197, 0.474
        t = np.clip(((X - ax_) * (bx_ - ax_) + (Y - ay_) * (by_ - ay_)) / ((bx_ - ax_) ** 2 + (by_ - ay_) ** 2), 0, 1)
        crease = np.exp(-(np.hypot(X - ax_ - t * (bx_ - ax_), Y - ay_ - t * (by_ - ay_)) / 0.0035) ** 2)
        z -= 0.008 * crease
        alb = lerp(alb, (150, 84, 20), crease * 0.6)

    # pores: a few big craters where the cartoon has them, then hundreds of
    # medium and thousands of small ones, as in real cellulose sponge
    P = np.zeros((RH, RW), np.float32)
    warp = fbm(90, 108, 403, 3)
    big = [(-0.215, 0.165, 0.030), (-0.105, 0.135, 0.017), (0.225, 0.155, 0.024), (0.135, 0.135, 0.012),
           (-0.255, 0.285, 0.020), (0.262, 0.300, 0.017), (-0.235, 0.365, 0.012), (0.240, 0.385, 0.022),
           (-0.250, 0.535, 0.026), (-0.160, 0.585, 0.016), (0.225, 0.555, 0.028), (0.110, 0.600, 0.014),
           (-0.040, 0.598, 0.012), (0.000, 0.135, 0.011), (0.255, 0.470, 0.012), (-0.265, 0.455, 0.012)]
    stamp_pores(P, [(b[0], b[1]) for b in big], [b[2] for b in big], lambda r: 0.03, warp)

    def scatter(n, margin, face_keep):
        x, y = rng.uniform(-0.31, 0.31, n), rng.uniform(0.09, 0.65, n)
        i, j = (y * RW).astype(int), ((x + 0.5) * RW).astype(int)
        ok = d[i, j] < -margin
        for ex, ey in EYES:
            ok &= np.hypot(x - ex, y - ey) > EYE_R + 0.006
        face = (np.abs(x) < 0.25) & (y > 0.37) & (y < 0.585)
        ok &= ~face | (rng.random(n) < face_keep)
        return list(zip(x[ok], y[ok]))

    med = scatter(520, 0.014, 0.25)
    stamp_pores(P, med, rng.uniform(0.005, 0.012, len(med)), lambda r: r * 1.7, warp)
    small = scatter(9000, 0.006, 0.6)
    Ps = np.zeros_like(P)
    stamp_pores(Ps, small, rng.uniform(0.0014, 0.0045, len(small)) ** 1.0, lambda r: r * 1.6, warp)
    P = P + Ps * (1 - 0.4 * (P > 0))
    z = z - P + 0.003 * (fbm(220, 264, 404, 3) - 0.5)
    alb = lerp(alb, (150, 110, 16), smooth(0.0, 0.014, P) * 0.6)
    alb = alb * (1 + 0.07 * (fbm(260, 312, 405, 2) - 0.5))[..., None]

    full = (slice(0, RH), slice(0, RW))
    M.put(full, inside & ~mouth, z, alb, spec=0.03, shin=6, sss=1.0)
    zface = 0.15

    # inside the mouth
    cav = lerp((40, 6, 12), (120, 26, 30), smooth(0.0, 1.0, (Y - yu) / np.maximum(yl - yu, 1e-4)))
    M.put(full, inside & mouth, np.full_like(z, 0.085), cav, spec=0.2, shin=20)
    pap = fbm(160, 190, 406, 2)

    def tongue(x, y, sl):
        c = lerp((222, 104, 112), (190, 70, 86), pap[sl])
        return c * (1 - 0.3 * np.exp(-(x / 0.004) ** 2))[..., None]

    M.ellipsoid((0.0, 0.556), 0.085, 0.034, 0.05, 0.085, tongue, clip=mouth, spec=0.55, shin=40)
    for sgn in (-1, 1):                                   # two buck teeth
        cx = sgn * 0.0225
        sl = box(cx - 0.021, cx + 0.021, 0.49, 0.555)
        x, y = X[sl] - cx, Y[sl]
        top = yu[sl]
        sd = rbox(x, y - (top + 0.021), 0.0195, 0.0255, 0.008)
        rel = (y - top) / 0.046
        tz = zface + 0.004 + 0.012 * np.sqrt(np.clip(1 - (x / 0.0195) ** 2 * 0.85, 0, 1)) - 0.006 * smooth(-0.004, 0, sd)
        en = lerp((246, 240, 224), (228, 208, 160), smooth(0.45, 0.0, rel) * 0.55)
        en = lerp(en, (204, 216, 228), smooth(0.72, 1.0, rel) * 0.4)
        en = en * (1 + 0.025 * np.sin(x * 2 * np.pi / 0.0045))[..., None]
        M.put(sl, (sd < 0) & (y > top - 0.002), tz, en, spec=0.9, shin=70)

    # nose: a stubby tube coming out toward the viewer
    nn = fbm(240, 288, 407, 2)

    def nose_alb(x, y, sl):
        return lerp((244, 200, 52), (224, 170, 30), nn[sl])

    M.capsule((0.004, 0.432), (0.034, 0.385), 0.030, 0.027, zface - 0.005, zface + 0.06, nose_alb,
              spec=0.08, shin=10, sss=1.0)
    return zface


def build_eyes(M, zface):
    """Glassy eyeballs.  They are shaded here directly; returns their colour."""
    lx, ly, lz = LIGHT
    col = np.zeros((RH, RW, 3), np.float32)
    vn, vn2 = fbm(44, 52, 500, 4), fbm(12, 14, 501, 2)
    irises = []

    def polar(th, n, seed):
        r = np.random.default_rng(seed).random(n)
        r = np.append(r, r[0])
        xx = (th + np.pi) / (2 * np.pi) * n
        i = np.clip(xx.astype(int), 0, n - 1)
        f = xx - i
        return r[i] * (1 - f) + r[i + 1] * f

    for k, (cx, cy) in enumerate(EYES):
        sgn = -1 if cx < 0 else 1
        R = EYE_R
        sl = box(cx - R, cx + R, cy - R, cy + R)
        x, y = X[sl] - cx, Y[sl] - cy
        rho = np.hypot(x, y) / R
        nzs = np.sqrt(np.clip(1 - rho ** 2, 0, 1))
        M.put(sl, rho < 1, zface + 0.008 + 0.5 * R * nzs, (240, 238, 232), kind=2)
        diff = np.clip((x / R) * lx + (y / R) * ly + nzs * lz, -1, 1)
        scl = lerp((246, 244, 238), (236, 204, 194), rho ** 3 * 0.7)
        vein = smooth(0.03, 0.0, np.abs(vn[sl] - 0.5)) * smooth(0.5, 0.98, rho) * smooth(0.35, 0.7, vn2[sl])
        scl = lerp(scl, (196, 70, 60), vein * 0.5)
        scl = lerp(scl, (170, 206, 226), 0.22 * smooth(0.2, 1.0, y / R))
        scl = scl * ((0.74 + 0.34 * np.clip(diff * 0.75 + 0.25, 0, 1)) * (1 - 0.30 * rho ** 5)
                     * (1 - 0.22 * smooth(-0.45, -1.0, y / R)))[..., None]
        # iris, looking very slightly inward
        ix, iy = x + sgn * 0.012, y - 0.006
        ri, rp = 0.042, 0.0175
        ir = np.hypot(ix, iy)
        rr = np.clip(ir / ri, 0, 1)
        th = np.arctan2(iy, ix)
        fib = 0.5 * polar(th, 90, 510 + k) + 0.3 * polar(th, 37, 520 + k) + 0.2 * polar(th, 190, 530 + k)
        ic = ramp([(0, (156, 218, 248)), (0.42, (150, 214, 246)), (0.58, (76, 158, 228)),
                   (0.82, (30, 108, 204)), (1.0, (10, 44, 108))], rr)
        ic = ic * (0.70 + 0.60 * fib * smooth(0.3, 0.6, rr) + 0.3 * (1 - smooth(0.3, 0.6, rr)))[..., None]
        ic = lerp(ic, (206, 222, 180), np.exp(-((rr - 0.47) / 0.05) ** 2) * 0.3 * polar(th, 23, 540 + k))
        ic = ic * (0.60 + 0.80 * smooth(-0.3, 1.0, (ix * 0.56 + iy * 0.78) / ri))[..., None]   # caustic crescent
        ic = ic * (1 - 0.42 * smooth(-0.1, -1.0, iy / ri))[..., None]                            # lid shadow
        ic = lerp(ic, (5, 5, 9), 1 - smooth(rp - 0.0015, rp + 0.0015, ir))
        c = lerp(scl, ic, 1 - smooth(ri - 0.002, ri + 0.001, ir))
        c = c * (1 - 0.2 * np.exp(-((ir - ri) / 0.004) ** 2))[..., None]
        # reflections on the wet cornea: a window with its glazing bars, a small
        # second glint, and a soft sheen across the white
        hx, hy = ix + 0.017, iy + 0.019
        u, v = hx * 0.94 + hy * 0.2, hy * 0.94 - hx * 0.2
        win = 1 - smooth(0.0085, 0.011, np.maximum(np.abs(u), np.abs(v) * 0.85))
        win = win * (1 - 0.75 * np.maximum(np.abs(u) < 0.0009, np.abs(v + 0.001) < 0.0009))
        add = (win * 0.96 + np.exp(-(np.hypot(hx, hy) / 0.022) ** 2) * 0.28
               + (1 - smooth(0.0035, 0.005, np.hypot(ix - 0.016, iy - 0.017))) * 0.6
               + np.exp(-(((x + 0.42 * R) / 0.035) ** 2 + ((y + 0.5 * R) / 0.03) ** 2)) * 0.22)
        c = lerp(c, (255, 255, 255), np.clip(add, 0, 1))
        c = c * (1 - 0.4 * smooth(0.95, 1.0, rho))[..., None]
        col[sl][rho < 1] = c[rho < 1]
        irises.append((cx - sgn * 0.012, cy + 0.006, ri, rp))
        for a in (-30, 0, 30):                           # three stout lashes
            sa, ca = math.sin(math.radians(a + sgn * 4)), -math.cos(math.radians(a + sgn * 4))
            M.capsule((cx + R * 0.96 * sa, cy + R * 0.96 * ca), (cx + R * 1.42 * sa, cy + R * 1.42 * ca),
                      0.0085, 0.003, zface + 0.03, zface + 0.02, (22, 18, 16), spec=0.5, shin=30)
    return col, irises


def build_clothes(M):
    hw = 0.30 - 0.035 * (Y - 0.10) / 0.66 + 0.006
    side = np.clip(1 - (np.abs(X) / hw) ** 6, 0, 1) ** 0.5
    zc = 0.06 + 0.10 * side
    full = (slice(0, RH), slice(0, RW))
    within = np.abs(X) < hw
    fold = fbm(18, 70, 600, 3)
    shirt = within & (Y > 0.63 + 0.004 * np.sin(X * 46)) & (Y < 0.686)
    M.put(full, shirt, zc + 0.006 * (fold - 0.5), (242, 242, 238), spec=0.04, shin=8)
    weave = np.sin(2 * np.pi * X / 0.0045) * np.sin(2 * np.pi * Y / 0.0045)
    pants = within & (Y >= 0.684) & (Y < 0.768) & ((Y < 0.74) | (rbox(X, Y - 0.72, hw, 0.048, 0.022) < 0))
    brown = lerp((134, 82, 36), (112, 66, 26), fbm(9, 11, 601, 3)) * (1 + 0.07 * weave)[..., None]
    M.put(full, pants, zc + 0.003 + 0.0012 * weave + 0.004 * (fbm(14, 30, 602, 3) - 0.5), brown, spec=0.03, shin=6)
    for bx in (-0.205, -0.07, 0.07, 0.205):               # belt
        m = (rbox(X - bx, Y - 0.701, 0.043, 0.009, 0.003) < 0) & within
        M.put(full, m, zc + 0.008, (22, 20, 20), spec=0.6, shin=30)
    for sgn in (-1, 1):                                   # collar points
        tri = ((sgn * 0.072, 0.63), (sgn * 0.004, 0.63), (sgn * 0.03, 0.674))
        sides = [(X - p[0]) * (q[1] - p[1]) - (Y - p[1]) * (q[0] - p[0])
                 for p, q in zip(tri, tri[1:] + tri[:1])]
        m = ((sides[0] > 0) == (sides[1] > 0)) & ((sides[1] > 0) == (sides[2] > 0))
        M.put(full, m, zc + 0.008, (248, 248, 246), spec=0.04, shin=8)
    rib = 1 + 0.08 * np.sin((X + Y) * 2 * np.pi / 0.005)
    red = np.asarray((208, 28, 32), np.float32) * rib[..., None]
    knot = (Y > 0.632) & (Y < 0.656) & (np.abs(X) < 0.019 - (Y - 0.632) * 0.25)
    wdt = np.where(Y < 0.708, 0.012 + (Y - 0.656) / 0.052 * 0.010, 0.022 * (0.738 - Y) / 0.03)
    blade = (Y >= 0.656) & (Y < 0.738) & (np.abs(X) < wdt)
    M.put(full, knot | blade, zc + 0.012 + 0.006 * np.sqrt(np.clip(1 - (X / 0.024) ** 2, 0, 1)), red,
          spec=0.45, shin=22)
    for sgn in (-1, 1):                                   # trouser legs
        cx = sgn * 0.115
        sl = box(cx - 0.053, cx + 0.053, 0.755, 0.806)
        x, y = X[sl] - cx, Y[sl]
        m = (np.abs(x) < 0.052) & (y > 0.755) & (y < 0.805)
        c = brown[sl] * (1 - 0.25 * (y > 0.797))[..., None]
        M.put(sl, m, 0.05 + 0.07 * np.sqrt(np.clip(1 - (x / 0.052) ** 2, 0, 1)), c, spec=0.03, shin=6)


def build_limbs(M):
    skin = (238, 198, 52)
    sk = dict(spec=0.14, shin=18, sss=0.6)

    def sock(x, y, sl):
        c = np.broadcast_to(np.asarray((244, 244, 240), np.float32), x.shape + (3,)).copy()
        c[(y > 0.972) & (y < 0.985)] = (44, 92, 204)
        c[(y > 0.993) & (y < 1.006)] = (212, 40, 44)
        return c * (0.94 + 0.12 * np.sin(x * 2 * np.pi / 0.004))[..., None]

    for sgn in (-1, 1):
        M.capsule((sgn * 0.115, 0.79), (sgn * 0.118, 0.975), 0.0125, 0.0125, 0.08, 0.08, skin, **sk)
        M.capsule((sgn * 0.118, 0.957), (sgn * 0.120, 1.04), 0.0175, 0.0175, 0.08, 0.08, sock, spec=0.03, shin=6)
        # patent-leather shoe: heel block, body and a bulbous toe
        M.ellipsoid((sgn * 0.128, 1.078), 0.062, 0.038, 0.055, 0.075, (16, 14, 16), spec=1.3, shin=60, kind=3)
        M.ellipsoid((sgn * 0.168, 1.072), 0.046, 0.044, 0.065, 0.085, (18, 16, 18), spec=1.3, shin=60, kind=3)
    # left arm hangs, right arm waves
    M.capsule((-0.268, 0.563), (-0.316, 0.600), 0.036, 0.029, 0.06, 0.06, (242, 242, 238), spec=0.04, shin=8)
    M.capsule((-0.312, 0.600), (-0.376, 0.700), 0.0115, 0.0115, 0.075, 0.075, skin, **sk)
    M.capsule((-0.376, 0.700), (-0.360, 0.800), 0.0115, 0.0115, 0.075, 0.08, skin, **sk)
    M.ellipsoid((-0.357, 0.822), 0.024, 0.028, 0.02, 0.085, skin, **sk)
    for tip in ((-0.377, 0.868), (-0.357, 0.876), (-0.337, 0.868)):
        M.capsule((tip[0] * 0.5 - 0.1785, 0.835), tip, 0.0095, 0.0085, 0.085, 0.09, skin, **sk)
    M.capsule((-0.340, 0.818), (-0.322, 0.842), 0.0095, 0.0085, 0.09, 0.095, skin, **sk)

    M.capsule((0.268, 0.563), (0.320, 0.548), 0.036, 0.029, 0.06, 0.06, (242, 242, 238), spec=0.04, shin=8)
    M.capsule((0.316, 0.548), (0.402, 0.490), 0.0115, 0.0115, 0.075, 0.075, skin, **sk)
    M.capsule((0.402, 0.490), (0.416, 0.365), 0.0115, 0.0115, 0.075, 0.08, skin, **sk)
    M.ellipsoid((0.418, 0.338), 0.026, 0.030, 0.02, 0.085, skin, **sk)
    for tip in ((0.395, 0.280), (0.419, 0.270), (0.443, 0.282)):
        M.capsule((0.418 + (tip[0] - 0.418) * 0.5, 0.322), tip, 0.0095, 0.0085, 0.085, 0.09, skin, **sk)
    M.capsule((0.400, 0.340), (0.377, 0.322), 0.0095, 0.0085, 0.09, 0.095, skin, **sk)


def caustics(seed):
    a, b = fbm(16, 19, seed, 3), fbm(27, 32, seed + 7, 3)
    c = (1 - np.abs(2 * a - 1)) ** 7 + 0.7 * (1 - np.abs(2 * b - 1)) ** 9
    return np.clip(blur(c.astype(np.float32), 1.5), 0, 1)


def shade(M, eye_col, caus):
    """Light the relief: key light with cast shadows, occluded ambient, gloss."""
    mask = M.z > -0.5
    z = np.where(mask, M.z, 0.0).astype(np.float32)
    zy, zx = np.gradient(blur(z, 0.7))
    zx, zy = zx * RW, zy * RW
    inv = 1 / np.sqrt(zx * zx + zy * zy + 1)
    nx, ny, nz = -zx * inv, -zy * inv, inv
    lx, ly, lz = LIGHT
    diff = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)

    hyp = math.hypot(lx, ly)
    sh = np.zeros_like(z)
    for dist in (2, 3, 4, 6, 8, 11, 14, 18, 23, 29, 36, 45, 56, 70, 88, 110, 135):
        dx, dy = int(round(lx / hyp * dist)), int(round(ly / hyp * dist))
        occ = np.roll(M.z, (-dy, -dx), axis=(0, 1)) - (M.z + dist * (lz / hyp) / RW)
        sh = np.maximum(sh, smooth(0.001, 0.005 + dist * 0.0004, occ))
    sh = blur(sh, 1.0)

    zc = np.where(mask, M.z, 0.02).astype(np.float32)
    ao_s = 1 / (1 + np.maximum(0, gblur(zc, 3) - zc) / 0.005)
    ao_l = 1 / (1 + np.maximum(0, gblur(zc, 24) - zc) / 0.045)
    ao = ao_s * ao_l

    key = np.asarray((1.12, 1.03, 0.88), np.float32) * 1.08
    amb = np.asarray((0.34, 0.39, 0.45), np.float32)
    bounce = np.clip(ny, 0, 1)[..., None] * np.asarray((0.30, 0.24, 0.13), np.float32)
    direct = (diff * (1 - sh) * (0.86 + 0.4 * caus) * np.sqrt(ao_s))[..., None] * key
    light = direct + (amb + bounce) * ao[..., None]
    light = light + M.sss[..., None] * np.asarray((0.13, 0.09, 0.03), np.float32)
    col = M.alb * light
    hvec = np.array([lx, ly, lz + 1.0])
    hvec = hvec / np.linalg.norm(hvec)
    ndh = np.clip(nx * hvec[0] + ny * hvec[1] + nz * hvec[2], 0, 1)
    col = col + (M.spec * ndh ** M.shin * (1 - sh) * 255)[..., None]
    # a shoe-polish reflection of the bright water above, and a cool rim from behind
    glossy = (M.kind == 3)[..., None]
    col = col + glossy * (np.clip(-ny, 0, 1) ** 2 * nz)[..., None] * np.asarray((60, 110, 130), np.float32)
    rim = ((1 - nz) ** 2 * np.clip(nx * 0.8 - ny * 0.2, 0, 1))[..., None]
    col = col + rim * np.asarray((70, 130, 150), np.float32) * 0.6

    eye = M.kind == 2
    col[eye] = (eye_col * ((1 - 0.38 * sh) * (0.7 + 0.3 * ao_l))[..., None])[eye]
    x = col / 255.0
    x = np.where(x > 0.8, 0.8 + (x - 0.8) / (1 + (x - 0.8) * 2.2), x)
    col = lerp(x * 255.0, (40, 130, 170), np.full(z.shape, 0.05, np.float32))   # a breath of water haze
    return col, blur(mask.astype(np.float32), 0.8)


def bubble(img, cx, cy, r, strength=1.0):
    sl = box(cx - r * 1.2, cx + r * 1.2, cy - r * 1.2, cy + r * 1.2)
    x, y = (X[sl] - cx) / r, (Y[sl] - cy) / r
    rho = np.hypot(x, y)
    aa = 1.5 / (r * RW)
    inside = 1 - smooth(1 - aa, 1, rho)
    facing = (-x * 0.56 - y * 0.74)
    rimw = np.exp(-((rho - 0.93) / 0.06) ** 2) * (0.25 + 0.75 * np.abs(facing))
    c = img[sl] * (1 + 0.10 * inside)[..., None]
    c = lerp(c, (150, 216, 236), inside * 0.10)
    c = lerp(c, (214, 242, 250), np.clip(rimw * inside * 0.8, 0, 1))
    glint = np.exp(-(((x + 0.42) / 0.14) ** 2 + ((y + 0.46) / 0.12) ** 2))
    arc = np.exp(-((rho - 0.72) / 0.07) ** 2) * smooth(0.35, 0.95, -facing) * 0.4
    c = lerp(c, (255, 255, 255), np.clip((glint * 0.95 + arc) * inside, 0, 1))
    img[sl] = lerp(img[sl], c, np.full(rho.shape, strength, np.float32))


def background(caus):
    yh = 0.905
    water = ramp([(0, (66, 178, 208)), (0.35, (26, 130, 180)), (0.75, (14, 96, 150)), (1, (32, 118, 162))],
                 np.clip(Y / yh, 0, 1))
    glow = np.exp(-(((X + 0.30) / 0.55) ** 2 + ((Y + 0.12) / 0.5) ** 2))
    water = lerp(water, (172, 238, 242), glow * 0.6)
    ang = np.arctan2(X + 0.35, Y + 0.5)                   # light shafts fan out from the surface
    n1 = noise1d(30, 301)
    rays = smooth(0.5, 0.85, n1[np.clip((ang + 0.5) / 1.8 * (RW - 1), 0, RW - 1).astype(int)])
    water = lerp(water, (156, 228, 238), rays * np.exp(-Y * 1.5) * (0.6 + 0.4 * glow) * 0.4)
    for cx, cy, r0, rot in ((-0.33, 0.30, 0.075, 0.3), (0.30, 0.16, 0.06, 1.1), (-0.12, 0.05, 0.05, 2.0),
                            (0.42, 0.62, 0.07, 0.7), (-0.40, 0.70, 0.05, 1.7), (0.10, 0.80, 0.04, 0.2)):
        th = np.arctan2(Y - cy, X - cx)                   # the flower-shaped clouds of his sky, far away
        rr = np.hypot(X - cx, Y - cy) / (r0 * (0.72 + 0.28 * np.cos(5 * th + rot)))
        water = lerp(water, (126, 214, 234), (1 - smooth(0.8, 1.0, rr)) * smooth(0.25, 0.5, rr) * 0.25)
    mound = 0.02 + 0.08 * noise1d(5, 311) ** 1.4
    water = lerp(water, (12, 80, 118), smooth(0, 0.012, Y - (yh - mound[None, :])) * 0.6)
    for _ in range(26):                                   # out-of-focus bubbles
        bubble(water, rng.uniform(-0.5, 0.5), rng.uniform(0.0, 0.9), rng.uniform(0.008, 0.035), 0.7)

    # the sand: rippled, grainy, netted with caustic light, fading into haze
    fz = 1 / np.maximum(Y - yh + 0.02, 0.004)
    fx = X * fz
    tex = fbm(8, 9, 320, 4)
    ti = ((fz * 40) % RH).astype(int)
    tj = ((fx * 300 + 5000) % RW).astype(int)
    ripple = np.sin(13 * fz + 6 * tex[ti, tj])
    near = smooth(0.0, 0.09, Y - yh)
    sand = np.asarray((224, 200, 150), np.float32) * (1 + 0.13 * ripple * near)[..., None]
    grain = rng.random((RH, RW), dtype=np.float32) - 0.5
    sand = sand * (1 + 0.16 * grain * near + 0.10 * (fbm(120, 60, 321, 2) - 0.5))[..., None]
    speck = rng.random((RH, RW), dtype=np.float32)
    sand = lerp(sand, (120, 100, 78), (speck > 0.993) * near * 0.7)
    sand = lerp(sand, (250, 240, 214), (speck < 0.004) * near * 0.8)
    cfl = caus[((fz * 95) % RH).astype(int), ((fx * 420 + 7000) % RW).astype(int)]
    sand = sand * (0.80 + 0.55 * cfl)[..., None]
    shadow = 0.55 * np.exp(-(((X - 0.05) / 0.30) ** 2 + ((Y - 1.128) / 0.032) ** 2))
    for sx in (-0.14, 0.15):
        shadow = np.maximum(shadow, 0.85 * np.exp(-(((X - sx) / 0.085) ** 2 + ((Y - 1.118) / 0.012) ** 2)))
    sand = sand * (1 - shadow)[..., None]
    sand = lerp(sand, (34, 122, 164), np.exp(-(Y - yh) / 0.075))
    bg = np.where((Y > yh)[..., None], sand, water)

    soft = np.asarray(Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7)),
                      np.float32)
    bg = lerp(soft, bg, smooth(0.97, 1.13, Y))            # depth of field
    for _ in range(320):                                  # drifting motes
        px, py = rng.integers(2, RW - 2), rng.integers(2, int(RH * 0.9))
        r = rng.choice([1, 1, 2])
        bg[py - r:py + r + 1, px - r:px + r + 1] += rng.uniform(14, 60)
    return bg


def compose():
    M = Model()
    caus = caustics(900)
    zface = build_sponge(M)
    eye_col, irises = build_eyes(M, zface)
    build_clothes(M)
    build_limbs(M)
    char, alpha = shade(M, eye_col, caus)
    ref = lerp(background(caus), char, alpha)
    for cx, cy, r in ((-0.405, 0.20, 0.024), (-0.445, 0.43, 0.012), (0.30, 0.075, 0.018), (0.455, 0.60, 0.016),
                      (-0.34, 0.065, 0.011), (0.43, 0.84, 0.010), (-0.43, 0.96, 0.014), (-0.385, 0.155, 0.008),
                      (0.345, 0.045, 0.007), (0.47, 0.545, 0.007)):
        bubble(ref, cx, cy, r)
    vig = smooth(0.42, 0.95, np.hypot(X / 0.5, (Y - 0.6) / 0.6) * 0.72)
    ref = np.clip(ref * (1 - 0.30 * vig)[..., None], 0, 255).astype(np.float32)

    # brush direction: along the forms (across the local gradient); where the
    # picture is flat, down the shafts of light
    lum = gblur(ref @ np.asarray((0.3, 0.59, 0.11), np.float32), 2)
    gy, gx = np.gradient(lum)
    c2 = gblur(gx * gx - gy * gy, 8)
    s2 = gblur(2 * gx * gy, 8)
    eps = np.percentile(np.hypot(c2, s2), 60) * 0.5
    phi = 1.15 + (fbm(3, 3, 950, 2) - 0.5) * 1.2
    theta = 0.5 * np.arctan2(s2 - np.sin(2 * phi) * eps, c2 - np.cos(2 * phi) * eps) + np.pi / 2
    return dict(ref=ref, ax=np.cos(theta).astype(np.float32), ay=np.sin(theta).astype(np.float32),
                irises=irises)


def paint(scene):
    P = pb.Painter(scene, levels=(16, 7, 3, 1, 0))
    clip = np.clip
    print("blocking in")
    P.layer("block-in", P.grid(52), 110, 200, 520, 16, None, 5, 0.5, jit=(0.01, 0.06, 0.04),
            wet=0.1, alpha=(225, 255))
    e = P.error(7)
    P.layer("large", P.sample(0.5 + clip(e - 5, 0, 60) / 12, 9000), 46, 100, 300, 7, 50, 4, 0.55,
            jit=(0.012, 0.07, 0.04))
    print("modelling")
    e = P.error(3)
    P.layer("medium", P.sample(0.2 + clip(e - 5, 0, 80) / 10, 30000), 22, 50, 150, 3, 38, 3, 0.6,
            jit=(0.01, 0.06, 0.035))
    for k in range(2):
        e = P.error(1)
        P.layer(f"small {k + 1}", P.sample(0.03 + clip(e - 5, 0, 90) / 8, 45000), 10, 22, 70, 1, 30, 3, 0.6,
                jit=(0.008, 0.05, 0.03), wet=0.12)
    print("detail")
    for k in range(3):
        e = P.error(0)
        P.layer(f"fine {k + 1}", P.sample(clip(e - 4, 0, 100) ** 1.2 + 0.02, 80000), 5, 10, 34, 0, 24, 2, 0.5,
                jit=(0.005, 0.035, 0.02), wet=0.08, dry=0.0)
    def hairline(k):
        e = P.error(0)
        P.layer(f"hairline {k}", P.sample(clip(e - 3, 0, 100) ** 1.3 + 0.004, 90000), 3, 5, 18, 0, 20, 2,
                0.45, jit=(0.004, 0.025, 0.015), wet=0.05, dry=0.0)

    for k in (1, 2, 3):
        hairline(k)
    ref = scene["ref"]
    for cx, cy, ri, rp in scene["irises"]:                # iris fibres, drawn outward from the pupil
        for _ in range(900):
            th = random.uniform(0, 2 * math.pi)
            ra = random.uniform(rp * 1.08, ri * 0.8)
            rb = min(ri * 0.97, ra + random.uniform(0.12, 0.4) * ri)
            pts = [((cx + r * math.cos(th) + 0.5) * pb.W, (cy + r * math.sin(th)) * pb.W)
                   for r in (ra, (ra + rb) / 2, rb)]
            cols = [ref[P.cell(x, y)] for x, y in pts]
            if max(float(np.abs(c - cols[1]).mean()) for c in cols) > 26:
                continue                                  # leave the reflections alone
            P.c.stroke(pts, random.uniform(2.5, 4), pb.jitter(tuple(cols[1]), 0.012, 0.1, 0.1), lw=2,
                       thick=0.5, dry=0.0, alpha=(170, 250), taper=(0.3, 0.4))
    hairline(4)
    return P


def main():
    args = sys.argv[1:]
    ref_out = None
    if "--ref" in args:
        i = args.index("--ref")
        ref_out = args[i + 1]
        del args[i:i + 2]
    out = args[0] if args else "spongebob.png"
    t0 = time.time()
    print("imagining the subject")
    scene = compose()
    if ref_out:
        Image.fromarray(scene["ref"].astype(np.uint8)).save(ref_out)
        print(f"reference -> {ref_out}  ({time.time() - t0:.0f}s)")
        if not args:
            return
    P = paint(scene)
    print("lighting the paint")
    P.c.finish(relief=0.35).save(out, optimize=True)
    print(f"{P.c.count} brushstrokes in {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
