#!/usr/bin/env python3
"""Analyse finished runs: trajectories, cognitive assays across evolutionary
time, ancestor-vs-descendant competition, communication, neural integration,
Stage-2 grounding probes. Writes summary.json + figures into --out.

  python scripts/analyze.py --runs results/A results/B results/C --out results/analysis
"""
import argparse
import glob
import json
import os
import pickle
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.accelerate import relative_fitness  # noqa: E402
from noogenesis.assays import battery  # noqa: E402
from noogenesis.genome import GenomeLayout, random_genomes  # noqa: E402
from noogenesis.language import (lesson_battery, representation_atlas,  # noqa: E402
                                 xenolexicon)
from noogenesis.metrics import (common_garden, communication_metrics,  # noqa: E402
                                lesion_study, neural_summary, record_hidden)
from noogenesis.unfolding import Physics  # noqa: E402


def load_metrics(run):
    return [json.loads(l) for l in open(os.path.join(run, "metrics.jsonl"))]


def archives(run):
    out = []
    for f in sorted(glob.glob(os.path.join(run, "archive", "t*.npz"))):
        z = np.load(f)
        out.append((int(z["t"]), z["genomes"], Physics(**json.loads(str(z["physics"])))))
    return out


def jsonable(o):
    if isinstance(o, dict):
        return {str(k): jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, float) and not np.isfinite(o):
        return None
    return o


