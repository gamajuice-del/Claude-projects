"""The cast, drawn as clean 2D shapes with cel shading and outlines.

Every character is drawn in its own units (the Knight's mask is 1 unit wide),
standing with its feet at the origin, y pointing down.  The caller places it
with x, y (pixels) and s (pixels per unit); facing=-1 mirrors it.
"""
import math

import skia

from .draw import (TAU, bezier_pts, circle, fill, glow, mix, outline, paint, path,
                   rgb, sym_path, tapered)

INK = (16, 13, 28)              # outline colour
VOID = (7, 6, 12)
VOID_SHEEN = (58, 46, 96)
WHITE = (242, 240, 250)
MASK_SHADE = (188, 182, 214)
MASK_DEEP = (140, 132, 176)
EYE_GLOW = (236, 236, 255)

KNIGHT_CLOAK = (62, 66, 98)
KNIGHT_CLOAK_SH = (36, 38, 62)
KNIGHT_CLOAK_RIM = (128, 132, 182)
NAIL = (196, 198, 214)
NAIL_SH = (120, 122, 146)

HORNET_RED = (176, 32, 50)
HORNET_RED_SH = (104, 14, 34)
HORNET_RED_RIM = (236, 96, 104)
VOID_RED = (64, 10, 24)
VOID_RED_SH = (30, 4, 12)
VOID_RED_RIM = (128, 40, 72)


class Pose(dict):
    """Pose parameters with defaults."""

    def __getattr__(self, k):
        return self.get(k, 0.0)


def _place(cv, x, y, s, facing=1, lean=0.0):
    cv.save()
    cv.translate(x, y)
    cv.rotate(lean)
    cv.scale(s * facing, s)


# --- the Knight --------------------------------------------------------------------
def knight_mask_path():
    """The mask with its two horns, one outline."""
    return sym_path([
        # top of the head, then up the inside of the right horn
        ('C', 0.10, -2.03, 0.16, -2.02, 0.19, -1.99),
        ('C', 0.21, -2.18, 0.26, -2.40, 0.33, -2.55),
        # round the horn tip and down its outer edge, bowing outward
        ('C', 0.36, -2.62, 0.44, -2.62, 0.45, -2.53),
        ('C', 0.50, -2.34, 0.52, -2.14, 0.47, -1.97),
        # the side of the face, bulging, then in to the chin
        ('C', 0.53, -1.86, 0.54, -1.55, 0.49, -1.38),
        ('C', 0.43, -1.16, 0.25, -1.06, 0.0, -1.06),
    ], top=-2.03, bottom=-1.06)


def knight_eye_path(cx, cy, rx, ry, rot):
    p = skia.Path()
    p.addOval(skia.Rect.MakeLTRB(cx - rx, cy - ry, cx + rx, cy + ry))
    m = skia.Matrix()
    m.setRotate(math.degrees(rot), cx, cy)
    p.transform(m)
    return p


def knight_cloak_path(t, wind, spread=0.0):
    w = wind
    hem = []
    xs = [-0.58, -0.30, -0.02, 0.27, 0.56]
    ys = [-0.22, -0.32, -0.20, -0.33, -0.24]
    for i, (hx, hy) in enumerate(zip(xs, ys)):
        flutter = 0.05 * math.sin(t * 7 + i * 1.7) * (0.3 + w)
        hem.append((hx * (1 + spread) - w * 0.32 * (0.5 + 0.5 * (i / 4)), hy + flutter - w * 0.1))
    cmds = [('M', -0.20, -1.16),
            ('C', -0.36, -1.08, -0.46 - w * 0.1, -0.70, hem[0][0], hem[0][1])]
    for i in range(1, 5):
        mx = (hem[i - 1][0] + hem[i][0]) / 2
        my = max(hem[i - 1][1], hem[i][1]) - 0.08
        cmds.append(('Q', mx, my, hem[i][0], hem[i][1]))
    cmds.append(('C', 0.48 - w * 0.2, -0.70, 0.38, -1.06, 0.20, -1.16))
    return path(cmds)


