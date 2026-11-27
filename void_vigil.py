#!/usr/bin/env python3
"""
void_vigil.py - finishes a 128x128 pixel-art Hollow Knight fan piece.

The composition and the figures are the artist's own block-in: the Knight, seen
from behind on a dark mound with the nail raised, a horned shade of void rising
out of it, and two siblings drifting in purple light that falls from above.
Their silhouettes are kept pixel for pixel; this program builds the world
around them and brings it to life as a seamless loop.

The story: the Knight has lost the Void Heart (it lies cracked on the mound)
and with it control of the void.  The Radiance, consumed by that void, looms
behind everything, eclipsing her own light; void drips from her tattered wings
and frayed gown and pours down in threads into the shades.

Everything is drawn on a fixed palette.  The background is painted as a value
on a purple ramp and ordered-dithered onto it; figures are placed pixel by
pixel from hand-drawn sprites.

Usage:  python3 void_vigil.py [out.png]
Writes  out.png, out_x8.png          still (frame 0), native and 8x
        out.gif, out_x4.gif          the animated loop, native and 4x
"""
import math
import random
import sys

import numpy as np
from PIL import Image

W = H = 128
FRAMES = 48
FRAME_MS = 100
TAU = 2 * math.pi

# --- palette -----------------------------------------------------------------
RAMP = [  # dark -> light; the whole world lives on this ramp
    (7, 6, 14), (13, 12, 25), (20, 18, 36), (27, 23, 47), (34, 29, 58),
    (42, 35, 70), (50, 42, 82), (58, 49, 95), (67, 58, 107), (78, 68, 121),
    (92, 82, 137), (110, 101, 156), (134, 127, 180), (164, 160, 206),
    (192, 196, 232), (224, 232, 250),
]
RAMP_ARR = np.array(RAMP, dtype=np.uint8)
TOP = len(RAMP) - 1

