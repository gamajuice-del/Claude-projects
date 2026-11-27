"""The shots of VOID VIGIL, each a function of time, cut to shade_finale.

Times are in seconds of the music.  Sections: Abyss 0, Awakening 20,
Fight 36 (a bar is 1.2 s), Her Shadow 55.2, Turn 74.4, Hornet 79.2,
Last Stand 98.4, final chord 105.9, Silence 110.4, end 123.9.
"""
import math
import random

import skia

from . import characters as ch
from . import fx
from . import world as wd
from .draw import TAU, bezier_pts, circle, fill, mix, paint, path, rect, soft_dot, tapered

W, H = wd.W, wd.H
GX = 960                               # where the Knight stands
KS = 70                                # the Knight's size in wide shots (px per unit)


def ease(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def ease_out(u):
    u = max(0.0, min(1.0, u))
    return 1 - (1 - u) ** 3


def ease_in(u):
    u = max(0.0, min(1.0, u))
    return u ** 3


def seg(t, a, b):
    return max(0.0, min(1.0, (t - a) / (b - a)))


def lerp(a, b, u):
    return a + (b - a) * u


def cam_on(x, y, z_eff, parallax=1.0, roll=0.0):
    """A camera that puts world point (x, y) of a layer with this parallax at
    the centre of the screen, at effective zoom z_eff."""
    zoom = 1 + (z_eff - 1) / parallax
    cx = (x - (1 - parallax) * W / 2) / parallax
    cy = (y - (1 - parallax) * H / 2) / parallax
    return wd.Camera(cx, cy, zoom, roll)


# --- the stage ------------------------------------------------------------------------
def stage(cv, cam, t, rad=None, light=0.0, dark=0.0, shafts=1.0, flare=0.0, motes=1.0):
    wd.sky(cv, cam, light, dark)
    wd.sun(cv, cam, t, light, flare, dark)
    wd.city(cv, cam, light=light)
    wd.shafts(cv, cam, t, shafts * (1 - dark), light)
    if rad is not False:
        wd.radiance(cv, cam, t, **(rad or {}))
    wd.motes(cv, cam, t, light, motes * (1 - dark * 0.7))
    wd.mound(cv, cam, light)


def world(cv, cam):
    cv.save()
    cam.apply(cv, 1.0)


def end(cv):
    cv.restore()


def ghost(cv, color, alpha, draw):
    """Draw something as a flat translucent afterimage."""
    p = paint(color, alpha)
    p.setColorFilter(skia.ColorFilters.Blend(skia.Color(*color, 255), skia.BlendMode.kSrcIn))
    p.setAlphaf(alpha)
    cv.saveLayer(None, p)
    draw()
    cv.restore()


def blurred(cv, sigma, draw):
    """Draw something out of focus."""
    p = skia.Paint()
    p.setImageFilter(skia.ImageFilters.Blur(sigma, sigma))
    cv.saveLayer(None, p)
    draw()
    cv.restore()


def dim(cv, a, color=(8, 6, 16)):
    rect(cv, 0, 0, W, H, color, a)


def void_heart(cv, x, y, s, glow=1.0, t=0.0):
    h = path([('M', 0, 0.9), ('C', -1.1, 0.1, -1.0, -0.9, -0.45, -0.95),
              ('C', -0.15, -0.98, 0, -0.7, 0, -0.55),
              ('C', 0, -0.7, 0.15, -0.98, 0.45, -0.95),
              ('C', 1.0, -0.9, 1.1, 0.1, 0, 0.9)])
    cv.save()
    cv.translate(x, y)
    cv.scale(s, s)
    soft_dot(cv, 0, 0, 3.2, (200, 190, 255), a=0.5 * glow)
    fill(cv, h, (8, 6, 14))
    cv.drawPath(h, paint((230, 226, 255), 0.9, stroke=0.08))
    pts = [(0.5 * math.cos(a + t) * (1 - a / 9), -0.1 + 0.5 * math.sin(a + t) * (1 - a / 9))
           for a in [k * 0.25 for k in range(28)]]
    tapered(cv, pts, 0.10, 0.01, (236, 232, 255), a=0.9)
    cv.restore()


def thread(cv, pts, color=(220, 210, 230), w=3.0, a=0.9):
    tapered(cv, pts, w, w * 0.6, color, a=a)


# --- the shots ---------------------------------------------------------------------------
def s01_establish(cv, t, u):
    """The Abyss.  Down from the eclipse to the Knight on the mound."""
    cam = wd.lerp_cam(wd.Camera(960, 330, 1.22), wd.Camera(960, 590, 1.0), ease(seg(t, 2.0, 9.5)))
    eyes = ease(seg(t, 9.6, 10.4))
    stage(cv, cam, t, {'eyes': eyes, 'flap': 0.6})
    world(cv, cam)
    gy = wd.ground_y(GX)
    for k, (sx, sy, sc, f) in enumerate(((640, 560, 40, 1), (1290, 520, 32, -1))):
        ch.sibling(cv, sx, sy + 8 * math.sin(t * 1.3 + k * 2), sc, t, f, tilt=-20 if k == 0 else 4)
    # the shade rising out of the Knight
    ch.shade(cv, GX, gy - 2.62 * KS - 88, 52, t)
    ch.knight(cv, GX, gy, KS, 1, {'wind': 0.1}, t=t, view='back')
    end(cv)
    wd.foreground(cv, cam, t)


def s02_her_eyes(cv, t, u):
    """Close on the Radiance.  Her eyes open."""
    ex, ey = wd.rad_to_world(*wd.RAD_EYES)
    cam = cam_on(ex, ey + 40, lerp(2.6, 3.2, ease(u)), 0.6)
    eyes = ease(seg(t, 10.0, 10.8))
    stage(cv, cam, t, {'eyes': eyes, 'flap': 0.4, 'charge': 0.3 * eyes}, motes=0.6)
    fx.bloom_ring(cv, W / 2, H / 2 - 40, 500, 0.25 * eyes)


def s03_over_shoulder(cv, t, u):
    """Behind the Knight, looking up at what rises out of him."""
    cam = wd.lerp_cam(wd.Camera(960, 470, 1.25), wd.Camera(960, 430, 1.4), ease(u))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 0.7})
    world(cv, cam)
    gy = wd.ground_y(GX)
    sx, sy = GX, gy - 2.62 * KS - 88
    ch.shade(cv, sx, sy, 52, t)
    # threads of void from her blade into the shade
    tip = wd.rad_to_world(512, 1080)
    for k in range(3):
        pts = bezier_pts((tip[0] + (k - 1) * 18, tip[1]), (sx + (k - 1) * 40, (tip[1] + sy) / 2),
                         (sx, sy - 70), n=30)
        tapered(cv, pts, 4, 1.5, (12, 8, 24), a=0.8)
        b = (t * 0.7 + k / 3) % 1.0
        x, y = pts[int(b * 30)]
        circle(cv, x, y, 5, (6, 5, 10))
    end(cv)
    # the Knight's back, huge in the foreground
    ch.knight(cv, 520, 1290, 330, 1, {'wind': 0.25, 'nail_on': False}, t=t, view='back')
    wd.foreground(cv, cam, t)