def plot_trajectories(runs, metrics, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    keys = [("pop", "population"), ("neurons", "mean neurons / brain"),
            ("gen_mean", "mean generation"), ("mean_lifespan", "mean lifespan (steps)"),
            ("genetic_diversity", "genetic diversity (nats)"), ("new_activity", "new evolutionary activity"),
            ("physics_level", "physics unfolding level"), ("eta_mean", "mean plasticity rate"),
            ("eta_pred", "forward-model learning rate")]
    fig, axs = plt.subplots(3, 3, figsize=(15, 11))
    for ax, (k, lab) in zip(axs.ravel(), keys):
        for run in runs:
            m = metrics[run]
            t = [r["t"] for r in m]
            y = [r.get(k, np.nan) for r in m]
            if k == "new_activity":
                y = np.convolve(np.nan_to_num(y), np.ones(10) / 10, mode="same")
            ax.plot(t, y, label=os.path.basename(run), lw=1.2)
        ax.set_title(lab)
        ax.set_xlabel("step")
    axs[0, 0].legend()
    fig.tight_layout()
    fig.savefig(os.path.join(out, "trajectories.png"), dpi=110)
    plt.close(fig)


def plot_cognition(epochs, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axs = plt.subplots(1, 5, figsize=(22, 4.2))
    for run, rows in epochs.items():
        t = [r["t"] for r in rows]
        axs[0].plot(t, [r["visible_eat_rate"] for r in rows], "o-", label=os.path.basename(str(run)))
        axs[1].plot(t, [r["memory_index_d3"] for r in rows], "o-")
        axs[2].plot(t, [r["reversal"]["late_acc"] for r in rows], "o-")
        axs[3].plot(t, [r["plasticity_gain"] for r in rows], "o-")
        for kind, ls in (("vision", "-"), ("memory", "--")):
            axs[4].plot(t, [r["lesion"].get(f"intake_ratio_{kind}", np.nan) for r in rows], "o" + ls,
                        label=f"{os.path.basename(str(run))} {kind}")
    for ax, tt in zip(axs, ["visible-food eat rate", "working-memory index (delay 3)",
                            "reversal task: late accuracy", "plasticity gain (intact - knockout)",
                            "intake ratio after lesion (1 = faculty unused)"]):
        ax.set_title(tt)
        ax.set_xlabel("evolutionary time (steps)")
        ax.axhline(0 if "index" in tt or "gain" in tt else (0.5 if "accuracy" in tt else 0),
                   color="grey", lw=0.6, ls="--")
    axs[0].legend()
    axs[4].legend(fontsize=7)
    axs[4].axhline(1.0, color="grey", lw=0.6, ls="--")
    fig.tight_layout()
    fig.savefig(os.path.join(out, "cognition_over_time.png"), dpi=110)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--subjects", type=int, default=49)
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    summary = {"runs": {}}
    metrics = {r: load_metrics(r) for r in a.runs}
    plot_trajectories(a.runs, metrics, a.out)
    rng = np.random.default_rng(0)
    epochs = {}
    base_cfg = None
    for run in a.runs:
        t0 = time.time()
        wpath = os.path.join(run, "world_final.pkl")
        world = pickle.load(open(wpath, "rb")) if os.path.exists(wpath) else None
        cfg = world.cfg if world is not None else None
        if cfg is None:
            from noogenesis.config import Config
            cfg = Config(**{k: v for k, v in json.load(open(os.path.join(run, "args.json"))).items()
                            if k in ("H", "W", "seed")})
        base_cfg = base_cfg or cfg
        arch = archives(run)
        pick = np.unique(np.linspace(0, len(arch) - 1, a.epochs).round().astype(int))
        rows = []
        for i in pick:
            t, G, phys = arch[i]
            sub = G[rng.choice(len(G), min(a.subjects, len(G)), replace=False)]
            res = battery(sub, cfg, phys, seed=1, quick=a.quick)
            res["t"] = t
            gw = common_garden(cfg, G, phys, seed=3)
            res["lesion"] = lesion_study(gw) if gw.agents.n > 20 else {}
            res["garden_pop"] = gw.agents.n
            rows.append(res)
            print(f"{os.path.basename(run)} t={t}: eat={res['visible_eat_rate']:.2f} "
                  f"mem3={res['memory_index_d3']:+.3f} rev_late={res['reversal']['late_acc']:.2f} "
                  f"plast={res['plasticity_gain']:+.3f} lesion={ {k: round(v, 2) for k, v in res['lesion'].items()} }",
                  flush=True)
        epochs[run] = rows
        R = {"epochs": rows, "final_snapshot": metrics[run][-1],
             "events": [e for r in metrics[run] for e in r.get("events", [])]}
        # ancestor vs descendant competition in the final physics
        if len(arch) >= 3:
            early, late = arch[1][1], arch[-1][1]
            c = cfg.replace(seed=7)
            R["competition_late_vs_early"] = relative_fitness(c, late, early, steps=1500)
            print("  competition:", R["competition_late_vs_early"], flush=True)
        if world is not None:
            R["communication"] = communication_metrics(world, steps=150)
            R["neural"] = neural_summary(record_hidden(world, steps=200))
            R["atlas"] = representation_atlas(world, steps=250)
            R["xenolexicon"] = xenolexicon(world, steps=150)
            fin = arch[-1][1]
            sub = fin[rng.choice(len(fin), min(a.subjects, len(fin)), replace=False)]
            R["lesson"] = lesson_battery(sub, cfg, world.physics, trials=24 if a.quick else 36)
            print("  comm:", {k: round(v, 4) for k, v in R["communication"].items()}, flush=True)
            print("  neural:", {k: round(v, 3) for k, v in R["neural"].items()}, flush=True)
            print("  lesson symbol_learning:", round(R["lesson"]["symbol_learning"], 3), flush=True)
        if os.path.exists(os.path.join(run, "iff.json")):
            R["iff"] = json.load(open(os.path.join(run, "iff.json")))
        R["analysis_seconds"] = time.time() - t0
        summary["runs"][run] = R
    # baselines: random (unevolved) genomes, in the initial physics
    lay = GenomeLayout(base_cfg)
    phys0 = Physics()
    rg = random_genomes(np, np.random.default_rng(5), lay, a.subjects, lay.mutable_mask(phys0))
    summary["random_baseline"] = battery(rg, base_cfg, phys0, seed=1, quick=a.quick)
    summary["random_baseline_lesson"] = lesson_battery(rg, base_cfg, phys0, trials=24 if a.quick else 36)
    print("random baseline:", {k: summary["random_baseline"][k] for k in
                               ("visible_eat_rate", "memory_index_d3", "plasticity_gain")})
    plot_cognition(epochs, a.out)
    with open(os.path.join(a.out, "summary.json"), "w") as f:
        json.dump(jsonable(summary), f, indent=1)


if __name__ == "__main__":
    main()
