"""Accelerators that compress evolutionary time without faking selection.

1. Invasion-fitness look-ahead screening (IFS)
   ------------------------------------------
   Adaptive-dynamics theory says the fate of a *rare* mutant is set by its
   invasion fitness in the resident community. During stasis most compute is
   spent re-simulating an equilibrium; meanwhile mutation supply is ~99%
   neutral-or-deleterious. IFS spends a slice of compute to pre-screen
   candidate germline mutations *in the real ecology*:

     * clone the world twice (treatment T, control C) with identical RNG state
       (common random numbers);
     * in T, regrow k randomly chosen residents with a mutant genome; in C,
       regrow the same residents with their own genome (identical rebirth
       perturbation and identical developmental-noise draws);
     * run both for a short horizon; the selection coefficient of each mutant
       is the paired difference in lineage biomass (self + descendants);
     * mutants with s > s_min are written into the parent's germline in the
       main world, so its next offspring carries them.

   Nothing here measures intelligence. The only quantity used is reproductive
   success in the organism's own world. The paired design cancels most of the
   luck that normally swamps weak selection on cognition (higher selection
   signal-to-noise). Known bias: short horizons favour short-term gains; the
   horizon should exceed a generation and the main world remains the final
   arbiter (screened mutants still face full selection).

2. Activity-allocated archipelago (see archipelago.py)
"""
from __future__ import annotations

import numpy as np

from .backend import fsum, to_numpy
from .genome import mutate


class InvasionScreen:
    def __init__(self, n_probes: int = 48, horizon: int = 200, s_min: float = 0.1,
                 every: int = 2000, seed: int = 0, replicates: int = 1):
        self.n_probes, self.horizon = n_probes, horizon
        self.s_min, self.every = s_min, every
        self.replicates = replicates
        self.rng = np.random.default_rng(seed)
        self.history: list[dict] = []
        self.steps_spent = 0

    def run(self, world) -> dict | None:
        xp, A = world.xp, world.agents
        n = A.n
        k = min(self.n_probes, n // 4)
        if k < 4:
            return None
        idx_h = self.rng.choice(n, k, replace=False)
        idx = xp.asarray(idx_h)
        ids = to_numpy(A["id"][idx]).copy()
        mut = mutate(xp, world.rng_dev, world.lay, A["genome"][idx].copy(), world.mutable)
        reps = []
        for r in range(self.replicates):
            T, C = world.clone(), world.clone()
            seed = int(self.rng.integers(0, 2**31 - 1))
            for w in (T, C):
                w.agents["tag"][:] = -1
                w.agents["tag"][idx] = xp.arange(k, dtype=np.int32)
                w.hook = None
                if r > 0:   # independent replicate; T and C still share their numbers
                    w.rng = xp.random.default_rng(seed)
                    w.rng_dev = xp.random.default_rng(seed + 1)
            T.redevelop(idx, mut)
            C.redevelop(idx, C.agents["genome"][idx].copy())
            for _ in range(self.horizon):
                T.step()
                C.step()
            self.steps_spent += 2 * self.horizon
            mT, mC = _lineage_mass(T, k), _lineage_mass(C, k)
            # symmetric paired estimator (bounded in [-2, 2], unbiased in sign)
            reps.append((mT - mC) / (0.5 * (mT + mC) + 1.0))
        S = np.stack(reps)
        s = S.mean(0)
        accept = np.nonzero((S > self.s_min).all(0))[0]
        # write accepted mutants into the germline of parents still alive
        live_ids = to_numpy(A["id"][:A.n])
        pos = {int(v): i for i, v in enumerate(live_ids)}
        mut_h = to_numpy(mut)
        written = 0
        for j in accept:
            slot = pos.get(int(ids[j]))
            if slot is not None:
                A["germ"][slot] = xp.asarray(mut_h[j])
                A["has_germ"][slot] = True
                written += 1
        rep_corr = (float(np.corrcoef(S[0], S[1])[0, 1])
                    if self.replicates > 1 and S[0].std() > 0 and S[1].std() > 0 else None)
        rec = dict(t=world.t, k=k, s_mean=float(s.mean()), s_sd=float(s.std()),
                   replicate_corr=rep_corr, s_reps=S.tolist(),
                   frac_beneficial=float((s > 0).mean()),
                   accepted=int(accept.size), written=written,
                   steps_spent=self.steps_spent)
        self.history.append(rec)
        return rec


def _lineage_mass(w, k):
    A = w.agents
    n = A.n
    tag = to_numpy(A["tag"][:n])
    m = to_numpy(A["energy"][:n] + A["structure"][:n])
    out = np.zeros(k)
    ok = tag >= 0
    np.add.at(out, tag[ok], m[ok])
    return out


def relative_fitness(cfg, genomes_a: np.ndarray, genomes_b: np.ndarray,
                     steps: int = 1500, n_each: int = 200, seed: int = 0) -> dict:
    """Lenski-style competition: seed a fresh world with equal numbers of A and
    B genomes (no immigration) and report the selection rate
    r = ln(N_A(t)/N_A(0)) - ln(N_B(t)/N_B(0)) per 1000 steps."""
    from .world import World
    c = cfg.replace(init_agents=0, immigration=False, seed=seed)
    w = World(c, populate=False)
    xp = w.xp
    rng = np.random.default_rng(seed)
    ga = genomes_a[rng.integers(0, len(genomes_a), n_each)]
    gb = genomes_b[rng.integers(0, len(genomes_b), n_each)]
    w.spawn(xp.asarray(ga), energy=3.0, tag=0)
    w.spawn(xp.asarray(gb), energy=3.0, tag=1)
    w.E0 = w.total_energy()
    for _ in range(steps):
        w.step()
        if w.agents.n == 0:
            break
    tag = to_numpy(w.agents["tag"][:w.agents.n])
    na, nb = int((tag == 0).sum()), int((tag == 1).sum())
    r = (np.log((na + 0.5) / n_each) - np.log((nb + 0.5) / n_each)) * 1000.0 / steps
    return dict(n_a=na, n_b=nb, selection_rate_per_kstep=float(r))
