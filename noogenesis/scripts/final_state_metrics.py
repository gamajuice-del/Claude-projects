#!/usr/bin/env python3
"""Lean end-of-run measurements on saved worlds (for replicate runs):
lesion study on the living population, neural summary, communication.

  python scripts/final_state_metrics.py --runs R1 R2 ... --out docs/replicates.json
"""
import argparse
import json
import os
import pickle
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.metrics import (communication_metrics, lesion_study,  # noqa: E402
                                neural_summary, record_hidden)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rows = []
    for run in a.runs:
        w = pickle.load(open(os.path.join(run, "world_final.pkl"), "rb"))
        m = [json.loads(l) for l in open(os.path.join(run, "metrics.jsonl"))][-1]
        r = dict(run=os.path.basename(run), t=w.t, physics_level=w.physics.level,
                 pop=w.agents.n, neurons=m.get("neurons"), gen_mean=m.get("gen_mean"),
                 **lesion_study(w, steps=200))
        ns = neural_summary(record_hidden(w, steps=200))
        cm = communication_metrics(w, steps=120)
        r.update({f"neural_{k}": v for k, v in ns.items()})
        r.update({f"comm_{k}": v for k, v in cm.items()})
        rows.append(r)
        print(json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()}),
              flush=True)
    with open(a.out, "w") as f:
        json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main()
