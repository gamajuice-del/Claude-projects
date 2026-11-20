#!/usr/bin/env python3
"""Language-readiness scorecard (Stage 2 gates L0-L2), pre-registered thresholds.

L0 referents  The concept "which food species is nutritious now" is decodable from
              internal state (neural state + learned values) with balanced accuracy
              >= 0.75 and >= 0.15 above decoding from the raw current input.
L1 signals    Emitted sounds carry >= 0.05 bits (above a permutation null) about the
              caller's value signal, AND listeners use *others'* calls: silencing a
              random half of the population lowers the other half's diet selectivity
              by >= 0.03. (Revised after Round 5: the original "deafening" criterion
              was passed by organisms that only listened to themselves.)
L2 symbols    Word lesson: informative minus uninformative early-block selectivity
              >= 0.10 in late blocks, and informative beats the plasticity knock-out.

  python scripts/readiness.py --runs R1 R2 --out readiness.json
"""
import argparse
import glob
import json
import os
import pickle
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.backend import to_numpy  # noqa: E402
from noogenesis.language import _ridge_bacc, word_lesson_battery  # noqa: E402
from noogenesis.metrics import lesion_study, mutual_info_discrete  # noqa: E402
sys.path.insert(0, os.path.dirname(__file__))
from who_listens import group_selectivity  # noqa: E402


def selectivity(world, steps=690, lesion=None):
    w = world.clone()
    w.lesion = lesion
    K = w.cfg.K_max
    good = bad = 0.0
    for _ in range(steps):
        w.step()
        le = to_numpy(w.last_eat)[:, :K].sum(0)
        val = to_numpy(w.species_value)
        good += float((le * (val > 0)).sum())
        bad += float((le * (val <= 0)).sum())
    return good / max(good + bad, 1e-9)


def l0_referents(world, steps=760, seed=0):
    """Decode 'species 0 is nutritious now' from internal vs raw input."""
    w = world.clone()
    N, C = w.cfg.N, w.agents["sal_F"].shape[1]
    I, X, Y, G = [], [], [], []
    for t in range(steps):
        rec = w.step(record=True)
        if rec is None or t % 4:
            continue
        n = len(rec["act"])
        A = w.agents
        h = np.zeros((n, N), np.float32)
        hh = to_numpy(rec["h"])
        h[:, :hh.shape[1]] = hh
        ids = to_numpy(rec["ids"])
        # learned state of the same individuals (slots may have moved after deaths)
        cur = to_numpy(A["id"][:A.n])
        pos = {int(v): i for i, v in enumerate(cur)}
        idx = np.array([pos.get(int(v), -1) for v in ids])
        ok = idx >= 0
        salF = np.zeros((n, C), np.float32)
        salF[ok] = to_numpy(A["sal_F"][:A.n])[idx[ok]]
        I.append(np.concatenate([h, salF], 1)[ok])
        X.append(np.concatenate([to_numpy(rec["Xv"]).reshape(n, -1), to_numpy(rec["Xo"])], 1)[ok])
        Y.append(np.full(int(ok.sum()), float(to_numpy(w.species_value)[0] > 0)))
        G.append(ids[ok])
    I, X, Y, G = map(np.concatenate, (I, X, Y, G))
    test = (G % 3) == 0
    return dict(from_internal=_ridge_bacc(I[~test], Y[~test], I[test], Y[test]),
                from_input=_ridge_bacc(X[~test], Y[~test], X[test], Y[test]),
                base_rate=float(Y.mean()), n=int(Y.size))


def l1_signals(world, steps=400, seed=0, n_null=20):
    w = world.clone()
    sa = w.physics.s_active
    syms, ctx = [], []
    for _ in range(steps):
        rec = w.step(record=True)
        if rec is None:
            continue
        s = to_numpy(rec["s_emit"])[:, :sa]
        q = np.digitize(s, [-0.33, 0.33])
        syms.append((q * (3 ** np.arange(sa))).sum(1))
        mv = to_numpy(rec["m_val"])
        ctx.append(np.digitize(mv, [-0.1, 0.1]))
    sym, c = np.concatenate(syms), np.concatenate(ctx)
    rng = np.random.default_rng(seed)
    mi = mutual_info_discrete(sym, c)
    null = [mutual_info_discrete(sym, rng.permutation(c)) for _ in range(n_null)]
    return dict(signal_mi=mi, null=float(np.mean(null)), excess=mi - float(np.mean(null)),
                frac_vocal=float((np.abs(np.concatenate(syms)) > 0).mean()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--subjects", type=int, default=64)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rows = []
    for run in a.runs:
        w = pickle.load(open(os.path.join(run, "world_final.pkl"), "rb"))
        G = np.load(sorted(glob.glob(os.path.join(run, "archive", "*.npz")))[-1])["genomes"]
        r = dict(run=os.path.basename(run), t=w.t, pop=w.agents.n)
        A, n, lay = w.agents, w.agents.n, w.lay
        for k in ("xm_eta", "sal_eta"):
            if k in lay.gs:
                r[k] = round(float(to_numpy(A[k][:n]).mean()), 4)
        if "call_gain" in lay.gs:
            r["call_gain_abs"] = round(float(np.abs(to_numpy(A["call_gain"][:n])[:, :w.physics.s_active]).mean()), 3)
        r["L0"] = l0_referents(w)
        r["L1"] = l1_signals(w)
        les = lesion_study(w, steps=345, kinds=("sound", "plasticity"))
        r["L1"].update(deaf_intake_ratio=les["intake_ratio_sound"],
                       sel_intact=selectivity(w), sel_deaf=selectivity(w, lesion="sound"))
        r["plasticity_intake_ratio"] = les["intake_ratio_plasticity"]
        soc = [group_selectivity(w, None, seed=s)[0] - group_selectivity(w, 1, seed=s)[0] for s in (0, 1)]
        slf = [group_selectivity(w, None, seed=s)[0] - group_selectivity(w, 0, seed=s)[0] for s in (0, 1)]
        r["L1"].update(social_effect=float(np.mean(soc)), self_effect=float(np.mean(slf)))
        sub = G[np.random.default_rng(0).choice(len(G), min(a.subjects, len(G)), replace=False)]
        wl = word_lesson_battery(sub, w.cfg, w.physics, seed=1)
        r["L2"] = dict(informative=wl["informative"]["early_second_half"],
                       uninformative=wl["uninformative"]["early_second_half"],
                       knockout=wl["knockout"]["early_second_half"],
                       word_benefit=wl["word_benefit"])
        L0, L1, L2 = r["L0"], r["L1"], r["L2"]
        r["gates"] = dict(
            L0=bool(L0["from_internal"] >= 0.75 and L0["from_internal"] - L0["from_input"] >= 0.15),
            L1=bool(L1["excess"] >= 0.05 and L1["social_effect"] >= 0.03),
            L2=bool(L2["word_benefit"] >= 0.10 and L2["informative"] > L2["knockout"]))
        rows.append(r)
        print(json.dumps(r, default=float), flush=True)
    with open(a.out, "w") as f:
        json.dump(rows, f, indent=1, default=float)


if __name__ == "__main__":
    main()
