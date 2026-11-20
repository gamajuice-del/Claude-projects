"""Genome: a compact developmental program, not a blueprint.

Layout = [global body genes | G_max neuron-type modules]. A module ("gene
module", cf. a cell-type identity program) describes one neuron *type*: how
many neurons of it to grow, its wiring affinities (key/query vectors), its
receptive-field basis, its time constant, its plasticity rule and which
neuromodulators gate that rule, and its motor affinities. Individual neurons
are then grown from their type with developmental noise.

All loci are unbounded reals; bounded phenotypes come from smooth squashing
functions, so every mutation produces a valid organism.

Structural variation follows Ohno's duplication-divergence: a module can be
copied into a silent slot and then drift apart, which is how brains gain new
cell types without destroying the old ones.
"""
from __future__ import annotations

import numpy as np

from .config import (BUILD, NA, N_INTERO, N_PATCH, N_SOUND_PTS, Config,
                     n_other_inputs, n_outputs, vision_channels)


def sigmoid(xp, x):
    return 1.0 / (1.0 + xp.exp(-x))


class GenomeLayout:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        C = vision_channels(cfg)
        self.C = C
        g_fields = [
            ("size", 1), ("max_age", 1), ("repro_thr", 1), ("invest", 1),
            ("enzymes", cfg.K_max + 1), ("color", 3), ("log_sigma", 1),
            ("compat", 1), ("eta_pred", 1), ("temp", 1), ("epi_rho", 1),
            ("share", 1),
        ]
        if getattr(cfg, "arc_learning", False):  # rate, value coupling (dE, modulator), trace
            g_fields += [("arc_eta", 1), ("arc_dE", 1), ("arc_mod", 1), ("arc_trace", 1)]
        if getattr(cfg, "tectum", False):     # what is salient, and how sharp the competition
            g_fields += [("sal_w", C), ("sal_beta", 1)]
        t_fields = [
            ("count", 1), ("q", cfg.d_aff), ("k", cfg.d_aff), ("w_scale", 1),
            ("bias", 1), ("alpha", 1), ("dev_noise", 1), ("eta", 1),
            ("hebb", 4), ("decay", 1), ("beta", cfg.M_mod + 1),
            ("vis_chan", cfg.R_vis * C),
            ("vis_pos", cfg.R_vis * (3 if getattr(cfg, "rf_mode", "pixel") == "gaussian" else N_PATCH)),
            ("vis_mix", cfg.R_vis), ("in_other", n_other_inputs(cfg)),
            ("in_gain", 1), ("out", n_outputs(cfg)),
        ]
        if getattr(cfg, "reflex_arcs", False):   # receptive field r of this type -> each action
            t_fields += [("arc", cfg.R_vis * NA)]
        self.gs, off = {}, 0
        for name, n in g_fields:
            self.gs[name] = slice(off, off + n)
            off += n
        self.G_len = off
        self.ts, off = {}, 0
        for name, n in t_fields:
            self.ts[name] = slice(off, off + n)
            off += n
        self.T_len = off
        self.L = self.G_len + cfg.G_max * self.T_len

    # -- views ---------------------------------------------------------------
    def g(self, genomes, name):
        return genomes[:, self.gs[name]]

    def types(self, genomes):
        n = genomes.shape[0]
        return genomes[:, self.G_len:].reshape(n, self.cfg.G_max, self.T_len)

    def t(self, genomes, name):
        return self.types(genomes)[:, :, self.ts[name]]

    def type_locus(self, g: int, name: str, j: int = 0) -> int:
        return self.G_len + g * self.T_len + self.ts[name].start + j

    # -- latent-physics mask --------------------------------------------------
    def mutable_mask(self, physics) -> np.ndarray:
        """Loci that are currently 'expressed'. Loci tied to latent physics stay
        at exactly 0 so that unfolding a new dimension is a conservative
        extension (pre-existing behaviour is unchanged at the moment of
        unfolding)."""
        cfg, C = self.cfg, self.C
        m = np.ones(self.L, dtype=bool)
        e0 = self.gs["enzymes"].start
        for k in range(physics.k_active, cfg.K_max):
            m[e0 + k] = False
        dead_ch = list(range(physics.k_active, cfg.K_max))  # veg channels
        pher0 = cfg.K_max + 1 + 1 + 1 + 3 + 1
        dead_ch += [pher0 + p for p in range(physics.p_active, cfg.P_max)]
        if "sal_w" in self.gs:
            for c in dead_ch:
                m[self.gs["sal_w"].start + c] = False
        so = self.ts["in_other"].start
        oo = self.ts["out"].start
        for g in range(cfg.G_max):
            base = self.G_len + g * self.T_len
            vc = base + self.ts["vis_chan"].start
            for r in range(cfg.R_vis):
                for c in dead_ch:
                    m[vc + r * C + c] = False
            for pt in range(N_SOUND_PTS):
                for s in range(physics.s_active, cfg.S_max):
                    m[base + so + pt * cfg.S_max + s] = False
            for s in range(physics.s_active, cfg.S_max):
                m[base + oo + NA + s] = False
            for p in range(physics.p_active, cfg.P_max):
                m[base + oo + NA + cfg.S_max + p] = False
            if not physics.building:
                m[base + oo + BUILD] = False
                if "arc" in self.ts:
                    for r in range(cfg.R_vis):
                        m[base + self.ts["arc"].start + r * NA + BUILD] = False
        return m


