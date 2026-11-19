"""Diagnostic for E5: what does the closed-form (NMCR) fine-scale field add or cost?

For each pyramid system, take its saved 32x32 samples, recover the coarse band exactly (Haar LL), and
re-synthesize with the detail band set to zero (blurry, but no detail artifacts).  The same is done
for real training images, which shows how much the metric penalizes missing fine detail by itself.
"""
import json
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS, save_json
from crisp.data import haar_fwd, haar_inv, load_cifar10
from generate_eval import PER_CLASS, fid, memorization, prec_recall
from train_classifier import Classifier


@torch.no_grad()
def main():
    torch.set_num_threads(4)
    xtr, ytr, xte, yte = load_cifar10()
    clf = Classifier()
    clf.load_state_dict(torch.load(os.path.join(RESULTS, "classifier.pt")))
    clf.eval()
    feats = lambda x: torch.cat([clf.features(x[i:i + 500]) for i in range(0, len(x), 500)])
    ft = feats(xte)
    res = json.load(open(os.path.join(RESULTS, "generation.json")))
    g = torch.Generator().manual_seed(0)
    idx = torch.cat([(ytr == c).nonzero(as_tuple=True)[0][torch.randperm(5000, generator=g)[:PER_CLASS]] for c in range(10)])
    sources = {"real_train": (xtr[idx], ytr[idx])}
    for k in ["crisp16+nmcr", "edm16+nmcr", "scaffold+nmcr"]:
        p = os.path.join(RESULTS, f"samples_{k.replace('+', '_')}.npz")
        if os.path.exists(p):
            z = np.load(p)
            sources[k] = (torch.from_numpy(z["x"]).float().div(127.5).sub(1.0), torch.from_numpy(z["y"]))
    for k, (x, y) in sources.items():
        ll, det = haar_fwd(x)
        xz = haar_inv(ll, torch.zeros_like(det)).clamp(-1, 1)
        fg = feats(xz)
        p, r = prec_recall(ft[:2000], fg)
        name = k.split("+")[0] + "+zero_details"
        mem, d1 = memorization(xz, xtr)
        res[name] = dict(sc_fid=fid(fg.numpy(), ft.numpy()), class_acc=float(clf.head(fg).argmax(1).eq(y).float().mean()),
                         precision=p, recall=r, memorized_frac=mem, mean_nn_dist=d1, sample_seconds=0.0, n=len(x))
        print(name, res[name], flush=True)
    save_json(res, "generation.json")


if __name__ == "__main__":
    main()
