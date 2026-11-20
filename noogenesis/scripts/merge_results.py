#!/usr/bin/env python3
"""Combine per-run analysis directories into shared figures and one JSON.

  python scripts/merge_results.py --runs R_A R_B R_C --analyses AN_A AN_B AN_C --out docs
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from analyze import load_metrics, plot_cognition, plot_trajectories  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--analyses", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    metrics = {r: load_metrics(r) for r in a.runs}
    plot_trajectories(a.runs, metrics, a.out)
    merged, epochs = {"runs": {}}, {}
    for run, an in zip(a.runs, a.analyses):
        s = json.load(open(os.path.join(an, "summary.json")))
        (key, R), = s["runs"].items()
        name = os.path.basename(run)
        epochs[name] = R["epochs"]
        R.pop("final_snapshot", None)
        merged["runs"][name] = R
        merged.setdefault("random_baseline", s.get("random_baseline"))
        merged.setdefault("random_baseline_lesson", s.get("random_baseline_lesson"))
        # compact trajectory table for the report
        m = metrics[run]
        merged["runs"][name]["trajectory"] = [
            {k: r.get(k) for k in ("t", "pop", "gen_mean", "neurons", "neurons_max",
                                   "mean_lifespan", "genetic_diversity", "physics_level",
                                   "eta_mean", "eta_pred", "epi_rho", "meat_eff",
                                   "deprivation", "welfare", "steps_per_s")}
            for r in m[::10]]
    plot_cognition(epochs, a.out)
    with open(os.path.join(a.out, "results_summary.json"), "w") as f:
        json.dump(merged, f, indent=1)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