# -----------------------------------------------------------------------------
def random_genomes(xp, rng, lay: GenomeLayout, n: int, mutable=None):
    cfg = lay.cfg
    g = rng.standard_normal((n, lay.L), dtype=xp.float32)
    G = lay.g
    G(g, "size")[:] *= 0.5
    G(g, "max_age")[:] = G(g, "max_age") * 0.5 + 0.3
    G(g, "repro_thr")[:] = G(g, "repro_thr") * 0.4 - 1.0
    G(g, "invest")[:] *= 0.5
    enz = G(g, "enzymes")
    enz[:] *= 0.5
    enz[:, -1] -= 1.0                       # most founders are herbivores
    G(g, "log_sigma")[:] = getattr(cfg, "sigma_init", -2.5) + 0.2 * G(g, "log_sigma")
    G(g, "compat")[:] *= 0.5
    G(g, "eta_pred")[:] = G(g, "eta_pred") - 2.0
    G(g, "temp")[:] *= 0.3
    G(g, "epi_rho")[:] = 0.5 * G(g, "epi_rho") - 3.0
    G(g, "share")[:] *= 0.5
    if "arc_eta" in lay.gs:
        G(g, "arc_dE")[:] *= 1.0      # value coupling starts random: evolution decides
        G(g, "arc_mod")[:] *= 0.5
    if "sal_w" in lay.gs:
        G(g, "sal_w")[:] *= 0.5
        G(g, "sal_beta")[:] = 1.0 + 0.3 * G(g, "sal_beta")

    T = lay.types(g)
    ts = lay.ts
    lo, hi = cfg.init_types
    n_act = rng.integers(lo, hi + 1, size=n)
    order = xp.argsort(rng.random((n, cfg.G_max)), axis=1)
    active = order < n_act[:, None]
    cnt = rng.uniform(2.0, 6.0, size=(n, cfg.G_max)).astype(xp.float32)
    T[:, :, ts["count"].start] = xp.where(active, cnt, -1.0)
    T[:, :, ts["w_scale"]] *= 0.6
    T[:, :, ts["bias"]] *= 0.3
    T[:, :, ts["dev_noise"]] = T[:, :, ts["dev_noise"]] * 0.5 - 1.0
    T[:, :, ts["eta"]] = T[:, :, ts["eta"]] - 1.0
    T[:, :, ts["hebb"]] *= 0.5
    T[:, :, ts["beta"]] *= 0.5
    T[:, :, ts["vis_mix"]] = 0.5 + 0.5 * T[:, :, ts["vis_mix"]]
    T[:, :, ts["in_gain"]] *= 0.3
    if "arc" in ts:
        T[:, :, ts["arc"]] *= 0.3
    if mutable is not None:
        g[:, ~xp.asarray(mutable)] = 0.0
    return g


