"""Build figures and the markdown results tables from results/*.json."""
import json
import math
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS

FIG = os.path.join(RESULTS, "figures")
os.makedirs(FIG, exist_ok=True)
J = lambda *p: json.load(open(os.path.join(RESULTS, *p))) if os.path.exists(os.path.join(RESULTS, *p)) else None
RUNS = {"edm16": "EDM (16x16 LL)", "abl16_rb": "+R", "abl16_scaffold": "+C", "abl16_rb_scaf": "+C+R",
        "abl16_scaf_ia": "+C+I (no R)", "crisp16_full": "CRISP: +C+R+I", "edm32": "EDM (32x32 pixels)"}
lines = []


def fmt(x, p=3):
    return "—" if x is None else (f"{x:.{p}g}" if isinstance(x, float) else str(x))


def analytic():
    a = J("analytic.json")
    if not a:
        return
    fig, axs = plt.subplots(1, 2, figsize=(12, 4.4))
    for ax, key in zip(axs, ["res32", "res16"]):
        r = a[key]
        s = r["sigmas"]
        for k, lab, st in [("edm_skip", "EDM skip c_skip·x (free)", ":"), ("spectral", "spectral scaffold", "--"),
                           ("gauss_uncond", "Gaussian scaffold", "-."), ("gauss_class", "class-cond. scaffold (CRISP)", "-"),
                           ("empirical_posterior", "empirical posterior (memorizer)", "-")]:
            ax.loglog(s, r["E1"][k], st, label=lab)
        ax.set_title(f"held-out denoising MSE per image, {key[3:]}x{key[3:]} ({'pixels' if key == 'res32' else 'Haar LL'})")
        ax.set_xlabel("sigma"); ax.grid(alpha=.3)
    axs[0].legend(fontsize=8)
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "e1_gap_profile.png"), dpi=130); plt.close(fig)

    fig, axs = plt.subplots(1, 2, figsize=(12, 4.4))
    for ax, key in zip(axs, ["res32", "res16"]):
        r = a[key]; s = r["sigmas"]
        for k, lab in [("V_std", "label noise, standard DSM"), ("V_strat", "label noise, stratified RB (k=32,s=256)"),
                       ("R_std", "residual target energy, standard"), ("R_rb", "residual target energy, RB")]:
            ax.loglog(s, np.maximum(r["E2"][k], 1e-6), label=lab)
        ax2 = ax.twinx(); ax2.semilogx(s, r["E2"]["ess_exact"], "k:", alpha=.6); ax2.set_ylabel("posterior ESS (dotted)")
        ax.set_title(f"E2 label noise vs sigma ({key[3:]}x{key[3:]})"); ax.set_xlabel("sigma"); ax.grid(alpha=.3)
    axs[0].legend(fontsize=8)
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "e2_label_noise.png"), dpi=130); plt.close(fig)

    r = a["res32"]
    lines.append("\n#### E1 + E2: closed-form scaffold and label noise (CIFAR-10 pixels, d = 3072, per-image squared error)\n")
    lines.append("| σ | EDM skip (free) | spectral | Gaussian | class-cond. scaffold | empirical posterior | label noise V_std | V after stratified RB | posterior ESS |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for i, s in enumerate(r["sigmas"]):
        if s in (0.01, 0.1, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 20.0, 80.0):
            e1, e2 = r["E1"], r["E2"]
            lines.append(f"| {s} | {e1['edm_skip'][i]:.2f} | {e1['spectral'][i]:.2f} | {e1['gauss_uncond'][i]:.2f} | **{e1['gauss_class'][i]:.2f}** | "
                         f"{e1['empirical_posterior'][i]:.2f} | {e2['V_std'][i]:.3f} | {e2['V_strat'][i]:.3f} | {e2['ess_exact'][i]:.1f} |")
    f = r["flops"]
    lines.append(f"\nScaffold fit: {f['scaffold_fit_class']:.2e} FLOPs (one pass + eigendecompositions); one scaffold call "
                 f"{f['scaffold_call']:.2e} FLOPs; stratified RB {f['rb_strat_per_sample']:.2e} FLOPs/sample vs exact "
                 f"{f['rb_exact_per_sample']:.2e}.")


def nmcr():
    n = J("nmcr.json")
    if not n:
        return
    s = n["sigmas"]; r = n["test_mse_per_dim"]
    fig, ax = plt.subplots(figsize=(6.5, 4.4))
    for k, lab, st in [("prior", "prior variance", ":"), ("cond_only", "E[d | coarse, class] (closed form)", "--"),
                       ("linear_local", "linear local LMMSE (closed form)", "-."), ("nmcr", "NMCR, m=2048 (closed form)", "-"),
                       ("cnn_1x", "SGD U-Net, 1x NMCR FLOPs", "-"), ("cnn_5x", "SGD U-Net, 5x NMCR FLOPs", "-")]:
        if r.get(k):
            ax.loglog(s, r[k], st, label=lab)
    ax.set_xlabel("sigma"); ax.set_ylabel("test MSE per coefficient"); ax.grid(alpha=.3); ax.legend(fontsize=8)
    ax.set_title("E3: finest detail band given coarse band (CIFAR test)")
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "e3_nmcr.png"), dpi=130); plt.close(fig)
    lines.append("\n#### E3: closed-form local field for the finest scale (test MSE per detail coefficient)\n")
    lines.append("| σ | prior | E[d \\| coarse] | linear local | **NMCR** | SGD U-Net 1× FLOPs | SGD U-Net 5× FLOPs |")
    lines.append("|---|---|---|---|---|---|---|")
    for i, sg in enumerate(s):
        if i % 3 == 0 or i == len(s) - 1:
            lines.append(f"| {sg:.4f} | {r['prior'][i]:.5f} | {r['cond_only'][i]:.5f} | {r['linear_local'][i]:.5f} | **{r['nmcr'][i]:.5f}** | "
                         f"{r['cnn_1x'][i]:.5f} | {r['cnn_5x'][i]:.5f} |")
    avg = {k: float(np.mean(np.log(r[k]))) for k in ["nmcr", "cnn_1x", "cnn_5x", "linear_local"]}
    lines.append(f"\nGeometric-mean MSE over the 18 sampler σ: NMCR {math.exp(avg['nmcr']):.5f}, linear {math.exp(avg['linear_local']):.5f}, "
                 f"SGD 1× {math.exp(avg['cnn_1x']):.5f}, SGD 5× {math.exp(avg['cnn_5x']):.5f}. "
                 f"NMCR cost: {n['nmcr_flops']:.2e} FLOPs total ({n['n_train_patches']:,} patches, one pass, {n['nmcr_seconds']:.0f} s on 2 CPU threads, "
                 f"all 18 σ). SGD baselines: {n['cnn']['1']['flops']:.2e} and {n['cnn']['5']['flops']:.2e} FLOPs.")


