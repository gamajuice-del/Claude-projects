"""E3: closed-form local fields for the fine scale of the pyramid (CIFAR 16x16 LL -> 32x32 image).

Task: denoise the finest Haar detail band d (9 x 16 x 16) given the clean coarse band LL (3 x 16 x 16)
and the class, at every sigma of the detail sampler.  Compared, on held-out TEST images with real
Monte-Carlo noise:
    cond_only     E[d | LL patch, class]            (closed form; sigma -> infinity limit)
    linear_local  LMMSE on [noisy patch, LL patch]   (closed form)
    nmcr          linear + 2048 random Fourier features, exact noise marginalization (closed form,
                  ONE pass over clean data, all 18 sigmas, ridge picked by closed-form val loss)
    cnn_1x/cnn_5x a conventional SGD-trained conditional U-Net denoiser for the same band with
                  1x / 5x the FLOPs NMCR used (standard DSM training with sampled noise)
The fitted NMCR field (W per sampler sigma) is saved for the generation experiment.
"""
import math
import os
import sys
import time

import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS, local_patches, save_json
from crisp.data import haar_fwd, load_cifar10
from torch.utils.flop_counter import FlopCounterMode

from crisp.edm import edm_weight, karras_sigmas
from crisp.nmcr import NMCRField
from crisp.unet import UNet

PN, PC, M = 3, 5, 2048
DET_SMAX = 5.0


class DetailDenoiser(torch.nn.Module):
    """EDM-preconditioned conditional denoiser for the detail band (baseline)."""

    def __init__(self, sd):
        super().__init__()
        self.sd = sd
        self.net = UNet(9 + 3, 9, base=32, mults=(1, 2), nres=1, num_classes=10)

    def forward(self, dt, sigma, ll, y):
        s = sigma.reshape(-1, 1, 1, 1)
        sd = self.sd
        c_in, c_out, c_skip = 1 / torch.sqrt(s ** 2 + sd ** 2), s * sd / torch.sqrt(s ** 2 + sd ** 2), sd ** 2 / (s ** 2 + sd ** 2)
        return c_skip * dt + c_out * self.net(torch.cat([c_in * dt, ll], 1), torch.log(sigma) / 4, y)


def train_cnn(det, ll, y, sd, budget, seed=0, bs=64, lr=3e-4):
    torch.manual_seed(seed)
    model = DetailDenoiser(sd)
    with FlopCounterMode(display=False) as fc:
        model(det[:bs], torch.rand(bs) + 0.05, ll[:bs], y[:bs]).square().mean().backward()
    fl = fc.get_total_flops() / bs
    model.zero_grad(set_to_none=True)
    opt = torch.optim.Adam(model.parameters(), lr=lr, betas=(0.9, 0.99))
    ema = [p.detach().clone() for p in model.parameters()]
    g = torch.Generator().manual_seed(seed)
    steps = int(budget / (fl * bs))
    for step in range(steps):
        idx = torch.randint(0, len(det), (bs,), generator=g)
        # sample sigma log-uniformly over the detail sampler's range
        sigma = torch.exp(torch.empty(bs).uniform_(math.log(0.002), math.log(DET_SMAX), generator=g))
        d0 = det[idx]
        dt = d0 + sigma.reshape(-1, 1, 1, 1) * torch.randn(d0.shape, generator=g)
        D = model(dt, sigma, ll[idx], y[idx])
        loss = (edm_weight(sigma, sd) * ((D - d0) ** 2).mean((1, 2, 3))).mean()
        opt.zero_grad(set_to_none=True)
        loss.backward()
        for pg in opt.param_groups:
            pg["lr"] = lr * min(1.0, (step + 1) / 200)
        opt.step()
        dec = min(0.999, (1 + step) / (10 + step))
        with torch.no_grad():
            for e, p in zip(ema, model.parameters()):
                e.lerp_(p, 1 - dec)
    with torch.no_grad():
        for e, p in zip(ema, model.parameters()):
            p.copy_(e)
    return model.eval(), dict(flops_per_sample=fl, steps=steps, flops=steps * bs * fl)