VOID = (6, 5, 10)
VOID_HI = (26, 20, 40)        # sheen on the void
VOID_RIM = (40, 32, 66)       # light from above catching the void's top edges
EYE = (236, 236, 248)
EYE_DIM = (188, 186, 210)
MASK = (238, 236, 246)
MASK2 = (204, 200, 226)
MASK3 = (156, 150, 186)
MASK4 = (104, 98, 138)
CLOAK_HI = (84, 82, 128)
CLOAK = (46, 44, 80)
CLOAK_LO = (24, 22, 42)
NAIL_HI = (226, 228, 240)
NAIL = (160, 162, 184)
NAIL_LO = (92, 92, 116)
HANDLE = (60, 46, 52)
MOTE = (176, 168, 226)
MOTE_HI = (240, 238, 255)
SHELL_HI = (132, 126, 164)    # fallen masks on the mound
SHELL = (90, 84, 120)
SHELL_LO = (58, 53, 84)
SHELL_HOLE = (14, 12, 24)

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6],
                  [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0
BAYER_T = np.tile(BAYER, (H // 4, W // 4))

YY, XX = np.mgrid[0:H, 0:W].astype(float)

# layer ids in the background, used to decide how much light/fog reaches a pixel
SKY, FAR, MID, NEAR, CHAIN, ROCK, GROUND = range(7)
BEAM_REACH = np.array([1.0, 0.8, 0.55, 0.3, 0.35, 0.0, 0.0])
FOG_REACH = np.array([1.0, 0.9, 0.7, 0.45, 0.6, 0.0, 0.0])


def smooth(a, b, x):
    t = np.clip((np.asarray(x, dtype=float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --- the static world, as a value field ----------------------------------------
def sky_field():
    x, y = XX, YY
    v = 8.4 - y * 0.062                              # light from above
    d = np.hypot((x - 64) / 1.5, y + 6)
    v += 3.4 * np.exp(-(d / 24.0) ** 2)              # the opening overhead
    v += 1.5 * np.exp(-(((x - 64.5) / 16) ** 2 + ((y - 92) / 11) ** 2))  # around the Knight
    v += 1.3 * np.exp(-((y - 101) / 6.0) ** 2)       # haze over the mound
    r = np.hypot((x - 64) / 64, (y - 58) / 70)
    v -= 3.2 * smooth(0.5, 1.25, r)                  # vignette
    return v


BEAMS = [  # angle from the opening, strength, width, shimmer phase
    (-0.44, 0.8, 0.040, 0.0), (-0.20, 1.1, 0.050, 0.3), (0.00, 1.5, 0.060, 0.55),
    (0.06, 0.9, 0.025, 0.1), (0.26, 1.0, 0.045, 0.75), (0.50, 0.6, 0.035, 0.4),
]


def beam_field(t):
    ang = np.arctan2(XX - 64, YY + 18)
    fade = 1 - smooth(16, 104, YY)
    v = np.zeros((H, W))
    for a0, s, w, ph in BEAMS:
        s = 1.35 * s * (1 + 0.2 * math.sin(TAU * (t + ph)))
        v += s * np.exp(-((ang - a0) / w) ** 2)
    return v * fade


def fog_field(t):
    """Drifting fog banks; every component makes whole turns, so it loops."""
    x, y = XX, YY
    n = np.zeros((H, W))
    for m, k, ph, a in ((3, 1, 0.2, 0.5), (5, -1, 1.7, 0.35), (7, 1, 3.1, 0.25),
                        (4, -1, 4.4, 0.3)):
        n += a * np.sin(TAU * (m * x / W + k * t) + ph + 0.06 * y)
    n = 0.5 + 0.5 * n / 1.4
    low = np.exp(-((y - 100) / 7.0) ** 2) * 1.2        # bank around the mound
    mid = np.exp(-((y - 70) / 9.0) ** 2) * 0.7 * smooth(18, 40, np.abs(x - 64))
    return (low + mid) * n


# --- the voided Radiance, looming behind everything ------------------------------
# Drawn after the reference the artist supplied: three tall thin spikes on a
# small crown, a great fluffy mass of fur with two small eyes set together in
# a heart, a fan of long curved feathers on each side whose tips lift at the
# ends, and a long dagger-like body of three blades pointing straight down.
# Voided, her pale grey body is void and the old outlines become faint light;
# her golden eyes burn void-white, and the sun-disc behind her is eclipsed.
#
# She is built on her own small grid (61 wide, centre column 30) and placed
# with that grid's column 0 at x = RAD_X, row 0 at y = 0.
RAD_X = 34
RAD_CX = 30
HEAD = (64.0, 18.0)
DISC = (64.0, 25.0, 24.0)            # centre x, y, radius of the halo disc

# half width of her fur, row by row (rows 15..39), and where it sticks out
FUR = {15: 4, 16: 5, 17: 7, 18: 8, 19: 9, 20: 10, 21: 11, 22: 13, 23: 14, 24: 14,
       25: 14, 26: 13, 27: 12, 28: 11, 29: 10, 30: 9, 31: 8, 32: 7, 33: 6, 34: 5,
       35: 5, 36: 4, 37: 4, 38: 4, 39: 3}
FUR_TUFTS = {16: 1, 18: 1, 20: 2, 21: 1, 23: 1, 26: 1, 28: 1, 30: 1, 32: 1, 34: 1,
             36: 1, 38: 1, 39: 1}
# feathers of the left wing: root, bend, tip, width at the root (drawn from
# the lowest up, so each lies over the one beneath it, as in the reference)
FEATHERS = [((24, 35), (21, 38.5), (16, 40.5), 1.3),
            ((23, 34), (17, 38.5), (10, 40.0), 1.7),
            ((22, 32), (14, 36.0), (4, 36.5), 2.0),
            ((22, 30), (12, 33.5), (1, 33.0), 2.1),
            ((21, 28), (11, 30.5), (1, 29.5), 2.1),
            ((21, 26), (10, 27.5), (0, 26.0), 2.1),
            ((21, 24), (10, 24.5), (1, 21.5), 1.9)]
# the head: a crown band and three spikes, the middle one far taller
SPIKES = [((30, 14), (30, 7), (30, 0.6), 1.3),
          ((27, 14), (25.5, 10), (24.2, 5.6), 1.1)]


def _bez(p0, p1, p2, u):
    return ((1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0],
            (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1])


def radiance_sprite(t, lift_amp=0.9):
    """Her silhouette on her own grid: 'B' void body, 'F' feather, 'l' a line
    of faint light (the reference's outlines, inverted).  Wings lift with t."""
    gh, gw = 64, 2 * RAD_CX + 1
    g = [['.'] * gw for _ in range(gh)]

    def put(c, r, ch, only_empty=False):
        c, r = int(round(c)), int(round(r))
        if 0 <= r < gh and 0 <= c < gw and (not only_empty or g[r][c] == '.'):
            g[r][c] = ch

    lift = lift_amp * math.sin(TAU * t)
    # feathers, lowest first; each one's upper edge is a line of light
    for k, (p0, p1, p2, w0) in enumerate(FEATHERS):
        sway = lift * (0.4 + 0.12 * k)
        p1 = (p1[0], p1[1] - sway * 0.6)
        p2 = (p2[0], p2[1] - sway)
        cells = set()
        n = 60
        for i in range(n + 1):
            u = i / n
            x, y = _bez(p0, p1, p2, u)
            w = w0 * (1 - u) ** 0.8 + 0.35
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    if dx * dx + dy * dy <= w * w:
                        cells.add((int(round(x + dx)), int(round(y + dy))))
        for c, r in cells:
            put(c, r, 'F')
        for c, r in cells:
            if (c, r - 1) not in cells and c < 21:
                put(c, r, 'l')
    # the fur, with tufts sticking out of its edge and a few strokes inside
    for r, half in FUR.items():
        half += FUR_TUFTS.get(r, 0) * ((r * 7) % 3 == 0)
        for c in range(RAD_CX - half, RAD_CX + 1):
            put(c, r, 'B')
    for r, c in ((25, 20), (26, 21), (31, 24), (32, 25), (36, 27), (37, 28)):
        put(c, r, 'l')                        # a few strokes of fur
    for c in (26, 28, 30):                     # ragged bottom edge of the fur
        put(c, 40, 'B')
    # crown band and spikes
    for c in range(25, RAD_CX + 1):
        put(c, 14, 'B')
    put(25, 13, 'B')
    for p0, p1, p2, w0 in SPIKES:
        for i in range(41):
            u = i / 40
            x, y = _bez(p0, p1, p2, u)
            w = w0 * (1 - u) + 0.3
            for dx in (-1, 0, 1):
                if abs(dx) <= w:
                    put(x + dx, y, 'B')
    for r in range(8, 14):                     # light down the tall spike's edge
        put(29, r, 'l')
    # the blade body: two outer blades around a slit, joining, then a long point
    for r in range(40, 47):
        inset = (r >= 44) + (r >= 46)
        for c in range(26 + inset, 30):
            put(c, r, 'B')
        if r < 46:
            put(RAD_CX, r, '.')
    for r in range(46, 51):
        for c in range(27 + (r >= 49), RAD_CX + 1):
            put(c, r, 'B')
    for r in range(51, 58):
        put(29, r, 'B')
        put(30, r, 'B')
    for r in range(58, 63):
        put(30, r, 'B')
    for r in range(41, 56):                    # a glint of light down the blades
        put(27 if r < 46 else 29, r, 'l')
    # mirror the left half onto the right
    for r in range(gh):
        for c in range(RAD_CX):
            g[r][2 * RAD_CX - c] = g[r][c]
    return g


RAD_VALUE = {'B': 0.8, 'F': 2.4, 'l': 6.6}


def radiance_field(t, lift_amp=0.9):
    """Density D and her own value R, placed in the scene."""
    D = np.zeros((H, W))
    R = np.zeros((H, W))
    g = radiance_sprite(t, lift_amp)
    for r, row in enumerate(g):
        for c, ch in enumerate(row):
            if ch != '.':
                x, y = RAD_X + c, r
                if 0 <= x < W and 0 <= y < H:
                    D[y, x] = 1.0
                    R[y, x] = RAD_VALUE[ch]
    return D, R


def halo(t):
    """Her great disc of light, eclipsed: a dark sun with a burning rim."""
    cx, cy, rad = DISC
    d = np.hypot(XX - cx, YY - cy)
    flicker = 1 + 0.12 * math.sin(TAU * 2 * t)
    rim = 5.0 * flicker * np.exp(-((d - rad) / 1.3) ** 2)
    outer = 2.4 * flicker * np.exp(-np.clip(d - rad, 0, None) / 7.0) * (d > rad)
    inner = -1.3 * smooth(rad - 2, rad - 9, d)          # the eclipsed face of the disc
    return rim + outer + inner


# her eyes: two small eyes set together in a heart, now burning void-white
RAD_EYES = [(RAD_X + c, r) for c, r in
            ((27, 17), (28, 17), (32, 17), (33, 17),
             (27, 18), (28, 18), (29, 18), (31, 18), (32, 18), (33, 18),
             (28, 19), (29, 19), (30, 19), (31, 19), (32, 19),
             (30, 20))]
HER_REACH = np.array([1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0])   # behind the near city


def spire_top(x, xs, peak, width):
    dx = abs(x - xs)
    if dx > width:
        return None
    if dx < 0.6:
        return peak
    dome_top = peak + 6
    return dome_top + (width - math.sqrt(max(width ** 2 - dx ** 2, 0))) * 1.4 \
        - 3 * (1 - dx / width) ** 3


def build_world():
    rnd = random.Random(7)
    sky = sky_field()
    val = sky.copy()
    layer = np.full((H, W), SKY)

    def darken(x, y, amount, lid):
        if 0 <= x < W and 0 <= y < H and layer[y, x] <= lid:
            val[y, x] = sky[y, x] - amount
            layer[y, x] = lid

    # three layers of Hallownest spires, each sinking into the haze below
    faint = [(10, 18, 3), (26, 34, 2), (40, 50, 2), (88, 48, 2), (101, 30, 2), (118, 14, 3)]
    far = [(6, 30, 4), (15, 40, 3), (22, 24, 5), (31, 46, 3), (99, 44, 3),
           (106, 26, 5), (114, 36, 4), (122, 20, 4)]
    near = [(2, 44, 6), (12, 58, 4), (116, 52, 5), (126, 40, 6), (108, 66, 3)]
    for lid, dark, towers in ((FAR, 0.8, faint), (MID, 1.6, far), (NEAR, 3.0, near)):
        for xs, peak, wdt in towers:
            for x in range(max(0, xs - wdt - 1), min(W, xs + wdt + 2)):
                top = spire_top(x, xs, peak, wdt)
                if top is None:
                    continue
                for y in range(int(round(top)), H):
                    darken(x, y, dark * (1 - 0.85 * smooth(70, 104, y)), lid)
            for y in range(peak - 6 - (lid == NEAR) * 2, peak):     # needle
                darken(xs, y, dark, lid)
            if wdt >= 4:                                            # windows
                for wy in range(peak + 12, H - 20, 9):
                    lit = rnd.random() < 0.18
                    for yy in range(wy, wy + 4):
                        for xx in ((xs - 1, xs + 1) if wdt >= 5 else (xs,)):
                            if lit:
                                val[yy, xx] = sky[yy, xx] + 1.3
                            else:
                                val[yy, xx] = sky[yy, xx] - dark - 1.0
                    if lit:                                         # arched top
                        for xx in ((xs - 1, xs + 1) if wdt >= 5 else (xs,)):
                            val[wy - 1, xx] = sky[wy - 1, xx] + 0.6
    for x0, x1, yb in ((6, 22, 62), (99, 114, 70), (106, 122, 50)):   # walkways
        for x in range(x0, x1 + 1):
            darken(x, yb, 1.6, MID)
            darken(x, yb + 1, 1.6, MID)
            if (x - x0) % 4 == 2:
                darken(x, yb + 2, 1.6, MID)

    # cavern rock overhanging the top corners, lit on its inner lip
    for x in range(W):
        side = x if x < 64 else W - 1 - x
        depth = 17 * max(0.0, 1 - side / 34) ** 1.6
        depth += 2.2 * max(0.0, math.sin(x * 1.31) * math.sin(x * 0.53)) * (depth > 0.5)
        bottom = int(round(depth))
        for y in range(0, bottom):
            val[y, x] = 0.7 + 0.3 * (y == bottom - 1)
            layer[y, x] = ROCK
        if bottom > 0:
            val[bottom - 1, x] = 2.2 + 1.2 * (1 - side / 34)

    # chains hanging from the dark above, link by link
    for cx, length in ((27, 38), (36, 22), (93, 30), (101, 16)):
        for y in range(0, length):
            x = cx + (1 if y % 4 == 1 else 0)
            darken(x, y, 2.4, CHAIN)
            if y % 4 == 3:
                darken(cx + 1, y, 1.8, CHAIN)
        for y in (length, length + 1):
            darken(cx, y, 3.0, CHAIN)
        darken(cx - 1, length + 1, 3.0, CHAIN)
        darken(cx + 1, length + 1, 3.0, CHAIN)

    # the mound
    gtop = np.zeros(W, dtype=int)
    for x in range(W):
        dx = x - 64.5
        gtop[x] = int(round(103.2 + 0.0028 * dx * dx
                            + 0.6 * math.sin(x * 0.45) * float(smooth(8, 30, abs(dx)))))
    for x in range(W):
        pool = math.exp(-((x - 64.5) / 16) ** 2)       # where the light lands
        for y in range(gtop[x], H):
            depth = y - gtop[x]
            v = 1.2 - depth * 0.05 + 1.6 * pool * math.exp(-depth / 4)
            # strata of old shell, following the curve of the mound
            if (depth + int(abs(x - 64.5) * 0.18)) % 6 == 2 and depth > 2:
                v += 0.45 * math.exp(-depth / 14)
            val[y, x] = max(v, 0.35)
            layer[y, x] = GROUND
        lit = math.exp(-((x - 64.5) / 30) ** 2)
        val[gtop[x], x] = 3.6 + 3.6 * lit
        if gtop[x] + 1 < H:
            val[gtop[x] + 1, x] = 1.8 + 2.4 * lit
    # the Knight's shadow, thrown toward us by the light ahead of it
    for y in range(104, 109):
        half = 5.5 - (y - 104) * 0.8
        for x in range(int(64.5 - half), int(64.5 + half) + 1):
            if layer[y, x] == GROUND and y > gtop[x]:
                val[y, x] -= 1.3
    return val, layer, gtop


def quantize(val):
    idx = np.floor(val + (BAYER_T - 0.47) * 0.95 + 0.5).astype(int)
    return RAMP_ARR[np.clip(idx, 0, TOP)].copy()


# --- drawing helpers -------------------------------------------------------------
class Canvas:
    def __init__(self, img):
        self.img = img
        self.void = np.zeros((H, W), dtype=bool)   # pixels that are void matter
        self.overlay = []                           # eyes and loose specks, laid on top

    def put(self, x, y, c):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < H:
            self.img[y, x] = c

    def putv(self, x, y, c=VOID):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < H:
            self.img[y, x] = c
            self.void[y, x] = True

    def sprite(self, x0, y0, rows, key):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch in ('.', ' '):
                    continue
                c = key[ch]
                if c == 'speck':
                    self.overlay.append((x0 + i, y0 + j, VOID))
                elif c == VOID or c == VOID_HI:
                    self.putv(x0 + i, y0 + j, c)
                elif c in (EYE, EYE_DIM):
                    self.putv(x0 + i, y0 + j)           # part of the void body
                    self.overlay.append((x0 + i, y0 + j, c))
                else:
                    self.put(x0 + i, y0 + j, c)

    def rim_light(self, region):
        """Top edges of void matter catch the light from above (inside the
        silhouette only, so the shapes do not change)."""
        x0, y0, x1, y1 = region
        v = self.void
        for y in range(max(y0, 1), y1):
            for x in range(x0, x1):
                if v[y, x] and not v[y - 1, x] and v[y + 1, x] \
                        and tuple(self.img[y, x]) == VOID:
                    self.img[y, x] = VOID_RIM


# --- the figures (from the artist's block-in) ----------------------------------------
KEY = {'K': VOID, 'k': VOID_HI, 'E': EYE, 'e': EYE_DIM,
       'W': MASK, 'w': MASK2, 'm': MASK3, 'd': MASK4,
       'C': CLOAK_HI, 'c': CLOAK, 'o': CLOAK_LO,
       'N': NAIL_HI, 'n': NAIL, 'q': NAIL_LO, 'h': HANDLE,
       'x': 'speck'}

# The shade rising out of the Knight: horns curving in like a crescent, two
# small eyes set close, and a narrow body running straight down between the
# Knight's horns.  Origin (56, 65).  K void, k sheen, E eye, x loose speck.
SHADE = [
    ".....K.....K.....",   # 65
    "....K.......K....",   # 66
    "...KK...x...KK...",   # 67
    "...KK.......KK...",   # 68
    "...KKK.....KKK...",   # 69
    "...KKKKKKKKKKK...",   # 70
    "....KkkKKKKKK....",   # 71
    ".....KEEKEEK.....",   # 72
    ".....KEKKKEK.....",   # 73
    ".....KKKKKKK.....",   # 74
    "......KKKKK...xx.",   # 75
    "......KKKKK....x.",   # 76
    "..x...KKKKK......",   # 77
    ".....KKKKKKK.x...",   # 78
    ".....KKKKKKK.....",   # 79
    ".....KKKKKKK.....",   # 80
    ".....KKKKKKK..x..",   # 81
    ".....KKKKKKK.....",   # 82
    ".....KKKKKKK.....",   # 83
    ".......KKKK......",   # 84  between the Knight's horns
    "......KK.KKK.....",   # 85
    "......K....K.....",   # 86
]

# The two siblings.  The left one is tilted, leaning away with its legs
# trailing; the right one floats upright.  'e' = dim eye.
SIB_L = [                  # origin (38, 63)
    ".........KKK......",
    "......K...KK..x...",
    ".....KK.KKKKK.....",
    ".....KKKKKeeK.....",
    "......KeKKKeK.....",
    ".......KeKKKK.....",
    "........KKKKKK.x..",
    "..........KKKK....",
    "..x.......KKKKK...",
    "...........KKKKK..",
    "........x..KKKKK..",
    "..........KKK.K.K.",
    "..........KKK.K...",
    ".........K..K.....",
    "..................",
    "..................",
    "............x.....",
]
SIB_R = [                  # origin (85, 59)
    "...KK..KK...",
    "..K.KKKK.K..",
    "....eKeK....",
    "....KKKK....",
    "....KKK..x..",
    "....KKK.....",
    "..x.KKKK....",
    "....KKKK....",
    "....KKKK....",
    "....K.K.K...",
]
SIB_TINY = [
    "K..K",
    "KKKK",
    "eKKe",
    ".KK.",
]

# The Knight, seen from behind, looking up at the shade.  Origin (56, 84).
KNIGHT = [
    ".....Ww....Ww....",   # 84  horn tips
    "....Ww......Wm...",   # 85
    "....Ww......Wm...",   # 86
    "....Ww......Wm...",   # 87
    ".....WWWWWwwm....",   # 88  back of the mask, lit from above
    ".....Wwwwwwwm....",   # 89
    "......Wwwwwm.....",   # 90
    "......wwwmmd.....",   # 91
    "...CCcmmmddd.....",   # 92  collar
    ".....CCcccccooo..",   # 93
    "...CCCcccccoo....",   # 94
    "..KKCCcccccooo...",   # 95  hand on the hilt
    ".KCCCccccccoooo..",   # 96
    "....CcoKKKK.oo...",   # 97  hem, legs showing
    "......lKKKK...o..",   # 98
    "......lKKKKK.....",   # 99
    "......lKKKKK.....",   # 100
    "......lK..KKK....",   # 101
    "......lK...KK....",   # 102
    "............K....",   # 103
]
KNIGHT_KEY = dict(KEY)
KNIGHT_KEY['l'] = (30, 30, 38)        # the far leg, in shadow
# The light is in front of the Knight, so the back of the mask sits in shadow
# with bright rims; the cloak is the artist's deep purple.
KNIGHT_KEY.update({'W': (206, 200, 228), 'w': (150, 142, 178), 'm': (120, 110, 150),
                   'd': (92, 82, 124), 'C': (72, 60, 112), 'c': (36, 25, 64),
                   'o': (22, 15, 40)})

# Cracked vessel masks lying in the Abyss.  a lit rim, b shell, c shade, K hole.
SHELL_KEY = {'a': SHELL_HI, 'b': SHELL, 'c': SHELL_LO, 'K': SHELL_HOLE}
SHELL_UPRIGHT = [          # half buried, facing us
    "a...a",
    "ab.bc",
    "abbbc",
    "bKbKc",
]
SHELL_TILTED = [           # fallen on its side
    "..aab.",
    "aabbbc",
    "bKbKbc",
    ".cccc.",
]
SHELL_SMALL = [
    "a.a",
    "bbc",
    "KbK",
]
# A great cracked mask in the foreground, half sunk and tilted.
BIG_SHELL_KEY = {'a': (112, 106, 148), 'b': (72, 67, 102), 'c': (44, 40, 68),
                 'K': (9, 8, 17)}
BIG_SHELL = [
    ".a..........",
    ".ab.......a.",
    ".ab......ab.",
    ".abb....abb.",
    ".abbbKbbbbbc",
    "abbbbbKbbbbc",
    "abKKKbbKKKbc",
    "abKKKbbKKKbc",
    "abbKKbbbKKcc",
    ".bbbbbbbbcc.",
    "..cccccccc..",
]


# The Void Heart the Knight has lost: cracked, lying on the mound.
VOID_HEART_KEY = {'a': (176, 172, 214), 'b': (110, 104, 150), 'K': VOID, 'k': (34, 26, 56)}
VOID_HEART = [
    ".a.b.",
    "aKaKb",
    "aKkK.",
    ".bKb.",
    "..b..",
]


def bob(t, phase, amp=1.2):
    return int(round(amp * math.sin(TAU * (t + phase))))


def draw_distant_siblings(cv, t):
    """Faint siblings lost in the haze, for depth."""
    rnd = random.Random(5)
    far = (30, 24, 50)
    for n, (x0, y0, tail) in enumerate(((20, 44, 1), (104, 38, -1), (30, 24, 1),
                                        (112, 82, -1), (8, 70, 1))):
        y0 += bob(t, n * 0.21, 1.0)
        for j, row in enumerate(SIB_TINY):
            for i, ch in enumerate(row):
                if ch == 'K':
                    cv.put(x0 + i, y0 + j, far)
                elif ch == 'e':
                    cv.put(x0 + i, y0 + j, RAMP[10])
        for k in range(4):
            if rnd.random() < 0.8:
                cv.put(x0 + 1 + (k // 2) * tail, y0 + 4 + k, far)


def draw_shade(cv):
    cv.sprite(56, 65, SHADE, KEY)


def draw_siblings(cv, t):
    cv.sprite(38, 63 + bob(t, 0.0), SIB_L, KEY)
    cv.sprite(85, 59 + bob(t, 0.37), SIB_R, KEY)


def draw_knight(cv):
    cv.sprite(56, 84, KNIGHT, KNIGHT_KEY)
    # the nail, raised up-left from the hand: lit lower edge, darker upper edge
    for x, y, c in ((52, 91, NAIL_HI),
                    (53, 92, NAIL_HI), (54, 92, NAIL),
                    (54, 93, NAIL_HI), (55, 93, NAIL),
                    (55, 94, NAIL_HI), (56, 94, NAIL_LO),
                    (56, 95, NAIL_LO), (57, 95, HANDLE)):
        cv.put(x, y, c)


def draw_ground_detail(cv, gtop, heart=True):
    rnd = random.Random(12)
    # grass and thorn tufts along the mound's lit edge
    for x in range(2, W - 2):
        g = gtop[x]
        r = rnd.random()
        if abs(x - 64.5) < 9:
            continue                      # keep the Knight's footing clean
        if r < 0.22:
            h = rnd.choice((1, 2, 2, 3))
            lean = rnd.choice((-1, 0, 0, 1))
            for k in range(1, h + 1):
                xx = x + (lean if k == h else 0)
                cv.put(xx, g - k, RAMP[2] if k < h else RAMP[4])
    # discarded vessels: masks half sunk in the mound
    for spr, x, sink in ((SHELL_UPRIGHT, 22, 1), (SHELL_TILTED, 99, 1),
                         (SHELL_SMALL, 41, 1), (SHELL_SMALL, 84, 1)):
        h = len(spr)
        base = max(gtop[x + k] for k in range(len(spr[0])))
        cv.sprite(x, base - h + 1 + sink, spr, SHELL_KEY)
    # the great mask in the foreground, and a nail planted as a grave marker
    for y in range(101, 121):
        x = 110 + (1 if y > 112 else 0)
        cv.put(x, y, (44, 40, 66))
        cv.put(x + 1, y, (22, 20, 36))
    cv.put(110, 100, (120, 116, 156))                # its pommel catching light
    cv.put(110, 101, (96, 92, 128))
    for x in range(108, 114):                        # crossguard
        cv.put(x, 104, (60, 56, 86) if x < 111 else (30, 27, 46))
    # a few stones half sunk in the dark
    for x, dy, c in ((30, 3, RAMP[5]), (31, 3, RAMP[4]), (95, 5, RAMP[5]),
                     (46, 2, RAMP[4]), (18, 6, RAMP[3]), (110, 5, RAMP[3])):
        cv.put(x, gtop[x] + dy, c)
    # the lost Void Heart, cracked, a few steps from the Knight
    if heart:
        cv.sprite(76, gtop[78] - 3, VOID_HEART, VOID_HEART_KEY)
    cv.put(80, gtop[80], (70, 64, 100))            # a chip broken off it
    # small pale flowers near the Knight's feet
    for x, c in ((52, MOTE), (54, RAMP[12]), (86, RAMP[12])):
        g = gtop[x]
        cv.put(x, g - 1, RAMP[3])
        cv.put(x, g - 2, c)


def draw_foreground(cv):
    """Near-black grass framing the bottom corners."""
    rnd = random.Random(13)
    dark = RAMP[0]
    blades = []
    for side in (-1, 1):
        for k in range(26):
            base_x = (2 + k * 1.6) if side < 0 else (125 - k * 1.6)
            h = max(4, 26 - k * 0.95 + rnd.uniform(-4, 4))
            lean = rnd.uniform(0.15, 0.6) * (-side) * rnd.choice((1, 1, -0.5))
            blades.append((base_x, h, lean))
    for bx, h, lean in blades:
        for s in range(int(h)):
            f = s / h
            x = bx + lean * s + 1.8 * f * f * (1 if lean > 0 else -1)
            y = H - 1 - s
            w = 1.6 * (1 - f) + 0.4
            for dx in range(int(-w), int(w) + 1):
                cv.put(int(x + dx), y, dark)
    # the great mask, sitting among the grass with a few blades in front
    cv.sprite(13, 112, BIG_SHELL, BIG_SHELL_KEY)
    for bx, h in ((15.5, 7), (25.5, 10)):
        for s in range(h):
            cv.put(int(bx + 0.25 * s), H - 1 - s - 4, dark)
            if s < h * 0.5:
                cv.put(int(bx + 0.25 * s) + 1, H - 1 - s - 4, dark)
    for bx, h, lean in blades[::5]:       # a lit edge on a few blade tips
        s = int(h) - 1
        cv.put(int(bx + lean * s + 1.8 * (1 if lean > 0 else -1)), H - 1 - s, RAMP[3])


# --- things that move -----------------------------------------------------------------
_rm = random.Random(11)
MOTES = [dict(x=_rm.uniform(2, 126), y=_rm.uniform(-4, 92), fall=_rm.uniform(10, 22),
              sway=_rm.uniform(0.5, 1.8), ph=_rm.random(), ph2=_rm.random(),
              big=_rm.random() < 0.18, peak=_rm.uniform(0.6, 1.0))
         for _ in range(54)]
SPARKLES = [(38, 30, 0.0), (91, 22, 0.4), (77, 48, 0.7), (21, 58, 0.2),
            (106, 60, 0.55), (52, 42, 0.85)]
_rv = random.Random(21)
DRIPS = []    # void dripping from the Radiance's wings and frayed gown
for x0, y0 in ((35, 24), (35, 28), (37, 34), (39, 38), (45, 42), (52, 42), (62, 46),
               (66, 46), (76, 42), (83, 42), (89, 38), (91, 34), (93, 28), (93, 24)):
    DRIPS.append(dict(x=x0 + _rv.uniform(-1.5, 1.5), y=y0, fall=_rv.uniform(8, 16),
                      ph=_rv.random(), sway=_rv.uniform(0.2, 0.8), ph2=_rv.random()))
# threads of void pouring from her into the shade and the siblings
THREADS = [((64.0, 63.0), (64.0, 64.5), (64.0, 66.0), 0.0),
           ((45.0, 41.0), (44.0, 52.0), (47.5, 61.0), 1),
           ((83.0, 41.0), (87.0, 50.0), (90.5, 57.5), 2)]


def _bezier(p0, p1, p2, u):
    a = (1 - u) ** 2
    b = 2 * (1 - u) * u
    c = u ** 2
    return a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]


def draw_motes(cv, t):
    for m in MOTES:
        u = (t + m['ph']) % 1.0
        x = m['x'] + m['sway'] * math.sin(TAU * (u + m['ph2']))
        y = m['y'] + m['fall'] * u
        b = math.sin(math.pi * u) * m['peak']
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < W and 0 <= yi < 100) or cv.void[yi, xi]:
            continue
        if b > 0.72:
            cv.put(xi, yi, MOTE_HI)
            if m['big']:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    cv.put(xi + dx, yi + dy, RAMP[11])
        elif b > 0.45:
            cv.put(xi, yi, MOTE)
        elif b > 0.2:
            cv.put(xi, yi, RAMP[11])
    for x, y, ph in SPARKLES:            # twinkling
        b = 0.5 + 0.5 * math.sin(TAU * (2 * t + ph))
        if b > 0.25:
            cv.put(x, y, MOTE_HI if b > 0.6 else MOTE)
        if b > 0.6:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                cv.put(x + dx, y + dy, RAMP[11])
            if b > 0.9:
                for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                    cv.put(x + dx, y + dy, RAMP[10])


def draw_drips(cv, t):
    for d in DRIPS:
        u = (t + d['ph']) % 1.0
        x = d['x'] + d['sway'] * math.sin(TAU * (u + d['ph2']))
        y = d['y'] + d['fall'] * u * u
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < W and 0 <= yi < H) or cv.void[yi, xi] or u < 0.06:
            continue
        cv.put(xi, yi, VOID if u < 0.55 else ((24, 18, 40) if u < 0.8 else (40, 33, 64)))


def draw_threads(cv, t):
    """Thin streams of void, with beads of it flowing down into her shades."""
    for p0, p1, p2, who in THREADS:
        dy = bob(t, 0.0) if who == 1 else (bob(t, 0.37) if who == 2 else 0)
        p2 = (p2[0], p2[1] + dy)
        n = 28
        for k in range(n + 1):
            u = k / n
            x, y = _bezier(p0, p1, p2, u)
            xi, yi = int(round(x)), int(round(y))
            if 0 <= xi < W and 0 <= yi < H and not cv.void[yi, xi] \
                    and (xi * 7 + yi * 3) % 5 != 0:
                cv.put(xi, yi, (30, 23, 50))
        for b in range(3):                  # beads travelling down
            u = (t * 2 + b / 3 + who * 0.13) % 1.0
            x, y = _bezier(p0, p1, p2, u)
            cv.put(x, y, VOID)


# --- one frame --------------------------------------------------------------------
WORLD = None


def render(t):
    global WORLD
    if WORLD is None:
        WORLD = build_world()
    val, layer, gtop = WORLD
    beams = beam_field(t) * BEAM_REACH[layer]
    # the sky behind her: her eclipsed disc, and the beams escaping around her
    v = val + halo(t) * HER_REACH[layer] + beams
    D, R = radiance_field(t)
    D = D * HER_REACH[layer]
    v = v * (1 - D) + (R + 0.12 * beams) * D
    # her outline catches the light of the disc behind her
    solid = D > 0.55
    around = (np.roll(solid, 1, 0) & np.roll(solid, -1, 0)
              & np.roll(solid, 1, 1) & np.roll(solid, -1, 1))
    edge = solid & ~around
    dist = np.hypot(XX - DISC[0], YY - DISC[1])
    glow = 3.0 * np.exp(-((dist - DISC[2]) / 6.0) ** 2) + 1.0
    v = np.where(edge, v + glow, v)
    v = v + fog_field(t) * FOG_REACH[layer]
    cv = Canvas(quantize(v))
    # her eyes, pulsing
    pulse = 0.5 + 0.5 * math.sin(TAU * t)
    for x, y in RAD_EYES:
        top = y <= 18
        if pulse > 0.45:
            c = (242, 242, 252) if top else (210, 208, 236)
        else:
            c = (210, 208, 238) if top else (172, 168, 212)
        cv.put(x, y, c)
    draw_distant_siblings(cv, t)
    draw_threads(cv, t)
    draw_shade(cv)
    draw_siblings(cv, t)
    cv.rim_light((30, 55, 100, 90))
    draw_motes(cv, t)
    draw_drips(cv, t)
    for x, y, c in cv.overlay:
        cv.put(x, y, c)
    draw_knight(cv)
    draw_ground_detail(cv, gtop)
    # a glint passing over the lost Void Heart
    g = (t * 2) % 1.0
    if g < 0.18:
        gx, gy = 77, gtop[78] - 3
        cv.put(gx, gy, MOTE_HI)
        if g < 0.1:
            for dx, dy in ((1, 0), (-1, 0), (0, -1)):
                cv.put(gx + dx, gy + dy, RAMP[12])
    draw_foreground(cv)
    return Image.fromarray(cv.img, 'RGB')


def main(out):
    stem = out[:-4]
    frames = [render(k / FRAMES) for k in range(FRAMES)]
    frames[0].save(out)
    frames[0].resize((W * 8, H * 8), Image.NEAREST).save(stem + '_x8.png')
    for scale, path in ((1, stem + '.gif'), (4, stem + '_x4.gif')):
        fr = [f.resize((W * scale, H * scale), Image.NEAREST) for f in frames]
        pal = [f.quantize(colors=255, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE)
               for f in fr]
        pal[0].save(path, save_all=True, append_images=pal[1:], duration=FRAME_MS,
                    loop=0, optimize=False, disposal=1)
    print('wrote', out, stem + '_x8.png', stem + '.gif', stem + '_x4.gif')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'void_vigil.png')