def curves():
    logs = {k: J("runs", k, "log.json") for k in RUNS}
    logs = {k: v for k, v in logs.items() if v}
    if not logs:
        return {}
    fig, ax = plt.subplots(figsize=(7, 4.6))
    for k, v in logs.items():
        if k == "edm32":
            continue
        c = v["curve"]
        ax.semilogx([max(p["flops"], 1e11) for p in c], [p["test_loss"] for p in c], "o-", ms=3, label=RUNS[k])
    ax.set_xlabel("training FLOPs (all counted)"); ax.set_ylabel("held-out EDM-weighted loss (coarse 16x16)")
    ax.grid(alpha=.3); ax.legend(fontsize=8); ax.set_title("E4: FLOP-matched training on the coarse scale")
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "e4_curves.png"), dpi=130); plt.close(fig)

    base = logs.get("edm16")
    lines.append("\n#### E4: FLOP-matched ablations on the coarse (16×16 LL) model, held-out loss (lower is better)\n")
    lines.append("| system | loss at 0 FLOPs | at 5·10¹³ | at 1.5·10¹⁴ | at 4.5·10¹⁴ | FLOPs to reach EDM's loss at 1.5·10¹⁴ | speed-up |")
    lines.append("|---|---|---|---|---|---|---|")

    def at(c, f):
        xs = [p["flops"] for p in c]; ys = [p["test_loss"] for p in c]
        if f > xs[-1] * 1.02:
            return None
        return float(np.interp(math.log(f), np.log(np.maximum(xs, 1e9)), ys))

    def reach(c, target):
        for a, b in zip(c, c[1:]):
            if b["test_loss"] <= target:
                if a["test_loss"] <= target:
                    return a["flops"]
                t = (a["test_loss"] - target) / (a["test_loss"] - b["test_loss"])
                return math.exp(math.log(max(a["flops"], 1e9)) + t * (math.log(b["flops"]) - math.log(max(a["flops"], 1e9))))
        return None

    target = at(base["curve"], 1.5e14) if base else None
    speed = {}
    for k, v in logs.items():
        if k == "edm32":
            continue
        c = v["curve"]
        r = reach(c, target) if target else None
        speed[k] = (1.5e14 / r) if r else None
        lines.append(f"| {RUNS[k]} | {c[0]['test_loss']:.4f} | {fmt(at(c, 5e13), 4)} | {fmt(at(c, 1.5e14), 4)} | {fmt(at(c, 4.5e14), 4)} | "
                     f"{'%.2e' % r if r else 'not reached'} | {('%.1f×' % speed[k]) if speed[k] else '—'} |")
    return speed


