"""The Abyss: sky, eclipsed sun, spires, mound, light, motes, and the Radiance.

World coordinates are pixels of a 1920x1080 frame showing the whole stage at
zoom 1.  A Camera looks at a world point with a zoom; background layers move
with a parallax factor (0 = fixed to the screen, 1 = moves with the world).
"""
import math
import os
import random

import numpy as np
import skia

from .draw import (TAU, circle, fill, glow, linear, mix, paint, path, radial, rect, rgb,
                   soft_dot, tapered)

W, H = 1920, 1080
ASSETS = os.path.join(os.path.dirname(__file__), 'assets')

GROUND_Y = 880            # top of the mound at its centre
RAD_X, RAD_TOP, RAD_SCALE = 960.0, 24.0, 0.56
SUN = (960.0, 270.0, 250.0)   # the eclipsed disc behind her: centre, radius


class Camera:
    def __init__(self, cx=960.0, cy=540.0, zoom=1.0, roll=0.0):
        self.cx, self.cy, self.zoom, self.roll = cx, cy, zoom, roll

    def apply(self, cv, parallax=1.0):
        z = 1 + (self.zoom - 1) * parallax
        cv.translate(W / 2, H / 2)
        cv.rotate(self.roll * parallax)
        cv.scale(z, z)
        cv.translate(-(self.cx * parallax + (1 - parallax) * W / 2),
                     -(self.cy * parallax + (1 - parallax) * H / 2))

    def to_screen(self, x, y, parallax=1.0):
        z = 1 + (self.zoom - 1) * parallax
        wx = self.cx * parallax + (1 - parallax) * W / 2
        wy = self.cy * parallax + (1 - parallax) * H / 2
        return (x - wx) * z + W / 2, (y - wy) * z + H / 2


def lerp_cam(a, b, u):
    return Camera(a.cx + (b.cx - a.cx) * u, a.cy + (b.cy - a.cy) * u,
                  a.zoom * (b.zoom / a.zoom) ** u, a.roll + (b.roll - a.roll) * u)


def ground_y(x):
    dx = (x - 960) / 960
    return GROUND_Y + 150 * dx * dx


# --- the sky --------------------------------------------------------------------------
def sky(cv, cam, light=0.0, dark=0.0):
    top = mix((44, 34, 80), (70, 64, 120), light)
    mid = mix((26, 20, 50), (48, 44, 90), light)
    low = mix((10, 8, 20), (20, 18, 36), light)
    k = 1 - dark * 0.7
    top, mid, low = [tuple(c * k for c in col) for col in (top, mid, low)]
    rect(cv, 0, 0, W, H, shader=linear((0, 0), (0, H), [(top, 1), (mid, 1), (low, 1)],
                                       [0.0, 0.55, 1.0]))


def sun(cv, cam, t, light=0.0, flare=0.0, dark=0.0):
    """The disc behind her: eclipsed (a dark sun with a burning rim), or with
    light=1 the light returned."""
    cv.save()
    cam.apply(cv, 0.6)
    x, y, r = SUN
    k = 1 - dark * 0.8
    flick = 1 + 0.06 * math.sin(t * 5.3) + flare
    # wide glow
    cv.drawCircle(x, y, r * 2.6, paint((0, 0, 0), shader=radial(
        (x, y), r * 2.6, [((150, 130, 230), 0.32 * flick * k), ((90, 70, 160), 0.10 * k),
                          ((0, 0, 0), 0)]), blend=skia.BlendMode.kPlus))
    # the burning rim
    ring = skia.Path()
    ring.addCircle(x, y, r)
    p = paint((226, 220, 255), 0.9 * k * flick, stroke=10)
    p.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 9))
    p.setBlendMode(skia.BlendMode.kPlus)
    cv.drawPath(ring, p)
    cv.drawPath(ring, paint((246, 244, 255), 0.85 * k * flick, stroke=3,
                            blend=skia.BlendMode.kPlus))
    # the eclipsed face, or the light coming back
    face = mix((16, 12, 32), (250, 246, 255), light)
    cv.drawCircle(x, y, r - 4, paint(face, 0.92 if light < 0.5 else 1.0))
    if light > 0:
        cv.drawCircle(x, y, r * 3.2, paint((0, 0, 0), shader=radial(
            (x, y), r * 3.2, [((255, 250, 240), 0.8 * light), ((200, 190, 255), 0.25 * light),
                              ((0, 0, 0), 0)]), blend=skia.BlendMode.kPlus))
    cv.restore()


