#!/usr/bin/env python3
"""Is invasion screening measuring heritable signal or noise?

Runs the screen with two independent replicates (each with its own common
random numbers shared by treatment and control) on the same mutants, at
several horizons, and reports the between-replicate correlation of the
selection estimates. If it is ~0 the screen is selecting on luck.

  python scripts/validate_iff.py --world results/A/world_final.pkl --out docs/iff_validation.json
"""
import argparse
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.accelerate import InvasionScreen  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--world", required=True)
    ap.add_argument("--horizons", type=int, nargs="+", default=[100, 300])
    ap.add_argument("--probes", type=int, default=40)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    world = pickle.load(open(a.world, "rb"))
    out = []
    for H in a.horizons:
        S1, S2 = [], []
        for r in range(a.rounds):
            w = world.clone()
            for _ in range(50 * r):        # different resident states per round
                w.step()
            rec = InvasionScreen(n_probes=a.probes, horizon=H, replicates=2, seed=r).run(w)
            S1 += rec["s_reps"][0]
            S2 += rec["s_reps"][1]
        S1, S2 = np.array(S1), np.array(S2)
        corr = float(np.corrcoef(S1, S2)[0, 1])
        # sign agreement among mutants with |s| clearly non-zero in replicate 1
        big = np.abs(S1) > 0.1
        agree = float((np.sign(S1[big]) == np.sign(S2[big])).mean()) if big.any() else None
        row = dict(horizon=H, n=int(S1.size), replicate_corr=corr, sign_agreement=agree,
                   s_sd=float(np.concatenate([S1, S2]).std()),
                   frac_pass_both_0p1=float(((S1 > 0.1) & (S2 > 0.1)).mean()),
                   frac_pass_one_0p1=float((S1 > 0.1).mean()))
        out.append(row)
        print(json.dumps(row), flush=True)
    if a.out:
        with open(a.out, "w") as f:
            json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
