"""Oracle ladder: hand-written strategies at successive cognitive levels.

They are used only to *measure the world*, never inside evolution. The gap in
food intake between consecutive rungs is the selection gradient that a lineage
would feel if it climbed that rung, i.e. how much the world pays for the
faculty. Ecology calibration (scripts/calibrate_ecology.py) tunes physics so
that every rung pays substantially while the lowest rung stays viable, which
is "shape the world, never the fitness function" made quantitative.

Rungs
  random     uniform over {forward, left, right, eat}
  taste      no vision: keeps eating while bites pay (interoceptive feedback),
             otherwise wanders. The strongest strategy available to a blind
             forager.
  reflex     sees its 5x5 patch, eats when the cell under it is good enough,
             otherwise steers to the best visible food. No memory.
  memory     reflex + an allocentric memory of the best food location seen in
             the last `horizon` steps (dead reckoning), used when nothing good
             is visible (night, depleted patches).
"""
from __future__ import annotations

import numpy as np

from .backend import to_numpy
from .config import EAT, FWD, LEFT, RIGHT
from .world import CENTER_P, F_DIR, PATCH, R_DIR

PF = np.array([f for f, s in PATCH])
PS = np.array([s for f, s in PATCH])
DIST = np.abs(PF) + np.abs(PS)


def food_value(world, n, Xv):
    """Energy an agent would get per unit of each visible cell: (n, P)."""
    K = world.cfg.K_max
    X = to_numpy(Xv)
    eff = to_numpy(world.agents["eff"][:n])
    val = (X[:, :K, :] * eff[:, :K, None]).sum(1) + X[:, K, :] * eff[:, K, None]
    val += X[:, K + 1, :] * eff[:, :K].mean(1)[:, None]
    occupied = X[:, K + 2, :] > 0
    occupied[:, CENTER_P] = False
    val[occupied] = 0.0
    return val


def steer(f, s, blocked_front):
    """Egocentric Manhattan steering towards (f, s)."""
    a = np.where(f > 0, FWD, np.where(s < 0, LEFT, np.where(s > 0, RIGHT, LEFT)))
    a = np.where((a == FWD) & blocked_front, np.where(s >= 0, RIGHT, LEFT), a)
    return a


def _wander(rng, n, p_turn=0.2):
    u = rng.random(n)
    return np.where(u < p_turn / 2, LEFT, np.where(u < p_turn, RIGHT, FWD))


def _blocked_front(world, n, Xv):
    K = world.cfg.K_max
    X = to_numpy(Xv)
    from .world import FRONT_P
    return (X[:, K + 2, FRONT_P] > 0) | (X[:, K + 6, FRONT_P] > 0.5)


class Random:
    name = "random"

    def __init__(self, seed=0):
        self.rng = np.random.default_rng(seed)

    def __call__(self, world, n, Xv):
        return world.xp.asarray(self.rng.choice([FWD, LEFT, RIGHT, EAT], n))


class Taste:
    """Blind but not senseless: eats while the last bite paid more than
    `min_gain`; after moving, always takes one exploratory bite."""
    name = "taste"

    def __init__(self, min_gain=0.03, p_turn=0.2, seed=0):
        self.min_gain, self.p_turn = min_gain, p_turn
        self.rng = np.random.default_rng(seed)

    def __call__(self, world, n, Xv):
        last = to_numpy(world.agents["last_action"][:n])
        le = to_numpy(world.last_eat)
        gain = le.sum(1) if le.shape[0] == n else np.zeros(n)
        keep = (last == EAT) & (gain > self.min_gain)
        bite = last == FWD
        a = np.where(keep | bite, EAT, _wander(self.rng, n, self.p_turn))
        return world.xp.asarray(a)


class Reflex:
    name = "reflex"

    def __init__(self, eat_frac=0.6, eat_abs=0.12, seed=0):
        self.eat_frac, self.eat_abs = eat_frac, eat_abs
        self.rng = np.random.default_rng(seed)

    def choose(self, world, n, Xv):
        val = food_value(world, n, Xv)
        own = val[:, CENTER_P]
        score = val - 0.02 * DIST[None, :]
        score[:, CENTER_P] = -1
        best = score.argmax(1)
        bval = val[np.arange(n), best]
        eat = (own > 1e-3) & ((own >= self.eat_frac * bval) | (own >= self.eat_abs))
        go = (bval > 1e-3) & ~eat
        a = steer(PF[best], PS[best], _blocked_front(world, n, Xv))
        a = np.where(eat, EAT, np.where(go, a, -1))
        return a, bval

    def __call__(self, world, n, Xv):
        a, _ = self.choose(world, n, Xv)
        a = np.where(a < 0, _wander(self.rng, n), a)
        return world.xp.asarray(a)


