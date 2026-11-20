"""Activity-allocated archipelago: a bandit over parallel universes.

N islands (independent worlds, possibly with different physics constants,
different devices) evolve in parallel. Each round, a fixed step budget is
split between islands by an upper-confidence-bound rule on each island's
recent *evolutionary activity* (rate of new persistent genotype components).
Islands that are innovating get more compute; stagnant islands get less but
never zero (floor share) and receive migrants from active ones.

This is selection at the level of universes for *open-endedness*, not for
intelligence: no cognitive quantity enters the allocation.
"""
from __future__ import annotations

import math

import numpy as np

from .config import Config
from .sim import Simulation


class Archipelago:
    def __init__(self, cfgs: list[Config], out_dir: str | None = None,
                 floor: float = 0.1, ucb_c: float = 0.5, n_migrants: int = 6,
                 **sim_kw):
        self.islands = [Simulation(c, out_dir=(f"{out_dir}/island{i}" if out_dir else None),
                                   island_id=i, **sim_kw)
                        for i, c in enumerate(cfgs)]
        self.floor, self.ucb_c, self.n_migrants = floor, ucb_c, n_migrants
        self.pulls = np.ones(len(cfgs))
        self.value = np.zeros(len(cfgs))
        self.round = 0
        self.alloc_history: list[list[float]] = []

    def _score(self, sim: Simulation) -> float:
        h = sim.activity.history[-10:]
        if not h:
            return 0.0
        return float(np.mean([r["new_activity"] for r in h]))

    def run(self, rounds: int, budget: int):
        m = len(self.islands)
        for _ in range(rounds):
            self.round += 1
            total = self.pulls.sum()
            ucb = self.value + self.ucb_c * np.sqrt(np.log(total + 1) / self.pulls)
            share = np.exp(ucb - ucb.max())
            share = share / share.sum()
            share = self.floor / m + (1 - self.floor) * share
            steps = np.maximum(1, np.round(share * budget)).astype(int)
            self.alloc_history.append(share.tolist())
            for i, (sim, k) in enumerate(zip(self.islands, steps)):
                sim.run(int(k))
                r = self._score(sim)
                self.pulls[i] += k / budget
                self.value[i] += (r - self.value[i]) * min(1.0, k / budget)
            self._migrate()
        return self

    def _migrate(self):
        """Ring migration from each island to the next; the most active island
        additionally seeds the least active one."""
        m = len(self.islands)
        if m < 2:
            return
        out = [s.emigrants(self.n_migrants) for s in self.islands]
        for i in range(m):
            self.islands[(i + 1) % m].receive(out[i])
        best, worst = int(np.argmax(self.value)), int(np.argmin(self.value))
        if best != worst:
            self.islands[worst].receive(self.islands[best].emigrants(self.n_migrants))


def default_islands(base: Config, n: int, devices=("cpu",)) -> list[Config]:
    """Islands differ in seed, device and a few physics constants so that the
    archipelago samples a neighbourhood of universes rather than one."""
    rng = np.random.default_rng(base.seed)
    cfgs = []
    for i in range(n):
        cfgs.append(base.replace(
            seed=base.seed + 1000 * i,
            device=devices[i % len(devices)],
            season_period=int(base.season_period * math.exp(rng.normal(0, 0.3))),
            day_period=int(base.day_period * math.exp(rng.normal(0, 0.2))),
            c_neuron=base.c_neuron * math.exp(rng.normal(0, 0.3)),
            attack_power=base.attack_power * math.exp(rng.normal(0, 0.3)),
        ))
    return cfgs
