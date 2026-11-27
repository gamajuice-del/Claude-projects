#!/usr/bin/env python3
"""
void_vigil_cutscene.py - the whole fight, as a cutscene cut to the music.

The Knight, having lost the Void Heart, faces the voided Radiance and the
shades she pours out.  Every action is placed on a beat of shade_finale.py,
so hits land on the music:

  The Abyss       the opening tableau; the title; her eyes open
  Awakening       the shade tears free of the Knight; the Knight turns
  The Fight       siblings dive and are cut down; void orbs; a rain of void
                  swords; orbs struck back at her
  Her Shadow      the great shade duels the Knight; spikes burst from the
                  ground; the shade is destroyed
  Turn            darkness; void pours into a cocoon - her last card:
  Radiance Falls  voided Hornet.  Lunges, needle throws, the thread whirl,
                  clashes on every downbeat; struck, the void leaves her
  Last Stand      Hornet flings the Knight skyward; the final chord is the
                  final blow; the Radiance cracks open into light
  Silence         the Knight takes back the Void Heart; Hornet beside him

The scene, palette and figures come from void_vigil.py.

Usage:  python3 void_vigil_cutscene.py                 -> void_vigil_cutscene.mp4
        python3 void_vigil_cutscene.py --sheet B0 B1   -> contact sheet of beats
"""
import math
import random
import subprocess
import sys

import numpy as np
from PIL import Image

import shade_finale as sf
import void_vigil as vv

FPS = 24
W = H = 128
TAU = 2 * math.pi
RAMP = vv.RAMP
VOID = vv.VOID
WHITE = (236, 234, 250)
VIOLET = (52, 32, 90)
VIOLET_HI = (92, 70, 140)

# --- time: everything is scripted in beats of the music ------------------------------
SCORE = sf.arrange()
TEMPI = sorted(SCORE.tempi)
AUDIO_LEN = SCORE.seconds() + 3.5


def T(b):
    """Beat -> seconds."""
    t, last_b, bpm = 0.0, 0.0, TEMPI[0][1]
    for tb, new in TEMPI:
        if tb > b:
            break
        t += (tb - last_b) * 60 / bpm
        last_b, bpm = tb, new
    return t + (b - last_b) * 60 / bpm


def B(t):
    """Seconds -> beat."""
    last_t, last_b, bpm = 0.0, 0.0, TEMPI[0][1]
    for tb, new in TEMPI:
        tt = last_t + (tb - last_b) * 60 / bpm
        if tt > t:
            break
        last_t, last_b, bpm = tt, tb, new
    return last_b + (t - last_t) * bpm / 60


def since(b, b0):
    """Seconds elapsed since beat b0 (negative if before)."""
    return T(b) - T(b0)


def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


def ease_out(u):
    u = min(max(u, 0.0), 1.0)
    return 1 - (1 - u) ** 2.2


def lerp(a, b, u):
    return a + (b - a) * u


WORLD = vv.build_world()
VAL, LAYER, GTOP = WORLD


def ground(x):
    return int(GTOP[int(min(max(round(x), 0), W - 1))])


# --- tracks: keyframed positions ------------------------------------------------------
class Track:
    """Keys (beat, x, h, pose, face, arc, curve).  x is the foot centre, h the
    height above the ground; 'arc' lifts the middle of a segment (a jump)."""

    def __init__(self, keys):
        self.keys = []
        for k in keys:
            k = list(k) + [None] * (7 - len(k))
            b, x, h, pose, face, arc, curve = k
            self.keys.append((b, x, h or 0, pose or 'idle', face or 1, arc or 0,
                              curve or 'ease'))

    def at(self, b):
        ks = self.keys
        if b <= ks[0][0]:
            k = ks[0]
            return k[1], k[2], k[3], k[4], 0.0
        for i in range(len(ks) - 1):
            k0, k1 = ks[i], ks[i + 1]
            if k0[0] <= b < k1[0]:
                u = (b - k0[0]) / (k1[0] - k0[0])
                f = {'ease': ease, 'lin': lambda v: v, 'out': ease_out,
                     'in': lambda v: v * v}[k0[6]](u)
                x = lerp(k0[1], k1[1], f)
                h = lerp(k0[2], k1[2], f) + k0[5] * 4 * u * (1 - u)
                return x, h, k0[3], k0[4], u
        k = ks[-1]
        return k[1], k[2], k[3], k[4], 1.0


class Path:
    """Keys (beat, x, y[, curve]) for things that fly."""

    def __init__(self, keys):
        self.keys = [tuple(k) + (('ease',) if len(k) == 3 else ()) for k in keys]

    def at(self, b):
        ks = self.keys
        if b <= ks[0][0]:
            return ks[0][1], ks[0][2]
        for i in range(len(ks) - 1):
            k0, k1 = ks[i], ks[i + 1]
            if k0[0] <= b < k1[0]:
                u = (b - k0[0]) / (k1[0] - k0[0])
                f = {'ease': ease, 'lin': lambda v: v, 'out': ease_out,
                     'in': lambda v: v * v}[k0[3]](u)
                return lerp(k0[1], k1[1], f), lerp(k0[2], k1[2], f)
        return ks[-1][1], ks[-1][2]


# --- sprites -------------------------------------------------------------------------
# The Knight in three-quarter view, facing right.  Foot centre: column 5, last row.
KN_SIDE = [
    ".W.....W...",
    ".Ww....Ww..",
    ".Ww....Ww..",
    ".WWw..wWw..",
    ".WWWWWWWWm.",
    "WWWKKWWKKKm",
    "WWKKKWWKKKm",
    "WWKKKWWKKKm",
    ".WWKWWWWKWm",
    "..mWWWWWmm.",
    "..CCccccc..",
    ".CCcccccco.",
    ".CCccccccoo",
    "CCcccccccoo",
    "CCcccccccoo",
    ".Cc.ccc.co.",
]
KN_LEGS = {
    'idle': ["...KK.KK...", "...KK.KK...", "..KKK.KKK.."],
    'run0': ["...KK..KK..", "..KK....KK.", ".KK......K."],
    'run1': ["....KKK....", "....KK.....", "...KKK....."],
    'jump': ["...KKKK....", "....KK.....", "..........."],
}
KN_KEY = {'W': (226, 222, 240), 'w': (184, 178, 208), 'm': (130, 122, 160),
          'K': VOID, 'C': (72, 60, 112), 'c': (36, 25, 64), 'o': (22, 15, 40)}