def main():
    threads = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    torch.set_num_threads(threads)
    xtr, ytr, xte, yte = load_cifar10()
    lltr, dtr = haar_fwd(xtr)
    llte, dte = haar_fwd(xte)
    oh = lambda y: F.one_hot(y, 10).float()
    sd_det, sd_ll = float(dtr.std()), float(lltr.std())
    print("detail std", sd_det, "LL std", sd_ll, flush=True)
    g = torch.Generator().manual_seed(0)
    perm = torch.randperm(len(xtr), generator=g)
    fit_idx, val_idx = perm[:4000], perm[4000:4500]
    sigmas = karras_sigmas(18, smax=DET_SMAX)[:-1].tolist()

    f = NMCRField(9 * PN * PN, 3 * PC * PC + 10, 9, m=M, scale_noisy=sd_det, scale_cond=sd_ll,
                  ls_noisy=(0.5, 200.0), ls_cond=(1.0, 30.0), seed=0)
    t0 = time.time()
    for split, ids in [("train", fit_idx), ("val", val_idx)]:
        for i in range(0, len(ids), 250):
            b = ids[i:i + 250]
            z = local_patches(dtr[b], lltr[b], oh(ytr[b]), PN, PC)
            tgt = dtr[b].permute(0, 2, 3, 1).reshape(-1, 9)
            f.accumulate(z, tgt, split)
    t_acc = time.time() - t0
    acc_flops = f.flops
    print(f"accumulated {f.stats['train']['n']} train / {f.stats['val']['n']} val patches in {t_acc:.0f}s, {acc_flops:.3e} FLOPs", flush=True)
    fits = [f.solve(s) for s in sigmas]
    nmcr_flops = f.flops
    t_fit = time.time() - t0
    print(f"solved {len(sigmas)} sigmas, total NMCR FLOPs {nmcr_flops:.3e}, {t_fit:.0f}s", flush=True)

    # closed-form linear-only and conditioning-only fits from the same sufficient statistics
    d_in = f.d_in
    lin_W, cond_W = {}, {}
    nz = 9 * PN * PN
    for s in sigmas:
        G, Bm, _ = f.system(s)
        Gl, Bl = G[:1 + d_in, :1 + d_in], Bm[:1 + d_in]
        lam = 1e-6 * Gl.diagonal()[1:].mean()
        lin_W[s] = torch.linalg.solve(Gl + lam * torch.eye(1 + d_in, dtype=torch.float64), Bl).float()
        keep = [0] + list(range(1 + nz, 1 + d_in))  # constant + conditioning coords only
        Gc, Bc = G[keep][:, keep], Bm[keep]
        cond_W[s] = (keep, torch.linalg.solve(Gc + lam * torch.eye(len(keep), dtype=torch.float64), Bc).float())

    # conventional baselines
    cnn = {}
    for mult in (1, 5):
        t1 = time.time()
        model, info = train_cnn(dtr, lltr, ytr, sd_det, mult * nmcr_flops)
        info["seconds"] = time.time() - t1
        cnn[mult] = (model, info)
        print(f"cnn {mult}x: {info}", flush=True)

    # held-out evaluation with real noise
    te = torch.randperm(len(xte), generator=g)[:500]
    res = {k: [] for k in ["cond_only", "linear_local", "nmcr", "cnn_1x", "cnn_5x", "prior"]}
    with torch.no_grad():
        for s in sigmas:
            d0, ll, y = dte[te], llte[te], yte[te]
            dt = d0 + s * torch.randn(d0.shape, generator=g)
            z = local_patches(dt, ll, oh(y), PN, PC)
            tgt = d0.permute(0, 2, 3, 1).reshape(-1, 9)
            phi_lin = torch.cat([torch.ones(z.shape[0], 1), z], 1)
            per_dim = lambda P: float(((P - tgt) ** 2).mean())
            res["nmcr"].append(per_dim(f.predict(z, s)))
            res["linear_local"].append(per_dim(phi_lin @ lin_W[s]))
            keep, Wc = cond_W[s]
            res["cond_only"].append(per_dim(phi_lin[:, keep] @ Wc))
            res["prior"].append(float(tgt.var(0).mean()))
            for mult in (1, 5):
                st = torch.full((len(te),), s)
                D = torch.cat([cnn[mult][0](dt[i:i + 100], st[i:i + 100], ll[i:i + 100], y[i:i + 100]) for i in range(0, len(te), 100)])
                res[f"cnn_{mult}x"].append(float(((D - d0) ** 2).mean()))
            print(f"sigma {s:7.4f}  nmcr {res['nmcr'][-1]:.5f}  lin {res['linear_local'][-1]:.5f}  cond {res['cond_only'][-1]:.5f}  "
                  f"cnn1 {res['cnn_1x'][-1]:.5f}  cnn5 {res['cnn_5x'][-1]:.5f}  prior {res['prior'][-1]:.5f}", flush=True)

    out = dict(sigmas=sigmas, test_mse_per_dim=res, closed_form_fits=fits, nmcr_flops=nmcr_flops,
               nmcr_accumulate_flops=acc_flops, nmcr_seconds=t_fit, accumulate_seconds=t_acc,
               cnn={k: v[1] for k, v in cnn.items()}, n_train_patches=f.stats["train"]["n"],
               features=M, patch_noisy=PN, patch_cond=PC, sd_det=sd_det, sd_ll=sd_ll,
               flops_per_site_prediction=f.flops_per_prediction())
    save_json(out, "nmcr.json")
    torch.save(dict(W=f.W, b=f.b, m=M, solutions=f.solutions, sigmas=sigmas, pn=PN, pc=PC, smax=DET_SMAX,
                    d_noisy=f.dn, d_cond=f.dc), os.path.join(RESULTS, "nmcr_field.pt"))
    print("done", flush=True)


if __name__ == "__main__":
    main()
