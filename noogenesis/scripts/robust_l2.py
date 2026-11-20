#!/usr/bin/env python3
"""Replicate the L2 word lesson and L1 signal measure with several seeds."""
import argparse
import glob
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from noogenesis.language import word_lesson_battery  # noqa: E402
from readiness import l1_signals  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--seeds", type=int, nargs="+", default=[11, 12, 13])
    ap.add_argument("--subjects", type=int, default=100)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    w = pickle.load(open(os.path.join(a.run, "world_final.pkl"), "rb"))
    G = np.load(sorted(glob.glob(os.path.join(a.run, "archive", "*.npz")))[-1])["genomes"]
    rows = []
    for s in a.seeds:
        sub = G[np.random.default_rng(s).choice(len(G), min(a.subjects, len(G)), replace=False)]
        wl = word_lesson_battery(sub, w.cfg, w.physics, seed=s)
        sig = l1_signals(w.clone(), steps=300, seed=s)
        r = dict(seed=s, informative=wl["informative"]["early_second_half"],
                 uninformative=wl["uninformative"]["early_second_half"],
                 knockout=wl["knockout"]["early_second_half"], benefit=wl["word_benefit"],
                 n=wl["informative"]["n_early"], signal_excess=sig["excess"])
        rows.append(r)
        print(json.dumps(r), flush=True)
    b = np.array([r["benefit"] for r in rows])
    summ = dict(run=os.path.basename(a.run), benefit_mean=float(b.mean()), benefit_sd=float(b.std(ddof=1)),
                inf_minus_ko=float(np.mean([r["informative"] - r["knockout"] for r in rows])), rows=rows)
    print(json.dumps({k: v for k, v in summ.items() if k != "rows"}), flush=True)
    json.dump(summ, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
