"""Stage 2 scaffold: grounding language in an already-evolved mind.

Principle: language is grafted onto the organism's *own* channels and learned
with its *own* evolved plasticity. Nothing here trains the brain with
gradients. Three instruments:

representation_atlas
    What does the evolved brain already represent? Linear probes decode
    world/body concepts from hidden state, including concepts about the past
    ("food was ahead 5 steps ago") that are absent from the current input.
    Decodability from h is compared with decodability from the raw current
    input x: concepts better decoded from h than from x are internal,
    temporally extended representations - candidate referents for words.

word_cued_foraging
    The first lesson. Food is hidden left or right; a caregiver "speaks" a
    word (a sound vector injected through the organism's evolved auditory
    channel) that names the side. The organism can only exploit the word by
    *learning*, within its lifetime, that this sound predicts where food is.
    Controls: uninformative words, plasticity knock-out.

xenolexicon
    The reverse direction: decode the organisms' own signals. For each
    discrete signal, which contexts make it more likely? This is the seed
    vocabulary of a bilingual dictionary between their proto-language and ours.
"""
from __future__ import annotations

import numpy as np

from .assays import ChamberWorld, _sides
from .backend import to_numpy
from .config import NA
from .world import CENTER_P, FRONT_P


# --------------------------------------------------------------------- atlas
def _ridge_bacc(Xtr, ytr, Xte, yte, lam=1.0):
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-6
    Xtr, Xte = (Xtr - mu) / sd, (Xte - mu) / sd
    Xtr = np.concatenate([Xtr, np.ones((len(Xtr), 1))], 1)
    Xte = np.concatenate([Xte, np.ones((len(Xte), 1))], 1)
    t = 2.0 * ytr - 1.0
    w = np.linalg.solve(Xtr.T @ Xtr + lam * np.eye(Xtr.shape[1]), Xtr.T @ t)
    ftr = Xtr @ w
    if (ytr == 1).any() and (ytr == 0).any():   # class-balanced threshold
        thr = 0.5 * (ftr[ytr == 1].mean() + ftr[ytr == 0].mean())
    else:
        thr = 0.0
    pred = (Xte @ w) > thr
    pos, neg = yte == 1, yte == 0
    if pos.sum() == 0 or neg.sum() == 0:
        return np.nan
    return 0.5 * (pred[pos].mean() + (~pred[neg]).mean())


def representation_atlas(world, steps=300, lag=5, seed=0, max_rows=40000):
    """Returns {concept: {'from_h': bacc, 'from_x': bacc, 'gain': h - x}}."""
    w = world.clone()
    cfg = w.cfg
    K = cfg.K_max
    rows = {}            # id -> list of (h_padded, x, labels)
    Nmax = cfg.N

    def hook(wd, n, Ne, Xv, Xo, h_new, out):
        A = wd.agents
        xv, xo = to_numpy(Xv), to_numpy(Xo)
        hh = np.zeros((n, Nmax), np.float32)
        hh[:, :Ne] = to_numpy(h_new)
        pres = xv[:, K + 2, :].copy()
        pres[:, CENTER_P] = 0
        lab = np.stack([
            xv[:, :K, FRONT_P].sum(1) > 0.3,                   # food ahead
            pres.sum(1) > 0,                                   # someone in view
            to_numpy(A["energy"][:n]) < 1.0,                   # hungry
            to_numpy(A["carry"][:n]).sum(1) > 0.05,            # carrying
            to_numpy(A["pain"][:n]) > 0,                       # hurt
            np.full(n, wd.is_night),                           # night
        ], 1).astype(np.int8)
        x = np.concatenate([xv.reshape(n, -1), xo], 1)
        ids = to_numpy(A["id"][:n])
        for r in range(n):
            rows.setdefault(int(ids[r]), []).append((hh[r], x[r], lab[r]))

    w.hook = hook
    for _ in range(steps):
        w.step()
    names = ["food_ahead", "agent_in_view", "hungry", "carrying", "hurt", "night"]
    H, X, Y, Ypast, G = [], [], [], [], []
    for i, seq in rows.items():
        for t in range(lag, len(seq)):
            h, x, lab = seq[t]
            H.append(h)
            X.append(x)
            Y.append(lab)
            Ypast.append(seq[t - lag][2])
            G.append(i)
    if len(H) < 200:
        return {}
    rng = np.random.default_rng(seed)
    sel = rng.permutation(len(H))[:max_rows]
    H, X = np.stack(H)[sel], np.stack(X)[sel]
    Y, Ypast, G = np.stack(Y)[sel], np.stack(Ypast)[sel], np.array(G)[sel]
    test = (G % 3) == 0                    # split by individual, not by time
    res = {}
    for j, nm in enumerate(names):
        for tag, lab in (("now", Y[:, j]), (f"past{lag}", Ypast[:, j])):
            bh = _ridge_bacc(H[~test], lab[~test], H[test], lab[test])
            bx = _ridge_bacc(X[~test], lab[~test], X[test], lab[test])
            res[f"{nm}@{tag}"] = dict(from_h=bh, from_x=bx,
                                     gain=(bh - bx) if np.isfinite(bh) and np.isfinite(bx) else np.nan,
                                     base_rate=float(lab.mean()))
    return res


