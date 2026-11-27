"""Synthetic world engine for CFVG experiments.

Every clip is generated from two independent parts:

* a **context** (the "world" / "source"): palette, object asset, physics,
  animation timing, recording artifacts. Clips that share a context form a
  *context group*: the same "game", but recorded independently.
* a **content** (the "events"): where the object starts and how it is launched.

The context is never put into the text. The text only describes the content,
in coarse bins, exactly as an event caption would.

Everything is vectorised over a batch with numpy, so data is generated on the
fly: there is no dataset on disk and the number of distinct worlds is unlimited.
"""
from __future__ import annotations

import colorsys
from dataclasses import dataclass

import numpy as np

H = W = 16          # frame size
T = 8               # frames per clip
SHAPES = 3          # square, circle, diamond
HOLDS = 3           # animation on 1s, 2s, 3s
GIANT = 2.2         # size multiplier of the "gigantic" override

# Never seen in training: the zero-shot (out-of-distribution) test worlds have
# stronger gravity than any training world (extrapolation) AND an object colour
# hue band that no training world uses.
G_RANGE = (0.0, 0.25)
G_TRAIN_MAX = 0.175
G_OOD = (0.19, 0.25)
SIZE_RANGE = (1.0, 2.2)
WIND = 0.08
HUE_OOD = (0.55, 0.70)

# ---- text vocabulary: an event caption, as tokens -------------------------
# slot 0: x0 bin (5), slot 1: y0 bin (4), slot 2: vx bin (5), slot 3: vy bin (4),
# slot 4: override (0 = none, 1 = gigantic)
# leaky slots (only for the leaky-caption ablation):
# slot 5: gravity bin (4), slot 6: shape (3)
TEXT_BINS = [5, 4, 5, 4, 2, 4, 3]
TEXT_OFFSETS = np.cumsum([0] + TEXT_BINS[:-1])
VOCAB = int(sum(TEXT_BINS)) + 1          # +1 for the "dropped" token
NULL_TOKEN = VOCAB - 1

CONTENT_RANGES = {
    "x0": (3.0, 13.0),
    "y0": (2.0, 9.0),
    "vx": (-1.0, 1.0),
    "vy": (-1.25, 0.25),
}


@dataclass
class Context:
    bg: np.ndarray        # (B, 3) background colour
    fg: np.ndarray        # (B, 3) object colour
    shape: np.ndarray     # (B,) int
    size: np.ndarray      # (B,) radius in px
    gravity: np.ndarray   # (B,) px / frame^2, downward
    wind: np.ndarray      # (B,) px / frame^2, horizontal
    hold: np.ndarray      # (B,) int, 1..3: animation held for N frames
    ghost: np.ndarray     # (B,) frame blending (smear / phosphor persistence)
    noise: np.ndarray     # (B,) sensor noise std

    def take(self, idx):
        return Context(*(getattr(self, f)[idx] for f in self.__dataclass_fields__))

    def vector(self) -> np.ndarray:
        """Continuous description used by the evaluation probe."""
        return np.concatenate(
            [self.bg, self.fg,
             np.stack([self.size, self.gravity, self.wind, self.ghost, self.noise], 1)],
            1).astype(np.float32)


@dataclass
class Content:
    x0: np.ndarray
    y0: np.ndarray
    vx: np.ndarray
    vy: np.ndarray

    def take(self, idx):
        return Content(self.x0[idx], self.y0[idx], self.vx[idx], self.vy[idx])

    def vector(self) -> np.ndarray:
        return np.stack([self.x0, self.y0, self.vx, self.vy], 1).astype(np.float32)


def _palette(rng, n, split="any"):
    """Background and object colours with guaranteed contrast."""
    h1 = rng.random(n)
    h2 = (h1 + rng.uniform(0.25, 0.75, n)) % 1.0
    in_band = lambda h: (h > HUE_OOD[0]) & (h < HUE_OOD[1])
    if split == "ood":
        h2 = rng.uniform(*HUE_OOD, n)
        h1 = (h2 - rng.uniform(0.25, 0.75, n)) % 1.0
    elif split == "train":
        bad = in_band(h2)
        while bad.any():
            h2[bad] = rng.random(bad.sum())
            bad = in_band(h2)
    s1, s2 = rng.uniform(0.2, 0.9, n), rng.uniform(0.3, 1.0, n)
    dark_bg = rng.random(n) < 0.5
    v1 = np.where(dark_bg, rng.uniform(0.1, 0.35, n), rng.uniform(0.65, 0.95, n))
    v2 = np.where(dark_bg, rng.uniform(0.7, 1.0, n), rng.uniform(0.05, 0.35, n))
    bg = np.array([colorsys.hsv_to_rgb(*a) for a in zip(h1, s1, v1)])
    fg = np.array([colorsys.hsv_to_rgb(*a) for a in zip(h2, s2, v2)])
    return bg, fg