def shafts(cv, cam, t, strength=1.0, light=0.0):
    """Light falling through the dark from above."""
    if strength <= 0:
        return
    cv.save()
    cam.apply(cv, 0.5)
    x0, y0 = SUN[0], SUN[1] - 200
    for k, (ang, w, a) in enumerate(((-0.42, 0.05, 0.6), (-0.2, 0.07, 0.8), (0.02, 0.09, 1.0),
                                     (0.22, 0.06, 0.8), (0.46, 0.05, 0.6), (-0.6, 0.04, 0.4),
                                     (0.64, 0.04, 0.4))):
        a *= strength * (0.75 + 0.25 * math.sin(t * 0.9 + k * 1.7)) * (1 + light)
        L = 1500
        dx, dy = math.sin(ang), math.cos(ang)
        nx, ny = dy, -dx
        p = path([('M', x0 - nx * 10, y0 - ny * 10), ('L', x0 + nx * 10, y0 + ny * 10),
                  ('L', x0 + dx * L + nx * L * w, y0 + dy * L + ny * L * w),
                  ('L', x0 + dx * L - nx * L * w, y0 + dy * L - ny * L * w)])
        sh = linear((x0, y0), (x0 + dx * L, y0 + dy * L),
                    [(mix((160, 140, 240), (255, 248, 230), light), 0.20 * a),
                     ((120, 100, 200), 0.07 * a), ((0, 0, 0), 0.0)], [0, 0.5, 1])
        pp = paint((0, 0, 0), shader=sh, blend=skia.BlendMode.kPlus)
        pp.setMaskFilter(skia.MaskFilter.MakeBlur(skia.kNormal_BlurStyle, 18))
        cv.drawPath(p, pp)
    cv.restore()


# --- the city of the Abyss --------------------------------------------------------------
_r = random.Random(4)
SPIRE_LAYERS = []
for layer, (par, n, col) in enumerate(((0.25, 14, (34, 28, 62)), (0.4, 11, (24, 20, 46)),
                                       (0.6, 8, (14, 12, 28)))):
    towers = []
    for i in range(n):
        side = -1 if i % 2 == 0 else 1
        x = 960 + side * _r.uniform(330 + layer * 80, 1300)
        towers.append((x, _r.uniform(160, 520) + layer * 90, _r.uniform(26, 60) + layer * 16,
                       _r.random() < 0.5))
    SPIRE_LAYERS.append((par, col, towers))


def spire_path(x, top, w):
    """A Hallownest tower: a straight shaft, an onion dome, a needle."""
    base = 1400
    return path([('M', x - w, base), ('L', x - w, top + w * 1.6),
                 ('C', x - w * 1.35, top + w * 0.9, x - w * 0.5, top + w * 0.3, x - 2, top - w * 0.2),
                 ('L', x, top - w * 1.6), ('L', x + 2, top - w * 0.2),
                 ('C', x + w * 0.5, top + w * 0.3, x + w * 1.35, top + w * 0.9, x + w, top + w * 1.6),
                 ('L', x + w, base)])


def city(cv, cam, fog=1.0, light=0.0):
    for par, col, towers in SPIRE_LAYERS:
        cv.save()
        cam.apply(cv, par)
        c = mix(col, (60, 56, 100), light * 0.5)
        for x, top, w, windows in towers:
            p = spire_path(x, top, w)
            cv.drawPath(p, paint((0, 0, 0), shader=linear(
                (0, top), (0, top + 900), [(c, 1), (mix(c, (30, 24, 56), 0.5), 1)])))
            if windows and par > 0.3:
                for k in range(3):
                    wy = top + w * 3 + k * w * 2.6
                    lit = (int(x) + k) % 7 == 0
                    wc = (130, 120, 200) if lit else mix(c, (0, 0, 0), 0.4)
                    cv.drawRoundRect(skia.Rect.MakeXYWH(x - w * 0.12, wy, w * 0.24, w * 0.6),
                                     w * 0.12, w * 0.12, paint(wc, 0.55 if lit else 1))
        cv.restore()
        # fog between the layers
        rect(cv, 0, 0, W, H, shader=linear((0, 300), (0, H), [((60, 50, 110), 0.0),
                                                             ((60, 50, 110), 0.10 * fog)]))


