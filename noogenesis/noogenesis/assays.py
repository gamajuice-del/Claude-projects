"""Cognitive assays: comparative-psychology test chambers for evolved minds.

Subjects are grown fresh from genomes (genotype-level assessment: innate
structure + whatever the evolved plasticity learns *during the assay*) and
placed in identical walled chambers, all tested in parallel inside one World
running the same physics engine as evolution. Nothing learned in the assay
feeds back into evolution.

Every assay comes with a control that a non-cognitive strategy cannot pass
(no-cue chance level, plasticity knock-out, uninformative cue), because the
quantity of interest is always the *difference* from the control - the
classic defence against Clever-Hans effects.

  visible_foraging   approach visible food (competence baseline)
  delayed_response   object-permanence / working memory: food is shown, then
                     hidden for a delay, then the subject is released
  reversal_learning  two foods, one nutritious one bitter; contingencies swap
                     mid-life. Run with and without plasticity.
"""
from __future__ import annotations

import copy
import math

import numpy as np

from .backend import to_numpy
from .config import Config
from .unfolding import Physics
from .world import World


class ChamberWorld:
    def __init__(self, genomes: np.ndarray, cfg: Config, physics: Physics,
                 cs: int = 13, seed: int = 0, plastic: bool = True):
        m = int(genomes.shape[0])
        tiles = int(math.ceil(math.sqrt(m)))
        H = W = tiles * cs
        c = cfg.replace(H=H, W=W, max_agents=m, init_agents=0, min_agents=0,
                        growth=False, climate=False, repro=False, immigration=False,
                        deaths=False, cache_decay=0.0, meat_decay=0.0, wall_decay=0.0,
                        seed=seed, tox_period=0, food_visibility=1.0)
        self.w = w = World(c, physics=copy.deepcopy(physics), populate=False)
        w.force_day = True
        w.plastic_on = plastic
        xp = w.xp
        w.veg[:] = 0
        wall = np.zeros((H, W), np.float32)
        for t in range(tiles):
            for b in (0, 1, cs - 2, cs - 1):
                wall[t * cs + b, :] = 1
                wall[:, t * cs + b] = 1
        w.wall = xp.asarray(wall)
        cy, cx = np.meshgrid(np.arange(tiles), np.arange(tiles), indexing="ij")
        centers = np.stack([cy.ravel() * cs + cs // 2, cx.ravel() * cs + cs // 2], 1)[:m]
        self.centers = centers.astype(np.int32)
        self.m = m
        w.spawn(xp.asarray(genomes.astype(np.float32)), positions=xp.asarray(self.centers),
                headings=xp.zeros(m, np.int32), energy=4.0)
        self.xp = xp

    # -- scripting helpers ---------------------------------------------------
    def reset_bodies(self, energy=4.0):
        A, xp = self.w.agents, self.xp
        A["pos"][:self.m] = xp.asarray(self.centers)
        A["heading"][:self.m] = 0
        A["energy"][:self.m] = energy
        A["prev_energy"][:self.m] = energy
        A["carry"][:self.m] = 0
        A["health"][:self.m] = 1.0

    def clear_food(self):
        w = self.w
        w.veg[:] = 0
        w.cache[:] = 0
        w.meat[:] = 0

    def cells(self, rel):
        """rel: (m, 2) offsets from each subject's chamber centre."""
        p = self.centers + rel
        return self.xp.asarray(p[:, 0]), self.xp.asarray(p[:, 1])

    def freeze(self, on: bool):
        self.w.agents["frozen"][:self.m] = on

    def positions(self):
        return to_numpy(self.w.agents["pos"][:self.m])

    def step(self, k=1):
        for _ in range(k):
            self.w.step()


def _sides(rng, m):
    return rng.choice([-1, 1], m)


def visible_foraging(genomes, cfg, physics, trials=8, steps=24, seed=0):
    cw = ChamberWorld(genomes, cfg, physics, seed=seed)
    rng = np.random.default_rng(seed)
    hit = np.zeros(cw.m)
    for _ in range(trials):
        side = _sides(rng, cw.m)
        rel = np.stack([np.full(cw.m, -2), 2 * side], 1)
        cw.clear_food()
        cw.reset_bodies()
        y, x = cw.cells(rel)
        cw.w.veg[0, y, x] = 1.0
        got = np.zeros(cw.m, bool)
        for _ in range(steps):
            cw.step()
            got |= to_numpy(cw.w.last_eat[:cw.m, 0]) > 0
        hit += got
    return dict(visible_eat_rate=float(hit.mean() / trials), per_subject=hit / trials)


def delayed_response(genomes, cfg, physics, delays=(0, 3, 8), trials=12, show=4,
                     resp=24, seed=0, plastic=True):
    """Food shown at front-left or front-right (distance 2) for `show` steps
    while the subject is held still; then it becomes a hidden cache (smell
    range 1 only) for `delay` steps; then the subject is released. Score =
    which of the two candidate cells it reaches first. Condition delay=None
    is the no-cue control (food hidden from the start)."""
    out = {}
    for delay in list(delays) + [None]:
        cw = ChamberWorld(genomes, cfg, physics, seed=seed, plastic=plastic)
        rng = np.random.default_rng(seed + 17)
        corr = np.zeros(cw.m)
        wrong = np.zeros(cw.m)
        for _ in range(trials):
            side = _sides(rng, cw.m)
            tgt = np.stack([np.full(cw.m, -2), 2 * side], 1)
            mir = np.stack([np.full(cw.m, -2), -2 * side], 1)
            cw.clear_food()
            cw.reset_bodies()
            cw.freeze(True)
            ty, tx = cw.cells(tgt)
            if delay is None:
                cw.w.cache[0, ty, tx] = 1.0
                cw.step(show)
            else:
                cw.w.veg[0, ty, tx] = 1.0
                cw.step(show)
                cw.w.veg[0, ty, tx] = 0.0
                cw.w.cache[0, ty, tx] = 1.0
                cw.step(delay)
            cw.freeze(False)
            decided = np.zeros(cw.m, bool)
            T = cw.centers + tgt
            M = cw.centers + mir
            for _ in range(resp):
                cw.step()
                p = cw.positions()
                at_t = (p == T).all(1) & ~decided
                at_m = (p == M).all(1) & ~decided
                corr += at_t
                wrong += at_m
                decided |= at_t | at_m
        dec = corr + wrong
        acc = float(corr.sum() / max(dec.sum(), 1))
        key = "nocue" if delay is None else f"d{delay}"
        out[key] = dict(acc=acc, reach=float(dec.mean() / trials),
                        k=int(corr.sum()), n=int(dec.sum()))
    base = out["nocue"]["acc"]
    out["memory_index"] = {k: v["acc"] - base for k, v in out.items() if k.startswith("d")}
    return out


def reversal_learning(genomes, cfg, physics, trials=10, steps=30, seed=0, plastic=True):
    """Species-0 and species-1 food appear on random sides. One is nutritious
    (+1), the other bitter (-1, it costs energy). After `trials` trials the
    contingency reverses. Counterbalanced over which species starts good."""
    accs = []
    for good_first in (0, 1):
        cw = ChamberWorld(genomes, cfg, physics, seed=seed + good_first, plastic=plastic)
        rng = np.random.default_rng(seed + 31 + good_first)
        rec = np.full((2 * trials, cw.m), np.nan)
        for tr in range(2 * trials):
            good = good_first if tr < trials else 1 - good_first
            val = np.zeros(cfg.K_max, np.float32)
            val[good], val[1 - good] = 1.0, -1.0
            cw.w.species_value = cw.xp.asarray(val)
            side = _sides(rng, cw.m)
            cw.clear_food()
            cw.reset_bodies()
            a = np.stack([np.full(cw.m, -2), 2 * side], 1)
            b = np.stack([np.full(cw.m, -2), -2 * side], 1)
            ya, xa = cw.cells(a)
            yb, xb = cw.cells(b)
            cw.w.veg[0, ya, xa] = 1.0
            cw.w.veg[1, yb, xb] = 1.0
            done = np.zeros(cw.m, bool)
            for _ in range(steps):
                cw.step()
                le = to_numpy(cw.w.last_eat[:cw.m, :2])
                ate = (le.sum(1) > 0) & ~done
                choice = np.argmax(le, 1)
                rec[tr, ate] = (choice[ate] == good)
                done |= ate
        accs.append(rec)
    R = np.concatenate(accs, 1)                       # (2*trials, subjects*2)
    acc = np.nanmean(R, 1)
    q = max(2, trials // 3)
    return dict(
        acc_curve=[None if np.isnan(a) else float(a) for a in acc],
        n_choices=int(np.sum(~np.isnan(R))),
        choice_rate=float(np.mean(~np.isnan(R))),
        acquisition=float(np.nanmean(R[trials - q:trials]) - np.nanmean(R[:q])),
        reversal=float(np.nanmean(R[2 * trials - q:]) - np.nanmean(R[trials:trials + q])),
        late_acc=float(np.nanmean(np.concatenate([R[trials - q:trials], R[2 * trials - q:]]))),
    )


def battery(genomes, cfg, physics, seed=0, quick=False):
    """Run the core battery on a sample of genomes; returns a flat dict."""
    tr = 6 if quick else 12
    res = {}
    vf = visible_foraging(genomes, cfg, physics, trials=tr // 2 + 2, seed=seed)
    res["visible_eat_rate"] = vf["visible_eat_rate"]
    dr = delayed_response(genomes, cfg, physics, trials=tr, seed=seed)
    res["delayed"] = dr
    res["memory_index_d3"] = dr["memory_index"].get("d3", 0.0)
    rl = reversal_learning(genomes, cfg, physics, trials=tr, seed=seed)
    rk = reversal_learning(genomes, cfg, physics, trials=tr, seed=seed, plastic=False)
    res["reversal"] = rl
    res["reversal_knockout"] = rk
    res["plasticity_gain"] = float(rl["late_acc"] - rk["late_acc"])
    return res