def s04_tears_free(cv, t, u):
    """Low angle.  The shade tears out of the Knight."""
    cam = wd.lerp_cam(wd.Camera(960, 700, 1.9), wd.Camera(960, 520, 1.6), ease(u))
    rise = ease_out(seg(t, 20.4, 23.0))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.0})
    world(cv, cam)
    gy = wd.ground_y(GX)
    sx, sy = GX + 30 * rise, gy - 2.62 * KS - 88 - 120 * rise
    fx.smoke(cv, GX, gy - 2.4 * KS, t, scale=1.0, amount=0.8 * (1 - seg(t, 23, 25)), seed=2)
    ch.shade(cv, sx, sy, 52 + 14 * rise, t, wisps=1.0)
    ch.knight(cv, GX, gy, KS, 1, {'wind': 0.5 * rise, 'squash': 0.08 * math.sin(seg(t, 20.4, 21.2) * math.pi)},
              t=t, view='back')
    if t > 20.4:
        fx.Burst(20.4, GX, gy - 2.6 * KS, 60, 420, [(6, 5, 10), (40, 28, 80)], 7, size=(3, 9),
                 rise=0.2, life=1.6).draw(cv, t)
    end(cv)
    wd.foreground(cv, cam, t)


def s05_knight_turns(cv, t, u):
    """Close: the Knight turns to face it.  Wind in the cloak."""
    cam = cam_on(860, 560, 2.2, 1.0)

    def bg():
        stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.0})
    blurred(cv, 10, bg)
    dim(cv, 0.25)
    turn = ease(seg(t, 25.3, 26.2))
    z = lerp(400, 440, ease(u))
    if turn < 0.5:
        ch.knight(cv, 980, 1540, z, -1, {'wind': 0.6, 'nail_on': False}, t=t, view='back')
    else:
        ch.knight(cv, 980, 1540, z, -1, {'wind': 0.6, 'turn': 0.8, 'nail_on': False}, t=t)
    fx.bloom_ring(cv, 600, 200, 600, 0.12)


def s06_nail_grip(cv, t, u):
    """The hand closes on the nail; light runs down the blade."""
    cam = cam_on(960, 700, 2.0, 1.0)

    def bg():
        stage(cv, cam, t, {'eyes': 1.0}, motes=0.0)
    blurred(cv, 16, bg)
    dim(cv, 0.45)
    cv.save()
    cv.translate(lerp(560, 600, u), lerp(760, 730, u))
    cv.rotate(-28)
    s = 520
    # blade
    blade = path([('M', 0.15 * s, -0.045 * s), ('L', 2.3 * s, -0.04 * s), ('L', 2.45 * s, 0),
                  ('L', 2.3 * s, 0.04 * s), ('L', 0.15 * s, 0.045 * s)])
    fill(cv, blade, ch.NAIL)
    fill(cv, path([('M', 0.15 * s, 0.0), ('L', 2.4 * s, 0.0), ('L', 2.3 * s, 0.04 * s),
                   ('L', 0.15 * s, 0.045 * s)]), ch.NAIL_SH)
    cv.drawPath(blade, paint(ch.INK, stroke=10))
    glint = ease(seg(t, 30.2, 31.6))
    if 0 < glint < 1:
        gx = lerp(0.2, 2.4, glint) * s
        soft_dot(cv, gx, -0.01 * s, 160, (255, 250, 240), a=0.9)
        tapered(cv, [(gx - 200, -0.01 * s), (gx + 200, -0.01 * s)], 1, 10, (255, 255, 255), a=0.8)
    # guard, grip, and the small black hand closing round it
    tapered(cv, [(0.15 * s, -0.22 * s), (0.15 * s, 0.22 * s)], 0.08 * s, 0.08 * s, ch.INK)
    tapered(cv, [(-0.35 * s, 0), (0.12 * s, 0)], 0.10 * s, 0.10 * s, (70, 52, 56))
    grip = ease(seg(t, 29.2, 29.8))
    circle(cv, -0.05 * s, 0.02 * s, (0.09 + 0.04 * grip) * s, (6, 5, 10))
    tapered(cv, [(-0.05 * s, 0.02 * s), (-0.4 * s, 0.6 * s)], 0.16 * s, 0.14 * s, (6, 5, 10))
    cv.restore()


def s07_gathering(cv, t, u):
    """Wide: the siblings spread, she opens her wings, the Abyss trembles."""
    cam = wd.lerp_cam(wd.Camera(960, 560, 1.15), wd.Camera(960, 520, 1.0), ease(u))
    flap = 1 + 3 * ease(u)
    stage(cv, cam, t, {'eyes': 1.0, 'flap': flap, 'charge': 0.5 * u}, flare=0.3 * u)
    world(cv, cam)
    gy = wd.ground_y(GX)
    for k, (x0, y0, x1, y1) in enumerate(((640, 560, 470, 600), (1290, 520, 1450, 560),
                                         (820, 420, 760, 380), (1100, 400, 1180, 360))):
        e = ease(u)
        ch.sibling(cv, lerp(x0, x1, e), lerp(y0, y1, e) + 6 * math.sin(t * 2 + k), 36, t,
                   1 if x1 < 960 else -1, fade=1 if k < 2 else ease(seg(t, 32.6 + k * 0.4, 33.4 + k * 0.4)))
    ch.shade(cv, 620, 460 + 10 * math.sin(t), 60, t)
    ch.knight(cv, GX, gy, KS, -1, {'wind': 0.4, 'turn': 0.7, 'nail': 0.6}, t=t)
    end(cv)
    wd.foreground(cv, cam, t)


# --- the fight ---------------------------------------------------------------------
def s08_first_blood(cv, t, u):
    """The Knight dashes at a diving sibling: speed, a cut, an impact frame."""
    cam = cam_on(1000, 760, 1.9)
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6})
    dim(cv, 0.3)
    fx.speed_streaks(cv, t, -1, amount=0.5 * (1 - seg(t, 37.2, 37.8)), color=(200, 190, 255), seed=1)
    world(cv, cam)
    gy = wd.ground_y(GX)
    dash = ease_in(seg(t, 36.3, 37.2))
    kx = lerp(860, 1040, dash)
    for k in range(1, 4):
        px = lerp(860, 1040, ease_in(seg(t - 0.04 * k, 36.3, 37.2)))
        if 36.3 < t < 37.4:
            ghost(cv, (90, 70, 170), 0.35 / k, lambda px=px: ch.knight(
                cv, px, gy, KS, 1, {'turn': 0.8, 'legs': 'run0', 'wind': 0.8, 'nail': 0.0,
                                    'nail_reach': 1}, t=t))
    hit = 37.2
    if t < hit:
        sx, sy = lerp(1300, 1100, ease_in(seg(t, 36, hit))), lerp(520, gy - 160, ease_in(seg(t, 36, hit)))
        ch.sibling(cv, sx, sy, 40, t, -1, tilt=-30)
    ch.knight(cv, kx, gy, KS, 1, {'turn': 0.8, 'legs': 'run0' if t < hit else 'stand',
                                  'wind': 0.8, 'nail': -0.1 if t >= hit else 0.0,
                                  'nail_reach': 1}, t=t)
    fx.slash(cv, kx + 60, gy - 120, 120, -1.9, 0.6, t - hit + 0.04, width=1.2)
    fx.Burst(hit, 1110, gy - 160, 70, 520, [(6, 5, 10), (50, 34, 96), (230, 226, 255)], 11,
             size=(3, 10), life=1.2).draw(cv, t)
    end(cv)


