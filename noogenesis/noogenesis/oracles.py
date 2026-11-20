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


def _ids(world, n):
    return to_numpy(world.agents["id"][:n]).astype(np.int64)


def _state(arr, need, shape_tail, fill):
    """Grow a per-individual state array (indexed by agent id) to hold `need` ids."""
    if arr is None or arr.shape[0] < need:
        new = np.full((max(need, 64) * 2,) + shape_tail, fill, dtype=np.float64)
        if arr is not None:
            new[:arr.shape[0]] = arr
        return new
    return arr


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
    """Reflex + an allocentric memory of the best *fruit-level* food seen recently.
    Visible fruit is approached directly; when none is visible (night, grazed-down
    surroundings), the remembered location is preferred over visible grass."""
    name = "memory"

    def __init__(self, horizon=300, fruit=0.35, **kw):
        super().__init__(**kw)
        self.horizon, self.fruit = horizon, fruit
        self.goal = None

    def __call__(self, world, n, Xv):
        A = world.agents
        H, W = world.cfg.H, world.cfg.W
        if self.goal is None or self.goal.shape[0] < A.A:
            self.goal = np.full((A.A, 4), -1.0)        # y, x, value, time seen
        val = food_value(world, n, Xv)
        own = val[:, CENTER_P]
        pos = to_numpy(A["pos"][:n])
        hd = to_numpy(A["heading"][:n])
        v2 = val.copy()
        v2[:, CENTER_P] = 0
        j = v2.argmax(1)
        vbest = v2[np.arange(n), j]
        wy = (pos[:, 0] + PF[j] * F_DIR[hd, 0] + PS[j] * R_DIR[hd, 0]) % H
        wx = (pos[:, 1] + PF[j] * F_DIR[hd, 1] + PS[j] * R_DIR[hd, 1]) % W
        g = self.goal[:n]
        stale = (world.t - g[:, 3]) > self.horizon
        g[stale] = -1
        upd = (vbest >= self.fruit) & (vbest >= g[:, 2])
        g[upd] = np.stack([wy, wx, vbest, np.full(n, world.t)], 1)[upd]
        at = (g[:, 0] == pos[:, 0]) & (g[:, 1] == pos[:, 1]) & (own < self.fruit)
        g[at] = -1
        blocked = _blocked_front(world, n, Xv)
        eat = (own > 1e-3) & ((own >= self.eat_frac * vbest) | (own >= self.eat_abs))
        to_vis = steer(PF[j], PS[j], blocked)
        dy = (g[:, 0] - pos[:, 0] + H / 2) % H - H / 2
        dx = (g[:, 1] - pos[:, 1] + W / 2) % W - W / 2
        f = dy * F_DIR[hd, 0] + dx * F_DIR[hd, 1]
        s = dy * R_DIR[hd, 0] + dx * R_DIR[hd, 1]
        to_goal = steer(f, s, blocked)
        has_goal = g[:, 0] >= 0
        a = np.where(eat, EAT,
             np.where(vbest >= self.fruit, to_vis,
             np.where(has_goal, to_goal,
             np.where(vbest > 1e-3, to_vis, _wander(self.rng, n)))))
        return world.xp.asarray(a)


class Persist(Reflex):
    """Minimal memory: when no fruit-level food is visible, keep executing the
    last fruit-directed movement for up to `hold` steps (no map, no updating)."""
    name = "persist"

    def __init__(self, hold=6, fruit=0.35, **kw):
        super().__init__(**kw)
        self.hold, self.fruit = hold, fruit
        self.last, self.age = None, None

    def __call__(self, world, n, Xv):
        A = world.agents
        if self.last is None or self.last.shape[0] < A.A:
            self.last = np.full(A.A, -1)
            self.age = np.full(A.A, 999)
        val = food_value(world, n, Xv)
        own = val[:, CENTER_P]
        v2 = val.copy()
        v2[:, CENTER_P] = 0
        j = v2.argmax(1)
        vbest = v2[np.arange(n), j]
        blocked = _blocked_front(world, n, Xv)
        eat = (own > 1e-3) & ((own >= self.eat_frac * vbest) | (own >= self.eat_abs))
        to_vis = steer(PF[j], PS[j], blocked)
        last, age = self.last[:n], self.age[:n]
        fresh = vbest >= self.fruit
        last[fresh & ~eat] = to_vis[fresh & ~eat]
        age[fresh] = 0
        age[~fresh] += 1
        keep = ~fresh & (age <= self.hold) & (last >= 0)
        a = np.where(eat, EAT, np.where(fresh, to_vis,
             np.where(keep, np.where(blocked & (last == FWD), RIGHT, last),
             np.where(vbest > 1e-3, to_vis, _wander(self.rng, n)))))
        return world.xp.asarray(a)


