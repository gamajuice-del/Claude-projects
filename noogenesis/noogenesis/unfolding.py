"""Physics Unfolding: open-endedness by conservative extension of the world.

The universe is allocated at its maximal state-space size, but most dimensions
are *latent*. When the ecosystem's evolutionary activity stagnates, the next
latent dimension is switched on. Each unfolding is a conservative extension:
at the moment it happens nothing that already exists behaves differently
(new channels are empty and the genes that would read them are pinned at 0),
so prior adaptations stay valid, but the space of possible niches grows.

Stagnation is measured with Bedau-Packard evolutionary activity over genome
"components" (16-bit random-hyperplane signatures of genomes): a component
contributes new activity when its cumulative usage crosses a threshold, i.e.
when a new genotype region proves persistently viable.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


@dataclass
class Physics:
    k_active: int = 2
    s_active: int = 2
    p_active: int = 1
    building: bool = False
    night_radius: int = 1
    level: int = 0

    def as_dict(self):
        return asdict(self)


LADDER = ("species", "building", "sound", "pheromone", "species", "deep_night")


def unfold(phys: Physics, cfg) -> str | None:
    """Advance one rung of the ladder. Returns the name of what unfolded."""
    while phys.level < len(LADDER):
        rung = LADDER[phys.level]
        phys.level += 1
        if rung == "species" and phys.k_active < cfg.K_max:
            phys.k_active += 1
            return f"species->{phys.k_active}"
        if rung == "building" and not phys.building:
            phys.building = True
            return "building"
        if rung == "sound" and phys.s_active < cfg.S_max:
            phys.s_active = cfg.S_max
            return f"sound->{phys.s_active}"
        if rung == "pheromone" and phys.p_active < cfg.P_max:
            phys.p_active += 1
            return f"pheromone->{phys.p_active}"
        if rung == "deep_night" and phys.night_radius > 0:
            phys.night_radius = 0
            return "deep_night"
    return None


class EvolutionaryActivity:
    """Bedau-Packard activity statistics on LSH genome components."""

    def __init__(self, L: int, n_bits: int = 16, threshold: float = 25.0,
                 seed: int = 1234):
        rng = np.random.default_rng(seed)
        self.planes = (rng.standard_normal((L, n_bits)) / np.sqrt(L)).astype(np.float32)
        self.weights = (1 << np.arange(n_bits)).astype(np.int64)
        self.threshold = threshold
        self.activity: dict[int, float] = {}
        self.crossed: set[int] = set()
        self.history: list[dict] = []

    def signatures(self, genomes: np.ndarray) -> np.ndarray:
        bits = (genomes @ self.planes) > 0
        return bits.astype(np.int64) @ self.weights

    def update(self, t: int, genomes: np.ndarray) -> dict:
        if genomes.shape[0] == 0:
            rec = dict(t=t, new_activity=0, components=0, diversity=0.0,
                       mean_activity=0.0)
            self.history.append(rec)
            return rec
        sig = self.signatures(genomes)
        u, c = np.unique(sig, return_counts=True)
        new = 0
        for s, k in zip(u.tolist(), c.tolist()):
            a = self.activity.get(s, 0.0) + k
            self.activity[s] = a
            if a >= self.threshold and s not in self.crossed:
                self.crossed.add(s)
                new += 1
        p = c / c.sum()
        rec = dict(t=t, new_activity=new, components=int(u.size),
                   diversity=float(-(p * np.log(p)).sum()),
                   mean_activity=float(np.mean([self.activity[s] for s in u.tolist()])))
        self.history.append(rec)
        return rec


class StagnationDetector:
    """Signals stagnation when windowed new-activity falls below a fraction of
    its running maximum, with a refractory period between unfoldings."""

    def __init__(self, window: int = 20, frac: float = 0.25,
                 refractory: int = 40, warmup: int = 30):
        self.window, self.frac = window, frac
        self.refractory, self.warmup = refractory, warmup
        self.series: list[float] = []
        self.best = 0.0
        self.since = 0

    def update(self, new_activity: float) -> bool:
        self.series.append(float(new_activity))
        self.since += 1
        if len(self.series) < max(self.window, self.warmup):
            return False
        cur = float(np.mean(self.series[-self.window:]))
        self.best = max(self.best, cur)
        if self.since >= self.refractory and cur <= self.frac * self.best:
            self.since = 0
            self.best = cur  # re-baseline after an unfolding
            return True
        return False