def s09_up_slash(cv, t, u):
    """Low angle: a sibling falls on him from above; he leaps to meet it."""
    cam = cam_on(960, 600, 1.7)
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6})
    world(cv, cam)
    gy = wd.ground_y(GX)
    hit = 39.6
    j = seg(t, 38.9, hit)
    kh = 230 * math.sin(min(1, j) * math.pi / 2) if t < hit else 230 * (1 - ease_in(seg(t, hit, 40.8)))
    if t < hit:
        sx, sy = lerp(720, 920, ease_in(seg(t, 38.4, hit))), lerp(260, gy - kh - 250, ease_in(seg(t, 38.4, hit)))
        ch.sibling(cv, sx, sy, 44, t, 1, tilt=40)
    ch.knight(cv, 960, gy - kh, KS * 1.1, 1, {'turn': 0.5, 'legs': 'tuck' if t > 38.9 else 'stand',
                                               'wind': 0.5, 'nail': -1.4 if t > hit - 0.1 else 0.5},
              t=t)
    fx.slash(cv, 960, gy - kh - 210, 140, -2.8, -0.3, t - hit + 0.03, width=1.3)
    fx.Burst(hit, 950, gy - kh - 260, 70, 560, [(6, 5, 10), (50, 34, 96), (230, 226, 255)], 13,
             size=(3, 10), life=1.2).draw(cv, t)
    end(cv)


ORBS = [(41.4 + 0.6 * k, x) for k, x in enumerate((900, 700, 1180, 800, 1260, 960))]


def s10_orbs(cv, t, u):
    """Wide: orbs wheel round her and fall; he dodges through the blasts."""
    cam = wd.lerp_cam(wd.Camera(960, 560, 1.05), wd.Camera(990, 600, 1.12), ease(u))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6, 'charge': 0.4})
    world(cv, cam)
    gy = wd.ground_y
    sunx, suny, r = wd.SUN
    pos = [960, 700, 1180, 800, 1260, 960, 1080]

    def knight_x(tt):
        x = pos[0]
        for k, (L, _) in enumerate(ORBS):
            if tt >= L + 0.15:
                x = lerp(pos[k], pos[k + 1], ease(seg(tt, L + 0.15, L + 0.4)))
        return x
    kx = knight_x(t)
    for k, (L, tx) in enumerate(ORBS):
        a = TAU * k / 6 + t * 0.6
        ox, oy = cam_rad_ring(a)
        if t < L:
            orb(cv, ox, oy, 1)
        elif t < L + 0.5:
            v = ease_in(seg(t, L, L + 0.5))
            orb(cv, lerp(ox, tx, v), lerp(oy, gy(tx) - 20, v), 1)
        fx.Burst(L + 0.5, tx, gy(tx) - 10, 50, 380, [(6, 5, 10), (60, 40, 110), (140, 110, 220)],
                 20 + k, size=(4, 12), spread=(math.pi, TAU), life=0.9).draw(cv, t)
        fx.sparks(cv, tx, gy(tx) - 10, t - L - 0.5, 30 + k, reach=90, color=(180, 160, 255))
    moving = any(L + 0.15 <= t < L + 0.4 for L, _ in ORBS)
    if moving:
        for k in range(1, 4):
            gx = knight_x(t - 0.035 * k)
            ghost(cv, (90, 70, 170), 0.3 / k, lambda gx=gx: ch.knight(
                cv, gx, gy(gx), KS, 1, {'legs': 'run0', 'wind': 0.6}, t=t))
    face = 1 if (kx < 1000) else -1
    ch.knight(cv, kx, gy(kx), KS, face, {'turn': 0.6, 'legs': 'run0' if moving else 'stand', 'wind': 0.6 if moving else 0.2,
                                         'nail': 0.7}, t=t)
    end(cv)
    wd.foreground(cv, cam, t)


def cam_rad_ring(a):
    """A point on a ring round her, in world coordinates."""
    x, y, r = wd.SUN
    # her layer has parallax 0.6; the orbs live in the world, so place them
    # where the ring appears at the wide camera
    return 960 + math.cos(a) * 330, 300 + math.sin(a) * 200


def orb(cv, x, y, a):
    fx.bloom_ring(cv, x, y, 60, 0.35 * a, (150, 110, 255))
    circle(cv, x, y, 17, (60, 40, 120), a)
    circle(cv, x, y, 13, (6, 5, 10), a)
    circle(cv, x - 4, y - 5, 3, (120, 100, 200), a)


SWORD_WAVES = [(45.6, 1060), (46.8, 860), (48.0, 1140), (49.2, 960)]


def s11_sword_rain(cv, t, u):
    """Looking up from the ground: void swords rain; he weaves between."""
    cam = wd.lerp_cam(wd.Camera(960, 640, 1.45), wd.Camera(960, 620, 1.6), ease(u))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6})
    world(cv, cam)
    gy = wd.ground_y
    kx = 960
    gaps = [g for _, g in SWORD_WAVES]
    for k, (wt, gap) in enumerate(SWORD_WAVES):
        if t >= wt - 0.5:
            prev = gaps[k - 1] if k else 960
            kx = lerp(prev, gap, ease(seg(t, wt - 0.5, wt - 0.1)))
        r = random.Random(int(wt * 10))
        for x in range(560, 1400, 56):
            if abs(x - gap) < 70:
                continue
            d = r.uniform(0, 0.25)
            fall = seg(t, wt + d - 0.3, wt + d + 0.55)
            gone = seg(t, wt + d + 1.2, wt + d + 1.6)
            if 0 < fall and gone < 1:
                tip = lerp(80, gy(x) + 14, fall * fall)
                sword(cv, x, tip, 1 - gone)
                if 0.98 < fall and t < wt + d + 0.7:
                    fx.sparks(cv, x, gy(x), t - wt - d - 0.55, int(x), n=6, reach=40,
                              color=(170, 150, 255))
    running = any(wt - 0.5 <= t < wt - 0.1 for wt, _ in SWORD_WAVES)
    ch.knight(cv, kx, gy(kx), KS, 1 if kx < 1000 else -1,
              {'turn': 0.5, 'legs': ('run0' if int(t * 10) % 2 else 'run1') if running else 'stand',
               'wind': 0.7 if running else 0.2, 'nail': 0.7}, t=t)
    end(cv)
    wd.foreground(cv, cam, t)


