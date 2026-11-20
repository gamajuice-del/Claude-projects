#!/usr/bin/env python3
"""Lesion + ladder summary of final worlds: does the population use vision?

  python scripts/perception_check.py --runs R1 R2 ... --out perception.json
"""
import argparse
import glob
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.metrics import lesion_study  # noqa: E402
from noogenesis.oracles import Brain, Random, Reflex, Taste, invasion  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rows = []
    for run in a.runs:
        w = pickle.load(open(os.path.join(run, "world_final.pkl"), "rb"))
        G = np.load(sorted(glob.glob(os.path.join(run, "archive", "*.npz")))[-1])["genomes"]
        r = dict(run=os.path.basename(run), t=w.t, pop=w.agents.n,
                 **{k: round(v, 4) for k, v in lesion_study(w, steps=200, kinds=("vision", "memory")).items()})
        e_typ = float(np.median(np.asarray(w.agents["energy"][:w.agents.n])))
        r["energy_median"] = round(e_typ, 3)
        for nm, P in (("random", Random), ("taste", Taste), ("reflex", Reflex)):
            r[f"{nm}_vs_brains"] = round(float(invasion(w.cfg, Brain(), P(seed=3), physics=w.physics,
                                                        genomes=G, settle=300, measure=500,
                                                        energy=e_typ)["ratio"]), 3)
        rows.append(r)
        print(json.dumps(r), flush=True)
    with open(a.out, "w") as f:
        json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main()
