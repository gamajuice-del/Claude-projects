"""Measurement instruments.

Everything here observes a *clone* of the world, so measuring never perturbs
evolution. Hooks run between the forward pass and physics, which allows
counterfactual queries ("what would this brain have done had it heard
something else?") on exactly the state the organism was in.

Instruments
  record_hidden          per-individual neural time series
  neural_summary         Gaussian multi-information, TSE complexity, lagged MI
                         (active information storage), whole-minus-sum Phi
                         over bipartitions (Barrett & Seth 2011 style proxy),
                         participation-ratio dimensionality
  communication_metrics  positive signalling (MI between signal and sender
                         context, against a permutation null) and positive
                         listening (counterfactual JSD of the receiver's policy
                         when the heard sound is swapped / silenced)
"""
from __future__ import annotations

import math

import numpy as np

from .backend import to_numpy
from .brain import brain_forward
from .config import BUILD, NA
from .world import FRONT_P, CENTER_P

LN2 = math.log(2)


# ----------------------------------------------------------- information theory
def _cov(X, ridge=1e-4):
    X = X - X.mean(0)
    C = X.T @ X / max(1, X.shape[0] - 1)
    return C + ridge * np.eye(C.shape[0]) * max(np.trace(C) / C.shape[0], 1e-8)


def _logdet(C):
    s, ld = np.linalg.slogdet(C)
    return ld


def multi_information(X):
    """Total correlation of a Gaussian fit: sum_i H(x_i) - H(X) (nats)."""
    C = _cov(X)
    return 0.5 * (np.log(np.diag(C)).sum() - _logdet(C))


def lagged_mi(X, lag=1):
    """I(X_t ; X_{t-lag}) under a Gaussian fit (nats)."""
    A, B = X[lag:], X[:-lag]
    k = X.shape[1]
    J = _cov(np.concatenate([A, B], 1))
    return 0.5 * (_logdet(J[:k, :k]) + _logdet(J[k:, k:]) - _logdet(J))


def tse_complexity(X, n_sub=12, rng=None):
    """Tononi-Sporns-Edelman neural complexity by subset sampling (nats)."""
    rng = rng or np.random.default_rng(0)
    n = X.shape[1]
    I_full = multi_information(X)
    C = 0.0
    for k in range(1, n):
        vals = [multi_information(X[:, rng.choice(n, k, replace=False)]) if k > 1 else 0.0
                for _ in range(n_sub)]
        C += (k / n) * I_full - float(np.mean(vals))
    return C