def sword(cv, x, tip_y, a=1.0):
    L = 270
    blade = path([('M', x, tip_y), ('L', x - 9, tip_y - 30), ('L', x - 7, tip_y - L),
                  ('L', x + 7, tip_y - L), ('L', x + 9, tip_y - 30)])
    cv.drawPath(blade, paint((90, 60, 170), 0.5 * a, blur=10, blend=skia.BlendMode.kPlus))
    fill(cv, blade, (8, 6, 14), a)
    tapered(cv, [(x - 3, tip_y - 30), (x - 3, tip_y - L + 10)], 3, 2, (110, 90, 190), a=a)
    tapered(cv, [(x - 26, tip_y - L), (x + 26, tip_y - L)], 9, 9, (8, 6, 14), a=a)
    circle(cv, x, tip_y - L - 16, 10, (8, 6, 14), a)


PARRIES = [51.0, 51.6, 52.2]


def s12_parry(cv, t, u):
    """He strikes her orbs back up at her."""
    cam = cam_on(960, 640, 1.7)
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6, 'hit': max(0, 1 - (t - 53.0) * 4) if t > 53.0 else 0})
    world(cv, cam)
    gy = wd.ground_y(GX)
    for k, p in enumerate(PARRIES):
        down = seg(t, p - 0.6, p)
        up = seg(t, p, p + 1.4)
        if 0 < down < 1:
            orb(cv, 960 + 20 * k, lerp(300, gy - 220, ease_in(down)), 1)
        elif 0 < up < 1:
            orb(cv, 960 + 20 * k - 200 * up, lerp(gy - 220, 120, ease_out(up)), 1)
        fx.sparks(cv, 960, gy - 220, t - p, 40 + k, reach=110)
    slashing = min((abs(t - p) for p in PARRIES))
    ch.knight(cv, 960, gy, KS * 1.1, 1, {'turn': 0.4, 'nail': -1.5 if slashing < 0.2 else 0.6,
                                         'wind': 0.3}, t=t)
    for p in PARRIES:
        fx.slash(cv, 960, gy - 210, 130, -2.6, -0.5, t - p + 0.03)
    end(cv)


def s13_her_wound(cv, t, u):
    """Close on her: the orbs strike, light cracks across her, she screams."""
    ex, ey = wd.rad_to_world(*wd.RAD_EYES)
    cam = cam_on(ex, ey + 120, lerp(2.2, 2.6, u), 0.6)
    hit = max(0.0, 1 - (t - 53.4) * 3) if t > 53.4 else 0.0
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.5, 'charge': 0.8 * seg(t, 54, 55), 'hit': hit},
          flare=0.5 * seg(t, 54, 55))
    fx.focus_lines(cv, W / 2, H / 2, t, amount=0.5 * seg(t, 54.0, 54.4), color=(200, 190, 255),
                   inner=380)


# --- the great shade ---------------------------------------------------------------------
CLASHES_D = [55.2, 56.4, 57.6, 58.8]


def s14_shade_duel(cv, t, u):
    """Side on: the shade swoops through him again and again; sparks."""
    cam = cam_on(960, 760, 2.1)
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6})
    dim(cv, 0.2)
    world(cv, cam)
    gy = wd.ground_y(GX)
    k = max(i for i, c in enumerate(CLASHES_D) if t >= c - 0.6) if t >= CLASHES_D[0] - 0.6 else 0
    c = CLASHES_D[k]
    side = -1 if k % 2 == 0 else 1
    v = seg(t, c - 0.5, c + 0.5)
    sx = lerp(960 + side * 360, 960 - side * 360, ease(v))
    sy = gy - 160 - 60 * math.sin(v * math.pi)
    ch.shade(cv, sx, sy, 60, t, facing=-side)
    face = side
    knock = 14 * math.exp(-max(0, t - c) * 8) if t > c else 0
    ch.knight(cv, 960 - face * knock, gy, KS * 1.15, face,
              {'turn': 0.6, 'nail': -0.15 if abs(t - c) < 0.15 else 0.5, 'nail_reach': 1 if abs(t - c) < 0.2 else 0,
               'wind': 0.5}, t=t)
    for cc in CLASHES_D:
        fx.slash(cv, 960 + (1 if cc in CLASHES_D[0::2] else -1) * -60, gy - 150, 110, -1.6, 1.2, t - cc + 0.03)
        fx.sparks(cv, 960 + (60 if cc in CLASHES_D[1::2] else -60), gy - 150, t - cc, int(cc * 10), reach=140)
    end(cv)


SPIKES = [60.0, 61.2, 62.4, 63.6]


def s15_spikes(cv, t, u):
    """Wide and low: spikes of void burst from the ground; he leaps them."""
    cam = wd.lerp_cam(wd.Camera(960, 700, 1.3), wd.Camera(960, 690, 1.4), ease(u))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6})
    world(cv, cam)
    gy = wd.ground_y
    h = 0.0
    for k, wt in enumerate(SPIKES):
        ltr = k % 2 == 0
        for x in range(420, 1520, 34):
            f = wt + ((x - 420) if ltr else (1520 - x)) / 1100 * 0.8
            age = t - f
            if 0 <= age < 0.7:
                hh = 130 * min(1, age / 0.08) * (1 - max(0, (age - 0.4) / 0.3))
                spike(cv, x, gy(x) + 6, hh)
        front = wt + (540 if ltr else 560) / 1100 * 0.8
        j = seg(t, front - 0.3, front + 0.3)
        if 0 < j < 1:
            h = max(h, 190 * math.sin(j * math.pi))
    ch.knight(cv, 960, gy(960) - h, KS * 1.1, 1, {'turn': 0.5, 'legs': 'tuck' if h > 10 else 'stand',
                                                    'wind': 0.4 + h / 400, 'nail': 0.4}, t=t)
    ch.shade(cv, 1240, 420 + 12 * math.sin(t * 1.5), 58, t, facing=-1)
    end(cv)
    wd.foreground(cv, cam, t)


def spike(cv, x, base, h):
    if h <= 1:
        return
    p = path([('M', x - 22, base), ('L', x - 3, base - h), ('L', x + 3, base - h), ('L', x + 22, base)])
    cv.drawPath(p, paint((110, 70, 210), 0.5, blur=12, blend=skia.BlendMode.kPlus))
    fill(cv, p, (8, 6, 14))
    tapered(cv, [(x - 10, base - 4), (x - 2, base - h + 6)], 5, 1, (120, 96, 210), a=0.9)