def generation():
    g = J("generation.json")
    if not g:
        return
    lines.append("\n#### E5: end-to-end class-conditional generation (2,000 samples; self-trained-classifier metrics)\n")
    lines.append("| system | training FLOPs | SC-FID ↓ | class accuracy ↑ | precision ↑ | recall ↑ | memorized ↓ | sampling seconds (CPU) |")
    lines.append("|---|---|---|---|---|---|---|---|")
    fl = {}
    for k in ["edm32", "edm16", "crisp16_full"]:
        v = J("runs", k, "log.json")
        if v:
            fl[k] = v["curve"][-1]["flops"]
    nm = J("nmcr.json"); nmf = nm["nmcr_flops"] if nm else 0
    sc = J("analytic.json")
    scf = sc["res16"]["flops"]["scaffold_fit_class"] if sc else 0
    tf = {"edm32": fl.get("edm32"), "edm16+nmcr": (fl.get("edm16", 0) + nmf) or None,
          "crisp16+nmcr": (fl.get("crisp16_full", 0) + nmf) or None, "scaffold+nmcr": scf + nmf, "real_train": None}
    names = {"edm32": "EDM, 32×32 pixels", "edm16+nmcr": "pyramid only: EDM coarse + NMCR fine",
             "crisp16+nmcr": "**CRISP** (C+R+I coarse + NMCR fine)", "scaffold+nmcr": "zero-SGD: scaffold + NMCR", "real_train": "real training images"}
    for k in ["real_train", "edm32", "edm16+nmcr", "crisp16+nmcr", "scaffold+nmcr"]:
        if k in g:
            v = g[k]
            lines.append(f"| {names[k]} | {('%.2e' % tf[k]) if tf.get(k) else '—'} | {v['sc_fid']:.2f} | {v['class_acc']:.3f} | {v['precision']:.3f} | "
                         f"{v['recall']:.3f} | {fmt(v['memorized_frac'])} | {v['sample_seconds']:.0f} |")
    # sample grids
    for k in g:
        p = os.path.join(RESULTS, f"samples_{k.replace('+', '_')}.npz")
        if not os.path.exists(p):
            continue
        z = np.load(p); x, y = z["x"], z["y"]
        rows = []
        for c in range(10):
            idx = np.nonzero(y == c)[0][:10]
            rows.append(np.concatenate([x[i].transpose(1, 2, 0) for i in idx], 1))
        grid = np.concatenate(rows, 0)
        plt.imsave(os.path.join(FIG, f"samples_{k.replace('+', '_')}.png"), grid)


def gap():
    gp = J("gap_paired.json")
    if not gp:
        return
    s = gp["sigmas"]
    fig, ax = plt.subplots(figsize=(7, 4.4))
    for n, v in gp["model_mse"].items():
        d = [(a - b) / sg ** 2 for a, b, sg in zip(gp["scaffold_mse"], v, s)]
        ax.semilogx(s, d, "o-", ms=3, label=RUNS.get(n, n))
    ax.axhline(0, color="k", lw=.8)
    ax.set_xlabel("sigma"); ax.set_ylabel("(mse_scaffold − mse_model)/σ²  [nats per unit ln σ]")
    ax.set_title("Learned non-Gaussian information density (Theorem 1), coarse scale")
    ax.grid(alpha=.3); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "e6_info_density.png"), dpi=130); plt.close(fig)
    lines.append("\n#### E6: non-Gaussian information captured, by noise band (lower bound, nats per 16×16×3 image; Theorem 1)\n")
    bands = list(next(iter(gp["nats_by_band"].values())).keys())
    lines.append("| model | total | " + " | ".join(f"σ ∈ [{b.replace('-', ', ')})" for b in bands) + " |")
    lines.append("|---|---|" + "---|" * len(bands))
    for n, tot in gp["nats_lower_bound"].items():
        lines.append(f"| {RUNS.get(n, n)} | {tot:.0f} | " + " | ".join(f"{gp['nats_by_band'][n][b]:.0f}" for b in bands) + " |")


if __name__ == "__main__":
    analytic(); nmcr(); sp = curves(); gap(); generation()
    with open(os.path.join(RESULTS, "results_tables.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