def knight(cv, x, y, s, facing=1, pose=None, t=0.0, view='front', palette='knight'):
    """pose: turn (eyes toward facing), nail (angle, radians, 0 = pointing
    forward), nail_reach, wind (cloak blown back), crouch, legs ('stand',
    'run0', 'run1', 'tuck'), lean (radians), squash, nail_on (bool)."""
    P = Pose(pose or {})
    _place(cv, x, y, s, facing, P.lean)
    shade_body = palette == 'shade'
    cloak_c, cloak_sh, cloak_rim = KNIGHT_CLOAK, KNIGHT_CLOAK_SH, KNIGHT_CLOAK_RIM
    lw = 0.045                       # outline width in units

    if P.squash:
        cv.scale(1 + P.squash * 0.5, 1 - P.squash)

    # legs
    legs = P.get('legs', 'stand')
    leg_pts = {
        'stand': [((-0.15, -0.34), (-0.16, 0.0)), ((0.15, -0.34), (0.16, 0.0))],
        'run0': [((-0.12, -0.34), (-0.34, -0.04)), ((0.14, -0.34), (0.30, -0.02))],
        'run1': [((-0.10, -0.34), (0.02, 0.0)), ((0.12, -0.34), (-0.10, -0.12))],
        'tuck': [((-0.14, -0.36), (-0.20, -0.18)), ((0.14, -0.36), (0.22, -0.16))],
    }[legs]
    for (a, b) in leg_pts:
        tapered(cv, [a, b], 0.16, 0.13, INK)
        tapered(cv, [(a[0], a[1]), (b[0], b[1] - 0.02)], 0.10, 0.08, VOID)
        circle(cv, b[0] + 0.03, b[1] - 0.03, 0.08, VOID)

    # cloak
    cl = knight_cloak_path(t, P.wind, P.spread)
    fill(cv, cl, cloak_c)
    cv.save()
    cv.clipPath(cl, doAntiAlias=True)
    fill(cv, path([('M', 0.05, -1.2), ('C', 0.2, -0.8, 0.25, -0.5, 0.15, -0.1),
                   ('L', 0.9, -0.1), ('L', 0.9, -1.2)]), cloak_sh)
    tapered(cv, bezier_pts((-0.22, -1.10), (-0.42, -0.85), (-0.52, -0.40)), 0.07, 0.02,
            cloak_rim, a=0.9)
    cv.restore()
    outline(cv, cl, INK, lw)

    # the nail, held out from the cloak
    if P.get('nail_on', True):
        ang = P.get('nail', 0.9)
        reach = P.get('nail_reach', 0.0)
        hx, hy = 0.30 + reach * 0.3, -0.68 - reach * 0.1
        tapered(cv, [(0.18, -0.80), (hx, hy)], 0.12, 0.10, VOID)
        ca, sa = math.cos(ang), math.sin(ang)
        L = 1.25
        blade = path([('M', hx + ca * 0.18 - sa * 0.05, hy + sa * 0.18 + ca * 0.05),
                      ('L', hx + ca * (L - 0.12) - sa * 0.045, hy + sa * (L - 0.12) + ca * 0.045),
                      ('L', hx + ca * L, hy + sa * L),
                      ('L', hx + ca * (L - 0.12) + sa * 0.045, hy + sa * (L - 0.12) - ca * 0.045),
                      ('L', hx + ca * 0.18 + sa * 0.05, hy + sa * 0.18 - ca * 0.05)])
        fill(cv, blade, NAIL)
        cv.save()
        cv.clipPath(blade, doAntiAlias=True)
        tapered(cv, [(hx + ca * 0.2 + sa * 0.03, hy + sa * 0.2 - ca * 0.03),
                     (hx + ca * L + sa * 0.03, hy + sa * L - ca * 0.03)], 0.05, 0.02, NAIL_SH)
        cv.restore()
        outline(cv, blade, INK, lw * 0.8)
        # guard and grip
        tapered(cv, [(hx + ca * 0.16 - sa * 0.11, hy + sa * 0.16 + ca * 0.11),
                     (hx + ca * 0.16 + sa * 0.11, hy + sa * 0.16 - ca * 0.11)], 0.07, 0.07, INK)
        tapered(cv, [(hx - ca * 0.10, hy - sa * 0.10), (hx + ca * 0.14, hy + sa * 0.14)],
                0.08, 0.08, (70, 52, 56))
        circle(cv, hx, hy, 0.08, VOID)

    # mask and horns
    m = knight_mask_path()
    if view == 'back':
        mask_c, mask_sh = (176, 170, 204), (128, 120, 160)
    elif shade_body:
        mask_c, mask_sh = VOID, (20, 16, 32)
    else:
        mask_c, mask_sh = WHITE, MASK_SHADE
    fill(cv, m, mask_c)
    cv.save()
    cv.clipPath(m, doAntiAlias=True)
    fill(cv, path([('M', 0.56, -2.9), ('C', 0.30, -2.3, 0.42, -1.5, 0.05, -1.0),
                   ('L', 0.7, -1.0)]), mask_sh)
    if view == 'back':
        tapered(cv, bezier_pts((-0.42, -1.95), (-0.48, -1.55), (-0.30, -1.15)), 0.07, 0.02,
                (226, 222, 244), a=0.9)
    cv.restore()
    outline(cv, m, INK, lw)

    if view != 'back':
        turn = P.get('turn', 0.35)
        ex = 0.215
        eyes_c = EYE_GLOW if shade_body else VOID
        for side in (-1, 1):
            near = side == 1
            rx = 0.135 * (1 + 0.12 * turn * side)
            cx = side * ex + 0.07 * turn
            e = knight_eye_path(cx, -1.50, rx, 0.205, side * 0.13)
            fill(cv, e, eyes_c)
            if not shade_body:
                fill(cv, knight_eye_path(cx - 0.04, -1.60, 0.035, 0.05, 0.3), (70, 72, 110), a=0.8)
            else:
                glow(cv, e, (180, 170, 255), 0.06, a=0.8)
    cv.restore()


