"""E5: end-to-end class-conditional generation at matched training FLOPs, plus metrics.

Systems
  edm32            standard EDM U-Net on 32x32 pixels
  edm16+nmcr       pyramid only: standard EDM on the 16x16 Haar LL band + closed-form NMCR details
  crisp16+nmcr     full CRISP: scaffold + RB targets + info-allocated sigmas on LL, NMCR details
  scaffold+nmcr    ZERO gradient steps: class-conditional Gaussian on LL + NMCR details
  real_train       2000 real training images (metric floor / sanity)
Metrics (self-trained classifier features): SC-FID vs 10k test images, class accuracy of samples
(prompt-adherence proxy), k-NN precision / recall (k=3), memorization rate (d1/d2 < 1/3 to train set).
"""
import os
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS, local_patches, save_json
from crisp.data import haar_fwd, haar_inv, load_cifar10
from crisp.edm import Denoiser, heun_sample, karras_sigmas
from crisp.nmcr import NMCRField
from crisp.scaffold import GaussianScaffold
from crisp.unet import UNet
from train_classifier import Classifier

PER_CLASS = 200


def load_model(name, xtr_view, ytr):
    ck = torch.load(os.path.join(RESULTS, "runs", name, "ema.pt"))
    cfg = ck["config"]
    C = xtr_view.shape[1]
    scaffold = GaussianScaffold(xtr_view, ytr, num_classes=10) if cfg["scaffold"] else None
    net = UNet(2 * C if cfg["scaffold"] else C, C, base=cfg["base"], num_classes=10)
    net.load_state_dict(ck["state"])
    return Denoiser(net, ck["sigma_data"], scaffold).eval()


def load_field():
    ck = torch.load(os.path.join(RESULTS, "nmcr_field.pt"))
    f = NMCRField.__new__(NMCRField)
    f.W, f.b, f.m, f.solutions = ck["W"], ck["b"], ck["m"], ck["solutions"]
    f.dn, f.dc = ck["d_noisy"], ck["d_cond"]
    f.d_in, f.do = f.dn + f.dc, 9
    return f, ck


@torch.no_grad()
def sample_details(field, ck, ll, y, seed):
    """Reverse diffusion on the detail band with the closed-form local denoiser (EDM Heun)."""
    oh = F.one_hot(y, 10).float()
    B = ll.shape[0]
    sig = ck["sigmas"]

    def denoise(dt, sigma, _):
        s = float(sigma[0])
        s = min(sig, key=lambda v: abs(v - s))  # sampler sigmas == fitted sigmas (exact match)
        z = local_patches(dt, ll, oh, ck["pn"], ck["pc"])
        return field.predict(z, s).reshape(B, 16, 16, 9).permute(0, 3, 1, 2)

    return heun_sample(denoise, (B, 9, 16, 16), None, n=18, smax=ck["smax"], seed=seed)


@torch.no_grad()
def generate(system, xtr, ytr, bs=200):
    ys = torch.arange(10).repeat_interleave(PER_CLASS)
    out = []
    t0 = time.time()
    if system == "edm32":
        model = load_model("edm32", xtr, ytr)
        for i in range(0, len(ys), bs):
            out.append(heun_sample(model, (len(ys[i:i + bs]), 3, 32, 32), ys[i:i + bs], seed=i))
    else:
        lltr = haar_fwd(xtr)[0]
        field, ck = load_field()
        if system == "scaffold+nmcr":
            sc = GaussianScaffold(lltr, ytr, num_classes=10)
            model = lambda x, s, y: sc(x, s, y)
        else:
            model = load_model({"edm16+nmcr": "edm16", "crisp16+nmcr": "crisp16_full"}[system], lltr, ytr)
        for i in range(0, len(ys), bs):
            yb = ys[i:i + bs]
            ll = heun_sample(model, (len(yb), 3, 16, 16), yb, seed=i)
            det = sample_details(field, ck, ll, yb, seed=10_000 + i)
            out.append(haar_inv(ll, det))
    return torch.cat(out).clamp(-1, 1), ys, time.time() - t0


def fid(f1, f2):
    from scipy import linalg
    m1, m2 = f1.mean(0), f2.mean(0)
    c1, c2 = np.cov(f1, rowvar=False), np.cov(f2, rowvar=False)
    cs = linalg.sqrtm(c1 @ c2)
    if isinstance(cs, tuple):  # older SciPy returns (sqrtm, errest)
        cs = cs[0]
    return float(((m1 - m2) ** 2).sum() + np.trace(c1 + c2 - 2 * np.real(cs)))


def prec_recall(real, fake, k=3):
    def radii(a):
        d = torch.cdist(a, a)
        return d.kthvalue(k + 1, dim=1).values
    rr, rf = radii(real), radii(fake)
    d = torch.cdist(fake, real)
    precision = float((d <= rr[None, :]).any(1).float().mean())
    recall = float((d.T <= rf[None, :]).any(1).float().mean())
    return precision, recall


def memorization(x, xtr):
    a, b = x.reshape(len(x), -1), xtr.reshape(len(xtr), -1)
    d = torch.cdist(a, b)
    two = d.topk(2, dim=1, largest=False).values
    return float((two[:, 0] / two[:, 1] < 1 / 3).float().mean()), float(two[:, 0].mean())


def main():
    torch.set_num_threads(int(sys.argv[1]) if len(sys.argv) > 1 else 4)
    systems = sys.argv[2].split(",") if len(sys.argv) > 2 else ["scaffold+nmcr", "crisp16+nmcr", "edm16+nmcr", "edm32", "real_train"]
    xtr, ytr, xte, yte = load_cifar10()
    clf = Classifier()
    clf.load_state_dict(torch.load(os.path.join(RESULTS, "classifier.pt")))
    clf.eval()
    feats = lambda x: torch.cat([clf.features(x[i:i + 500]) for i in range(0, len(x), 500)])
    with torch.no_grad():
        ft = feats(xte)
    prev = os.path.join(RESULTS, "generation.json")
    results = {}
    if os.path.exists(prev):
        import json
        results = json.load(open(prev))
    for sysname in systems:
        if sysname == "real_train":
            g = torch.Generator().manual_seed(0)
            idx = torch.cat([(ytr == c).nonzero(as_tuple=True)[0][torch.randperm(5000, generator=g)[:PER_CLASS]] for c in range(10)])
            x, ys, secs = xtr[idx], ytr[idx], 0.0
        else:
            x, ys, secs = generate(sysname, xtr, ytr)
        with torch.no_grad():
            fg = feats(x)
            acc = float(clf.head(fg).argmax(1).eq(ys).float().mean())
        p, r = prec_recall(ft[:2000], fg)
        mem, d1 = memorization(x, xtr) if sysname != "real_train" else (None, None)
        results[sysname] = dict(sc_fid=fid(fg.numpy(), ft.numpy()), class_acc=acc, precision=p, recall=r,
                                memorized_frac=mem, mean_nn_dist=d1, sample_seconds=secs, n=len(x))
        print(sysname, results[sysname], flush=True)
        np.savez_compressed(os.path.join(RESULTS, f"samples_{sysname.replace('+', '_')}.npz"),
                            x=((x + 1) * 127.5).round().clamp(0, 255).byte().numpy(), y=ys.numpy())
        save_json(results, "generation.json")


if __name__ == "__main__":
    main()
