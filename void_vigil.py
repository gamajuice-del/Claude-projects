#!/usr/bin/env python3
"""
void_vigil.py - finishes a 128x128 pixel-art Hollow Knight fan piece.

The composition follows the artist's own block-in: the Knight, seen from behind
on a dark mound with the nail raised, a horned shade of void rising out of it,
and two siblings drifting in purple light that falls from above.

Everything is drawn on a fixed palette.  The background is painted as a value
on a purple ramp and ordered-dithered onto it; figures are placed pixel by
pixel from hand-drawn sprites.

Usage:  python3 void_vigil.py [out.png]      (also writes <out>_x8.png)
"""
import math
import random
import sys

import numpy as np
from PIL import Image

W = H = 128
rnd = random.Random(7)

# --- palette -----------------------------------------------------------------
RAMP = [  # dark -> light, the whole background lives on this ramp
    (8, 7, 12), (15, 13, 23), (22, 19, 34), (29, 25, 45), (36, 31, 56),
    (44, 37, 67), (52, 43, 80), (60, 50, 93), (69, 58, 105), (80, 69, 119),
    (94, 83, 135), (112, 101, 154), (136, 126, 178), (166, 158, 204),
]
VOID = (6, 5, 10)
VOID_HI = (26, 20, 40)        # sheen on the void
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
MOTE_HI = (240, 236, 255)

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6],
                  [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0


def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# --- background as a value field ------------------------------------------------
def sky_value(x, y):
    """Index (float) on RAMP for the open sky/void at x, y."""
    v = 8.7 - y * 0.058                         # light from above, falling off
    # bright opening at the top centre
    d = math.hypot((x - 64) / 1.5, y + 6)
    v += 2.6 * math.exp(-(d / 26.0) ** 2)
    # light shafts fanning down from the opening
    ang = math.atan2(x - 64, y + 18)
    for a0, s, w in ((-0.42, 0.9, 0.045), (-0.16, 1.2, 0.05),
                     (0.05, 1.0, 0.035), (0.27, 1.1, 0.05), (0.5, 0.7, 0.04)):
        v += s * math.exp(-((ang - a0) / w) ** 2) * (1 - smooth(20, 100, y))
    # glow behind the Knight
    v += 1.4 * math.exp(-(((x - 64.5) / 16) ** 2 + ((y - 92) / 11) ** 2))
    # haze band just above the mound separates it from the sky
    v += 1.3 * math.exp(-((y - 101) / 6.0) ** 2)
    # vignette
    r = math.hypot((x - 64) / 64, (y - 58) / 70)
    v -= 2.4 * smooth(0.55, 1.25, r)
    return v


def spire_profile(xs, base, peak, width, onion=True):
    """Height map (top y) of a Hallownest spire centred at xs."""
    def top(x):
        dx = abs(x - xs)
        if dx > width:
            return None
        if onion:
            # pointed dome over a straight tower, with a needle on top
            if dx < 0.6:
                return peak
            dome_top = peak + 6
            dome_r = width
            if dx <= dome_r:
                return dome_top + (dome_r - math.sqrt(max(dome_r**2 - dx**2, 0))) * 1.4 \
                    - 3 * (1 - dx / dome_r) ** 3
        return peak + 6
    return top


def build_background():
    val = np.zeros((H, W))
    for y in range(H):
        for x in range(W):
            val[y, x] = sky_value(x, y)

    # --- distant city of the Abyss: two layers of towers -----------------------
    far = [(6, 30, 4), (15, 40, 3), (22, 24, 5), (31, 46, 3), (99, 44, 3),
           (106, 26, 5), (114, 36, 4), (122, 20, 4)]
    near = [(2, 44, 6), (12, 58, 4), (116, 52, 5), (126, 40, 6), (108, 66, 3)]
    for layer, dark, towers in ((0, 1.6, far), (1, 3.0, near)):
        for xs, peak, wdt in towers:
            top = spire_profile(xs, 128, peak, wdt)
            for x in range(max(0, xs - wdt - 1), min(W, xs + wdt + 2)):
                t = top(x)
                if t is None:
                    continue
                for y in range(int(round(t)), H):
                    fog = 1 - 0.85 * smooth(70, 104, y)   # bases sink into haze
                    val[y, x] = min(val[y, x], sky_value(x, y) - dark * fog)
            # a needle spire
            for y in range(peak - 6 - layer * 2, peak):
                val[y, xs] = min(val[y, xs], sky_value(xs, y) - dark)
            # a few arched windows, some faintly lit
            if wdt >= 4:
                for wy in range(peak + 12, H - 20, 9):
                    lit = rnd.random() < 0.18
                    for yy in range(wy, wy + 4):
                        for xx in (xs - 1, xs + 1) if wdt >= 5 else (xs,):
                            if lit:
                                val[yy, xx] = sky_value(xx, yy) + 1.2
                            else:
                                val[yy, xx] = min(val[yy, xx], sky_value(xx, yy) - dark - 1.0)
    # bridges/walkways between the far towers
    for x0, x1, yb in ((6, 22, 62), (99, 114, 70), (106, 122, 50)):
        for x in range(x0, x1 + 1):
            for y in (yb, yb + 1):
                val[y, x] = min(val[y, x], sky_value(x, y) - 1.6)
            if (x - x0) % 4 == 2:
                val[yb + 2, x] = min(val[yb + 2, x], sky_value(x, yb + 2) - 1.6)

    # --- chains hanging from the dark above -----------------------------------
    for cx, length in ((27, 38), (36, 22), (93, 30), (101, 16)):
        for y in range(0, length):
            x = cx + (1 if (y // 2) % 2 and y % 4 == 1 else 0)
            val[y, x] = min(val[y, x], sky_value(x, y) - 2.4)
        val[length, cx] = sky_value(cx, length) - 3.0
        val[length + 1, cx] = sky_value(cx, length) - 3.0

    # --- the mound ---------------------------------------------------------------
    ground_top = np.zeros(W, dtype=int)
    for x in range(W):
        dx = x - 64.5
        gt = 103.2 + 0.0028 * dx * dx + 0.6 * math.sin(x * 0.45) * smooth(8, 30, abs(dx))
        ground_top[x] = int(round(gt))
    for x in range(W):
        for y in range(ground_top[x], H):
            depth = y - ground_top[x]
            v = 1.3 - depth * 0.05 + 1.2 * math.exp(-((x - 64.5) / 18) ** 2) * math.exp(-depth / 4)
            val[y, x] = max(v, 0.4)
        # rim light where the light from above grazes the surface
        lit = math.exp(-((x - 64.5) / 30) ** 2)
        val[ground_top[x], x] = 3.6 + 3.2 * lit
        if ground_top[x] + 1 < H:
            val[ground_top[x] + 1, x] = 1.8 + 2.0 * lit
    return val, ground_top


def quantize(val):
    img = np.zeros((H, W, 3), dtype=np.uint8)
    n = len(RAMP) - 1
    for y in range(H):
        for x in range(W):
            v = val[y, x] + (BAYER[y % 4, x % 4] - 0.47) * 0.95
            i = int(math.floor(v + 0.5))
            img[y, x] = RAMP[min(max(i, 0), n)]
    return img


# --- drawing helpers -------------------------------------------------------------
class Canvas:
    def __init__(self, img):
        self.img = img
        self.void = np.zeros((H, W), dtype=bool)   # pixels that are void matter
        self.overlay = []                           # eyes and loose specks, laid on top

    def put(self, x, y, c):
        x, y = int(x), int(y)
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


# --- the figures -----------------------------------------------------------------
KEY = {'K': VOID, 'k': VOID_HI, 'E': EYE, 'e': EYE_DIM,
       'W': MASK, 'w': MASK2, 'm': MASK3, 'd': MASK4,
       'C': CLOAK_HI, 'c': CLOAK, 'o': CLOAK_LO,
       'N': NAIL_HI, 'n': NAIL, 'q': NAIL_LO, 'h': HANDLE,
       'x': 'speck'}

# The shade rising out of the Knight, as the artist blocked it in: horns curving
# in like a crescent, two small eyes set close, and a narrow body running
# straight down between the Knight's horns.  Origin (56, 65).
# K void, k sheen on the void, E eye, x a loose speck of void.
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

# The two siblings, also from the block-in.  The left one is tilted, leaning
# away with its legs trailing; the right one floats upright.  'e' = dim eye.
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
# Follows the artist's block-in pixel for pixel: horns leaning in at the tips,
# the pale back of the mask (no face - it is turned away from us), the cloak
# swept out to the right, the left arm raised with the nail, and the stance.
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


def draw_shade(cv):
    cv.sprite(56, 65, SHADE, KEY)


def draw_siblings(cv):
    cv.sprite(38, 63, SIB_L, KEY)
    cv.sprite(85, 59, SIB_R, KEY)


def draw_distant_siblings(cv):
    """Faint siblings lost in the haze, for depth."""
    far = (30, 24, 50)
    for x0, y0, tail in ((20, 44, 1), (104, 38, -1), (30, 24, 1), (112, 82, -1), (8, 70, 1)):
        for j, row in enumerate(SIB_TINY):
            for i, ch in enumerate(row):
                if ch == 'K':
                    cv.put(x0 + i, y0 + j, far)
                elif ch == 'e':
                    cv.put(x0 + i, y0 + j, RAMP[10])
        for k in range(4):
            if rnd.random() < 0.8:
                cv.put(x0 + 1 + (k // 2) * tail, y0 + 4 + k, far)


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
    rnd = random.Random(12)        # own seed: editing figures won't move it
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
    # a few shells/stones half sunk in the dark
    for x, dy, c in ((30, 3, RAMP[5]), (31, 3, RAMP[4]), (95, 4, RAMP[5]),
                     (96, 4, RAMP[4]), (96, 3, RAMP[6]), (46, 2, RAMP[4]),
                     (82, 2, RAMP[4]), (18, 6, RAMP[3]), (110, 5, RAMP[3])):
        cv.put(x, gtop[x] + dy, c)
    # small pale flowers near the Knight's feet
    for x, c in ((52, MOTE), (54, RAMP[12]), (76, MOTE), (79, RAMP[12])):
        g = gtop[x]
        cv.put(x, g - 1, RAMP[3])
        cv.put(x, g - 2, c)


def draw_foreground(cv):
    """Near-black grass framing the bottom corners."""
    rnd = random.Random(13)        # own seed: editing figures won't move it
    dark = RAMP[0]
    blades = []
    for side in (-1, 1):
        for k in range(26):
            base_x = (2 + k * 1.6) if side < 0 else (125 - k * 1.6)
            h = max(4, 26 - k * 0.95 + rnd.uniform(-4, 4))
            lean = rnd.uniform(0.15, 0.6) * (-side) * rnd.choice((1, 1, -0.5))
            blades.append((base_x, h, lean))
    for bx, h, lean in blades:
        for t in range(int(h)):
            f = t / h
            x = bx + lean * t + 1.8 * f * f * (1 if lean > 0 else -1)
            y = H - 1 - t
            w = 1.6 * (1 - f) + 0.4
            for dx in range(int(-w), int(w) + 1):
                cv.put(x + dx, y, dark)
    # a lit edge on a few blade tips
    for bx, h, lean in blades[::5]:
        t = int(h) - 1
        cv.put(bx + lean * t + 1.8 * (1 if lean > 0 else -1), H - 1 - t, RAMP[3])


def draw_particles(cv, gtop):
    rnd = random.Random(11)        # own seed: editing figures won't move it
    # falling light motes
    for _ in range(46):
        x = rnd.randrange(W)
        y = rnd.randrange(4, 100)
        if cv.void[y, x]:
            continue
        b = rnd.random()
        cv.put(x, y, MOTE_HI if b < 0.2 else (MOTE if b < 0.6 else RAMP[11]))
    # a few soft sparkles
    for x, y in ((38, 30), (91, 22), (77, 48), (21, 58), (106, 60), (52, 42)):
        cv.put(x, y, MOTE_HI)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cv.put(x + dx, y + dy, RAMP[11])


def main(out):
    val, gtop = build_background()
    img = quantize(val)
    cv = Canvas(img)
    draw_distant_siblings(cv)
    draw_shade(cv)
    draw_siblings(cv)
    draw_particles(cv, gtop)
    for x, y, c in cv.overlay:
        cv.put(x, y, c)
    draw_knight(cv)
    draw_ground_detail(cv, gtop)
    draw_foreground(cv)

    im = Image.fromarray(cv.img, 'RGB')
    im.save(out)
    big = out[:-4] + '_x8.png'
    im.resize((W * 8, H * 8), Image.NEAREST).save(big)
    print('wrote', out, big)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'void_vigil.png')