# --- Hornet --------------------------------------------------------------------------
def hornet_head_path(turn):
    """Her mask: a rounded crown narrowing to a pointed chin, and two long
    horns sweeping up and back."""
    k = -0.10 * turn                  # horns sweep away from where she faces
    return sym_path([
        ('C', 0.10, -3.14, 0.16, -3.15, 0.20, -3.12),
        ('C', 0.24 + k, -3.42, 0.38 + k * 2, -3.70, 0.58 + k * 3, -3.92),
        ('C', 0.52 + k * 2, -3.66, 0.45 + k, -3.36, 0.39, -3.06),
        ('C', 0.45, -2.88, 0.41, -2.62, 0.27, -2.46),
        ('C', 0.17, -2.36, 0.07, -2.29, 0.0, -2.25),
    ], top=-3.14, bottom=-2.25)


def hornet_eye_path(side, turn):
    cx = side * 0.16 + 0.05 * turn
    p = path([('M', cx - side * 0.08, -2.56),
              ('C', cx - side * 0.14, -2.71, cx - side * 0.02, -2.90, cx + side * 0.16, -2.93),
              ('C', cx + side * 0.15, -2.78, cx + side * 0.05, -2.61, cx - side * 0.08, -2.56)])
    return p


def hornet_cloak_path(t, wind, spread=0.0):
    w = wind
    pts = [(-0.66, -0.98), (-0.30, -1.16), (0.04, -0.92), (0.36, -1.12), (0.64, -0.96)]
    hem = []
    for i, (hx, hy) in enumerate(pts):
        f = 0.06 * math.sin(t * 6 + i * 1.3) * (0.3 + w)
        hem.append((hx * (1 + spread) - w * 0.55 * (0.4 + 0.6 * i / 4), hy + f - w * 0.25))
    cmds = [('M', -0.16, -2.34), ('C', -0.42, -2.20, -0.58 - w * 0.2, -1.6, hem[0][0], hem[0][1])]
    for i in range(1, 5):
        mx = (hem[i - 1][0] + hem[i][0]) / 2
        my = min(hem[i - 1][1], hem[i][1]) - 0.06
        cmds.append(('Q', mx, my, hem[i][0], hem[i][1]))
    cmds.append(('C', 0.56 - w * 0.4, -1.6, 0.40, -2.2, 0.16, -2.34))
    return path(cmds)