class Learner(Reflex):
    """Reflex whose food values per species are learned from experience: after
    eating, the realised energy per unit of each species updates a running
    estimate; species currently estimated as harmful are neither approached nor
    eaten. (Uses only what an organism experiences: what it ate, what it got.)"""
    name = "learner"

    def __init__(self, rate=0.3, forget=0.01, prior=0.3, **kw):
        super().__init__(**kw)
        self.rate, self.forget, self.prior = rate, forget, prior
        self.v = None

    def choose(self, world, n, Xv):
        A = world.agents
        K = world.cfg.K_max
        ids = _ids(world, n)
        self.v = _state(self.v, int(ids.max()) + 1, (K,), 0.5)
        v = self.v[ids]
        le = to_numpy(world.last_eat)
        if le.shape[0] == n:
            eff = to_numpy(A["eff"][:n])
            val = to_numpy(world.species_value)
            amt = le[:, :K]
            ate = amt > 1e-4
            unit = eff[:, :K] * val[None, :]            # experienced energy per unit eaten
            v[ate] += self.rate * (unit[ate] - v[ate])
            v += self.forget * (self.prior - v)          # beliefs fade -> occasional re-tasting
            self.v[ids] = v
        w = np.clip(v, 0.0, None)                       # avoid what is believed harmful
        X = to_numpy(Xv).copy()
        X[:, :K, :] *= (w / np.maximum(to_numpy(A["eff"][:n])[:, :K], 1e-6))[:, :, None]
        return super().choose(world, n, world.xp.asarray(X))


class LearnMemory(Memory):
    """Learner + allocentric memory: species values are learned from experience
    (as in Learner) and the remembered fruit location uses learned values."""
    name = "learnmemory"

    def __init__(self, rate=0.3, forget=0.01, prior=0.3, **kw):
        super().__init__(**kw)
        self._L = Learner(rate=rate, forget=forget, prior=prior)

    def __call__(self, world, n, Xv):
        L, A, K = self._L, world.agents, world.cfg.K_max
        if L.v is None or L.v.shape[0] < A.A:
            L.v = np.full((A.A, K), 0.5)
        le = to_numpy(world.last_eat)
        if le.shape[0] == n:
            eff = to_numpy(A["eff"][:n])
            unit = eff[:, :K] * to_numpy(world.species_value)[None, :]
            ate = le[:, :K] > 1e-4
            v = L.v[:n]
            v[ate] += L.rate * (unit[ate] - v[ate])
            v += L.forget * (L.prior - v)
        w = np.clip(L.v[:n], 0.0, None)
        X = to_numpy(Xv).copy()
        X[:, :K, :] *= (w / np.maximum(to_numpy(A["eff"][:n])[:, :K], 1e-6))[:, :, None]
        return super().__call__(world, n, world.xp.asarray(X))


class Cacher(Reflex):
    """Hoarder with spatial memory. When nearly full and standing on food it
    picks food up; once carrying enough it drops it underfoot as a cache (hidden
    beyond range 1) and remembers the place. When hungry and nothing good is in
    view, it walks to the nearest remembered cache and eats there."""
    name = "cacher"

    def __init__(self, full=0.8, hungry=0.4, max_caches=12, **kw):
        super().__init__(**kw)
        self.full, self.hungry, self.M = full, hungry, max_caches
        self.caches = None

    def __call__(self, world, n, Xv):
        A, cfg = world.agents, world.cfg
        H, W = cfg.H, cfg.W
        ids = _ids(world, n)
        self.caches = _state(self.caches, int(ids.max()) + 1, (self.M, 2), -1)
        a, bval = self.choose(world, n, Xv)
        pos = to_numpy(A["pos"][:n])
        hd = to_numpy(A["heading"][:n])
        size = to_numpy(A["size"][:n])
        cap = max(getattr(cfg, "energy_cap", 0.0), 1e-9) * size
        frac = to_numpy(A["energy"][:n]) / cap
        carry = to_numpy(A["carry"][:n]).sum(1)
        own = food_value(world, n, Xv)[:, CENTER_P]
        C = self.caches[ids]
        # forget caches that are found empty when standing on them
        here = (C[:, :, 0] == pos[:, None, 0]) & (C[:, :, 1] == pos[:, None, 1])
        empty_here = here & (own[:, None] < 0.02)
        C[empty_here] = -1
        pick = (frac > self.full) & (own > 0.05) & (carry < 0.8 * cfg.carry_cap * size)
        drop = (carry >= 0.4 * cfg.carry_cap * size) & ~pick
        # remember a new cache where we drop
        for i in np.nonzero(drop)[0]:
            slot = np.nonzero(C[i, :, 0] < 0)[0]
            if slot.size:
                C[i, slot[0]] = pos[i]
        # hungry and nothing worthwhile visible -> go to nearest cache
        hungry = (frac < self.hungry) & (bval < 0.2) & (own < 0.05)
        dy = (C[:, :, 0] - pos[:, None, 0] + H / 2) % H - H / 2
        dx = (C[:, :, 1] - pos[:, None, 1] + W / 2) % W - W / 2
        dist = np.where(C[:, :, 0] >= 0, np.abs(dy) + np.abs(dx), 1e9)
        k = dist.argmin(1)
        has = dist[np.arange(n), k] < 1e9
        f = dy[np.arange(n), k] * F_DIR[hd, 0] + dx[np.arange(n), k] * F_DIR[hd, 1]
        s = dy[np.arange(n), k] * R_DIR[hd, 0] + dx[np.arange(n), k] * R_DIR[hd, 1]
        nav = steer(f, s, _blocked_front(world, n, Xv))
        from .config import DROP, PICK
        a = np.where(pick, PICK, np.where(drop, DROP, np.where(hungry & has, nav, a)))
        a = np.where(a < 0, _wander(self.rng, n), a)
        self.caches[ids] = C
        return world.xp.asarray(a)