def phi_wms(X, lag=1, n_random=24, rng=None):
    """Whole-minus-sum integrated information over bipartitions, minimised
    (size-normalised) over spectral + random candidate bipartitions. A proxy:
    it can be negative and is not IIT's Phi. Returns (phi_at_MIB, whole_MI)."""
    rng = rng or np.random.default_rng(0)
    n = X.shape[1]
    whole = lagged_mi(X, lag)
    cands = []
    Cr = np.abs(np.corrcoef(X.T))
    Cr = np.nan_to_num(Cr)
    Lap = np.diag(Cr.sum(1)) - Cr
    try:
        v = np.linalg.eigh(Lap)[1][:, 1]
        m = v > np.median(v)
        if 0 < m.sum() < n:
            cands.append(m)
    except np.linalg.LinAlgError:
        pass
    for _ in range(n_random):
        k = rng.integers(1, n // 2 + 1)
        m = np.zeros(n, bool)
        m[rng.choice(n, k, replace=False)] = True
        cands.append(m)
    best, best_norm = None, np.inf
    for m in cands:
        phi = whole - lagged_mi(X[:, m], lag) - lagged_mi(X[:, ~m], lag)
        norm = phi / min(m.sum(), (~m).sum())
        if norm < best_norm:
            best, best_norm = phi, norm
    return float(best), float(whole)


def participation_ratio(X):
    ev = np.clip(np.linalg.eigvalsh(_cov(X, 1e-6)), 0, None)
    return float(ev.sum() ** 2 / max((ev ** 2).sum(), 1e-12))


def mutual_info_discrete(x, y):
    """Plug-in MI in bits with Miller-Madow bias correction."""
    x, y = np.asarray(x), np.asarray(y)
    N = x.size
    if N == 0:
        return 0.0

    def H(*cols):
        _, c = np.unique(np.stack(cols, 1), axis=0, return_counts=True)
        p = c / N
        return -(p * np.log2(p)).sum() + (c.size - 1) / (2 * N * LN2)

    return float(H(x) + H(y) - H(x, y))


# ------------------------------------------------------------------- recorders
def record_hidden(world, steps=200, max_agents=48, min_neurons=4, seed=0):
    """Hidden-state traces {id: (T, k)} for agents alive the whole window."""
    w = world.clone()
    A = w.agents
    rng = np.random.default_rng(seed)
    nn = to_numpy(A["n_neurons"][:A.n])
    ids = to_numpy(A["id"][:A.n])
    pool = ids[nn >= min_neurons]
    tracked = set(rng.permutation(pool)[:max_agents].tolist())
    traces = {i: [] for i in tracked}

    N = w.cfg.N

    def hook(wd, n, Ne, Xv, Xo, h_new, out):
        cur = to_numpy(wd.agents["id"][:n])
        hh = np.zeros((n, N), np.float32)      # N_eff varies step to step: pad
        hh[:, :Ne] = to_numpy(h_new)
        for r in np.nonzero(np.isin(cur, list(traces)))[0]:
            traces[int(cur[r])].append(hh[r])

    w.hook = hook
    for _ in range(steps):
        w.step()
    out = {}
    for i, tr in traces.items():
        if len(tr) == steps:
            X = np.stack(tr)
            out[i] = X
    return out


def neural_summary(traces: dict, max_agents=32, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for i, X in list(traces.items())[:max_agents]:
        keep = X.std(0) > 1e-3
        X = X[:, keep]
        if X.shape[1] < 3:
            continue
        phi, whole = phi_wms(X, rng=rng)
        rows.append(dict(k=X.shape[1], mi=multi_information(X),
                         tse=tse_complexity(X, rng=rng), ais=lagged_mi(X),
                         phi_wms=phi, whole=whole, pr=participation_ratio(X)))
    if not rows:
        return {"n": 0}
    keys = rows[0].keys()
    out = {k: float(np.mean([r[k] for r in rows])) for k in keys}
    out["n"] = len(rows)
    return out


def _softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def _jsd(p, q):
    m = 0.5 * (p + q)
    kl = lambda a, b: (a * (np.log(a + 1e-12) - np.log(b + 1e-12))).sum(1)  # noqa: E731
    return 0.5 * kl(p, m) + 0.5 * kl(q, m)


def communication_metrics(world, steps=120, seed=0, n_null=20):
    w = world.clone()
    cfg = w.cfg
    K, S = cfg.K_max, cfg.S_max
    sa = w.physics.s_active
    rng = np.random.default_rng(seed)
    syms, ctxs, jsd_swap, jsd_sil, vocal = [], [], [], [], []

    def hook(wd, n, Ne, Xv, Xo, h_new, out):
        xp, A = wd.xp, wd.agents
        if n < 4:
            return
        o = to_numpy(out)
        s = np.tanh(o[:, NA:NA + sa])
        q = np.digitize(s, [-0.33, 0.33])                     # 3 levels per dim
        sym = (q * (3 ** np.arange(sa))).sum(1)
        xv = to_numpy(Xv)
        pres = xv[:, K + 2, :].copy()
        pres[:, CENTER_P] = 0
        bits = np.stack([
            xv[:, :K, FRONT_P].sum(1) > 0.3,
            pres.sum(1) > 0,
            xv[:, K, :].sum(1) > 0.1,
            to_numpy(A["energy"][:n]) < 1.0,
            to_numpy(A["pain"][:n]) > 0,
        ], 1).astype(int)
        ctx = (bits * (2 ** np.arange(bits.shape[1]))).sum(1)
        syms.append(sym)
        ctxs.append(ctx)
        vocal.append((np.abs(s) > 0.33).any(1).mean())
        # counterfactual listening
        so = slice(0, 5 * S)
        perm = xp.asarray(rng.permutation(n))
        Xs = Xo.copy()
        Xs[:, so] = Xo[perm][:, so]
        X0 = Xo.copy()
        X0[:, so] = 0
        temp = to_numpy(A["temp"][:n])[:, None]

        om = to_numpy(A["omask"][:n, :NA])

        def pol(oo):
            lg = to_numpy(oo)[:, :NA] / temp + (om - 1.0) * 1e9
            if not wd.physics.building:
                lg[:, BUILD] = -1e9
            return _softmax(lg)

        p = pol(out)
        ps = pol(brain_forward(xp, A.arr, n, Ne, Xv, Xs, wd.plastic_on, getattr(wd.cfg, "bilateral", False), getattr(wd.cfg, "reflex_arcs", False))[1])
        p0 = pol(brain_forward(xp, A.arr, n, Ne, Xv, X0, wd.plastic_on, getattr(wd.cfg, "bilateral", False), getattr(wd.cfg, "reflex_arcs", False))[1])
        heard = np.abs(to_numpy(Xo[:, so])).sum(1) > 0.05
        if heard.any():
            jsd_swap.append(_jsd(p, ps)[heard].mean())
            jsd_sil.append(_jsd(p, p0)[heard].mean())

    w.hook = hook
    for _ in range(steps):
        w.step()
    if not syms:
        return {}
    sym, ctx = np.concatenate(syms), np.concatenate(ctxs)
    mi = mutual_info_discrete(sym, ctx)
    null = [mutual_info_discrete(sym, rng.permutation(ctx)) for _ in range(n_null)]
    return dict(signal_mi_bits=mi, signal_mi_null=float(np.mean(null)),
                signal_mi_null95=float(np.percentile(null, 95)),
                signal_excess_bits=mi - float(np.mean(null)),
                listen_jsd_swap=float(np.mean(jsd_swap)) if jsd_swap else 0.0,
                listen_jsd_silence=float(np.mean(jsd_sil)) if jsd_sil else 0.0,
                frac_vocal=float(np.mean(vocal)), n_samples=int(sym.size))


def lesion_study(world, steps=150, kinds=("vision", "memory", "sound")):
    """How much does the evolved population's foraging depend on each faculty?
    Energy intake per agent-step in a lesioned clone relative to an intact
    clone run with identical random numbers. 1.0 = faculty irrelevant."""
    def intake(lesion):
        w = world.clone()
        w.lesion = lesion
        w.counters.clear()
        agent_steps = 0
        for _ in range(steps):
            agent_steps += w.agents.n
            w.step()
        return w.counters.get("eat_gain", 0.0) / max(agent_steps, 1)
    base = intake(None)
    out = {"intake_intact": base}
    for k in kinds:
        out[f"intake_ratio_{k}"] = intake(k) / max(base, 1e-9)
    return out


def common_garden(cfg, genomes, physics, n=500, settle=300, seed=0):
    """A fresh world populated only by (copies of) `genomes`, with no
    immigration, allowed to settle - for testing archived populations."""
    import copy
    from .world import World
    c = cfg.replace(init_agents=0, immigration=False, seed=seed)
    w = World(c, physics=copy.deepcopy(physics), populate=False)
    w.refresh_masks()
    rng = np.random.default_rng(seed)
    g = genomes[rng.integers(0, len(genomes), n)].astype(np.float32)
    w.spawn(w.xp.asarray(g), energy=3.0)
    w.E0 = w.total_energy()
    for _ in range(settle):
        w.step()
    return w