def hornet(cv, x, y, s, facing=1, pose=None, t=0.0, voided=1.0):
    """pose: turn, wind, legs ('stand','run0','run1','tuck','kneel','lunge'),
    needle (angle), needle_on, lean, arm_reach."""
    P = Pose(pose or {})
    _place(cv, x, y, s, facing, P.lean)
    lw = 0.045
    red = mix(HORNET_RED, VOID_RED, voided)
    red_sh = mix(HORNET_RED_SH, VOID_RED_SH, voided)
    red_rim = mix(HORNET_RED_RIM, VOID_RED_RIM, voided)
    mask_c = mix(WHITE, VOID, voided)
    mask_sh = mix(MASK_SHADE, (24, 18, 36), voided)
    turn = P.get('turn', 0.4)

    # legs: long and thin
    legs = P.get('legs', 'stand')
    L = {
        'stand': [[(-0.10, -1.10), (-0.16, -0.55), (-0.18, 0.0)],
                  [(0.10, -1.10), (0.16, -0.55), (0.20, 0.0)]],
        'run0': [[(-0.08, -1.10), (-0.42, -0.70), (-0.62, -0.30)],
                 [(0.10, -1.10), (0.30, -0.55), (0.50, 0.0)]],
        'run1': [[(-0.08, -1.10), (0.10, -0.55), (-0.05, 0.0)],
                 [(0.10, -1.10), (-0.10, -0.60), (-0.40, -0.40)]],
        'tuck': [[(-0.10, -1.10), (-0.40, -0.80), (-0.20, -0.50)],
                 [(0.10, -1.10), (0.36, -0.82), (0.24, -0.52)]],
        'kneel': [[(-0.10, -0.62), (-0.40, -0.30), (-0.10, 0.0)],
                  [(0.10, -0.62), (0.42, -0.02), (0.80, 0.0)]],
        'lunge': [[(-0.08, -1.05), (-0.60, -0.70), (-1.00, -0.40)],
                  [(0.10, -1.05), (0.40, -0.55), (0.62, 0.0)]],
    }[legs]
    for leg in L:
        pts = bezier_pts(leg[0], leg[1], leg[2], n=10)
        tapered(cv, pts, 0.11, 0.06, INK)
        tapered(cv, pts, 0.065, 0.03, VOID)
        fx, fy = leg[2]
        fill(cv, path([('M', fx - 0.05, fy - 0.06), ('L', fx + 0.18, fy - 0.01),
                       ('L', fx - 0.03, fy + 0.01)]), VOID)

    # arm behind, then the cloak, then the arm in front with the needle
    drop = 0.52 if legs == 'kneel' else 0.0
    cv.save()
    cv.translate(0, drop)
    cl = hornet_cloak_path(t, P.wind, P.spread)
    fill(cv, cl, red)
    cv.save()
    cv.clipPath(cl, doAntiAlias=True)
    fill(cv, path([('M', 0.02, -2.4), ('C', 0.2, -1.8, 0.3, -1.4, 0.1, -0.8),
                   ('L', 1.2, -0.8), ('L', 1.2, -2.4)]), red_sh)
    tapered(cv, bezier_pts((-0.18, -2.28), (-0.48, -1.9), (-0.60, -1.1)), 0.07, 0.02, red_rim, a=0.9)
    cv.restore()
    outline(cv, cl, INK, lw)

    # neck
    tapered(cv, [(0, -2.40), (0, -2.26)], 0.10, 0.12, VOID)

    if P.get('needle_on', True):
        reach = P.get('arm_reach', 0.0)
        hx, hy = 0.34 + reach * 0.5, -1.72 - reach * 0.05
        tapered(cv, [(0.16, -2.12), (0.28 + reach * 0.2, -1.92), (hx, hy)], 0.09, 0.07, INK)
        tapered(cv, [(0.16, -2.12), (0.28 + reach * 0.2, -1.92), (hx, hy)], 0.05, 0.04, VOID)
        a = P.get('needle', 1.25)
        ca, sa = math.cos(a), math.sin(a)
        ln = 1.55
        tip = (hx + ca * ln, hy + sa * ln)
        tail = (hx - ca * 0.22, hy - sa * 0.22)
        tapered(cv, [tail, tip], 0.085, 0.01, INK)
        tapered(cv, [tail, tip], 0.05, 0.005, mix(NAIL, (150, 140, 170), voided * 0.5))
        circle(cv, tail[0], tail[1], 0.05, INK)
        circle(cv, tail[0], tail[1], 0.025, (200, 196, 210))

    # head
    h = hornet_head_path(turn)
    fill(cv, h, mask_c)
    cv.save()
    cv.clipPath(h, doAntiAlias=True)
    fill(cv, path([('M', 0.6, -4.2), ('C', 0.3, -3.3, 0.40, -2.7, 0.0, -2.22), ('L', 0.7, -2.2)]),
         mask_sh)
    if voided > 0.5:
        tapered(cv, bezier_pts((-0.22, -3.0), (-0.28, -2.8), (-0.18, -2.55)), 0.05, 0.01,
                VOID_SHEEN, a=voided)
    cv.restore()
    outline(cv, h, INK, lw)
    for side in (-1, 1):
        e = hornet_eye_path(side, turn)
        fill(cv, e, mix(VOID, EYE_GLOW, voided))
        if voided > 0.5:
            glow(cv, e, (200, 190, 255), 0.07, a=voided * 0.8)
    cv.restore()
    cv.restore()


