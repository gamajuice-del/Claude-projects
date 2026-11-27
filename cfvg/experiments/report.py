"""Collect results/*.json into results/summary.md and charts."""
from __future__ import annotations

import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

R = "results"
load = lambda n: json.load(open(f"{R}/{n}.json")) if os.path.exists(f"{R}/{n}.json") else None
base = {s: load(f"baselines_{s}") for s in ("id", "ood")}

ATTR = ["color", "size", "gravity", "wind", "ghost", "noise", "shape", "hold"]
COLS = ["context_score", "instr_acc", "copy_rate", "giant_ratio_on", "giant_ratio_off"]
HDR = ["context score ↓", "instruction acc ↑", "copy rate ↓", "giant size × (want 2.2)", "normal size × (want 1.0)"]


def row(name, r):
    return f"| {name} | " + " | ".join(f"{r[c]:.3f}" if c in r else "–" for c in COLS) + " |"


def table(runs, split):
    lines = [f"| model | {' | '.join(HDR)} |", "|---" * (len(COLS) + 1) + "|"]
    for label, key in (("*real footage (ceiling)*", "real"), ("*wrong world (floor)*", "wrong"),
                       ("*copy a reference*", "copy")):
        lines.append(row(label, base[split][key]))
    for r in runs:
        res = load(r)
        if res:
            lines.append(row(f"**{r}**", res[split]))
    return "\n".join(lines)


def attr_table(runs, split):
    lines = ["| model | " + " | ".join(ATTR) + " | gravity bias |", "|---" * (len(ATTR) + 2) + "|"]
    src = [("real", base[split]["real"]), ("wrong world", base[split]["wrong"])]
    src += [(r, load(r)[split]) for r in runs if load(r)]
    for name, r in src:
        lines.append(f"| {name} | " + " | ".join(f"{r['err_' + a]:.3f}" for a in ATTR)
                     + f" | {r.get('gravity_bias', float('nan')):+.3f} |")
    return "\n".join(lines)


def bars(runs, path):
    runs = [r for r in runs if load(r)]
    fig, axes = plt.subplots(1, 3, figsize=(12, 3.6))
    for ax, (metric, title) in zip(axes, [("context_score", "Context error (0 = real, 1 = wrong world)"),
                                          ("instr_acc", "Instruction accuracy"),
                                          ("copy_rate", "Copy rate")]):
        for j, split in enumerate(("id", "ood")):
            vals = [load(r)[split][metric] for r in runs]
            ax.bar([i + j * 0.38 for i in range(len(runs))], vals, 0.38,
                   label="unseen worlds" if split == "id" else "unseen region (OOD)",
                   color=["#4C78A8", "#F58518"][j])
            ax.axhline(base[split]["real"][metric], color=["#4C78A8", "#F58518"][j], ls=":", lw=1)
        ax.set_xticks([i + 0.19 for i in range(len(runs))], runs, rotation=30, ha="right")
        ax.set_title(title, fontsize=10)
    axes[0].legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def pool_plot(path):
    pts = [(30, "pool30"), (300, "pool300"), (1e5, "cfvg")]
    pts = [(n, r) for n, r in pts if load(r)]
    if len(pts) < 2:
        return None
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.4))
    for ax, metric in zip(axes, ("context_score", "instr_acc")):
        for split, c in (("id", "#4C78A8"), ("ood", "#F58518")):
            ax.plot([n for n, _ in pts], [load(r)[split][metric] for _, r in pts], "o-", color=c,
                    label="unseen worlds" if split == "id" else "unseen region (OOD)")
        ax.set_xscale("log")
        ax.set_xlabel("distinct worlds seen in training (rightmost = unlimited)")
        ax.set_title(metric)
    axes[0].legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)
    lines = ["| worlds in training | context score (unseen) | context score (OOD) | instr acc (unseen) | copy rate (unseen) |",
             "|---|---|---|---|---|"]
    for n, r in pts:
        x = load(r)
        lines.append(f"| {'unlimited' if n == 1e5 else n} | {x['id']['context_score']:.3f} | "
                     f"{x['ood']['context_score']:.3f} | {x['id']['instr_acc']:.3f} | {x['id']['copy_rate']:.3f} |")
    return "\n".join(lines)


def main():
    out = ["# CFVG synthetic-world experiments: results", ""]
    core = ["cfvg", "cfvg_long", "cfvg_nocontrast", "paired", "cfvg_direct"]
    bars(core + ["pool30", "pool300", "leaky"], f"{R}/overview.png")
    out += ["![overview](overview.png)", ""]
    for split, title in (("id", "Unseen worlds (inside the training distribution)"),
                         ("ood", "Unseen region: stronger gravity than any training world + unseen colour band")):
        out += [f"## {title}", "", table(core + ["leaky"], split), "",
                "Per-attribute error (lower is better):", "", attr_table(core, split), ""]
    out += [f"Snap baseline (never leaves training gravity range) OOD gravity error: "
            f"{base['ood']['snap_gravity_err']:.3f}", ""]
    p = pool_plot(f"{R}/pool_scaling.png")
    if p:
        out += ["## World diversity vs zero-shot generalisation", "", p, "", "![pool](pool_scaling.png)", ""]
    curve = [(st, r) for st, r in ((1500, "cfvg_at1500"), (4000, "cfvg"), (12000, "cfvg_long")) if load(r)]
    if len(curve) > 1:
        out += ["## Training length (main model)", "",
                "| steps | context score (unseen) | context score (OOD) | instr acc | copy rate | shape err | hold err | ghost err |",
                "|---|---|---|---|---|---|---|---|"]
        for st, r in curve:
            x = load(r)
            out.append(f"| {st} | {x['id']['context_score']:.3f} | {x['ood']['context_score']:.3f} | "
                       f"{x['id']['instr_acc']:.3f} | {x['id']['copy_rate']:.3f} | {x['id']['err_shape']:.3f} | "
                       f"{x['id']['err_hold']:.3f} | {x['id']['err_ghost']:.3f} |")
        out.append("")
    main_res = load("cfvg_long") if load("cfvg_long") and "k_sweep" in load("cfvg_long") else load("cfvg")
    if main_res and "k_sweep" in main_res:
        out += ["## Number of reference clips at inference (trained with 1–3)", "",
                "| K | context score | instruction acc | copy rate |", "|---|---|---|---|"]
        for k, r in main_res["k_sweep"].items():
            out.append(f"| {k} | {r['context_score']:.3f} | {r['instr_acc']:.3f} | {r['copy_rate']:.3f} |")
        out += ["", "## Text guidance scale", "", "| scale | context score | instruction acc | copy rate |",
                "|---|---|---|---|"]
        for s, r in main_res["guidance"].items():
            out.append(f"| {s} | {r['context_score']:.3f} | {r['instr_acc']:.3f} | {r['copy_rate']:.3f} |")
        out.append("")
    lk = load("leaky")
    if lk:
        out += ["## Leaky captions: reference vs text under conflict", "",
                "| split | shape follows reference | shape follows text | gravity err vs reference | gravity err vs text |",
                "|---|---|---|---|---|"]
        for s in ("id", "ood"):
            c = lk[s + "_conflict"]
            out.append(f"| {s} | {c['shape_follows_reference']:.3f} | {c['shape_follows_text']:.3f} | "
                       f"{c['gravity_err_vs_reference']:.3f} | {c['gravity_err_vs_text']:.3f} |")
        out.append("")
    open(f"{R}/summary.md", "w").write("\n".join(out))
    print("\n".join(out))


if __name__ == "__main__":
    main()
