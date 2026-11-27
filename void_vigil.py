#!/usr/bin/env python3
"""
void_vigil.py - finishes a 128x128 pixel-art Hollow Knight fan piece.

The composition and the figures are the artist's own block-in: the Knight, seen
from behind on a dark mound with the nail raised, a horned shade of void rising
out of it, and two siblings drifting in purple light that falls from above.
Their silhouettes are kept pixel for pixel; this program builds the world
around them and brings it to life as a seamless loop.

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


def draw_ground_detail(cv, gtop):
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
    # small pale flowers near the Knight's feet
    for x, c in ((52, MOTE), (54, RAMP[12]), (76, MOTE), (79, RAMP[12])):
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
RISING = []   # void specks lifting off the shade's horns and head, and the siblings
for x0, y0, n, spread in ((64.5, 68, 8, 7.0), (46, 63, 4, 3), (90, 59, 3, 2.5)):
    for _ in range(n):
        RISING.append(dict(x=x0 + _rv.gauss(0, spread), y=y0 + _rv.uniform(-2, 3),
                           rise=_rv.uniform(12, 22), ph=_rv.random(),
                           sway=_rv.uniform(0.3, 1.2), ph2=_rv.random(),
                           sib=(x0 != 64.5) * (1 if x0 < 64 else 2)))


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


def draw_rising(cv, t):
    for s in RISING:
        u = (t + s['ph']) % 1.0
        dy = 0
        if s['sib'] == 1:
            dy = bob(t, 0.0)
        elif s['sib'] == 2:
            dy = bob(t, 0.37)
        x = s['x'] + s['sway'] * math.sin(TAU * (u + s['ph2']))
        y = s['y'] + dy - s['rise'] * u
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < W and 0 <= yi < H) or cv.void[yi, xi]:
            continue
        if u < 0.08:
            continue                      # still inside the body
        cv.put(xi, yi, VOID if u < 0.6 else ((24, 18, 40) if u < 0.82 else (40, 33, 64)))


# --- one frame --------------------------------------------------------------------
WORLD = None


def render(t):
    global WORLD
    if WORLD is None:
        WORLD = build_world()
    val, layer, gtop = WORLD
    v = val + beam_field(t) * BEAM_REACH[layer] + fog_field(t) * FOG_REACH[layer]
    cv = Canvas(quantize(v))
    draw_distant_siblings(cv, t)
    draw_shade(cv)
    draw_siblings(cv, t)
    cv.rim_light((30, 55, 100, 90))
    draw_motes(cv, t)
    draw_rising(cv, t)
    for x, y, c in cv.overlay:
        cv.put(x, y, c)
    draw_knight(cv)
    draw_ground_detail(cv, gtop)
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