def s16_combo(cv, t, u):
    """The shade's eyes narrow; then three cuts against rushing lines."""
    if t < 66.0:
        cam = cam_on(1240, 430, 3.4)
        blurred(cv, 8, lambda: stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6}))
        dim(cv, 0.3)
        sq = ease(seg(t, 65.2, 65.8))
        cv.save()
        cv.translate(W / 2, H / 2)
        cv.scale(1, 1 - 0.35 * sq)
        ch.shade(cv, 0, 0, 380, t, facing=-1)
        cv.restore()
        return
    rect(cv, 0, 0, W, H, (18, 12, 34))
    fx.speed_streaks(cv, t, 1, amount=0.9, color=(170, 150, 255), seed=3)
    hits = [66.0, 66.4, 66.8]
    hit = max((max(0.0, 1 - (t - h) * 10) for h in hits if t >= h), default=0.0)
    shove = sum(40 * ease_out(seg(t, h, h + 0.2)) for h in hits)
    ch.shade(cv, 1220 + shove, 520, 150, t, facing=-1, hit=hit)
    ch.knight(cv, 700 + shove * 0.6, 900, 170, 1, {'turn': 0.8, 'nail': -0.2 + 0.8 * math.sin(t * 20),
                                                    'nail_reach': 1, 'wind': 1.0, 'legs': 'run0'}, t=t)
    for k, h in enumerate(hits):
        a0, a1 = ((-2.2, 0.8), (1.9, -0.6), (-1.2, 1.6))[k]
        fx.slash(cv, 1180 + shove, 560, 260, a0, a1, t - h + 0.03, width=1.4)
        fx.sparks(cv, 1150 + shove, 540, t - h, 70 + k, reach=200)
    if t > 67.4:
        cut = seg(t, 67.4, 69.6)
        cam = wd.lerp_cam(wd.Camera(1000, 700, 1.6), wd.Camera(1000, 420, 1.6), ease(cut))
        stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6})
        world(cv, cam)
        ch.shade(cv, 1100, 440 + 30 * cut, 60, t, facing=-1)
        kh = 520 * ease_out(seg(t, 68.0, 69.4))
        ch.knight(cv, 960, wd.ground_y(960) - kh, KS * 1.1, 1, {'turn': 0.4, 'legs': 'tuck',
                                                                 'wind': 0.8, 'nail': -1.4}, t=t)
        end(cv)


def s17_shatter(cv, t, u):
    """Above the shade; the downward cut; it shatters, slowly."""
    hit = 72.0
    cam = cam_on(1060, 470, lerp(2.4, 2.0, ease(u)))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.6})
    world(cv, cam)
    if t < hit:
        ch.shade(cv, 1080, 500, 62, t, facing=-1)
        drop = ease_in(seg(t, 71.4, hit))
        ch.knight(cv, 1070, lerp(300, 440, drop), KS * 1.1, 1,
                  {'turn': 0.3, 'legs': 'tuck', 'wind': 0.9, 'nail': 1.57 if t > 71.5 else -1.4}, t=t)
    else:
        slow = (t - hit) * 0.35
        fx.Burst(0, 1080, 500, 220, 900, [(6, 5, 10), (6, 5, 10), (40, 28, 80), (120, 96, 210),
                                         (236, 232, 255)], 71, size=(2, 7), rise=-0.05,
                 life=2.4).draw(cv, slow)
        ch.knight(cv, 1070, 470 + 300 * ease_in(seg(t, hit + 0.4, hit + 1.2)), KS * 1.1, 1,
                  {'turn': 0.3, 'legs': 'tuck', 'wind': 0.5, 'nail': 1.57}, t=t)
        fx.slash(cv, 1080, 520, 160, -3.0, 0.2, t - hit + 0.03, width=1.6, life=0.4)
    end(cv)


def s18_scream(cv, t, u):
    """Her scream: the eclipse flares; the Abyss shakes."""
    ex, ey = wd.rad_to_world(*wd.RAD_EYES)
    cam = cam_on(ex, ey + 150, lerp(1.8, 2.3, ease(u)), 0.6, roll=2 * math.sin(t * 30) * (1 - u))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 3.5, 'charge': 1.0}, flare=0.8)
    fx.focus_lines(cv, W / 2, H / 2 - 100, t, amount=0.6, color=(220, 210, 255), inner=420, seed=5)


# --- her last card ------------------------------------------------------------------------
def s19_cocoon(cv, t, u):
    """Darkness.  Void pours into a cocoon; it beats like a heart."""
    cam = wd.lerp_cam(wd.Camera(820, 700, 1.5), wd.Camera(800, 720, 1.9), ease(u))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.5, 'charge': 0.6}, dark=0.75, shafts=0.3)
    world(cv, cam)
    cx, gy = 760, wd.ground_y(760)
    grow = ease(seg(t, 74.6, 78.6))
    beat = 0.5 + 0.5 * math.cos((t - 74.4) / 0.4 * TAU)
    rx, ry = 60 * grow + 4 + 4 * beat * grow, 110 * grow + 6 + 6 * beat * grow
    cy = gy - ry
    for k in range(12):
        sx = 300 + k * 110
        pts = bezier_pts((sx, -200), ((sx + cx) / 2 + 120 * math.sin(k), 200), (cx, cy - ry * 0.6), n=40)
        tapered(cv, pts, 14, 3, (8, 6, 14), a=0.7 * (1 - seg(t, 78.8, 79.2)))
        b = (t * 0.9 + k / 12) % 1.0
        x, y = pts[int(b * 40)]
        circle(cv, x, y, 8, (60, 40, 120), 0.8)
    fx.bloom_ring(cv, cx, cy, ry * 2.4, 0.25 * grow * (0.5 + beat), (130, 90, 255))
    oval = skia.Rect.MakeLTRB(cx - rx, cy - ry, cx + rx, cy + ry)
    cv.drawOval(oval, paint((6, 5, 10)))
    cv.drawOval(oval, paint((110, 80, 210), 0.6 * grow, stroke=5))
    crack = seg(t, 78.6, 79.2)
    if crack > 0:
        r = random.Random(2)
        for k in range(7):
            x, y, a = cx, cy, r.uniform(0, TAU)
            pts = [(x, y)]
            for _ in range(int(10 * crack)):
                a += r.uniform(-0.6, 0.6)
                x += math.cos(a) * 12
                y += math.sin(a) * 12
                pts.append((x, y))
            if len(pts) > 2:
                tapered(cv, pts, 6, 1, (240, 236, 255), a=0.9)
    end(cv)
    # the Knight, a silhouette at the right edge
    ch.knight(cv, 1600, 1180, 260, -1, {'turn': 0.5, 'wind': 0.3, 'nail': 0.6}, t=t)
    dim(cv, 0.15)


def s20_hornet_wakes(cv, t, u):
    """Her eyes open in the void, then the camera pulls back to all of her."""
    reveal = ease(seg(t, 80.0, 81.6))
    cam = cam_on(760, wd.ground_y(760) - 3.1 * KS * 1.1, lerp(6.5, 1.8, reveal))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.5, 'charge': 0.6}, dark=0.5 * (1 - reveal), shafts=0.5)
    world(cv, cam)
    gy = wd.ground_y(760)
    fx.smoke(cv, 760, gy - 60, t, scale=1.4, amount=0.7 - 0.5 * reveal, seed=8)
    ch.hornet(cv, 760, gy, KS * 1.1, 1, {'turn': 0.3, 'wind': 0.8, 'needle': 1.0}, t=t, voided=1.0)
    fx.Burst(79.2, 760, gy - 150, 160, 800, [(6, 5, 10), (40, 28, 80), (120, 90, 210)], 31,
             size=(2, 6), life=1.4).draw(cv, t)
    end(cv)