# --- the mound and what lies on it ------------------------------------------------------------
def mound(cv, cam, light=0.0):
    cv.save()
    cam.apply(cv, 1.0)
    pts = [(x, ground_y(x)) for x in range(-400, 2340, 40)]
    p = skia.Path()
    p.moveTo(-400, 2200)
    for x, y in pts:
        p.lineTo(x, y)
    p.lineTo(2340, 2200)
    p.close()
    cv.drawPath(p, paint((0, 0, 0), shader=linear((0, GROUND_Y), (0, GROUND_Y + 300),
                                                 [((26, 22, 44), 1), ((8, 7, 14), 1)])))
    # rim light along the top, strongest where the light lands
    rim = skia.Path()
    rim.moveTo(*pts[0])
    for q in pts[1:]:
        rim.lineTo(*q)
    pr = paint(mix((150, 136, 220), (240, 230, 255), light), 0.9, stroke=4)
    pr.setShader(linear((200, 0), (1720, 0), [((90, 80, 150), 0.0), ((190, 176, 255), 0.9),
                                               ((90, 80, 150), 0.0)]))
    cv.drawPath(rim, pr)
    # fallen vessels half buried
    for mx, s, tilt in ((420, 26, -0.5), (1540, 20, 0.6), (700, 14, 0.2), (1260, 16, -0.3)):
        y = ground_y(mx) + s * 0.6
        cv.save()
        cv.translate(mx, y)
        cv.rotate(math.degrees(tilt))
        m = path([('M', 0, -s), ('C', s * 0.9, -s, s, -s * 0.2, s * 0.7, s * 0.3),
                  ('L', -s * 0.7, s * 0.3), ('C', -s, -s * 0.2, -s * 0.9, -s, 0, -s)])
        cv.drawPath(m, paint((96, 90, 130)))
        for side in (-1, 1):
            cv.drawOval(skia.Rect.MakeXYWH(side * s * 0.38 - s * 0.16, -s * 0.5, s * 0.32, s * 0.5),
                        paint((14, 12, 24)))
            tapered(cv, [(side * s * 0.4, -s * 0.9), (side * s * 0.55, -s * 1.7)], s * 0.22, s * 0.04,
                    (96, 90, 130))
        cv.restore()
    cv.restore()


def foreground(cv, cam, t):
    """Dark grass in the near corners, closer than everything."""
    cv.save()
    cam.apply(cv, 1.35)
    r = random.Random(9)
    for side in (-1, 1):
        for k in range(28):
            bx = 960 + side * (760 + k * 16 + r.uniform(-8, 8))
            by = 1000
            h = r.uniform(140, 330) * (1 - k / 36)
            lean = side * r.uniform(0.1, 0.5) + 0.04 * math.sin(t * 1.4 + k)
            pts = [(bx + lean * h * (u / 10) ** 2 * 1.4, by - h * u / 10) for u in range(11)]
            tapered(cv, pts, r.uniform(10, 18), 1, (6, 5, 10))
    cv.restore()


# --- motes of light and void ------------------------------------------------------------------
_m = random.Random(11)
MOTES = [(_m.uniform(-200, 2120), _m.uniform(-100, 1000), _m.uniform(1.2, 4.0), _m.random(),
          _m.uniform(0.2, 1.0), _m.uniform(0.4, 1.4)) for _ in range(140)]


def motes(cv, cam, t, light=0.0, amount=1.0, parallax=0.85):
    cv.save()
    cam.apply(cv, parallax)
    for x, y, r, ph, sp, par in MOTES:
        yy = (y + t * 22 * sp) % 1150 - 80
        xx = x + 14 * math.sin(t * 0.7 * sp + ph * TAU)
        tw = 0.5 + 0.5 * math.sin(t * 2.2 * sp + ph * TAU)
        soft_dot(cv, xx, yy, r * 3.2, mix((190, 180, 255), (255, 246, 220), light),
                 a=0.5 * tw * amount)
    cv.restore()


# --- the Radiance -----------------------------------------------------------------------------
_RAD = None


