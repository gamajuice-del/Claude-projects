#!/usr/bin/env python3
"""Diagnostic: can this genome/development scheme *represent* a forager as
good as the reflex oracle, if selection were strong and noise-free?

Directed truncation selection on food intake, in a shared world where 1/8 of
the agents are reflex oracles (the yardstick). This is a measuring instrument
for the genotype-phenotype map, never part of the evolutionary process.

  python scripts/capacity_probe.py --set rf_mode=gaussian --gens 40 --out probe.json
"""
import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.backend import to_numpy  # noqa: E402
from noogenesis.config import Config  # noqa: E402
from noogenesis.genome import mutate  # noqa: E402
from noogenesis.oracles import Brain, Mixed, Reflex  # noqa: E402
from noogenesis.world import World  # noqa: E402


def evaluate(cfg, genomes, copies, n_oracle, settle, measure, seed):
    c = cfg.replace(init_agents=0, immigration=False, repro=False, deaths=False, seed=seed)
    w = World(c, populate=False)
    G = len(genomes)
    gid = np.repeat(np.arange(G), copies)
    w.spawn(w.xp.asarray(genomes[gid]), energy=3.0)
    w.spawn(w.random_genomes(n_oracle), energy=3.0)
    n = w.agents.n
    groups = np.zeros(w.agents.A, int)
    groups[G * copies:n] = 1
    w.policy = Mixed([Brain(), Reflex(seed=seed)], groups)
    K = c.K_max
    tot = np.zeros(n)
    for t in range(settle + measure):
        w.step()
        A = w.agents
        d = 3.0 - A["energy"][:n]
        A["energy"][:n] += d
        A["prev_energy"][:n] += d
        if t >= settle:
            le, eff = to_numpy(w.last_eat), to_numpy(A["eff"][:n])
            val = to_numpy(w.species_value)
            tot += (eff[:, :K] * val[None, :] * le[:, :K]).sum(1) + eff[:, K] * le[:, K]
    per = np.bincount(gid, weights=tot[:G * copies], minlength=G) / copies
    return per / measure, tot[G * copies:].mean() / measure


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", nargs="*", default=[])
    ap.add_argument("--gens", type=int, default=40)
    ap.add_argument("--pop", type=int, default=56)
    ap.add_argument("--copies", type=int, default=8)
    ap.add_argument("--settle", type=int, default=100)
    ap.add_argument("--measure", type=int, default=300)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    cfg = Config(seed=a.seed)
    over = {}
    for kv in a.set:
        k, v = kv.split("=", 1)
        cur = getattr(cfg, k)
        over[k] = type(cur)(v)
    cfg = cfg.replace(**over)
    w0 = World(cfg.replace(init_agents=0), populate=False)
    xp, lay, mask = w0.xp, w0.lay, w0.mutable
    pop = to_numpy(w0.random_genomes(a.pop))
    rng = np.random.default_rng(a.seed)
    hist = []
    for gen in range(a.gens):
        t0 = time.time()
        fit, oracle = evaluate(cfg, pop, a.copies, a.pop * a.copies // 7, a.settle, a.measure,
                               seed=a.seed * 1000 + gen)
        order = np.argsort(-fit)
        rec = dict(gen=gen, best=float(fit[order[0]]), mean=float(fit.mean()),
                   oracle=float(oracle), best_ratio=float(fit[order[0]] / oracle),
                   mean_ratio=float(fit.mean() / oracle))
        hist.append(rec)
        print(json.dumps({k: round(v, 4) for k, v in rec.items()}), f"{time.time() - t0:.0f}s", flush=True)
        elite = pop[order[:a.pop // 4]]
        kids = elite[rng.integers(0, len(elite), a.pop - len(elite))].copy()
        kids = to_numpy(mutate(xp, w0.rng_dev, lay, xp.asarray(kids), mask))
        pop = np.concatenate([elite, kids], 0).astype(np.float32)
    if a.out:
        with open(a.out, "w") as f:
            json.dump(dict(set=a.set, history=hist), f, indent=1)


if __name__ == "__main__":
    main()