LUNGES = [82.8, 84.0, 85.2]


def s21_lunges(cv, t, u):
    """Side on: her lunges, his parries, the air torn behind her."""
    cam = cam_on(960, 760, 1.9)
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.0})
    dim(cv, 0.25)
    k = 0
    for i, c in enumerate(LUNGES):
        if t >= c - 0.6:
            k = i
    c = LUNGES[k]
    side = -1 if k % 2 == 0 else 1
    lunging = c - 0.35 <= t < c + 0.05
    if lunging:
        fx.speed_streaks(cv, t, -side, amount=0.8, color=(230, 120, 130), seed=k)
    world(cv, cam)
    gy = wd.ground_y(GX)
    v = ease_in(seg(t, c - 0.35, c))
    hx = lerp(960 + side * 600, 960 + side * 150, v) + side * 60 * ease_out(seg(t, c, c + 0.6))
    if lunging:
        for g in range(1, 4):
            gx = lerp(960 + side * 600, 960 + side * 150, ease_in(seg(t - 0.03 * g, c - 0.35, c)))
            ghost(cv, (150, 30, 60), 0.3 / g, lambda gx=gx: ch.hornet(
                cv, gx, gy, KS * 1.15, -side, {'legs': 'lunge', 'needle': 0.0, 'arm_reach': 1,
                                               'wind': 1.0}, t=t))
    ch.hornet(cv, hx, gy, KS * 1.15, -side, {'turn': 0.6, 'legs': 'lunge' if lunging else 'stand',
                                             'needle': 0.0 if lunging else 1.0,
                                             'arm_reach': 1 if lunging else 0, 'wind': 1.0 if lunging else 0.4},
              t=t, voided=1.0)
    knock = 20 * math.exp(-max(0, t - c) * 7) if t > c else 0
    ch.knight(cv, 960 - side * knock, gy, KS * 1.15, side,
              {'turn': 0.6, 'nail': -0.1 if abs(t - c) < 0.2 else 0.5, 'nail_reach': 1 if abs(t - c) < 0.25 else 0,
               'wind': 0.5}, t=t)
    for cc in LUNGES:
        sd = -1 if LUNGES.index(cc) % 2 == 0 else 1
        fx.sparks(cv, 960 + sd * 90, gy - 120, t - cc, int(cc * 10), reach=170)
        fx.slash(cv, 960 + sd * 40, gy - 130, 120, (-1.2 if sd < 0 else 1.9), (1.2 if sd < 0 else 4.3),
                 t - cc + 0.03)
    end(cv)


def s22_needle(cv, t, u):
    """From behind her: the needle flies on its thread; he knocks it aside."""
    cam = cam_on(1180, 760, 1.6)
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.0})
    world(cv, cam)
    gy = wd.ground_y
    ch.knight(cv, 1320, gy(1320), KS, -1, {'turn': 0.6, 'nail': -0.2 if abs(t - 87.6) < 0.2 else 0.5,
                                            'nail_reach': 1 if abs(t - 87.6) < 0.25 else 0}, t=t)
    out = ease_in(seg(t, 86.8, 87.6))
    back = ease(seg(t, 87.8, 88.6))
    nx = lerp(lerp(700, 1290, out), 700, back)
    ny = lerp(lerp(gy(700) - 280, gy(1290) - 120, out), gy(700) - 280, back) - 60 * back * (1 - back) * 4
    if 86.8 <= t < 88.6:
        thread(cv, bezier_pts((640, gy(640) - 260), ((640 + nx) / 2, ny - 40), (nx, ny)), w=2.5,
               color=(150, 110, 170))
        ang = math.atan2(ny - (gy(700) - 280), nx - 700) if t < 87.7 else math.pi
        tapered(cv, [(nx - math.cos(ang) * 120, ny - math.sin(ang) * 120), (nx, ny)], 9, 1, (200, 196, 214))
    fx.sparks(cv, 1280, gy(1280) - 120, t - 87.6, 87, reach=150)
    fx.slash(cv, 1300, gy(1300) - 130, 110, 4.0, 1.4, t - 87.6 + 0.03)
    end(cv)
    # Hornet, close in the foreground, her back three-quarters to us
    ch.hornet(cv, 470, 1500, 280, 1, {'turn': -0.3, 'wind': 0.6, 'needle_on': False, 'arm_reach': 1},
              t=t, voided=1.0)


def s23_whirl(cv, t, u):
    """Her whirling thread: rings of silk cutting the air."""
    cam = wd.lerp_cam(wd.Camera(900, 680, 1.6), wd.Camera(900, 680, 1.8), ease(u))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.0})
    world(cv, cam)
    gy = wd.ground_y
    hx = 860
    spin = int(t * 16) % 2
    ch.hornet(cv, hx, gy(hx), KS * 1.1, 1 if spin else -1, {'turn': 0.5, 'legs': 'stand', 'wind': 1.0,
                                                            'needle': -0.4}, t=t, voided=1.0)
    for k in range(3):
        rot = t * (9 + k * 3) + k
        cx, cy = hx, gy(hx) - 150
        rr = 160 + k * 40
        for j in range(4):
            a0 = rot + j * TAU / 4
            pts = [(cx + math.cos(a0 + q * 0.06) * rr, cy + math.sin(a0 + q * 0.06) * rr * 0.55)
                   for q in range(14)]
            tapered(cv, pts, 1, 4, (220, 200, 230), a=0.8)
    kx = lerp(1180, 1300, ease(u))
    ch.knight(cv, kx, gy(kx), KS, -1, {'turn': 0.6, 'legs': 'run1' if u < 0.6 else 'stand', 'wind': 0.7,
                                        'nail': 0.5}, t=t)
    end(cv)
    wd.foreground(cv, cam, t)


CLASHES_F = [91.2, 92.4, 93.6, 94.8]


def s24_clashes(cv, t, u):
    """Four clashes on four downbeats; between them, their faces."""
    k = max(i for i, c in enumerate(CLASHES_F) if t >= c)
    c = CLASHES_F[k]
    if t - c < 0.42:
        cam = cam_on(960, 760, 2.2)
        stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.0})
        dim(cv, 0.25)
        fx.focus_lines(cv, 960, 640, t, amount=0.5 * (1 - (t - c) / 0.42), color=(255, 230, 230), inner=200,
                       seed=k)
        world(cv, cam)
        gy = wd.ground_y(GX)
        push = 30 * ease_out(seg(t, c, c + 0.4))
        ch.hornet(cv, 900 - push, gy, KS * 1.2, 1, {'turn': 0.6, 'legs': 'lunge', 'needle': 0.0,
                                                    'arm_reach': 1, 'wind': 1.0}, t=t, voided=1.0)
        ch.knight(cv, 1030 + push, gy, KS * 1.2, -1, {'turn': 0.6, 'nail': -0.1, 'nail_reach': 1,
                                                      'wind': 0.8}, t=t)
        fx.sparks(cv, 965, gy - 140, t - c, 90 + k, n=24, reach=220)
        end(cv)
    else:
        cam = cam_on(960, 600, 2.0)
        blurred(cv, 12, lambda: stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.0}))
        dim(cv, 0.35)
        z = lerp(460, 500, seg(t, c + 0.42, c + 1.2))
        if k % 2 == 0:
            ch.knight(cv, 1000, 1480, z, -1, {'turn': 0.9, 'wind': 0.7, 'nail_on': False}, t=t)
        else:
            ch.hornet(cv, 940, 1480, z * 0.62, 1, {'turn': 0.8, 'wind': 0.8, 'needle_on': False},
                      t=t, voided=1.0)
        fx.speed_streaks(cv, t, 1 if k % 2 else -1, amount=0.25, color=(200, 190, 255), seed=9 + k)


