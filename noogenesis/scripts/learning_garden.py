#!/usr/bin/env python3
"""Learning measures for archived genomes (no saved world needed).

Each archive is regrown in a common garden under the given world (full
toxicity), allowed `settle` steps to live and learn, then measured:
lesions (vision, plasticity), diet selectivity with learning on vs off, and
the free-foraging reversal assay (intact vs knock-out).

  python scripts/learning_garden.py --world-cfg W.pkl --archives A1.npz A2.npz --out out.json
"""
import argparse
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from learning_check import selectivity  # noqa: E402
from noogenesis.assays import free_reversal  # noqa: E402
from noogenesis.metrics import common_garden, lesion_study  # noqa: E402
from noogenesis.unfolding import Physics  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--world-cfg", required=True, help="any saved world of the run (for its Config)")
    ap.add_argument("--archives", nargs="+", required=True)
    ap.add_argument("--settle", type=int, default=700)
    ap.add_argument("--subjects", type=int, default=64)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    cfg = pickle.load(open(a.world_cfg, "rb")).cfg.replace(tox_start=0, tox_ramp=0)
    rows = []
    for f in a.archives:
        z = np.load(f)
        G, phys = z["genomes"], Physics(**json.loads(str(z["physics"])))
        w = common_garden(cfg, G, phys, settle=a.settle, seed=5)
        r = dict(archive=f, t=int(z["t"]), garden_pop=w.agents.n)
        r.update({k: round(v, 4) for k, v in
                  lesion_study(w, steps=345, kinds=("vision", "plasticity")).items()})
        r["selectivity_intact"] = round(selectivity(w, plastic=True), 4)
        r["selectivity_no_plasticity"] = round(selectivity(w, plastic=False), 4)
        sub = G[np.random.default_rng(0).choice(len(G), min(a.subjects, len(G)), replace=False)]
        fr = free_reversal(sub, cfg, phys, seed=1, plastic=True)
        fk = free_reversal(sub, cfg, phys, seed=1, plastic=False)
        r.update(fr_curve=[round(c, 3) for c in fr["curve"]], fr_ko_curve=[round(c, 3) for c in fk["curve"]],
                 fr_reversal_gain=round(fr["reversal_gain"], 3), fr_ko_reversal_gain=round(fk["reversal_gain"], 3),
                 fr_late=round(fr["late"], 3), fr_ko_late=round(fk["late"], 3),
                 fr_eating=round(fr["eating_frac"], 3))
        rows.append(r)
        print(json.dumps(r), flush=True)
    with open(a.out, "w") as fh:
        json.dump(rows, fh, indent=1)


if __name__ == "__main__":
    main()
