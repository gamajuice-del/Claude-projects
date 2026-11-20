#!/usr/bin/env python3
"""Does the evolved population learn within its lifetime?

For each final world:
  * lesions: vision, memory (reflex-only), plasticity (all lifetime learning off)
  * diet selectivity in the wild: fraction of food eaten that belongs to the
    currently nutritious species, intact vs plasticity knocked out (same RNG)
  * oracle ladder under full toxicity: learner and reflex oracles invading
  * chamber reversal-learning assay: intact vs plasticity knock-out
  * evolved learning genes (rate, sign of value coupling, forgetting)

  python scripts/learning_check.py --runs R1 R2 --out learning.json
"""
import argparse
import glob
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.assays import reversal_learning  # noqa: E402
from noogenesis.backend import to_numpy  # noqa: E402
from noogenesis.metrics import lesion_study  # noqa: E402
from noogenesis.oracles import Brain, Learner, Reflex, invasion  # noqa: E402


def selectivity(world, steps=690, plastic=True):
    w = world.clone()
    w.plastic_on = plastic
    K = w.cfg.K_max
    good = bad = 0.0
    for _ in range(steps):
        w.step()
        le = to_numpy(w.last_eat)[:, :K].sum(0)
        val = to_numpy(w.species_value)
        good += float((le * (val > 0)).sum())
        bad += float((le * (val <= 0)).sum())
    return good / max(good + bad, 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--subjects", type=int, default=49)
    a = ap.parse_args()
    rows = []
    for run in a.runs:
        w = pickle.load(open(os.path.join(run, "world_final.pkl"), "rb"))
        G = np.load(sorted(glob.glob(os.path.join(run, "archive", "*.npz")))[-1])["genomes"]
        A, lay, n = w.agents, w.lay, w.agents.n
        r = dict(run=os.path.basename(run), t=w.t, pop=n)
        r.update({k: round(v, 4) for k, v in
                  lesion_study(w, steps=345, kinds=("vision", "memory", "plasticity")).items()})
        r["selectivity_intact"] = round(selectivity(w, plastic=True), 4)
        r["selectivity_no_plasticity"] = round(selectivity(w, plastic=False), 4)
        full = w.cfg.replace(tox_start=0, tox_ramp=0)
        e_typ = float(np.median(to_numpy(A["energy"][:n])))
        for nm, P in (("learner", Learner), ("reflex", Reflex)):
            r[f"{nm}_vs_brains"] = round(float(invasion(full, Brain(), P(seed=3), physics=w.physics,
                                                        genomes=G, settle=300, measure=700,
                                                        energy=e_typ)["ratio"]), 3)
        rng = np.random.default_rng(0)
        sub = G[rng.choice(len(G), min(a.subjects, len(G)), replace=False)]
        rl = reversal_learning(sub, w.cfg, w.physics, trials=12, seed=1)
        rk = reversal_learning(sub, w.cfg, w.physics, trials=12, seed=1, plastic=False)
        r.update(rev_late=round(rl["late_acc"], 3), rev_late_ko=round(rk["late_acc"], 3),
                 rev_reversal=round(rl["reversal"], 3), rev_choices=rl["n_choices"],
                 rev_curve=[None if c is None else round(c, 2) for c in rl["acc_curve"]])
        if "sal_eta" in lay.gs:
            r.update(sal_eta=round(float(to_numpy(A["sal_eta"][:n]).mean()), 4),
                     sal_dE_pos=round(float((to_numpy(A["sal_dE"][:n]) > 0).mean()), 3),
                     sal_decay=round(float(to_numpy(A["sal_decay"][:n]).mean()), 4))
        rows.append(r)
        print(json.dumps(r), flush=True)
    with open(a.out, "w") as f:
        json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main()