# ------------------------------------------------------------- first lesson
def word_cued_foraging(genomes, cfg, physics, trials=30, cue=4, resp=24, seed=0,
                       informative=True, plastic=True):
    cw = ChamberWorld(genomes, cfg, physics, seed=seed, plastic=plastic)
    w, xp, m = cw.w, cw.xp, cw.m
    rng = np.random.default_rng(seed + 5)
    sa = max(1, w.physics.s_active)
    words = {-1: np.zeros(cfg.S_max, np.float32), 1: np.zeros(cfg.S_max, np.float32)}
    words[-1][:sa] = np.array([1.0, -1.0, 1.0, -1.0][:sa])
    words[1][:sa] = -words[-1][:sa]
    curve = np.zeros((trials, 2))
    for tr in range(trials):
        side = _sides(rng, m)
        said = side if informative else _sides(rng, m)
        tgt = np.stack([np.full(m, -2), 2 * side], 1)
        mir = np.stack([np.full(m, -2), -2 * side], 1)
        cw.clear_food()
        cw.reset_bodies()
        ty, tx = cw.cells(tgt)
        w.cache[0, ty, tx] = 1.0                       # hidden reward
        cw.freeze(True)
        by, bx = cw.cells(np.stack([np.full(m, 1), np.zeros(m, int)], 1))  # caregiver behind
        wv = np.stack([words[int(s)] for s in said], 0)
        for _ in range(cue):
            w.sound_emit[:, by, bx] = xp.asarray(wv.T)
            cw.step()
        cw.freeze(False)
        decided = np.zeros(m, bool)
        T, M = cw.centers + tgt, cw.centers + mir
        for _ in range(resp):
            cw.step()
            p = cw.positions()
            at_t = (p == T).all(1) & ~decided
            at_m = (p == M).all(1) & ~decided
            curve[tr, 0] += at_t.sum()
            curve[tr, 1] += at_m.sum()
            decided |= at_t | at_m
    acc = curve[:, 0] / np.maximum(curve.sum(1), 1)
    q = max(3, trials // 4)
    ke, ne = curve[:q, 0].sum(), curve[:q].sum()
    kl, nl = curve[-q:, 0].sum(), curve[-q:].sum()
    return dict(acc_curve=acc.tolist(), early=float(ke / max(ne, 1)),
                late=float(kl / max(nl, 1)), gain=float(kl / max(nl, 1) - ke / max(ne, 1)),
                k_early=int(ke), n_early=int(ne), k_late=int(kl), n_late=int(nl),
                reach=float(curve.sum() / (trials * m)))


def two_prop_p(k1, n1, k2, n2):
    """Two-sided two-proportion z-test p-value (normal approximation)."""
    import math
    if n1 == 0 or n2 == 0:
        return float("nan")
    p = (k1 + k2) / (n1 + n2)
    se = math.sqrt(max(p * (1 - p) * (1 / n1 + 1 / n2), 1e-12))
    z = (k1 / n1 - k2 / n2) / se
    return math.erfc(abs(z) / math.sqrt(2))


def lesson_battery(genomes, cfg, physics, trials=30, seed=0):
    full = word_cued_foraging(genomes, cfg, physics, trials, seed=seed)
    sham = word_cued_foraging(genomes, cfg, physics, trials, seed=seed, informative=False)
    ko = word_cued_foraging(genomes, cfg, physics, trials, seed=seed, plastic=False)
    return dict(informative=full, uninformative=sham, knockout=ko,
                symbol_learning=float(full["late"] - max(sham["late"], ko["late"])),
                p_vs_uninformative=two_prop_p(full["k_late"], full["n_late"],
                                              sham["k_late"], sham["n_late"]),
                p_vs_knockout=two_prop_p(full["k_late"], full["n_late"],
                                         ko["k_late"], ko["n_late"]),
                p_late_vs_chance=two_prop_p(full["k_late"], full["n_late"],
                                            full["n_late"] // 2, full["n_late"]))


# ---------------------------------------------------------------- xenolexicon
def xenolexicon(world, steps=150, seed=0, min_count=30):
    """For each discrete organism signal: P(context | signal) / P(context)."""
    w = world.clone()
    cfg = w.cfg
    K, sa = cfg.K_max, w.physics.s_active
    data = []

    def hook(wd, n, Ne, Xv, Xo, h_new, out):
        o = to_numpy(out)
        q = np.digitize(np.tanh(o[:, NA:NA + sa]), [-0.33, 0.33])
        sym = (q * (3 ** np.arange(sa))).sum(1)
        xv = to_numpy(Xv)
        pres = xv[:, K + 2, :].copy()
        pres[:, CENTER_P] = 0
        ctx = np.stack([xv[:, :K, FRONT_P].sum(1) > 0.3, pres.sum(1) > 0,
                        to_numpy(wd.agents["energy"][:n]) < 1.0,
                        to_numpy(wd.agents["pain"][:n]) > 0], 1)
        data.append((sym, ctx))

    w.hook = hook
    for _ in range(steps):
        w.step()
    if not data:
        return {}
    sym = np.concatenate([d[0] for d in data])
    ctx = np.concatenate([d[1] for d in data])
    names = ["food_ahead", "agent_in_view", "hungry", "hurt"]
    base = ctx.mean(0)
    lex = {}
    for s in np.unique(sym):
        sel = sym == s
        if sel.sum() < min_count:
            continue
        lift = ctx[sel].mean(0) / np.maximum(base, 1e-6)
        digits = [(int(s) // 3 ** d) % 3 - 1 for d in range(sa)]
        lex[str(digits)] = dict(count=int(sel.sum()),
                                lift={nm: round(float(l), 3) for nm, l in zip(names, lift)})
    return lex


# ------------------------------------------------- lesson 2: word -> value
def word_value_lesson(genomes, cfg, physics, blocks=20, block_steps=40, items=6, bad=-0.5,
                      early=10, seed=0, informative=True, plastic=True):
    """Does a heard word come to mean "this food species is good now"?

    Each block a chamber is restocked with both species; which one is nutritious
    is drawn at random per block. A caregiver next to the subject keeps saying
    word A (species 0 good) or word B (species 1 good). The organism can only
    exploit the word by associating it, through its own plasticity, with the
    outcomes of eating. Key measure: diet selectivity in the first `early`
    steps of a block (before tasting can tell), early vs late blocks.
    Controls: uninformative words (random), plasticity knock-out."""
    cw = ChamberWorld(genomes, cfg, physics, seed=seed, plastic=plastic)
    w, xp, m = cw.w, cw.xp, cw.m
    rng = np.random.default_rng(seed + 9)
    sa = max(1, w.physics.s_active)
    word = np.zeros((2, cfg.S_max), np.float32)
    word[0, :sa] = np.array([1.0, -1.0, 1.0, -1.0][:sa])
    word[1] = -word[0]
    K = cfg.K_max
    early_sel = np.full((blocks, m), np.nan)
    all_sel = np.full((blocks, m), np.nan)
    from .world import F_DIR
    for b in range(blocks):
        good = int(rng.integers(0, 2))
        said = good if informative else int(rng.integers(0, 2))
        val = np.zeros(K, np.float32)
        val[good], val[1 - good] = 1.0, bad
        w.species_value = xp.asarray(val)
        cw.clear_food()
        A = w.agents
        A["energy"][:m] = 4.0
        A["prev_energy"][:m] = 4.0
        for sp in (0, 1):
            for _ in range(items):
                y, x = cw.cells(rng.integers(-4, 5, size=(m, 2)))
                w.veg[sp, y, x] = 1.0
        g_e = np.zeros(m)
        b_e = np.zeros(m)
        g_a = np.zeros(m)
        b_a = np.zeros(m)
        for t in range(block_steps):
            pos = to_numpy(A["pos"][:m])
            hd = to_numpy(A["heading"][:m])
            by = (pos[:, 0] - F_DIR[hd, 0]) % w.cfg.H          # caregiver just behind
            bx = (pos[:, 1] - F_DIR[hd, 1]) % w.cfg.W
            w.sound_emit[:, xp.asarray(by), xp.asarray(bx)] = xp.asarray(
                np.repeat(word[said][:, None], m, 1))
            cw.step()
            le = to_numpy(w.last_eat[:m, :2])
            g_a += le[:, good]
            b_a += le[:, 1 - good]
            if t < early:
                g_e += le[:, good]
                b_e += le[:, 1 - good]
        te, ta = g_e + b_e, g_a + b_a
        early_sel[b, te > 0.02] = (g_e / np.maximum(te, 1e-9))[te > 0.02]
        all_sel[b, ta > 0.02] = (g_a / np.maximum(ta, 1e-9))[ta > 0.02]
    h = blocks // 2
    return dict(early_first_half=float(np.nanmean(early_sel[:h])),
                early_second_half=float(np.nanmean(early_sel[h:])),
                all_second_half=float(np.nanmean(all_sel[h:])),
                early_curve=[None if np.isnan(v) else float(v) for v in np.nanmean(early_sel, 1)],
                n_early=int(np.sum(~np.isnan(early_sel[h:]))))


def word_lesson_battery(genomes, cfg, physics, seed=0, **kw):
    full = word_value_lesson(genomes, cfg, physics, seed=seed, **kw)
    sham = word_value_lesson(genomes, cfg, physics, seed=seed, informative=False, **kw)
    ko = word_value_lesson(genomes, cfg, physics, seed=seed, plastic=False, **kw)
    return dict(informative=full, uninformative=sham, knockout=ko,
                word_benefit=float(full["early_second_half"] - sham["early_second_half"]),
                word_learning=float(full["early_second_half"] - full["early_first_half"]))