class Memory(Reflex):
    """Reflex + remembers the world position of the best food it has seen."""
    name = "memory"

    def __init__(self, horizon=200, **kw):
        super().__init__(**kw)
        self.horizon = horizon
        self.goal = None

    def __call__(self, world, n, Xv):
        A = world.agents
        H, W = world.cfg.H, world.cfg.W
        if self.goal is None or self.goal.shape[0] < n:
            self.goal = np.full((A.A, 4), -1.0)        # y, x, value, time seen
        a, _ = self.choose(world, n, Xv)
        pos = to_numpy(A["pos"][:n])
        hd = to_numpy(A["heading"][:n])
        val = food_value(world, n, Xv)
        # remember the best visible non-own cell, in world coordinates
        v2 = val.copy()
        v2[:, CENTER_P] = 0
        j = v2.argmax(1)
        vbest = v2[np.arange(n), j]
        wy = (pos[:, 0] + PF[j] * F_DIR[hd, 0] + PS[j] * R_DIR[hd, 0]) % H
        wx = (pos[:, 1] + PF[j] * F_DIR[hd, 1] + PS[j] * R_DIR[hd, 1]) % W
        g = self.goal[:n]
        stale = (world.t - g[:, 3]) > self.horizon
        upd = (vbest > 0.2) & ((vbest > g[:, 2]) | stale | (g[:, 0] < 0))
        g[upd] = np.stack([wy, wx, vbest, np.full(n, world.t)], 1)[upd]
        # arrived at goal -> forget it
        at = (g[:, 0] == pos[:, 0]) & (g[:, 1] == pos[:, 1])
        g[at | stale, 0] = -1
        g[at | stale, 2] = -1
        # when nothing good is visible, navigate to the remembered goal
        need = (a < 0) & (g[:, 0] >= 0)
        dy = (g[:, 0] - pos[:, 0] + H / 2) % H - H / 2
        dx = (g[:, 1] - pos[:, 1] + W / 2) % W - W / 2
        f = dy * F_DIR[hd, 0] + dx * F_DIR[hd, 1]
        s = dy * R_DIR[hd, 0] + dx * R_DIR[hd, 1]
        nav = steer(f, s, _blocked_front(world, n, Xv))
        a = np.where(need, nav, a)
        a = np.where(a < 0, _wander(self.rng, n), a)
        return world.xp.asarray(a)


LADDER = {"random": Random, "taste": Taste, "reflex": Reflex, "memory": Memory}


def evaluate(cfg, policy, n_agents=500, settle=500, measure=500, seed=0, physics=None,
             genomes=None):
    """Mean food intake per agent-step for a population that all follows
    `policy` (or, if policy is None, brains grown from `genomes`), at fixed
    density: no births, no deaths, no immigration."""
    import copy
    from .world import World
    c = cfg.replace(init_agents=0, immigration=False, repro=False, deaths=False, seed=seed)
    w = World(c, physics=copy.deepcopy(physics) if physics else None, populate=False)
    w.refresh_masks()
    if genomes is None:
        g = w.random_genomes(n_agents)
    else:
        rng = np.random.default_rng(seed)
        g = w.xp.asarray(genomes[rng.integers(0, len(genomes), n_agents)].astype(np.float32))
    w.spawn(g, energy=3.0)
    w.policy = policy

    def refill():                 # keep bodies comparable without disturbing dE
        A = w.agents
        d = 3.0 - A["energy"][:A.n]
        A["energy"][:A.n] += d
        A["prev_energy"][:A.n] += d

    for _ in range(settle):
        w.step()
        refill()
    w.counters.clear()
    steps = 0
    for _ in range(measure):
        steps += w.agents.n
        w.step()
        refill()
    return w.counters.get("eat_gain", 0.0) / max(steps, 1)


class Brain:
    """Placeholder strategy: the organism's own evolved brain decides."""
    name = "brain"

    def __call__(self, world, n, Xv):
        return world.xp.full(n, -1)


class Mixed:
    """Agents in group g follow policies[g] (slots are stable: no births/deaths).
    A policy may be Brain(), in which case those agents use their brains."""

    def __init__(self, policies, groups):
        self.policies, self.groups = policies, groups
        self.needs_brain = any(isinstance(p, Brain) for p in policies)

    def __call__(self, world, n, Xv):
        a = np.full(n, -1, np.int64)
        for gi, p in enumerate(self.policies):
            m = self.groups[:n] == gi
            if m.any() and not isinstance(p, Brain):
                a[m] = to_numpy(p(world, n, Xv))[m]
        return world.xp.asarray(a)


def invasion(cfg, resident, invader, frac=0.2, n_agents=500, settle=400, measure=600,
             seed=0, physics=None, genomes=None):
    """Relative intake of a minority strategy (invader) in a population of
    residents: >1 means the world pays for the invader's extra faculty. This is
    the selection gradient a rare mutant climbing one rung would feel."""
    import copy
    from .world import World
    c = cfg.replace(init_agents=0, immigration=False, repro=False, deaths=False, seed=seed)
    w = World(c, physics=copy.deepcopy(physics) if physics else None, populate=False)
    w.refresh_masks()
    if genomes is None:
        g = w.random_genomes(n_agents)
    else:
        r0 = np.random.default_rng(seed)
        g = w.xp.asarray(genomes[r0.integers(0, len(genomes), n_agents)].astype(np.float32))
    w.spawn(g, energy=3.0)
    rng = np.random.default_rng(seed + 1)
    groups = (rng.random(w.agents.A) < frac).astype(int)
    w.policy = Mixed([resident, invader], groups)
    K = c.K_max
    tot = np.zeros(w.agents.A)
    for t in range(settle + measure):
        w.step()
        A = w.agents
        d = 3.0 - A["energy"][:A.n]
        A["energy"][:A.n] += d
        A["prev_energy"][:A.n] += d
        if t >= settle:
            le = to_numpy(w.last_eat)
            eff = to_numpy(A["eff"][:A.n])
            tot[:A.n] += (eff[:, :K] * le[:, :K]).sum(1) + eff[:, K] * le[:, K]
    n = w.agents.n
    g = groups[:n]
    inv, res = tot[:n][g == 1].mean() / measure, tot[:n][g == 0].mean() / measure
    return dict(invader=inv, resident=res, ratio=inv / max(res, 1e-9))