# --- the shade and the siblings (from the artist's sketch) ---------------------------------
def shade(cv, x, y, s, t=0.0, facing=1, hit=0.0, wisps=1.0):
    """The horned shade: crescent horns curving in, sad eyes, a narrow body
    trailing into void.  Origin at the centre of its head."""
    _place(cv, x, y, s, facing)
    body = VOID if hit <= 0 else mix(VOID, WHITE, hit)
    # trailing body: a tapering column with drifting smoke
    tail = [(0.0, 0.3)]
    for k in range(1, 9):
        u = k / 8
        tail.append((0.10 * math.sin(t * 3 + u * 4) * u, 0.3 + 1.7 * u))
    tapered(cv, tail, 0.62, 0.05, body)
    if wisps > 0:
        for k in range(5):
            ph = t * 1.3 + k * 1.9
            u = (ph % 1.0)
            wx = 0.25 * math.sin(k * 2.1) + 0.2 * math.sin(ph * 2)
            wy = 1.0 + 1.2 * u
            circle(cv, wx, wy, 0.16 * (1 - u), body, a=wisps * (1 - u))
    # horns: a crescent, tips curving in
    for side in (-1, 1):
        pts = bezier_pts((side * 0.30, -0.35), (side * 0.80, -0.95), (side * 0.18, -1.55))
        tapered(cv, pts, 0.24, 0.02, body)
    # head
    hd = skia.Path()
    hd.addOval(skia.Rect.MakeLTRB(-0.48, -0.50, 0.48, 0.42))
    fill(cv, hd, body)
    glow(cv, hd, (90, 60, 150), 0.12, a=0.25)
    # eyes: two, close set, drooping at the outer corners
    if hit <= 0.5:
        for side in (-1, 1):
            e = path([('M', side * 0.05, -0.12), ('L', side * 0.30, -0.12),
                      ('Q', side * 0.32, 0.04, side * 0.24, 0.12),
                      ('Q', side * 0.20, -0.02, side * 0.05, -0.02)])
            fill(cv, e, EYE_GLOW)
            glow(cv, e, (200, 190, 255), 0.06, a=0.7)
    cv.restore()


def sibling(cv, x, y, s, t=0.0, facing=1, tilt=0.0, fade=1.0):
    """A small void vessel: two short horns, white eyes, a wisp of a body."""
    _place(cv, x, y, s, facing, tilt)
    tail = [(0, 0.2)] + [(0.12 * math.sin(t * 4 + k), 0.2 + 0.22 * k) for k in range(1, 6)]
    tapered(cv, tail, 0.5, 0.04, VOID, a=fade)
    for side in (-1, 1):
        tapered(cv, bezier_pts((side * 0.18, -0.25), (side * 0.32, -0.55), (side * 0.26, -0.80)),
                0.12, 0.02, VOID, a=fade)
    hd = skia.Path()
    hd.addOval(skia.Rect.MakeLTRB(-0.34, -0.36, 0.34, 0.30))
    fill(cv, hd, VOID, a=fade)
    for side in (-1, 1):
        e = skia.Path()
        e.addOval(skia.Rect.MakeLTRB(side * 0.16 - 0.07, -0.13, side * 0.16 + 0.07, 0.08))
        fill(cv, e, EYE_GLOW, a=fade)
    cv.restore()