def sample_contexts(rng, n, split="train") -> Context:
    """split: 'train' never touches the hold-out region, 'ood' lies entirely in
    it, 'any' covers everything (used only to train the evaluation probe)."""
    bg, fg = _palette(rng, n, split)
    if split == "ood":
        g = rng.uniform(*G_OOD, n)
    elif split == "train":
        g = rng.uniform(G_RANGE[0], G_TRAIN_MAX, n)
    else:
        g = rng.uniform(*G_RANGE, n)
    return Context(
        bg=bg, fg=fg,
        shape=rng.integers(0, SHAPES, n),
        size=rng.uniform(*SIZE_RANGE, n),
        gravity=g,
        wind=rng.uniform(-WIND, WIND, n),
        hold=rng.integers(1, HOLDS + 1, n),
        ghost=np.where(rng.random(n) < 0.5, 0.0, rng.uniform(0.3, 0.75, n)),
        noise=np.where(rng.random(n) < 0.4, 0.0, rng.uniform(0.02, 0.12, n)),
    )


def sample_content(rng, n) -> Content:
    return Content(*(rng.uniform(lo, hi, n) for lo, hi in CONTENT_RANGES.values()))


def content_bins(c: Content) -> np.ndarray:
    """(B, 4) integer bins: the coarse 'caption' of the events."""
    out = []
    for (name, (lo, hi)), nb in zip(CONTENT_RANGES.items(), TEXT_BINS[:4]):
        v = getattr(c, name)
        out.append(np.clip(((v - lo) / (hi - lo) * nb).astype(int), 0, nb - 1))
    return np.stack(out, 1)


def bin_centers(bins: np.ndarray) -> np.ndarray:
    out = []
    for i, ((lo, hi), nb) in enumerate(zip(CONTENT_RANGES.values(), TEXT_BINS[:4])):
        out.append(lo + (bins[:, i] + 0.5) / nb * (hi - lo))
    return np.stack(out, 1).astype(np.float32)


def make_text(c: Content, giant: np.ndarray, ctx: Context | None = None) -> np.ndarray:
    """Token ids (B, 5), or (B, 7) with leaky context slots when ctx is given."""
    slots = [content_bins(c)[:, i] for i in range(4)] + [giant.astype(int)]
    if ctx is not None:
        gb = np.clip((ctx.gravity / G_RANGE[1] * 4).astype(int), 0, 3)
        slots += [gb, ctx.shape]
    ids = np.stack(slots, 1)
    return ids + TEXT_OFFSETS[: ids.shape[1]]


