"""Paired measurement of the learned gap: on IDENTICAL noisy test inputs, per sigma,
    gap_lower(sigma) = mse(class-conditional scaffold) - mse(trained model)      (per image)
and the learnable-information density gap/sigma^2 of Theorem 1, integrated over d ln sigma into a
lower bound on the non-Gaussian nats per image each model captured (coarse 16x16 scale)."""
import math
import os
import sys

import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS, cifar_view, save_json
from crisp.scaffold import GaussianScaffold
from generate_eval import load_model

SIGMAS = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 40.0, 80.0]


@torch.no_grad()
def main():
    torch.set_num_threads(int(sys.argv[1]) if len(sys.argv) > 1 else 4)
    names = sys.argv[2].split(",") if len(sys.argv) > 2 else ["edm16", "crisp16_full", "abl16_rb", "abl16_scaffold", "abl16_rb_scaf", "abl16_scaf_ia"]
    names = [n for n in names if os.path.exists(os.path.join(RESULTS, "runs", n, "ema.pt"))]
    xtr, ytr, xte, yte = cifar_view(16)
    sc = GaussianScaffold(xtr, ytr, num_classes=10)
    models = {n: load_model(n, xtr, ytr) for n in names}
    g = torch.Generator().manual_seed(2024)
    idx = torch.randperm(len(xte), generator=g)[:1000]
    x0, y = xte[idx], yte[idx]
    out = {"sigmas": SIGMAS, "scaffold_mse": [], "model_mse": {n: [] for n in names}}
    for s in SIGMAS:
        xt = x0 + s * torch.randn(x0.shape, generator=g)
        st = torch.full((len(x0),), s)
        out["scaffold_mse"].append(float(((sc(xt, st, y) - x0) ** 2).sum((1, 2, 3)).mean()))
        for n, m in models.items():
            D = torch.cat([m(xt[i:i + 250], st[i:i + 250], y[i:i + 250]) for i in range(0, len(x0), 250)])
            out["model_mse"][n].append(float(((D - x0) ** 2).sum((1, 2, 3)).mean()))
        print(s, out["scaffold_mse"][-1], {n: round(v[-1], 3) for n, v in out["model_mse"].items()}, flush=True)
    ls = [math.log(s) for s in SIGMAS]
    out["nats_lower_bound"] = {}
    out["nats_by_band"] = {}
    bands = [(0.002, 0.05), (0.05, 0.5), (0.5, 5.0), (5.0, 80.0)]
    for n in names:
        dens = [(a - b) / s ** 2 for a, b, s in zip(out["scaffold_mse"], out["model_mse"][n], SIGMAS)]
        tot, per = 0.0, {f"{lo}-{hi}": 0.0 for lo, hi in bands}
        for i in range(len(SIGMAS) - 1):
            seg = 0.5 * (dens[i] + dens[i + 1]) * (ls[i + 1] - ls[i])
            tot += seg
            mid = math.exp(0.5 * (ls[i] + ls[i + 1]))
            for lo, hi in bands:
                if lo <= mid < hi:
                    per[f"{lo}-{hi}"] += seg
        out["nats_lower_bound"][n] = tot
        out["nats_by_band"][n] = per
    print(out["nats_lower_bound"], out["nats_by_band"], flush=True)
    save_json(out, "gap_paired.json")


if __name__ == "__main__":
    main()
