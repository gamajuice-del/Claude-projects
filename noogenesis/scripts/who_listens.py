#!/usr/bin/env python3
"""Is sound use social (others' calls) or private (hearing oneself)?

Population split at random into groups 0 and 1. Diet selectivity (fraction of
food eaten that is currently nutritious) of group 0 is measured when
  none muted / group 1 muted (others silent) / group 0 muted (self silent),
all from the same world state with the same random numbers.
"""
import argparse
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.backend import to_numpy  # noqa: E402


def group_selectivity(world, mute, steps=690, seed=0):
    w = world.clone()
    n = w.agents.n
    tags = (np.random.default_rng(seed).random(n) < 0.5).astype(np.int32)
    w.agents["tag"][:n] = w.xp.asarray(tags)
    w.mute_tag = mute
    K = w.cfg.K_max
    good = np.zeros(2)
    tot = np.zeros(2)
    for _ in range(steps):
        w.step()
        A = w.agents
        tg = to_numpy(A["tag"][:A.n])
        le = to_numpy(w.last_eat)[:, :K]
        val = to_numpy(w.species_value)
        if le.shape[0] != len(tg):
            continue
        for g in (0, 1):
            m = tg == g
            good[g] += float((le[m] * (val > 0)).sum())
            tot[g] += float(le[m].sum())
    return good / np.maximum(tot, 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1])
    a = ap.parse_args()
    for run in a.runs:
        w = pickle.load(open(os.path.join(run, "world_final.pkl"), "rb"))
        res = {"none": [], "others_muted": [], "self_muted": []}
        for s in a.seeds:
            res["none"].append(group_selectivity(w, None, seed=s)[0])
            res["others_muted"].append(group_selectivity(w, 1, seed=s)[0])
            res["self_muted"].append(group_selectivity(w, 0, seed=s)[0])
        print(json.dumps(dict(run=os.path.basename(run),
                              **{k: [round(v, 3) for v in vs] for k, vs in res.items()},
                              social_effect=round(float(np.mean(res["none"]) - np.mean(res["others_muted"])), 3),
                              self_effect=round(float(np.mean(res["none"]) - np.mean(res["self_muted"])), 3))),
              flush=True)


if __name__ == "__main__":
    main()
