#!/usr/bin/env python3
"""Second-pass instruments on final worlds with larger samples and statistics:
representation atlas (class-balanced probes), first language lesson with
significance tests, and delayed response with counts.

  python scripts/addendum.py --runs R_A R_B R_C --out docs/addendum.json
"""
import argparse
import glob
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.assays import delayed_response  # noqa: E402
from noogenesis.language import lesson_battery, representation_atlas  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--subjects", type=int, default=100)
    ap.add_argument("--trials", type=int, default=40)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    res = {}
    for run in a.runs:
        name = os.path.basename(run)
        w = pickle.load(open(os.path.join(run, "world_final.pkl"), "rb"))
        last = sorted(glob.glob(os.path.join(run, "archive", "t*.npz")))[-1]
        G = np.load(last)["genomes"]
        rng = np.random.default_rng(11)
        sub = G[rng.choice(len(G), min(a.subjects, len(G)), replace=False)]
        R = {"atlas": representation_atlas(w, steps=250)}
        R["lesson"] = lesson_battery(sub, w.cfg, w.physics, trials=a.trials, seed=3)
        R["delayed"] = delayed_response(sub, w.cfg, w.physics, trials=16, seed=3)
        res[name] = R
        L = R["lesson"]
        print(name, "lesson late inf/sham/ko:", round(L["informative"]["late"], 3),
              round(L["uninformative"]["late"], 3), round(L["knockout"]["late"], 3),
              "n_late", L["informative"]["n_late"], "p_vs_sham", round(L["p_vs_uninformative"], 4),
              "p_vs_chance", round(L["p_late_vs_chance"], 4), flush=True)
        for k, v in R["atlas"].items():
            print(f"   {k:22s} h={v['from_h']:.3f} x={v['from_x']:.3f}", flush=True)
    with open(a.out, "w") as f:
        json.dump(res, f, indent=1, default=float)


if __name__ == "__main__":
    main()