def decode_globals(xp, lay: GenomeLayout, g, k_active: int):
    cfg = lay.cfg
    G = lambda name: lay.g(g, name)  # noqa: E731
    sg = lambda x: sigmoid(xp, x)    # noqa: E731
    size = 0.5 + 1.5 * sg(G("size")[:, 0])
    # specialist/generalist trade-off. The softmax runs over *all* K_max+1
    # food types (latent species' logits are pinned at 0 until they unfold),
    # so unfolding a species never changes efficiency on existing foods.
    enz = G("enzymes")
    p = xp.exp(enz - enz.max(1, keepdims=True))
    p = p / p.sum(1, keepdims=True)
    F = cfg.K_max + 1
    eff = xp.minimum(cfg.eff_max, cfg.eff_max * p * F ** cfg.eff_alpha)
    out = dict(
        size=size.astype(xp.float32),
        max_age=(300 + 2700 * sg(G("max_age")[:, 0])).astype(xp.float32),
        repro_thr=(1.0 + 9.0 * sg(G("repro_thr")[:, 0])).astype(xp.float32),
        invest=(0.1 + 0.8 * sg(G("invest")[:, 0])).astype(xp.float32),
        eff=eff.astype(xp.float32),
        color=xp.tanh(G("color")).astype(xp.float32),
        compat=(0.05 + 0.5 * sg(G("compat")[:, 0])).astype(xp.float32),
        eta_pred=(0.05 * sg(G("eta_pred")[:, 0])).astype(xp.float32),
        temp=xp.exp(xp.clip(G("temp")[:, 0], -3, 2)).astype(xp.float32),
        epi_rho=sg(G("epi_rho")[:, 0]).astype(xp.float32),
        share=(0.05 + 0.45 * sg(G("share")[:, 0])).astype(xp.float32),
    )
    if "arc_eta" in lay.gs:
        out.update(
            arc_eta=(0.2 * sg(G("arc_eta")[:, 0] - 2.0)).astype(xp.float32),
            arc_dE=G("arc_dE")[:, 0].astype(xp.float32),
            arc_mod=G("arc_mod")[:, 0].astype(xp.float32),
            arc_trace=sg(G("arc_trace")[:, 0]).astype(xp.float32))
    return out


def type_counts(xp, lay: GenomeLayout, g):
    c = lay.t(g, "count")[:, :, 0]
    return xp.clip(xp.floor(c), 0, lay.cfg.n_max).astype(xp.int32)


# -----------------------------------------------------------------------------
def mutate(xp, rng, lay: GenomeLayout, g, mutable_mask):
    """In-place mutation of a (n, L) batch of genomes; returns g."""
    cfg = lay.cfg
    n = g.shape[0]
    if n == 0:
        return g
    ls = lay.gs["log_sigma"].start
    g[:, ls] += cfg.tau_sigma * rng.standard_normal(n, dtype=xp.float32)
    g[:, ls] = xp.clip(g[:, ls], -6.0, 0.0)
    sig = xp.exp(g[:, ls])
    hit = rng.random((n, lay.L), dtype=xp.float32) < cfg.p_gene
    noise = rng.standard_normal((n, lay.L), dtype=xp.float32)
    hit[:, ls] = False
    g += hit * noise * sig[:, None]

    # structural mutations: duplication-divergence and deletion of modules
    T = lay.types(g)
    cs = lay.ts["count"].start
    u_dup = np.asarray(_host(rng.random(n)))
    u_del = np.asarray(_host(rng.random(n)))
    events = np.nonzero((u_dup < cfg.p_dup) | (u_del < cfg.p_del))[0]
    if events.size:
        counts = np.asarray(_host(T[:, :, cs]))
        sel = np.random.default_rng(int(_host(rng.integers(0, 2**31 - 1))))
        for i in events:
            active = np.nonzero(counts[i] >= 1)[0]
            silent = np.nonzero(counts[i] < 1)[0]
            if u_dup[i] < cfg.p_dup and active.size and silent.size:
                src, dst = sel.choice(active), sel.choice(silent)
                T[i, dst] = T[i, src]
                T[i, dst] += 0.3 * xp.asarray(
                    sel.standard_normal(lay.T_len).astype(np.float32))
                # split the neurons between the two copies (dosage compensation)
                c = max(1.0, float(counts[i, src]) / 2 + 0.5)
                T[i, src, cs] = c
                T[i, dst, cs] = c
            elif u_del[i] < cfg.p_del and active.size > 1:
                T[i, sel.choice(active), cs] = -1.0
    m = xp.asarray(mutable_mask)
    g[:, ~m] = 0.0
    return g


def crossover(xp, rng, lay: GenomeLayout, a, b):
    """Module-level uniform crossover: each gene module is inherited whole."""
    n = a.shape[0]
    child = a.copy()
    gm = rng.random((n, lay.G_len)) < 0.5
    child[:, :lay.G_len] = xp.where(gm, a[:, :lay.G_len], b[:, :lay.G_len])
    tm = rng.random((n, lay.cfg.G_max)) < 0.5
    TA, TB, TC = lay.types(a), lay.types(b), lay.types(child)
    TC[:] = xp.where(tm[:, :, None], TA, TB)
    return child


def genome_distance(xp, a, b):
    return xp.sqrt(((a - b) ** 2).mean(axis=1))


def _host(x):
    try:
        return x.get()
    except AttributeError:
        return x