def s25_strike(cv, t, u):
    """He cuts through her.  In slow motion the void bleeds out of her."""
    hit = 96.0
    if t < hit + 0.1:
        cam = cam_on(960, 760, 1.9)
        stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.0})
        fx.speed_streaks(cv, t, 1, amount=0.7, color=(220, 210, 255), seed=12)
        world(cv, cam)
        gy = wd.ground_y(GX)
        dash = ease_in(seg(t, 95.5, hit))
        ch.hornet(cv, 1020, gy, KS * 1.15, -1, {'turn': 0.5, 'needle': 1.2, 'wind': 0.6}, t=t, voided=1.0)
        ch.knight(cv, lerp(700, 1240, dash), gy, KS * 1.15, 1,
                  {'turn': 0.8, 'legs': 'run0', 'nail': -0.1, 'nail_reach': 1, 'wind': 1.0}, t=t)
        end(cv)
        return
    slow = seg(t, hit, 98.4)
    cam = cam_on(1000, wd.ground_y(1000) - 3.0 * KS, lerp(2.6, 3.6, ease(slow)))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 1.0})
    world(cv, cam)
    gy = wd.ground_y(1000)
    voided = 1.0 - ease(seg(t, 96.8, 98.2))
    ch.hornet(cv, 1000, gy, KS * 1.15, -1, {'turn': 0.5, 'needle_on': False, 'wind': 0.3 + 0.4 * voided,
                                            'lean': -6 * slow}, t=t, voided=voided)
    fx.Burst(hit, 1000, gy - 3.0 * KS, 160, 260, [(6, 5, 10), (40, 28, 80), (90, 60, 160)], 41,
             size=(3, 10), rise=0.3, life=2.6).draw(cv, hit + (t - hit) * 0.45)
    fx.smoke(cv, 1000, gy - 2.6 * KS, t, scale=0.9, amount=voided, seed=4)
    end(cv)
    fx.slash(cv, W / 2, H / 2, 700, -2.6, 0.5, t - hit, width=0.8, life=0.45)


# --- the last stand ---------------------------------------------------------------------
def s26_rise_together(cv, t, u):
    """Freed, she kneels, then stands beside him.  Above, she gathers herself."""
    cam = wd.lerp_cam(wd.Camera(960, 700, 1.45), wd.Camera(960, 640, 1.3), ease(u))
    charge = ease(u)
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.5, 'charge': charge}, flare=0.4 * charge)
    world(cv, cam)
    gy = wd.ground_y
    stand = ease(seg(t, 99.8, 100.8))
    ch.hornet(cv, 1160, gy(1160), KS * 1.1, -1, {'turn': 0.4, 'legs': 'kneel' if stand < 0.5 else 'stand',
                                                 'needle': 1.0, 'wind': 0.4}, t=t, voided=0.0)
    ch.knight(cv, 960, gy(960), KS * 1.1, 1, {'turn': 0.2, 'wind': 0.5, 'nail': 0.6}, t=t)
    # void gathers to the point of her blade
    tip = wd.rad_to_world(512, 1080)
    for k in range(18):
        a = k * 0.35 + t
        d = 260 * (1 - ((t * 0.8 + k / 18) % 1.0))
        circle(cv, tip[0] + math.cos(a) * d, tip[1] + math.sin(a) * d * 0.6, 6, (8, 6, 14))
    fx.bloom_ring(cv, tip[0], tip[1], 160, 0.4 * charge, (140, 100, 255))
    end(cv)
    wd.foreground(cv, cam, t)


def s27_flung(cv, t, u):
    """She whirls her thread and flings him; he rises toward her."""
    fling = 102.6
    if t < fling:
        cam = cam_on(1040, 780, 1.9)
        stage(cv, cam, t, {'eyes': 1.0, 'flap': 2.5, 'charge': 1.0})
        world(cv, cam)
        gy = wd.ground_y
        ch.hornet(cv, 1160, gy(1160), KS * 1.15, -1, {'turn': 0.5, 'needle': -1.2, 'wind': 0.8,
                                                      'arm_reach': 1}, t=t, voided=0.0)
        ch.knight(cv, 960, gy(960), KS * 1.15, 1, {'turn': 0.3, 'legs': 'tuck' if t > 102.2 else 'stand',
                                                   'wind': 0.5}, t=t)
        a = t * 12
        for k in range(2):
            pts = [(1060 + math.cos(a + k * 3 + q * 0.07) * 150, gy(1060) - 260 + math.sin(a + k * 3 + q * 0.07) * 60)
                   for q in range(20)]
            tapered(cv, pts, 1, 3, (230, 220, 235))
        end(cv)
        return
    v = seg(t, fling, 105.85)
    ky = lerp(wd.ground_y(960) - 100, 380, ease_out(v))
    cam = cam_on(960, ky - 120, lerp(1.6, 1.25, v))
    stage(cv, cam, t, {'eyes': 1.0, 'flap': 3.0, 'charge': 1.0}, flare=0.6)
    r = random.Random(int(t * 24))
    for _ in range(50):
        x = r.uniform(0, W)
        y0 = r.uniform(0, H)
        tapered(cv, [(x, y0), (x, y0 + r.uniform(150, 500))], 1, r.uniform(1, 4), (220, 210, 255),
                a=r.uniform(0.15, 0.5))
    world(cv, cam)
    thread(cv, [(1160, wd.ground_y(1160) - 200), (960, ky)], color=(230, 220, 235),
           a=1 - seg(t, fling, fling + 0.4))
    ch.knight(cv, 960, ky, KS * 1.15, 1, {'turn': 0.2, 'legs': 'tuck', 'wind': 1.0, 'nail': -1.57}, t=t)
    end(cv)


