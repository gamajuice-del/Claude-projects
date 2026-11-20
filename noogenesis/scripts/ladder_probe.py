#!/usr/bin/env python3
"""Place evolved populations on the oracle ladder over evolutionary time.

For each archived epoch: invasion ratios of oracle strategies (random, taste,
reflex) entering a resident population of evolved brains, plus brains
invading a reflex population. A ratio < 1 for an oracle invading brains means
the brains already do better than that rung.

  python scripts/ladder_probe.py --runs R1 R2 --out ladder.json
"""
import argparse
import glob
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.config import Config  # noqa: E402
from noogenesis.oracles import Brain, Random, Reflex, Taste, invasion  # noqa: E402
from noogenesis.unfolding import Physics  # noqa: E402


def run_cfg(run):
    p = os.path.join(run, "world_final.pkl")
    if os.path.exists(p):
        return pickle.load(open(p, "rb")).cfg
    a = json.load(open(os.path.join(run, "args.json")))
    cfg = Config(H=a["H"], W=a["W"], max_agents=a["max_agents"], seed=a["seed"])
    over = {}
    for kv in a.get("set", []):
        k, v = kv.split("=", 1)
        cur = getattr(cfg, k)
        over[k] = (v.lower() in ("1", "true", "yes")) if isinstance(cur, bool) else type(cur)(v)
    return cfg.replace(**over)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--measure", type=int, default=500)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    res = {}
    for run in a.runs:
        cfg = run_cfg(run)
        files = sorted(glob.glob(os.path.join(run, "archive", "t*.npz")))
        pick = np.unique(np.linspace(0, len(files) - 1, a.epochs).round().astype(int))
        rows = []
        for i in pick:
            z = np.load(files[i])
            G, phys = z["genomes"], Physics(**json.loads(str(z["physics"])))
            r = {"t": int(z["t"])}
            for name, P in (("random", Random), ("taste", Taste), ("reflex", Reflex)):
                r[f"{name}_vs_brains"] = invasion(cfg, Brain(), P(seed=3), physics=phys, genomes=G,
                                                  settle=300, measure=a.measure)["ratio"]
            rows.append(r)
            print(os.path.basename(run), json.dumps({k: round(v, 3) for k, v in r.items()}), flush=True)
        res[os.path.basename(run)] = rows
    with open(a.out, "w") as f:
        json.dump(res, f, indent=1)


if __name__ == "__main__":
    main()