NAIL_HI, NAIL, NAIL_LO = vv.NAIL_HI, vv.NAIL, vv.NAIL_LO

# Hornet, facing right.  'M' mask, 'e' eyes, 'r' 'R' 'd' cloak, 'K' legs.
HORNET = [
    "..M..M......",
    "..MM.MM.....",
    "...M..M.....",
    "...MM.MM....",
    "....MM.M....",
    "....MMMM....",
    "...MMMMMM...",
    "..MMMMMMMM..",
    "..MMMMMeeM..",
    "..MMMMMeeM..",
    "...MMMMMM...",
    "....MMMM....",
    "....KrrK....",
    "...rrRRrr...",
    "..rrRRRRrr..",
    "..rRRRRRrrd.",
    ".rrRRRRrrrd.",
    ".rRRRRRrrdd.",
    "rrRRRRrrrddd",
    "rrRRRrrrdddd",
    ".rr.rrd.dd..",
    "....K..K....",
    "....K..K....",
    "...KK..KK...",
]
HORNET_RUN = [["...K...K....", "..K.....K...", ".KK.....KK.."],
              ["....K.K.....", "....KK......", "...KKK......"]]
HORNET_VOIDED = {'M': VOID, 'e': WHITE, 'r': (84, 16, 36), 'R': (118, 28, 52),
                 'd': (46, 8, 22), 'K': VOID}
HORNET_FREE = {'M': (232, 228, 240), 'e': (20, 16, 28), 'r': (170, 36, 52),
               'R': (206, 62, 74), 'd': (110, 20, 36), 'K': (40, 30, 50)}
THREAD_VOID = (88, 54, 104)
THREAD_FREE = (210, 200, 214)

SHADE = vv.SHADE[:19]          # the great shade, without the part between the horns


def blend(c0, c1, u):
    return tuple(int(lerp(int(a), int(b), u)) for a, b in zip(c0, c1))


# --- the canvas helpers ------------------------------------------------------------------
def put(img, x, y, c):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < W and 0 <= y < H:
        img[y, x] = c


def blit(img, rows, key, x0, y0, flip=False, flat=None, keep=None):
    """Draw a sprite; 'flat' paints every pixel one colour (hit flash, afterimage)."""
    x0, y0 = int(round(x0)), int(round(y0))
    for j, row in enumerate(rows):
        if flip:
            row = row[::-1]
        for i, ch in enumerate(row):
            if ch in '. ':
                continue
            if keep is not None and not keep(i, j):
                continue
            c = key.get(ch)
            if c is None:
                continue
            if c == 'speck':
                c = VOID
            put(img, x0 + i, y0 + j, flat if flat else c)


def line(img, x0, y0, x1, y1, c, every=1):
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    for k in range(n + 1):
        if k % every == 0:
            u = k / max(n, 1)
            put(img, lerp(x0, x1, u), lerp(y0, y1, u), c)


# --- effects ------------------------------------------------------------------------
class Burst:
    """Particles thrown from a point, drifting with drag; stateless in time."""

    def __init__(self, b0, x, y, n, speed, colors, seed, rise=0.0, life=0.9, spread=None):
        r = random.Random(seed)
        self.b0, self.x, self.y, self.rise, self.colors = b0, x, y, rise, colors
        self.parts = []
        for _ in range(n):
            a = r.uniform(*(spread or (0, TAU)))
            s = speed * r.uniform(0.3, 1.0)
            self.parts.append((math.cos(a) * s, math.sin(a) * s, life * r.uniform(0.5, 1.0),
                               r.randrange(len(colors))))

    def draw(self, img, b):
        t = since(b, self.b0)
        if t < 0:
            return
        k = 2.8
        for vx, vy, life, ci in self.parts:
            if t > life:
                continue
            d = (1 - math.exp(-k * t)) / k
            x = self.x + vx * d
            y = self.y + vy * d - self.rise * t * t * 0.5 * 30
            age = t / life
            c = self.colors[min(len(self.colors) - 1, ci + int(age * 1.5))]
            put(img, x, y, c)


VOID_COLS = [VOID, VOID, (24, 18, 40), VIOLET, (40, 33, 64)]
LIGHT_COLS = [WHITE, vv.MOTE_HI, vv.MOTE, RAMP[12], RAMP[11]]
SPARK_COLS = [WHITE, (250, 244, 220), vv.MOTE, RAMP[12]]


def slash_arc(img, cx, cy, direction, age, r0=6.0, span=1.25, flip=1):
    """The nail's crescent, for 0.2 s after the swing."""
    if age < 0 or age > 0.2:
        return
    c = WHITE if age < 0.05 else (vv.MOTE if age < 0.12 else RAMP[11])
    for k in range(40):
        a = direction - span / 2 + span * k / 39
        taper = math.sin(math.pi * k / 39)
        for dr in np.arange(0, 1.0 + 1.6 * taper, 0.5):
            put(img, cx + math.cos(a) * (r0 + dr), cy + math.sin(a) * (r0 + dr), c)


def sparks(img, x, y, age, seed, n=10, reach=7):
    if age < 0 or age > 0.3:
        return
    r = random.Random(seed)
    for _ in range(n):
        a = r.uniform(0, TAU)
        L = reach * r.uniform(0.5, 1.0) * min(1, age / 0.08)
        tail = L * 0.5
        for s in np.arange(tail, L, 0.5):
            put(img, x + math.cos(a) * s, y + math.sin(a) * s,
                WHITE if age < 0.12 else vv.MOTE)


def orb(img, x, y, glow=1.0):
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            d = dx * dx + dy * dy
            if d <= 1:
                put(img, x + dx, y + dy, VOID)
            elif d <= 4 and glow > 0.3:
                put(img, x + dx, y + dy, VIOLET if d < 4 else VIOLET_HI)
    put(img, x - 1, y - 1, (70, 56, 110))


def void_sword(img, x, tip_y, dissolve=0.0, seed=0):
    r = random.Random(seed)
    pix = [(0, -k, VOID) for k in range(0, 7)] + [(-1, -5, VIOLET), (1, -5, VIOLET),
                                                   (0, -7, VIOLET_HI), (1, -3, VIOLET)]
    for dx, dy, c in pix:
        if r.random() >= dissolve:
            put(img, x + dx, tip_y + dy, c)


