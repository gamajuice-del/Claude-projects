#!/usr/bin/env python3
"""Does the world pay for cognition? Evolve short runs in two ecologies and
lesion the evolved population (vision / memory / sound) in clones that share
the same random numbers. Intake ratio 1.0 = the faculty is not being used.

  python scripts/ecology_lesion.py --steps 12000 --seeds 2 3 --out docs/ecology_lesion.json
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis import Config, World  # noqa: E402
from noogenesis.metrics import lesion_study  # noqa: E402

ECOLOGIES = {
    # vegetation can reach full biomass everywhere (the original design)
    "dense": dict(site_density=0.0, grass_cap=1.0, veg_rate=0.03, veg_diffuse=0.01),
    # low-yield grass everywhere + rich fruit at 8% fixed sites (current default)
    "two_tier": dict(),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=12000)
    ap.add_argument("--seeds", type=int, nargs="+", default=[2, 3])
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    rows = []
    for eco, kw in ECOLOGIES.items():
        for seed in a.seeds:
            t0 = time.time()
            w = World(Config(seed=seed, **kw))
            for _ in range(a.steps):
                w.step()
            snap = w.snapshot()
            les = lesion_study(w)
            r = dict(ecology=eco, seed=seed, steps=a.steps, pop=snap["pop"],
                     gen_mean=snap.get("gen_mean"), neurons=snap.get("neurons"),
                     **{k: round(v, 4) for k, v in les.items()},
                     seconds=round(time.time() - t0))
            rows.append(r)
            print(json.dumps(r), flush=True)
    if a.out:
        with open(a.out, "w") as f:
            json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main()