def simulate(ctx: Context, c: Content, size: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Trajectories (B, T) in pixels. Elastic-ish bounces off all four walls."""
    B = len(size)
    x, y = c.x0.copy(), c.y0.copy()
    vx, vy = c.vx.copy(), c.vy.copy()
    xs, ys = np.zeros((B, T)), np.zeros((B, T))
    lo, hi_x, hi_y = size, W - size, H - size
    for t in range(T):
        xs[:, t], ys[:, t] = x, y
        vy = vy + ctx.gravity
        vx = vx + ctx.wind
        x, y = x + vx, y + vy
        for p, v, h in ((x, vx, hi_x), (y, vy, hi_y)):
            m = p > h
            p[m] = 2 * h[m] - p[m]
            v[m] = -0.8 * np.abs(v[m])
            m = p < lo
            p[m] = 2 * lo[m] - p[m]
            v[m] = 0.8 * np.abs(v[m])
    return xs, ys


def render(ctx: Context, c: Content, giant: np.ndarray | None = None,
           rng: np.random.Generator | None = None) -> np.ndarray:
    """Clips as float32 (B, T, 3, H, W) in [-1, 1]."""
    B = len(ctx.size)
    rng = rng or np.random.default_rng()
    size = ctx.size * np.where(giant, GIANT, 1.0) if giant is not None else ctx.size
    xs, ys = simulate(ctx, c, size)

    # animation "on Ns": the drawn pose only updates every `hold` frames
    t_idx = np.arange(T)[None, :]
    held = (t_idx // ctx.hold[:, None]) * ctx.hold[:, None]
    xs = np.take_along_axis(xs, held, 1)
    ys = np.take_along_axis(ys, held, 1)

    gy, gx = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    dx = np.abs(gx[None, None] - xs[:, :, None, None])
    dy = np.abs(gy[None, None] - ys[:, :, None, None])
    d = np.where(ctx.shape[:, None, None, None] == 0, np.maximum(dx, dy),
        np.where(ctx.shape[:, None, None, None] == 1, np.sqrt(dx ** 2 + dy ** 2),
                 (dx + dy) / 1.35))
    mask = np.clip(size[:, None, None, None] - d + 0.5, 0.0, 1.0)  # anti-aliased

    # frame blending (ghosting / smear)
    a = ctx.ghost[:, None, None]
    for t in range(1, T):
        mask[:, t] = np.maximum(mask[:, t], a * mask[:, t - 1])

    frames = (ctx.bg[:, None, :, None, None] * (1 - mask[:, :, None])
              + ctx.fg[:, None, :, None, None] * mask[:, :, None])
    frames = frames + rng.standard_normal(frames.shape) * ctx.noise[:, None, None, None, None]
    return (np.clip(frames, 0, 1) * 2 - 1).astype(np.float32)


# ---------------------------------------------------------------------------
# Training batches
# ---------------------------------------------------------------------------

class ContextPool:
    """A finite set of worlds (for the diversity-scaling experiment) or an
    unlimited stream (pool_size=None)."""

    def __init__(self, pool_size: int | None, seed: int, split="train"):
        self.rng = np.random.default_rng(seed)
        self.split = split
        self.pool = sample_contexts(self.rng, pool_size, split) if pool_size else None

    def draw(self, n) -> Context:
        if self.pool is None:
            return sample_contexts(self.rng, n, self.split)
        return self.pool.take(self.rng.integers(0, len(self.pool.size), n))


def _distinct_content(rng, ref_bins_list, n, min_diff=2, tries=20):
    """Content whose caption differs from every reference caption in >= min_diff slots."""
    c = sample_content(rng, n)
    for _ in range(tries):
        b = content_bins(c)
        bad = np.zeros(n, bool)
        for rb in ref_bins_list:
            bad |= (b != rb).sum(1) < min_diff
        if not bad.any():
            break
        c2 = sample_content(rng, bad.sum())
        for f in ("x0", "y0", "vx", "vy"):
            getattr(c, f)[bad] = getattr(c2, f)
    return c


def make_batch(pool: ContextPool, n: int, k_max: int, mode: str = "cfvg",
               p_giant: float = 0.15, leaky: bool = False, k_fixed: int | None = None):
    """One training batch.

    mode='cfvg'   : target is an independent recording from the same world.
    mode='paired' : target is one of the reference clips (replication baseline).

    Returns refs (n, K, T, 3, H, W), ref_mask (n, K) bool, target, text ids.
    """
    rng = pool.rng
    ctx = pool.draw(n)
    K = k_fixed or k_max
    k = np.full(n, K) if k_fixed else rng.integers(1, k_max + 1, n)
    refs = np.zeros((n, K, T, 3, H, W), np.float32)
    ref_contents = []
    for j in range(K):
        cj = sample_content(rng, n)
        ref_contents.append(cj)
        refs[:, j] = render(ctx, cj, rng=rng)
    ref_mask = np.arange(K)[None] < k[:, None]

    giant = rng.random(n) < p_giant
    if mode == "cfvg":
        c = _distinct_content(rng, [content_bins(r) for r in ref_contents], n, min_diff=1)
    elif mode == "paired":
        # target = reference clip 0 (always present); refs show the target itself
        c = ref_contents[0]
        giant[:] = False   # the replication baseline has nothing to override
    else:
        raise ValueError(mode)
    target = render(ctx, c, giant, rng=rng) if mode == "cfvg" else refs[:, 0].copy()
    text = make_text(c, giant, ctx if leaky else None)
    return refs, ref_mask, target, text, ctx, c, giant
