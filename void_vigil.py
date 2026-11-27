#!/usr/bin/env python3
"""
void_vigil.py - finishes a 128x128 pixel-art Hollow Knight fan piece.

The composition follows the artist's own block-in: the Knight on a dark mound
with the nail raised, a tall horned shade of void rising out of it, and two
siblings drifting in purple light that falls from above.

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
AURA1 = (34, 20, 60)          # violet edge around void
AURA2 = (50, 32, 88)
EYE = (236, 236, 248)
EYE_DIM = (150, 146, 184)
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
        self.overlay = []                           # eyes etc, laid over the aura

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
                if c == VOID or c == VOID_HI:
                    self.putv(x0 + i, y0 + j, c)
                elif c in (EYE, EYE_DIM):
                    self.putv(x0 + i, y0 + j)           # part of the void body
                    self.overlay.append((x0 + i, y0 + j, c))
                else:
                    self.put(x0 + i, y0 + j, c)

    def wisp(self, pts, r0, r1, steps=None, broken=0.0):
        """Tapered void tendril along a Catmull-Rom curve through pts."""
        P = [pts[0]] + list(pts) + [pts[-1]]
        samples = []
        for k in range(1, len(P) - 2):
            p0, p1, p2, p3 = P[k - 1], P[k], P[k + 1], P[k + 2]
            for s in range(12):
                t = s / 12
                t2, t3 = t * t, t * t * t
                x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                           (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                           (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
                y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                           (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                           (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
                samples.append((x, y))
        samples.append(pts[-1])
        n = len(samples)
        for k, (x, y) in enumerate(samples):
            f = k / max(n - 1, 1)
            r = r0 + (r1 - r0) * f
            if f > 1 - broken and rnd.random() < 0.45:
                continue
            if r < 0.75:
                self.putv(x, y)
            else:
                ri = int(math.ceil(r))
                for dy in range(-ri, ri + 1):
                    for dx in range(-ri, ri + 1):
                        if dx * dx + dy * dy <= r * r:
                            self.putv(x + dx, y + dy)

    def blob(self, cx, cy, rx, ry):
        for y in range(int(cy - ry - 1), int(cy + ry + 2)):
            for x in range(int(cx - rx - 1), int(cx + rx + 2)):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                    self.putv(x, y)

    def aura(self, protect):
        """Violet edge around all void matter (not over protected pixels)."""
        v = self.void
        ring1 = np.zeros_like(v)
        ring2 = np.zeros_like(v)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ring1 |= np.roll(np.roll(v, dy, 0), dx, 1)
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if abs(dx) + abs(dy) <= 3:
                    ring2 |= np.roll(np.roll(v, dy, 0), dx, 1)
        ring2 &= ~ring1
        ring1 &= ~v
        for y in range(H):
            for x in range(W):
                if protect[y, x]:
                    continue
                if ring1[y, x]:
                    self.img[y, x] = AURA1 if y < 102 else RAMP[1]
                elif ring2[y, x] and (x + y) % 2 == 0 and y < 100:
                    self.img[y, x] = AURA2


# --- the figures -----------------------------------------------------------------
KEY = {'K': VOID, 'k': VOID_HI, 'E': EYE, 'e': EYE_DIM,
       'W': MASK, 'w': MASK2, 'm': MASK3, 'd': MASK4,
       'C': CLOAK_HI, 'c': CLOAK, 'o': CLOAK_LO,
       'N': NAIL_HI, 'n': NAIL, 'q': NAIL_LO, 'h': HANDLE}

# The great shade rising out of the Knight.  Origin (56, 60).
SHADE = [
    ".......K........K......",   # 60  horn tips lean in
    "......KK........KK.....",   # 61
    ".....KKk.........KK....",   # 62
    ".....Kk...........KK...",   # 63
    "....KKk...........KK...",   # 64
    "....KKk...........KK...",   # 65
    "....KKk...........KK...",   # 66
    "....KKKk.........KKK...",   # 67
    ".....KKKk.......KKK....",   # 68
    ".....KKKKKkkkkKKKKK....",   # 69
    "....KKKKkkKKKKKKKKKK...",   # 70
    "....KKKKKKKKKKKKKKKK...",   # 71
    "....KKEEEKKKKKKEEEKK...",   # 72
    "....KKEEKKKKKKKKEEKK...",   # 73
    "....KKEKKKKKKKKKKEKK...",   # 74
    ".....KKKKKKKKKKKKKK....",   # 75
    ".....KKKKKKKKKKKKKK....",   # 76
    "......KKKKKKKKKKKK.....",   # 77
]

# Abyss sibling, larger (left) and small (right).
SIB_L = [
    ".K......K.",
    ".KK....KK.",
    "..KK..KK..",
    ".KKKKKKKK.",
    "KKKKKKKKKK",
    "KEEKKKKEEK",
    "KEEKKKKEEK",
    "KKEKKKKEKK",
    ".KKKKKKKK.",
    "..KKKKKK..",
]
SIB_R = [
    "K......K",
    "KK....KK",
    ".KKKKKK.",
    "KKKKKKKK",
    "KEEKKEEK",
    "KKEKKEKK",
    ".KKKKKK.",
    "..KKKK..",
]
SIB_TINY = [
    "K..K",
    "KKKK",
    "eKKe",
    ".KK.",
]

# The Knight.  Origin (56, 82).
KNIGHT = [
    "....m........m...",   # 82
    "....Wm......Wm...",   # 83
    "....Ww......Ww...",   # 84
    "....WW......Ww...",   # 85
    "....WWW....WWw...",   # 86
    "....WWWWWWWWWw...",   # 87
    "....WWKKWWKKWw...",   # 88
    "....WKKKWWKKKw...",   # 89
    "....WKKKWwKKKw...",   # 90
    "....wWKKWwKKwm...",   # 91
    ".....wWWwwwwm....",   # 92
    "....CCccmmmcco...",   # 93
    "...CCcccccccooo..",   # 94
    "..hCCccccccccoo..",   # 95
    "..CCcccccccccooo.",   # 96
    "..CcccccccccccoO.",   # 97
    "..Cc.ccc.cccc.o..",   # 98
    "..C...cK..Kc...o.",   # 99
    "......KK..KK.....",   # 100
    "......KK..KK.....",   # 101
    ".....KKK..KKK....",   # 102
]
KNIGHT_KEY = dict(KEY)
KNIGHT_KEY['O'] = CLOAK_LO


def draw_shade(cv):
    ox, oy = 53, 60
    # body: a ragged cloak of void pouring down into the Knight
    cv.blob(64.5, 80, 6.2, 4.5)
    cv.blob(64.5, 84, 4.2, 3.0)
    # shoulders sweep out into two long tendrils, like a cape lifting
    cv.wisp([(59, 78), (55, 81), (51, 80), (47, 77), (46, 74), (48, 72)], 2.0, 0.4, broken=0.15)
    cv.wisp([(70, 78), (74, 81), (79, 81), (83, 78), (84, 75), (82, 73)], 2.0, 0.4, broken=0.15)
    # lower ragged hem strands
    cv.wisp([(60, 82), (57, 86), (54, 87), (52, 86)], 1.4, 0.3, broken=0.3)
    cv.wisp([(69, 82), (72, 86), (75, 88), (77, 87)], 1.4, 0.3, broken=0.3)
    cv.wisp([(62, 83), (60, 88), (58, 90)], 0.9, 0.3, broken=0.4)
    cv.wisp([(67, 83), (69, 88), (71, 91)], 0.9, 0.3, broken=0.4)
    # head and horns over the body
    cv.sprite(ox, oy, SHADE, KEY)


def draw_siblings(cv):
    # left sibling reaching toward the Knight, trailing its body behind
    cv.wisp([(46, 72), (42, 75), (39, 79), (40, 83), (37, 86)], 2.4, 0.3, broken=0.35)
    cv.wisp([(44, 73), (40, 74), (36, 73), (33, 75)], 1.0, 0.3, broken=0.4)
    cv.wisp([(49, 73), (51, 76), (53, 76)], 0.9, 0.3, broken=0.2)   # little arm
    cv.sprite(43, 63, SIB_L, KEY)
    # right sibling, smaller, curling its tail
    cv.wisp([(90, 67), (91, 71), (94, 74), (97, 73), (98, 70)], 1.8, 0.3, broken=0.3)
    cv.wisp([(88, 67), (86, 70), (85, 73)], 0.8, 0.3, broken=0.3)
    cv.sprite(86, 59, SIB_R, KEY)


def draw_distant_siblings(cv):
    """Faint siblings lost in the haze, for depth.  Not void-masked (no aura)."""
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
    cv.sprite(56, 82, KNIGHT, KNIGHT_KEY)
    # nail raised up-left from the hand at (58, 95)
    x0, y0, x1, y1 = 57, 94, 47, 87
    n = max(abs(x1 - x0), abs(y1 - y0))
    for k in range(n + 1):
        x = round(x0 + (x1 - x0) * k / n)
        y = round(y0 + (y1 - y0) * k / n)
        if k <= 1:
            cv.put(x, y, HANDLE)
        elif k == 2:
            cv.put(x, y, NAIL_LO)          # guard
            cv.put(x - 1, y + 1, NAIL_LO)
            cv.put(x + 1, y - 1, NAIL_LO)
        else:
            cv.put(x, y, NAIL_HI if k < n else NAIL)
            cv.put(x, y + 1, NAIL if k < n - 1 else NAIL_LO)
    cv.put(x1 - 1, y1 - 1, NAIL_HI)        # the tip catching the light


def draw_ground_detail(cv, gtop):
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


def draw_specks(cv):
    """Void specks drifting up off the shade and siblings (after the aura)."""
    for cx, cy, spread, n in ((64.5, 60, 11, 16), (47, 62, 6, 6), (90, 57, 5, 5)):
        for _ in range(n):
            x = int(round(cx + rnd.gauss(0, spread * 0.7)))
            y = int(round(cy - abs(rnd.gauss(0, spread))))
            if 0 <= x < W and 0 <= y < H and not cv.void[y, x]:
                cv.put(x, y, VOID if rnd.random() < 0.6 else AURA1)


def main(out):
    val, gtop = build_background()
    img = quantize(val)
    cv = Canvas(img)
    draw_distant_siblings(cv)
    draw_shade(cv)
    draw_siblings(cv)
    draw_particles(cv, gtop)
    # violet aura goes around the void before the Knight is laid on top
    protect = np.zeros((H, W), dtype=bool)
    cv.aura(protect)
    for x, y, c in cv.overlay:
        cv.put(x, y, c)
    draw_specks(cv)
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