def s28_final_blow(cv, t, u):
    """The final chord.  The cut; the cracks; she breaks into light."""
    hit = 105.9
    cracks = ease(seg(t, hit + 0.1, hit + 1.8))
    dissolve = ease(seg(t, hit + 1.6, hit + 4.2))
    light = ease(seg(t, hit + 1.0, hit + 4.0))
    cam = wd.lerp_cam(cam_on(960, 300, 1.9, 0.6), cam_on(960, 380, 1.15, 0.6), ease(seg(t, hit, 110.4)))
    stage(cv, cam, t, {'eyes': 1.0 - dissolve, 'flap': 1.0 * (1 - dissolve), 'cracks': cracks,
                       'dissolve': dissolve}, light=light)
    sx, sy = wd.rad_point(512, 420, cam)
    for k in range(3):
        fx.Burst(hit + 1.6 + k * 0.4, sx, sy, 90, 700 + 200 * k,
                 [(255, 252, 240), (230, 220, 255), (190, 170, 255)], 50 + k, size=(2, 6),
                 rise=-0.02, life=2.4, glow=True).draw(cv, t)
    fx.slash(cv, W / 2, H / 2 + 60, 780, -2.7, -0.2, t - hit + 0.02, width=1.0, life=0.6)
    kx, ky = W / 2, lerp(H / 2 + 120, H + 300, ease_in(seg(t, hit + 0.8, 110.4)))
    ch.knight(cv, kx, ky, 120, 1, {'turn': 0.2, 'legs': 'tuck', 'wind': 0.6, 'nail': -1.57 if t < hit + 0.5 else 0.6},
              t=t)


# --- silence -----------------------------------------------------------------------------
def s29_aftermath(cv, t, u):
    """Light has come back to the Abyss.  He lands, and finds what he lost."""
    cam = wd.lerp_cam(wd.Camera(1000, 640, 1.3), wd.Camera(1040, 700, 1.55), ease(u))
    stage(cv, cam, t, False, light=1.0, shafts=1.6)
    world(cv, cam)
    gy = wd.ground_y
    land = ease_out(seg(t, 110.4, 112.0))
    walk = ease(seg(t, 112.4, 115.0))
    kx = lerp(980, 1120, walk)
    kh = 300 * (1 - land)
    kneel = seg(t, 115.2, 116.0)
    heart_y = gy(1150) - 10 - 80 * ease(seg(t, 116.0, 117.0))
    ch.hornet(cv, 760, gy(760), KS * 1.1, 1, {'turn': 0.4, 'needle': 1.0, 'wind': 0.2}, t=t, voided=0.0)
    ch.knight(cv, kx, gy(kx) - kh + 12 * kneel, KS * 1.1, 1,
              {'turn': 0.3, 'legs': ('run0' if int(t * 4) % 2 else 'run1') if 112.4 < t < 115 else 'stand',
               'wind': 0.15, 'nail': 0.9}, t=t)
    void_heart(cv, 1155, heart_y, 14, glow=0.6 + 0.4 * math.sin(t * 3), t=t)
    end(cv)
    wd.foreground(cv, cam, t)


def s30_heart(cv, t, u):
    """Close: the Void Heart in his hand, and then within him again."""
    cam = cam_on(1100, 760, 2.4)
    blurred(cv, 14, lambda: stage(cv, cam, t, False, light=1.0, shafts=1.6))
    dim(cv, 0.15)
    fly = ease(seg(t, 117.9, 118.6))
    gone = ease(seg(t, 118.5, 119.1))
    ch.knight(cv, 1180, 1430, 390, -1, {'turn': 0.7, 'nail_on': False, 'wind': 0.2}, t=t)
    hx, hy = lerp(800, 1150, fly), lerp(560 + 14 * math.sin(t * 2), 900, fly)
    if gone < 1:
        void_heart(cv, hx, hy, 60 * (1 - 0.8 * fly), glow=1.0 + 2 * fly, t=t)
    fx.bloom_ring(cv, 1150, 900, 520, 0.7 * gone * (1 - seg(t, 119.2, 120.0)), (255, 250, 240))


def s31_together(cv, t, u):
    """The last look: the two of them, small, in the light."""
    cam = wd.lerp_cam(wd.Camera(960, 640, 1.25), wd.Camera(960, 560, 1.0), ease(u))
    stage(cv, cam, t, False, light=1.0, shafts=1.8)
    world(cv, cam)
    gy = wd.ground_y
    ch.hornet(cv, 900, gy(900), KS, 1, {'turn': 0.2, 'needle': 1.0, 'wind': 0.15}, t=t, voided=0.0)
    ch.knight(cv, 1010, gy(1010), KS, 1, {}, t=t, view='back')
    end(cv)
    wd.foreground(cv, cam, t)


SHOTS = [
    (0.0, 9.5, s01_establish), (9.5, 14.0, s02_her_eyes), (14.0, 20.0, s03_over_shoulder),
    (20.0, 25.0, s04_tears_free), (25.0, 29.0, s05_knight_turns), (29.0, 32.5, s06_nail_grip),
    (32.5, 36.0, s07_gathering),
    (36.0, 38.4, s08_first_blood), (38.4, 40.8, s09_up_slash), (40.8, 45.6, s10_orbs),
    (45.6, 50.4, s11_sword_rain), (50.4, 53.2, s12_parry), (53.2, 55.2, s13_her_wound),
    (55.2, 60.0, s14_shade_duel), (60.0, 64.8, s15_spikes), (64.8, 69.6, s16_combo),
    (69.6, 72.8, s17_shatter), (72.8, 74.4, s18_scream),
    (74.4, 79.2, s19_cocoon), (79.2, 81.6, s20_hornet_wakes), (81.6, 86.4, s21_lunges),
    (86.4, 88.8, s22_needle), (88.8, 91.2, s23_whirl), (91.2, 96.0, s24_clashes),
    (96.0, 98.4, s25_strike),
    (98.4, 101.6, s26_rise_together), (101.6, 105.9, s27_flung), (105.9, 110.4, s28_final_blow),
    (110.4, 117.6, s29_aftermath), (117.6, 120.0, s30_heart), (120.0, 124.0, s31_together),
]

# camera shake (time, length, pixels), white flashes, impact frames
SHAKES = [(37.2, .3, 10), (39.6, .3, 10), (41.9, .3, 6), (42.5, .3, 6), (43.1, .3, 6), (43.7, .3, 6),
          (44.3, .3, 6), (44.9, .3, 6), (53.4, 1.0, 14), (54.0, 1.2, 10),
          (55.2, .3, 8), (56.4, .3, 8), (57.6, .3, 8), (58.8, .3, 8), (66.0, .2, 10), (66.4, .2, 10),
          (66.8, .3, 12), (72.0, 1.0, 18), (72.8, 1.6, 14), (79.2, .8, 16), (82.8, .3, 10),
          (84.0, .3, 12), (85.2, .3, 10), (91.2, .3, 12), (92.4, .3, 12), (93.6, .3, 12),
          (94.8, .5, 16), (96.0, .5, 14), (105.9, 1.6, 22)]
FLASHES = [(36.0, 0.25, 0.9), (53.4, 0.15, 0.6), (72.0, 0.2, 0.8), (79.2, 0.3, 0.9),
           (96.0, 0.12, 0.7), (105.9, 0.5, 1.0), (118.6, 0.4, 0.5)]
IMPACTS = [(37.2, 'light'), (39.6, 'dark'), (66.8, 'light'), (72.0, 'dark'), (84.0, 'light'),
           (94.8, 'dark'), (96.0, 'light'), (105.9, 'dark')]