LADDER = {"random": Random, "taste": Taste, "reflex": Reflex, "persist": Persist, "memory": Memory,
          "learner": Learner, "learnmemory": LearnMemory, "cacher": Cacher}


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
        groups = (to_numpy(world.agents["tag"][:n]) if self.groups is None else self.groups[:n])
        for gi, p in enumerate(self.policies):
            m = groups == gi
            if m.any() and not isinstance(p, Brain):
                a[m] = to_numpy(p(world, n, Xv))[m]
        return world.xp.asarray(a)


def survival(cfg, resident, invader, frac=0.5, n_agents=500, steps=2400, seed=0,
             physics=None, energy=4.0):
    """Mixed population, deaths on, no births or immigration: fraction of each
    group still alive after `steps` (e.g. through a winter)."""
    import copy
    from .world import World
    c = cfg.replace(init_agents=0, immigration=False, repro=False, deaths=True, seed=seed)
    w = World(c, physics=copy.deepcopy(physics) if physics else None, populate=False)
    w.refresh_masks()
    g = w.random_genomes(n_agents)
    g[:, w.lay.gs["max_age"].start] = 10.0       # only starvation should kill in this test
    g[:, w.lay.gs["size"].start] = 0.0           # equal bodies in both groups
    rng = np.random.default_rng(seed + 1)
    tags = (rng.random(n_agents) < frac).astype(np.int32)
    w.spawn(g, energy=energy)
    w.agents["tag"][:n_agents] = w.xp.asarray(tags)
    w.policy = Mixed([resident, invader], None)
    for _ in range(steps):
        w.step()
        if w.agents.n == 0:
            break
    alive = to_numpy(w.agents["tag"][:w.agents.n])
    s_res = float((alive == 0).sum() / max((tags == 0).sum(), 1))
    s_inv = float((alive == 1).sum() / max((tags == 1).sum(), 1))
    return dict(resident=s_res, invader=s_inv, diff=s_inv - s_res)


def invasion(cfg, resident, invader, frac=0.2, n_agents=500, settle=400, measure=600,
             seed=0, physics=None, genomes=None, energy=3.0, clamp=True):
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
    w.spawn(g, energy=energy)
    rng = np.random.default_rng(seed + 1)
    groups = (rng.random(w.agents.A) < frac).astype(int)
    w.policy = Mixed([resident, invader], groups)
    K = c.K_max
    tot = np.zeros(w.agents.A)
    reserve = np.zeros(w.agents.A)
    for t in range(settle + measure):
        w.step()
        A = w.agents
        if clamp:
            d = energy - A["energy"][:A.n]   # hold bodies at the residents' typical energy
            A["energy"][:A.n] += d
            A["prev_energy"][:A.n] += d
        elif t >= settle:                    # unclamped: score the energy reserve over time
            reserve[:A.n] += to_numpy(A["energy"][:A.n])
        if t >= settle:   # realised energy, including the sign of toxic food
            le = to_numpy(w.last_eat)
            eff = to_numpy(A["eff"][:A.n])
            val = to_numpy(w.species_value)
            tot[:A.n] += (eff[:, :K] * val[None, :] * le[:, :K]).sum(1) + eff[:, K] * le[:, K]
    n = w.agents.n
    g = groups[:n]
    if not clamp:   # mean energy reserve (can be negative: starvation debt)
        inv, res = reserve[:n][g == 1].mean() / measure, reserve[:n][g == 0].mean() / measure
        return dict(invader=inv, resident=res, ratio=inv / max(abs(res), 1e-9), diff=inv - res)
    inv, res = tot[:n][g == 1].mean() / measure, tot[:n][g == 0].mean() / measure
    return dict(invader=inv, resident=res, ratio=inv / max(res, 1e-9))