def spike(img, x, base_y, h):
    h = int(round(h))
    for k in range(h):
        half = (h - k) / h * 1.6
        for dx in range(-2, 3):
            if abs(dx) <= half:
                edge = abs(dx) > half - 1
                put(img, x + dx, base_y - k, VIOLET if edge else VOID)
    if h > 0:
        put(img, x, base_y - h, VIOLET_HI)


# --- pixel font for the title -----------------------------------------------------------
FONT = {
    'V': ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
    'O': [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    'I': [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    'D': ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    'G': [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    'L': ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
}


def text(img, s, cy, alpha):
    if alpha <= 0:
        return
    width = sum(4 if ch == ' ' else 6 for ch in s) - 1
    x = (W - width) // 2
    for ch in s:
        if ch == ' ':
            x += 4
            continue
        for j, row in enumerate(FONT[ch]):
            for i, px in enumerate(row):
                if px == '#':
                    xx, yy = x + i, cy + j
                    img[yy, xx] = blend(img[yy, xx], WHITE, alpha)
                    if yy + 1 < H:
                        img[yy + 1, xx] = blend(img[yy + 1, xx], RAMP[0], alpha * 0.8)
        x += 6


# --- the script -------------------------------------------------------------------------
# Section starts (beats): Abyss 0, Awakening 24, Fight 48, Shadow 96, Turn 144,
# Hornet 156, Last Stand 204, final chord 216, Silence 222.
KNIGHT = Track([
    (0, 64, 0, 'back', 1), (29.5, 64, 0, 'back', 1),
    (30, 64, 0, 'jump', -1, 4), (30.8, 64, 0, 'idle', -1),
    (49.4, 64, 0, 'idle', 1), (51.6, 64, 0, 'idle', -1),
    (55.9, 64, 0, 'jump', -1, 14), (57.4, 60, 0, 'idle', -1),
    (58.4, 60, 0, 'idle', 1),
    (63.75, 60, 0, 'dash', -1), (64.25, 40, 0, 'idle', -1),
    (65.25, 40, 0, 'dash', 1), (65.75, 80, 0, 'idle', 1),
    (66.75, 80, 0, 'dash', -1), (67.25, 50, 0, 'idle', -1),
    (68.25, 50, 0, 'dash', 1), (68.75, 88, 0, 'idle', 1),
    (69.75, 88, 0, 'dash', -1), (70.25, 64, 0, 'idle', -1),
    (74.2, 64, 0, 'run', -1), (75.6, 40, 0, 'idle', -1),
    (77.9, 40, 0, 'dash', 1), (78.9, 88, 0, 'idle', 1),
    (80.9, 88, 0, 'dash', -1), (81.9, 60, 0, 'idle', -1),
    (83, 60, 0, 'idle', 1), (90, 60, 0, 'idle', -1), (93, 60, 0, 'run', 1),
    (94.5, 64, 0, 'idle', -1),
    # the great shade
    (96, 64, 0, 'idle', -1), (96.3, 67, 0, 'idle', -1), (97.5, 67, 0, 'idle', 1),
    (99, 67, 0, 'idle', 1), (99.3, 63, 0, 'idle', 1), (100.5, 63, 0, 'idle', -1),
    (102, 63, 0, 'idle', -1), (102.3, 67, 0, 'idle', -1), (103.5, 67, 0, 'idle', 1),
    (105, 67, 0, 'idle', 1), (105.3, 63, 0, 'idle', 1),
    (108.5, 63, 0, 'jump', 1, 12), (109.3, 63, 0, 'idle', 1),
    (111.5, 63, 0, 'jump', -1, 12), (112.3, 63, 0, 'idle', -1),
    (114.5, 63, 0, 'jump', 1, 12), (115.3, 63, 0, 'idle', 1),
    (117.4, 63, 0, 'jump', 1, 18), (118.5, 63, 0, 'idle', 1),
    (119.4, 63, 0, 'dash', 1), (119.9, 84, 0, 'idle', -1),
    (122.5, 84, 0, 'jump', -1, 16), (123.6, 76, 0, 'idle', 1),
    (125.4, 76, 0, 'dash', 1), (125.9, 88, 0, 'idle', 1),
    (128.5, 88, 0, 'idle', 1), (129.5, 88, 0, 'idle', -1),
    (132.4, 88, 0, 'jump', -1, 12), (133.2, 88, 0, 'run', -1), (134.0, 70, 0, 'idle', -1),
    (134.2, 70, 0, 'jump', -1, 0, 'out'), (135, 66, 50, 'jump', -1, 0, 'in'),
    (136.5, 66, 0, 'idle', -1),
    (137.4, 66, 0, 'jump', -1, 0, 'out'), (138, 66, 30, 'jump', -1, 0, 'in'),
    (139.5, 66, 0, 'idle', -1), (142, 66, 0, 'run', 1), (143, 72, 0, 'idle', -1),
    # Hornet
    (156, 72, 0, 'idle', -1), (158.4, 72, 0, 'jump', -1, 14), (159.6, 70, 0, 'idle', 1),
    (165.2, 70, 0, 'dash', -1), (165.7, 48, 0, 'idle', 1),
    (168.4, 48, 0, 'jump', 1, 12), (169.2, 48, 0, 'idle', 1),
    (173.4, 48, 0, 'dash', -1), (173.9, 36, 0, 'idle', 1),
    (176.8, 36, 0, 'jump', 1, 16), (177.9, 56, 0, 'idle', -1),
    (180, 56, 0, 'idle', -1), (180.5, 64, 0, 'idle', -1),
    (183, 64, 0, 'idle', -1), (183.5, 70, 0, 'idle', -1),
    (186, 70, 0, 'idle', -1), (186.5, 76, 0, 'idle', -1),
    (189, 76, 0, 'idle', -1), (189.6, 84, 0, 'idle', -1),
    (191.5, 84, 0, 'jump', -1, 14), (192.5, 84, 0, 'idle', 1),
    (194.6, 84, 0, 'dash', 1), (195.0, 98, 0, 'idle', 1), (196, 92, 0, 'idle', 1),
    # the last stand
    (204, 92, 0, 'run', -1), (206, 64, 0, 'back', 1),
    (210, 64, 0, 'rise', 1, 0, 'out'), (215.8, 64, 63, 'rise', 1),
    (216.3, 64, 63, 'jump', 1, 0, 'in'), (221.5, 70, 0, 'idle', 1),
    # silence
    (223, 70, 0, 'walk', 1), (226, 74, 0, 'idle', 1),
    (226.5, 74, 0, 'crouch', 1), (228.5, 74, 0, 'idle', 1),
    (229.5, 74, 0, 'back', 1), (240, 74, 0, 'back', 1),
])
KNIGHT_SLASHES = [  # (beat, direction: 'f' forward, 'up', 'down')
    (51, 'f'), (54, 'f'), (56.7, 'up'), (60, 'f'), (72, 'up'),
    (85.5, 'up'), (87, 'up'), (88.5, 'up'),
    (96, 'f'), (99, 'f'), (102, 'f'), (105, 'f'),
    (126, 'f'), (127, 'f'), (128, 'f'), (135, 'down'), (138, 'up'),
    (162, 'f'), (171.7, 'f'), (180, 'f'), (183, 'f'), (186, 'f'), (189, 'f'), (195, 'f'),
]

HORNET_T = Track([
    (156, 36, 0, 'idle', 1),
    (158.6, 36, 0, 'lunge', 1, 0, 'lin'), (159.6, 104, 0, 'idle', -1),
    (161.4, 104, 0, 'lunge', -1, 0, 'lin'), (162.0, 80, 0, 'idle', -1),
    (162.6, 96, 0, 'idle', -1),
    (164.6, 96, 0, 'jump', -1, 22), (166.0, 70, 0, 'idle', -1),
    (174, 70, 0, 'spin', -1), (177, 70, 0, 'lunge', -1, 0, 'lin'), (177.8, 30, 0, 'idle', 1),
    (179.4, 30, 0, 'lunge', 1, 0, 'lin'), (180, 50, 0, 'idle', 1), (180.5, 40, 0, 'idle', 1),
    (182.4, 40, 0, 'lunge', 1, 0, 'lin'), (183, 58, 0, 'idle', 1), (183.5, 46, 0, 'idle', 1),
    (185.4, 46, 0, 'lunge', 1, 0, 'lin'), (186, 64, 0, 'idle', 1), (186.5, 52, 0, 'idle', 1),
    (188.4, 52, 0, 'lunge', 1, 0, 'lin'), (189, 70, 0, 'idle', 1), (189.6, 56, 0, 'idle', 1),
    (191.6, 56, 0, 'lunge', 1, 0, 'lin'), (192.4, 104, 0, 'idle', -1),
    (195, 104, 0, 'idle', -1), (195.6, 110, 0, 'idle', -1),
    (201, 110, 0, 'crouch', -1),
    (206, 110, 0, 'idle', -1), (207, 110, 0, 'run', -1), (208.5, 80, 0, 'spin', -1),
    (210.5, 80, 0, 'idle', 1),
    (222, 80, 0, 'walk', 1), (224, 92, 0, 'idle', -1), (240, 92, 0, 'idle', -1),
])
HORNET_THROWS = [(168, 30), (171, 48)]      # (beat, needle target x)
HORNET_FREE_AT = (198, 201)                 # the void leaves her between these beats

SHADE_PATH = Path([
    (0, 56, 65), (24, 56, 65), (30, 30, 50), (34, 14, 46), (90, 14, 46), (95.5, 20, 72),
    (96.5, 84, 72, 'lin'), (98.5, 84, 72), (99.5, 20, 72, 'lin'), (101.5, 20, 72),
    (102.5, 84, 72, 'lin'), (104.5, 84, 72), (105.5, 20, 72, 'lin'), (106.5, 56, 40),
    (119.6, 56, 40), (120.4, 24, 70, 'lin'), (122.6, 24, 70), (123.4, 92, 70, 'lin'),
    (126, 92, 70), (126.2, 94, 70), (127, 94, 70), (127.2, 96, 70), (128, 96, 70),
    (128.2, 98, 70), (129, 98, 70), (131, 56, 46), (135, 56, 46), (135.3, 56, 49),
    (136, 56, 46),
])
SHADE_ATTACKS = [96, 99, 102, 105, 120, 123]
SHADE_HITS = [126, 127, 128, 135]
SHADE_DIES = 138

# siblings: (sprite, path, beat they die (or None), beat they appear)
SIBLINGS = [
    (vv.SIB_R, Path([(0, 85, 59), (30, 85, 59), (40, 100, 62), (49.5, 100, 62),
                     (51, 64, 84, 'in')]), 51, 0),
    (vv.SIB_L, Path([(0, 38, 63), (30, 38, 63), (40, 14, 66), (52.5, 14, 66),
                     (54, 52, 84, 'in')]), 54, 0),
    (vv.SIB_R, Path([(52, 42, 40), (55.8, 42, 44), (56.7, 55, 62, 'in')]), 56.7, 52),
    (vv.SIB_R, Path([(55, 86, 40), (58.8, 86, 44), (60, 64, 84, 'in')]), 60, 55),
]

ORB_LAUNCH = [(63 + 1.5 * i, x) for i, x in enumerate((60, 40, 80, 50, 88, 64))]
PARRY_ORBS = [84, 85.5, 87]
SWORD_WAVES = [(73, 64), (76, 40), (79, 88), (82, 60)]     # (beat, gap left for the Knight)
SPIKE_WAVES = [(108, 'lr'), (111, 'rl'), (114, 'lr'), (117, 'in')]

SHAKES = [(51, .4, 1), (54, .4, 1), (56.7, .4, 1), (60, .4, 1), (72, .4, 1),
          (90, 1.5, 2), (93, 3, 1), (96, .5, 1), (99, .5, 1), (102, .5, 1), (105, .5, 1),
          (108.7, .4, 1), (111.7, .4, 1), (114.7, .4, 1), (117.7, .6, 2),
          (120, .5, 1), (126, .3, 1), (127, .3, 1), (128, .5, 1), (132, .8, 1), (135, .5, 2),
          (138, 2, 3), (139, 5, 2), (152, 4, 1), (156, 1.5, 3),
          (162, .5, 1), (166, .6, 2), (171.7, .4, 1), (180, .5, 2), (183, .5, 2),
          (186, .5, 2), (189, .8, 3), (195, 1, 2), (198, 1.5, 1),
          (212, 4, 1), (216, 3, 4)]
FLASHES = [(48, 0.35, 0.7), (90, 0.15, 0.5), (138, 0.35, 0.9), (156, 0.4, 0.9),
           (195, 0.2, 0.6), (216, 0.7, 1.0), (228.5, 0.3, 0.3)]

BURSTS = []


def _bursts():
    s = 1
    for spr, path, dies, _ in SIBLINGS:
        x, y = path.at(dies)
        BURSTS.append(Burst(dies, x + 5, y + 5, 40, 40, VOID_COLS, s, rise=0.3))
        s += 1
    for L, x in ORB_LAUNCH[:-1]:
        BURSTS.append(Burst(L + 1.5, x, ground(x) - 1, 22, 30, VOID_COLS, s,
                            spread=(math.pi, TAU)))
        s += 1
    BURSTS.append(Burst(72, 64, 82, 26, 36, VOID_COLS, 50))
    for k, L in enumerate(PARRY_ORBS):
        BURSTS.append(Burst(L + 3, 64, 40, 20, 30, VOID_COLS + [WHITE], 60 + k))
    BURSTS.append(Burst(SHADE_DIES, 64, 55, 120, 70, VOID_COLS, 70, rise=0.4, life=1.6))
    BURSTS.append(Burst(156, 36, 90, 90, 60, VOID_COLS, 80, life=1.2))
    BURSTS.append(Burst(166, 70, 103, 18, 30, [RAMP[6], RAMP[5], RAMP[4]], 85,
                        spread=(math.pi, TAU)))
    BURSTS.append(Burst(195, 104, 90, 50, 50, VOID_COLS, 90))
    BURSTS.append(Burst(198, 110, 88, 90, 26, VOID_COLS, 91, rise=1.2, life=2.4))
    BURSTS.append(Burst(216, 64, 26, 160, 90, LIGHT_COLS, 95, rise=0.2, life=2.2))
    BURSTS.append(Burst(228.5, 76, 92, 30, 24, LIGHT_COLS, 99, rise=0.4, life=1.2))


_bursts()


# --- the Radiance ----------------------------------------------------------------------
HASH = np.modf(np.sin(np.arange(W * H).reshape(H, W) * 12.9898) * 43758.5453)[0] % 1.0
_rc = random.Random(5)
CRACKS = []
for k in range(9):
    a = -math.pi / 2 + (k - 4) * 0.42 + _rc.uniform(-0.15, 0.15)
    x, y, pts = 64.0, 26.0, []
    for _ in range(_rc.randint(14, 30)):
        a += _rc.uniform(-0.45, 0.45)
        x += math.cos(a)
        y += math.sin(a) * 1.1
        pts.append((x, y))
    CRACKS.append(pts)
_d0, _ = vv.radiance_field(0.0)
_body = list(zip(*np.nonzero(_d0)))
_rc.shuffle(_body)
DEATH_MOTES = [(x, y, _rc.uniform(216.6, 221.0), _rc.uniform(-6, 6), _rc.uniform(8, 20))
               for y, x in _body[:220]]


def radiance_state(b):
    lift = 0.9
    if 40 <= b < 48:
        lift = 0.9 + 2.0 * ease((b - 40) / 8)
    elif 48 <= b < 144:
        lift = 1.6
    elif 144 <= b < 216:
        lift = 2.6
    eyes = 0.0 if b < 12 else min(1.0, (b - 12) / 1.5)
    charge = 0.0
    if 139 <= b < 156:
        charge = 0.7
    if 204 <= b < 216:
        charge = ease((b - 204) / 10)
    dissolve = 0.0 if b < 216.5 else min(1.0, (b - 216.5) / 5.0)
    light = 0.0 if b < 216 else ease((b - 216) / 4)
    return lift, eyes, charge, dissolve, light


# --- one frame ---------------------------------------------------------------------------
_layers = {}


def ground_layer(heart):
    """Ground details and foreground grass, drawn once onto a transparent layer."""
    if heart not in _layers:
        key = np.zeros((H, W, 3), dtype=np.uint8)
        key[:] = (255, 0, 255)
        cv = vv.Canvas(key)
        vv.draw_ground_detail(cv, GTOP, heart=heart)
        vv.draw_foreground(cv)
        mask = np.any(key != (255, 0, 255), axis=2)
        _layers[heart] = (key.copy(), mask)
    return _layers[heart]


def knight_pixels(img, b, afterimage=None):
    x, h, pose, face, u = KNIGHT.at(b)
    fy = ground(x) - h
    slash = None
    for sb, kind in KNIGHT_SLASHES:
        age = since(b, sb)
        if -0.06 <= age <= 0.22:
            slash = (sb, kind, age)
    flat = afterimage
    if pose == 'back' and not flat:
        ox, oy = x - 64, fy - 103
        blit(img, vv.KNIGHT, vv.KNIGHT_KEY, 56 + ox, 84 + oy)
        for px, py, c in ((52, 91, NAIL_HI), (53, 92, NAIL_HI), (54, 92, NAIL),
                          (54, 93, NAIL_HI), (55, 93, NAIL), (55, 94, NAIL_HI),
                          (56, 94, NAIL_LO), (56, 95, NAIL_LO), (57, 95, vv.HANDLE)):
            put(img, px + ox, py + oy, c)
        return x, fy, face
    flip = face < 0
    body = list(KN_SIDE)
    if pose in ('run', 'dash', 'walk'):
        rate = 6 if pose == 'walk' else 12
        legs = KN_LEGS['run0' if int(T(b) * rate) % 2 == 0 else 'run1']
    elif pose in ('jump', 'rise'):
        legs = KN_LEGS['jump']
    else:
        legs = KN_LEGS['idle']
    rows = body + legs
    top = fy - len(rows) + 1
    if pose == 'crouch':
        rows = body[:-1] + [legs[-1]]
        top = fy - len(rows) + 1
    blit(img, rows, KN_KEY, x - 5, top, flip=flip, flat=flat)
    if flat:
        return x, fy, face
    # the nail
    hx, hy = x + 4 * face, fy - 7
    if pose == 'crouch':
        hy += 1
    if slash:
        sb, kind, age = slash
        if kind == 'f':
            pts = [(face * k, 0) for k in range(1, 7)]
            slash_arc(img, x + face * 3, fy - 9, 0 if face > 0 else math.pi, age, r0=7)
        elif kind == 'up':
            pts = [(0, -k) for k in range(1, 7)]
            slash_arc(img, x, fy - 15, -math.pi / 2, age, r0=6)
        else:
            pts = [(0, k) for k in range(1, 7)]
            slash_arc(img, x, fy + 2, math.pi / 2, age, r0=6)
    elif pose == 'rise':
        pts = [(0, -k) for k in range(1, 7)]
    else:
        pts = [(face * k, k) for k in range(1, 4)]
    for k, (dx, dy) in enumerate(pts):
        put(img, hx + dx, hy + dy, NAIL_HI if k == len(pts) - 1 else NAIL)
    return x, fy, face


def hornet_palette(b):
    f = ease((b - HORNET_FREE_AT[0]) / (HORNET_FREE_AT[1] - HORNET_FREE_AT[0]))
    if b < HORNET_FREE_AT[0]:
        f = 0.0
    key = {k: blend(HORNET_VOIDED[k], HORNET_FREE[k], f) for k in HORNET_VOIDED}
    return key, f


def hornet_pixels(img, b, flat=None):
    x, h, pose, face, u = HORNET_T.at(b)
    fy = ground(x) - h
    key, free = hornet_palette(b)
    flip = face < 0
    if pose == 'spin':
        flip = int(T(b) * 14) % 2 == 0
    rows = list(HORNET)
    if pose in ('run', 'walk', 'lunge'):
        rate = 6 if pose == 'walk' else 14
        rows = rows[:-3] + HORNET_RUN[int(T(b) * rate) % 2]
    if pose == 'jump':
        rows = rows[:-3] + ["....KK.K....", ".....KK.....", "............"]
    top = fy - len(rows) + 1
    if pose == 'crouch':
        rows = rows[:-4] + ["..KK...KK..."]
        top = fy - len(rows) + 1
    hit = any(0 <= since(b, hb) < 0.09 for hb in (195,))
    blit(img, rows, key, x - 5, top, flip=flip, flat=flat or (WHITE if hit else None))
    if flat:
        return x, fy, face
    thread = blend(THREAD_VOID, THREAD_FREE, free)
    hx, hy = x + 5 * face, top + 14
    # needle
    throwing = None
    for tb, tx in HORNET_THROWS:
        if tb <= b < tb + (2.0 if tb == 168 else 1.5):
            throwing = (tb, tx)
    if throwing:
        tb, tx = throwing
        out = 1.0 if tb == 168 else 0.7
        uu = (b - tb) / out if b < tb + out else 1 - (b - tb - out) / out
        nx = lerp(hx, tx, ease(uu))
        line(img, hx, hy, nx, hy, thread, every=2)
        for k in range(5):
            put(img, nx + k * face, hy, NAIL_HI if k == 0 else NAIL)
    elif pose == 'lunge':
        for k in range(1, 10):
            put(img, hx + k * face, hy, NAIL_HI if k == 9 else NAIL)
        for k in range(3):                                  # speed lines
            yy = top + 8 + k * 5
            line(img, x - face * 8, yy, x - face * 18, yy, RAMP[10], every=2)
    elif pose == 'spin':
        cx, cy = x, top + 12
        rot = T(b) * 9
        for k in range(48):
            a = rot + TAU * k / 48
            if k % 6 < 4:
                put(img, cx + math.cos(a) * 12, cy + math.sin(a) * 9, thread)
        for k in range(4):
            a = rot * 1.3 + TAU * k / 4
            line(img, cx + math.cos(a) * 9, cy + math.sin(a) * 7,
                 cx + math.cos(a) * 14, cy + math.sin(a) * 10, NAIL)
    else:
        for k in range(1, 5):
            put(img, hx + k * face * 0.5, hy + k, NAIL if k < 4 else NAIL_HI)
    return x, fy, face


def render_frame(t):
    b = B(t)
    lt = (t / 4.8) % 1.0
    lift, eyes, charge, dissolve, light = radiance_state(b)

    # --- the sky, her, the light ----------------------------------------------------
    beam_k = 1.0
    if 144 <= b < 156:
        beam_k = 0.35
    beam_k += 0.9 * light
    dim = 0.0
    if 144 <= b < 156:
        dim = 1.4 * ease((b - 144) / 2) * (1 - ease((b - 155.5) / 0.5))
    beams = vv.beam_field(lt) * vv.BEAM_REACH[LAYER] * beam_k
    reach = vv.HER_REACH[LAYER]
    cx, cy, rad = vv.DISC
    dd = np.hypot(vv.XX - cx, vv.YY - cy)
    sun = 3.6 * np.exp(-(dd / rad) ** 2) + 1.6 * np.exp(-(dd / (2 * rad)) ** 2)
    v = VAL + (vv.halo(lt) * (1 - light) + sun * light) * reach + beams
    D, R = vv.radiance_field(lt, lift)
    if dissolve > 0:
        D = D * (HASH > dissolve)
    D = D * reach
    v = v * (1 - D) + (R + 0.12 * beams + 2.0 * charge * (R > 3)) * D
    solid = D > 0.55
    around = (np.roll(solid, 1, 0) & np.roll(solid, -1, 0)
              & np.roll(solid, 1, 1) & np.roll(solid, -1, 1))
    glow = 3.0 * np.exp(-((dd - rad) / 6.0) ** 2) + 1.0
    v = np.where(solid & ~around, v + glow, v)
    v = v + vv.fog_field(lt) * vv.FOG_REACH[LAYER] - dim
    img = vv.quantize(v)
    cv = vv.Canvas(img)

    # her eyes
    if eyes > 0 and dissolve < 0.6:
        pulse = 0.5 + 0.5 * math.sin(TAU * lt)
        for x, y in vv.RAD_EYES:
            base = (242, 242, 252) if y <= 18 else (210, 208, 236)
            dimc = (172, 168, 212)
            c = blend(dimc, base, max(pulse, charge))
            put(img, x, y, blend(tuple(img[y, x]), c, eyes))
        if charge > 0.5:
            for x, y in ((59, 17), (59, 18), (69, 17), (69, 18), (64, 21)):
                put(img, x, y, RAMP[9])
    # cracks of light, then her body breaking into light
    if 216 <= b < 222:
        grow = min(1.0, (b - 216) / 1.2)
        for pts in CRACKS:
            for x, y in pts[:int(len(pts) * grow)]:
                if 0 <= int(y) < H and 0 <= int(x) < W and D[int(y), int(x)] > 0:
                    put(img, x, y, WHITE)
    for x, y, tb, dx, rise in DEATH_MOTES:
        age = since(b, tb)
        if 0 <= age < 1.6:
            put(img, x + dx * age, y - rise * age, LIGHT_COLS[min(4, int(age * 3))])

    # the void she pours out, and her children far off
    vv.draw_distant_siblings(cv, lt)
    if b < 30:
        fade = 1 - ease((b - 24) / 6)
        if fade > 0.05:
            sub = vv.Canvas(img.copy())
            vv.draw_threads(sub, lt)
            mask = np.any(sub.img != img, axis=2) & (HASH < fade)
            img[mask] = sub.img[mask]
    if b < 216:
        vv.draw_drips(cv, lt)
    vv.draw_motes(cv, lt)

    # cocoon (her last card)
    if 145 <= b < 156:
        grow = ease((b - 145) / 10)
        rx, ry = 7 * grow + 0.5, 11 * grow + 0.5
        ccx, ccy = 36, 92 - 11 * grow + 8
        pulse = 0.5 + 0.5 * math.sin(T(b) * 14)
        for y in range(int(ccy - ry - 1), int(ccy + ry + 2)):
            for x in range(int(ccx - rx - 1), int(ccx + rx + 2)):
                r = ((x - ccx) / rx) ** 2 + ((y - ccy) / ry) ** 2
                if r <= 1:
                    put(img, x, y, VOID if r < 0.75 else (VIOLET if pulse > 0.4 else VOID))
        for k in range(10):                         # streams pouring into it
            sx = 40 + k * 5.5
            sy = 40 + 6 * math.sin(k)
            for j in range(30):
                u = j / 30
                x = lerp(sx, ccx, u) + 4 * math.sin(u * 5 + k)
                y = lerp(sy, ccy, u)
                if (j + int(T(b) * 30)) % 5 == 0:
                    put(img, x, y, VOID)
                elif j % 3 == 0:
                    put(img, x, y, (30, 23, 50))

    # orbs
    for L, tx in ORB_LAUNCH:
        a = TAU * (L - 63) / 9 - math.pi / 2
        sx, sy = 64 + math.cos(a) * 26, 25 + math.sin(a) * 18
        if 60 <= b < L:
            orb(img, sx, sy, glow=min(1, (b - 60) / 2))
        elif L <= b < L + 1.5:
            u = (b - L) / 1.5
            end_y = 82 if L == ORB_LAUNCH[-1][0] else ground(tx) - 2
            x, y = lerp(sx, tx, u * u), lerp(sy, end_y, u * u)
            orb(img, x, y)
            for k in (1, 2):
                put(img, lerp(sx, tx, (u - 0.05 * k) ** 2), lerp(sy, end_y, (u - 0.05 * k) ** 2),
                     VIOLET)
    for L in PARRY_ORBS:
        if L - 0.6 <= b < L + 1.5:
            u = max(0.0, (b - L) / 1.5)
            orb(img, 64, lerp(62, 80, u * u), glow=min(1, (b - L + 0.6) / 0.6))
        elif L + 1.5 <= b < L + 3:
            u = (b - L - 1.5) / 1.5
            orb(img, 62 + 2 * u, lerp(80, 40, ease_out(u)))
            put(img, 62, lerp(80, 40, ease_out(u)) + 3, WHITE)

    # void swords
    for wb, gap in SWORD_WAVES:
        r = random.Random(int(wb))
        for x in range(8, 124, 8):
            if abs(x - gap) < 7:
                continue
            delay = r.uniform(0, 0.3)
            gy = ground(x)
            fall0 = wb + delay
            if fall0 <= b < fall0 + 1:
                u = (b - fall0)
                void_sword(img, x, lerp(-8, gy + 1, u * u), seed=x)
            elif fall0 + 1 <= b < fall0 + 2.4:
                diss = max(0.0, (b - fall0 - 1.8) / 0.6)
                void_sword(img, x, gy + 2, dissolve=diss, seed=x)
                if b < fall0 + 1.15:
                    put(img, x - 1, gy - 1, RAMP[8])
                    put(img, x + 1, gy - 1, RAMP[8])

    # ground spikes
    for wb, kind in SPIKE_WAVES:
        for x in range(8, 124, 4):
            if kind == 'lr':
                f = wb + (x - 8) / 112 * 1.5
            elif kind == 'rl':
                f = wb + (120 - x) / 112 * 1.5
            else:
                f = wb + abs(x - 64) / 56 * -0.75 + 0.75
            age = b - f
            if 0 <= age < 1.0:
                hgt = 11 * min(1, age / 0.15) * (1 - max(0.0, (age - 0.65) / 0.35))
                spike(img, x, ground(x) - 1, hgt)

    # the shade's crescent wave along the ground
    if 132 <= b < 133.6:
        u = (b - 132) / 1.5
        for side in (-1, 1):
            wx = 64 + side * u * 60
            for k in range(9):
                yy = ground(wx) - 1 - k
                put(img, wx - side * (k * k) / 12, yy, VOID)
                put(img, wx - side * (k * k) / 12 - side, yy, VIOLET)

    # --- figures -------------------------------------------------------------------------
    # siblings
    for spr, path, dies, appear in SIBLINGS:
        if b < appear or (dies and b >= dies):
            continue
        x, y = path.at(b)
        bobby = vv.bob(lt, 0.37 if spr is vv.SIB_R else 0.0)
        if b > 40:
            bobby = 0
        if b < appear + 1 and appear > 0:
            keep = lambda i, j, f=(b - appear): HASH[j, i] < f
        else:
            keep = None
        blit(img, spr, vv.KEY, x, y + bobby, keep=keep)

    # the great shade
    if b < SHADE_DIES:
        sx, sy = SHADE_PATH.at(b)
        rows = vv.SHADE if b < 24 else SHADE
        hit = any(0 <= since(b, hb) < 0.08 for hb in SHADE_HITS)
        blit(img, rows, vv.KEY, sx, sy, flat=WHITE if hit else None)
        for a in SHADE_ATTACKS:
            age = since(b, a)
            if -0.1 <= age < 0.25:
                fwd = 1 if (SHADE_PATH.at(a + 0.3)[0] > SHADE_PATH.at(a - 0.3)[0]) else -1
                for k in range(30):
                    ang = (0 if fwd > 0 else math.pi) - 0.8 + 1.6 * k / 29
                    for dr in (0, 0.6, 1.2):
                        put(img, sx + 8 + math.cos(ang) * (10 + dr),
                            sy + 10 + math.sin(ang) * (10 + dr),
                            VOID if dr < 1 else VIOLET)

    # Hornet
    if 156 <= b:
        for k in (3, 2, 1):                            # afterimages on her lunges
            pb = b - k * 0.12
            if HORNET_T.at(pb)[2] == 'lunge' and pb >= 156:
                hornet_pixels(img, pb, flat=blend(RAMP[4], RAMP[7], 1 - k / 3))
        hornet_pixels(img, b)
        if 208.5 <= b < 210.6:                         # the thread that flings him
            hx, hy = HORNET_T.at(b)[0], ground(80) - 12
            kx, kh, *_ = KNIGHT.at(b)
            line(img, hx, hy, kx, ground(kx) - kh - 8, blend(THREAD_VOID, THREAD_FREE, 1), 1)

    # the Knight
    pose = KNIGHT.at(b)[2]
    if pose in ('dash', 'rise') or (pose == 'jump' and 210 <= b < 216.5):
        for k in (3, 2, 1):
            knight_pixels(img, b - k * 0.15 * (3 if pose == 'rise' else 1),
                          afterimage=blend(RAMP[4], RAMP[7], 1 - k / 3))
    kx, kfy, kface = knight_pixels(img, b)

    # the final blow
    age = since(b, 216)
    if 0 <= age < 0.6:
        c = WHITE if age < 0.2 else vv.MOTE
        for k in range(90):
            u = k / 89
            x, y = lerp(30, 98, u), lerp(52, 4, u) + 10 * math.sin(math.pi * u)
            w = 2.5 * math.sin(math.pi * u)
            for dw in np.arange(-w, w + 0.1, 0.5):
                put(img, x + dw * 0.6, y + dw, c)

    # sparks at clashes
    for cb, x, y in ((96, 60, 90), (99, 70, 90), (102, 60, 90), (105, 70, 90),
                     (126, 96, 88), (127, 98, 88), (128, 100, 88), (135, 64, 64),
                     (162, 76, 92), (171.7, 52, 90), (180, 53, 92), (183, 61, 92),
                     (186, 67, 92), (189, 73, 92), (195, 100, 92),
                     (87, 64, 76), (88.5, 64, 76), (85.5, 64, 76), (72, 64, 82)):
        sparks(img, x, y, since(b, cb), int(cb * 10))
    for bu in BURSTS:
        bu.draw(img, b)

    # the Void Heart: lying there, then lifted, then taken
    heart = b < 227.4
    if 227.4 <= b < 228.5:
        u = (b - 227.4) / 1.1
        hx, hy = lerp(78, 76, u), lerp(102, 92, ease(u))
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, -1), (0, 1)):
            put(img, hx + dx, hy + dy, VOID if (dx, dy) == (0, 0) else WHITE)

    # ground details and foreground grass
    layer_img, mask = ground_layer(heart)
    img[mask] = layer_img[mask]

    # the title
    if b < 14:
        a = ease((b - 2.5) / 2.5) * (1 - ease((b - 10.5) / 3))
        text(img, 'VOID VIGIL', 112, a)

    # --- camera: shake, flashes, fades -----------------------------------------------------
    amp = 0.0
    for sb, dur, a in SHAKES:
        if sb <= b < sb + dur:
            amp = max(amp, a * (1 - (b - sb) / dur))
    if amp > 0.2:
        r = random.Random(int(t * FPS))
        dx, dy = int(round(r.uniform(-amp, amp))), int(round(r.uniform(-amp, amp)))
        img = np.roll(np.roll(img, dy, 0), dx, 1)
        if dy > 0:
            img[:dy] = RAMP[0]
        elif dy < 0:
            img[dy:] = RAMP[0]
        if dx > 0:
            img[:, :dx] = RAMP[0]
        elif dx < 0:
            img[:, dx:] = RAMP[0]
    f = 0.0
    for fb, dur, a in FLASHES:
        age = since(b, fb)
        if age >= 0:
            f = max(f, a * math.exp(-age / dur))
    if f > 0.01:
        img = (img * (1 - f) + np.array(WHITE) * f).astype(np.uint8)
    fade = 1.0 - ease(t / 2.0)                                # fade in
    fade = max(fade, ease((b - 230.5) / 2.0))                 # fade out
    if fade > 0:
        img = (img * (1 - fade)).astype(np.uint8)
    if b >= 232.5:
        a = ease((t - T(232.5)) / 0.8) * (1 - ease((t - (AUDIO_LEN - 1.0)) / 0.9))
        text(img, 'VOID VIGIL', 60, a)
    return img


def contact_sheet(b0, b1, n=12, path='cutscene_sheet.png'):
    frames = [render_frame(T(b0 + (b1 - b0) * k / (n - 1))) for k in range(n)]
    cols = 4
    rows = (n + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 256 + (cols - 1) * 4, rows * 256 + (rows - 1) * 4), (0, 0, 0))
    for k, f in enumerate(frames):
        im = Image.fromarray(f).resize((256, 256), Image.NEAREST)
        sheet.paste(im, ((k % cols) * 260, (k // cols) * 260))
    sheet.save(path)
    print('wrote', path)


def main():
    if '--sheet' in sys.argv:
        i = sys.argv.index('--sheet')
        b0, b1 = float(sys.argv[i + 1]), float(sys.argv[i + 2])
        out = sys.argv[i + 3] if len(sys.argv) > i + 3 else 'cutscene_sheet.png'
        contact_sheet(b0, b1, path=out)
        return
    out = 'void_vigil_cutscene.mp4'
    n = int(AUDIO_LEN * FPS)
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error',
                           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H),
                           '-r', str(FPS), '-i', '-', '-i', 'shade_finale.mp3',
                           '-vf', 'scale=1024:1024:flags=neighbor',
                           '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16',
                           '-preset', 'medium', '-c:a', 'aac', '-b:a', '256k',
                           '-shortest', out], stdin=subprocess.PIPE)
    for k in range(n):
        ff.stdin.write(render_frame(k / FPS).tobytes())
        if k % (FPS * 10) == 0:
            print('  %3d s' % (k // FPS), flush=True)
    ff.stdin.close()
    ff.wait()
    print('wrote', out)


if __name__ == '__main__':
    main()