def radiance_image():
    global _RAD
    if _RAD is None:
        _RAD = skia.Image.open(os.path.join(ASSETS, 'radiance_voided.png'))
    return _RAD


RAD_EYES = (518.0, 329.0)        # in the image's own pixels
RAD_W, RAD_H = 1024, 1090


def rad_to_world(px, py):
    return RAD_X + (px - RAD_W / 2) * RAD_SCALE, RAD_TOP + py * RAD_SCALE


def radiance(cv, cam, t, flap=1.0, eyes=1.0, charge=0.0, cracks=0.0, dissolve=0.0, hit=0.0):
    img = radiance_image()
    cv.save()
    cam.apply(cv, 0.6)
    cv.translate(RAD_X - RAD_W / 2 * RAD_SCALE, RAD_TOP)
    cv.scale(RAD_SCALE, RAD_SCALE)
    alpha = 1.0 - dissolve
    p = skia.Paint(AntiAlias=True)
    p.setAlphaf(alpha)
    smp = skia.SamplingOptions(skia.FilterMode.kLinear)
    ang = flap * 3.0 * math.sin(t * 1.6)
    # wings, each swung about its shoulder, then the body over them
    for clip, pivot, a in (((0, 0, 400, RAD_H), (400, 470), -ang),
                           ((624, 0, RAD_W, RAD_H), (624, 470), ang)):
        cv.save()
        cv.clipRect(skia.Rect.MakeLTRB(*clip))
        cv.rotate(a, *pivot)
        cv.drawImage(img, 0, 0, smp, p)
        cv.restore()
    cv.save()
    cv.clipRect(skia.Rect.MakeLTRB(340, 0, 684, RAD_H))
    cv.drawImage(img, 0, 0, smp, p)
    cv.restore()
    if hit > 0:
        hp = skia.Paint(AntiAlias=True)
        hp.setAlphaf(hit * 0.8)
        hp.setColorFilter(skia.ColorFilters.Blend(rgb((255, 255, 255)), skia.BlendMode.kSrcIn))
        cv.drawImage(img, 0, 0, smp, hp)
    # eyes: burning
    ex, ey = RAD_EYES
    if eyes > 0 and dissolve < 0.8:
        k = eyes * (1 - dissolve) * (0.85 + 0.15 * math.sin(t * 2.0) + charge * 0.8)
        cv.drawCircle(ex, ey, 150 + 120 * charge, paint((0, 0, 0), shader=radial(
            (ex, ey), 150 + 120 * charge, [((230, 220, 255), 0.55 * k), ((150, 120, 255), 0.18 * k),
                                           ((0, 0, 0), 0)]), blend=skia.BlendMode.kPlus))
        for side in (-1, 1):
            e = path([('M', ex + side * 6, ey + 18), ('C', ex + side * 30, ey - 6, ex + side * 50, ey - 22,
                                                     ex + side * 56, ey - 4),
                      ('C', ex + side * 60, ey + 14, ex + side * 30, ey + 26, ex + side * 6, ey + 18)])
            cv.drawPath(e, paint((255, 255, 255), min(1, k)))
            gp = paint((210, 200, 255), min(1, k) * 0.9, blur=10, blend=skia.BlendMode.kPlus)
            cv.drawPath(e, gp)
    # cracks of light running through her
    if cracks > 0:
        r = random.Random(3)
        for k in range(14):
            x, y = 512.0, 330.0 + r.uniform(-20, 120)
            a0 = r.uniform(0, TAU)
            pts = [(x, y)]
            n = int(30 * min(1, cracks * 1.3))
            for _ in range(n):
                a0 += r.uniform(-0.5, 0.5)
                x += math.cos(a0) * 14
                y += math.sin(a0) * 14
                pts.append((x, y))
            if len(pts) > 2:
                tapered(cv, pts, 9, 2, (255, 250, 240), a=min(1, cracks * 2) * (1 - dissolve))
                tapered(cv, pts, 30, 6, (220, 200, 255), a=0.5 * (1 - dissolve), blur=12,
                        blend=skia.BlendMode.kPlus)
    cv.restore()


def rad_point(px, py, cam):
    """Screen position of a point given in the Radiance image's pixels."""
    wx, wy = rad_to_world(px, py)
    return cam.to_screen(wx, wy, 0.6)
