"""Train a class-conditional denoiser under a fixed FLOP budget, logging held-out loss vs FLOPs.

  --method edm          standard EDM (Karras et al. 2022) training
  --rb                  Pillar R: Rao-Blackwellized (stratified empirical-posterior) targets
  --scaffold            Pillar C: residual over the closed-form class-conditional LMMSE scaffold
  --ia                  Pillar I: information-allocated (excess-loss) noise-level sampling
  --res 16              Pillar SP: train only the coarse (Haar LL, 16x16) scale

All FLOPs are counted: network fwd+bwd (measured with torch FlopCounterMode, includes scaffold
mat-vecs), RB retrieval (analytic count), scaffold fitting (analytic count).
"""
import argparse
import copy
import json
import math
import os
import sys
import time

import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS, cifar_view
from crisp.edm import (Denoiser, InfoAllocatedSigma, LogNormalSigma, edm_weight,
                       measure_fwd_flops, measure_train_flops)
from crisp.rb import StratifiedPosterior
from crisp.scaffold import GaussianScaffold
from crisp.unet import UNet


def build_eval(xte, yte, sd, n=1024, seed=1234):
    g = torch.Generator().manual_seed(seed)
    idx = torch.randperm(len(xte), generator=g)[:n]
    x0, y = xte[idx], yte[idx]
    sig = torch.exp(torch.randn(n, generator=g) * 1.2 - 1.2)
    noise = torch.randn(x0.shape, generator=g)
    return x0, y, sig, noise


@torch.no_grad()
def evaluate(model, ev, sd, bs=256):
    x0, y, sig, noise = ev
    per = []
    for i in range(0, len(x0), bs):
        s = sig[i:i + bs]
        xt = x0[i:i + bs] + s.reshape(-1, 1, 1, 1) * noise[i:i + bs]
        D = model(xt, s, y[i:i + bs])
        per.append(edm_weight(s, sd) * ((D - x0[i:i + bs]) ** 2).mean((1, 2, 3)))
    per = torch.cat(per)
    edges = torch.tensor([-1e9, math.log(0.05), math.log(0.2), math.log(0.6), math.log(2.0), 1e9])
    b = torch.bucketize(torch.log(sig), edges[1:-1])
    bins = [float(per[b == k].mean()) if (b == k).any() else None for k in range(5)]
    return float(per.mean()), bins


@torch.no_grad()
def mse_profile(model, xte, yte, sigmas, n=512, seed=99):
    g = torch.Generator().manual_seed(seed)
    idx = torch.randperm(len(xte), generator=g)[:n]
    x0, y = xte[idx], yte[idx]
    out = []
    for s in sigmas:
        noise = torch.randn(x0.shape, generator=g)
        st = torch.full((n,), s)
        D = torch.cat([model(x0[i:i + 128] + s * noise[i:i + 128], st[i:i + 128], y[i:i + 128]) for i in range(0, n, 128)])
        out.append(float(((D - x0) ** 2).sum((1, 2, 3)).mean()))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--res", type=int, default=32)
    ap.add_argument("--rb", action="store_true")
    ap.add_argument("--scaffold", action="store_true")
    ap.add_argument("--ia", action="store_true")
    ap.add_argument("--budget", type=float, default=1.5e14)
    ap.add_argument("--evals", type=int, default=12)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--base", type=int, default=64)
    ap.add_argument("--ema", type=float, default=0.999)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--teacher_net", default=None, help="run name of a trained model used as target (oracle diagnostic)")
    ap.add_argument("--teacher_ls", action="store_true", help="closed-form LS-machine teacher (leave-one-out)")
    ap.add_argument("--td", type=float, default=0.0, help="TD bootstrapping: target = EMA(x_s, s) with s = td * sigma")
    ap.add_argument("--td_floor", type=float, default=0.02, help="below this sigma_s use x0 (anchor)")
    ap.add_argument("--teacher_mix", type=float, default=1.0, help="target = (1-a) x0 + a * teacher")
    ap.add_argument("--teacher_anneal", type=float, default=0.0, help="if >0, a decays linearly to 0 at this many FLOPs")
    ap.add_argument("--count_teacher", type=int, default=1, help="count teacher FLOPs in the budget (0 only for the oracle diagnostic)")
    ap.add_argument("--retrieve", type=int, default=0, help="k nearest training images fed as inputs (leave-one-out in training)")
    ap.add_argument("--skip", default="scaffold", choices=["scaffold", "edm"], help="skip path when scaffold/retrieval are used")
    ap.add_argument("--opt", default="adam", choices=["adam", "muon"])
    ap.add_argument("--patch_retrieve", type=int, default=0, help="k exemplar mosaics from translation-equivariant patch retrieval")
    ap.add_argument("--muon_lr", type=float, default=0.02)
    ap.add_argument("--aux_input", action="store_true", help="use the RetrievalDenoiser path even with k=0 (scaffold as input only)")
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    torch.manual_seed(a.seed)
    out_dir = os.path.join(RESULTS, "runs", a.name)
    os.makedirs(out_dir, exist_ok=True)

    xtr, ytr, xte, yte = cifar_view(a.res)
    C = xtr.shape[1]
    sd = float(xtr.std())
    aux_flops = 0.0
    scaffold = None
    if a.scaffold:
        scaffold = GaussianScaffold(xtr, ytr, num_classes=10)
        aux_flops += scaffold.flops_fit
    rb = StratifiedPosterior(xtr, ytr, num_classes=10, k=32, s=256, rank=64, seed=a.seed) if a.rb else None
    if rb is not None:
        aux_flops += 2 * min(len(xtr), 20000) * xtr[0].numel() ** 2 + 2 * len(xtr) * xtr[0].numel() * 64  # SVD sketch + projection

    if a.patch_retrieve:
        from crisp.edm import PatchRetrievalDenoiser
        net = UNet(2 * C + a.patch_retrieve * C, C, base=a.base, num_classes=10)
        model = PatchRetrievalDenoiser(net, sd, scaffold, {c: xtr[ytr == c] for c in range(10)}, k=a.patch_retrieve, skip=a.skip)
        pos = torch.full((len(ytr),), -1, dtype=torch.long)
        for c in range(10):
            m = (ytr == c).nonzero(as_tuple=True)[0]
            pos[m] = torch.arange(len(m))
    elif a.retrieve or a.aux_input:
        from crisp.edm import RetrievalDenoiser
        net = UNet(2 * C + a.retrieve * C, C, base=a.base, num_classes=10)
        pools = {c: xtr[ytr == c] for c in range(10)}
        model = RetrievalDenoiser(net, sd, scaffold, pools, k=a.retrieve, skip=a.skip)
        pos = torch.full((len(ytr),), -1, dtype=torch.long)
        for c in range(10):
            m = (ytr == c).nonzero(as_tuple=True)[0]
            pos[m] = torch.arange(len(m))
    else:
        net = UNet(2 * C if a.scaffold else C, C, base=a.base, num_classes=10)
        model = Denoiser(net, sd, scaffold)
    ema = copy.deepcopy(model).eval()
    for p in ema.parameters():
        p.requires_grad_(False)
    muon = None
    if a.opt == "muon":
        from crisp.optim import Muon, split_params
        mp, ap_ = split_params(net)
        muon = Muon(mp, lr=a.muon_lr)
        opt = torch.optim.Adam(ap_, lr=a.lr, betas=(0.9, 0.99))
    else:
        opt = torch.optim.Adam(net.parameters(), lr=a.lr, betas=(0.9, 0.99))
    sampler = InfoAllocatedSigma(seed=a.seed) if a.ia else LogNormalSigma(seed=a.seed)
    g = torch.Generator().manual_seed(a.seed + 7)

    fl_step = measure_train_flops(model, xtr[:a.batch], torch.rand(a.batch) + 0.1, ytr[:a.batch])
    teacher, ls, fl_teacher, teacher_flops = None, None, 0.0, 0.0
    if a.teacher_net:
        from generate_eval import load_model
        teacher = load_model(a.teacher_net, xtr, ytr)
        fl_teacher = measure_fwd_flops(teacher, xtr[:a.batch], torch.rand(a.batch) + 0.1, ytr[:a.batch])
    if a.td > 0:
        fl_teacher = measure_fwd_flops(ema, xtr[:a.batch], torch.rand(a.batch) + 0.1, ytr[:a.batch])
    if a.teacher_ls:
        from crisp.teachers import LocalPosterior
        ls = LocalPosterior(xtr, ytr)
        tq = json.load(open(os.path.join(RESULTS, "teacher_quality.json")))
        ls.patch_for_sigma = {float(k): v for k, v in tq["patch"].items()}
    ev = build_eval(xte, yte, sd)
    log = dict(config=vars(a), sigma_data=sd, params=sum(p.numel() for p in net.parameters()),
               train_flops_per_sample=fl_step, aux_flops=aux_flops, curve=[])
    print(json.dumps({k: v for k, v in log.items() if k != "curve"}), flush=True)

    flops, step, t0 = aux_flops, 0, time.time()
    next_eval = 0.0
    eval_every = a.budget / a.evals
    while True:
        if flops >= next_eval or flops >= a.budget:
            l, bins = evaluate(ema, ev, sd)
            log["curve"].append(dict(step=step, flops=flops, test_loss=l, bins=bins, wall=time.time() - t0,
                                     rb_flops=rb.flops if rb else 0.0, teacher_flops=teacher_flops))
            print(f"step {step} flops {flops:.3e} test {l:.4f} bins {[round(b, 4) if b else None for b in bins]} t {time.time() - t0:.0f}s", flush=True)
            next_eval += eval_every
            if flops >= a.budget:
                break
        idx = torch.randint(0, len(xtr), (a.batch,), generator=g)
        x0, y = xtr[idx], ytr[idx]
        sigma, w = sampler.sample(a.batch)
        xt = x0 + sigma.reshape(-1, 1, 1, 1) * torch.randn(x0.shape, generator=g)
        if rb is not None:
            with torch.no_grad():
                target, _ = rb(xt, sigma, idx, y)
        else:
            target = x0
        mix = a.teacher_mix * (max(0.0, 1.0 - flops / a.teacher_anneal) if a.teacher_anneal > 0 else 1.0)
        if mix > 0 and (teacher is not None or ls is not None or a.td > 0):
            with torch.no_grad():
                if teacher is not None:
                    tgt = teacher(xt, sigma, y)
                    teacher_flops += a.batch * fl_teacher
                elif ls is not None:
                    before = ls.flops
                    tgt = ls.denoise(xt, sigma, y, exclude=ls.pos[idx])
                    teacher_flops += ls.flops - before
                else:  # TD: re-draw the pair (x_s, x_t) on one forward chain; bootstrap from the less noisy view
                    s_s = a.td * sigma
                    xs = x0 + s_s.reshape(-1, 1, 1, 1) * torch.randn(x0.shape, generator=g)
                    xt = xs + torch.sqrt(sigma ** 2 - s_s ** 2).reshape(-1, 1, 1, 1) * torch.randn(x0.shape, generator=g)
                    tgt = ema(xs, s_s, y)
                    tgt = torch.where((s_s < a.td_floor).reshape(-1, 1, 1, 1), x0, tgt)
                    teacher_flops += a.batch * fl_teacher
            target = (1 - mix) * target + mix * tgt
        if a.retrieve or a.patch_retrieve:
            model.exclude = pos[idx]
        D = model(xt, sigma, y)
        if a.retrieve or a.aux_input or a.patch_retrieve:
            model.exclude = None
        per = edm_weight(sigma, sd) * ((D - target) ** 2).mean((1, 2, 3))
        loss = (w * per).mean()
        opt.zero_grad(set_to_none=True)
        if muon is not None:
            muon.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        warm = min(1.0, (step + 1) / 200)
        for pg in opt.param_groups:
            pg["lr"] = a.lr * warm
        opt.step()
        if muon is not None:
            for pg in muon.param_groups:
                pg["lr"] = a.muon_lr * warm
            muon.step()
        decay = min(a.ema, (1 + step) / (10 + step))
        with torch.no_grad():
            for pe, pm in zip(ema.net.parameters(), net.parameters()):
                pe.lerp_(pm, 1 - decay)
        sampler.update(sigma, per.detach())
        step += 1
        flops = (aux_flops + step * a.batch * fl_step + (rb.flops if rb else 0.0) + (teacher_flops if a.count_teacher else 0.0)
                 + (step * muon.flops_per_step if muon is not None else 0.0))

    sig_grid = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 40.0, 80.0]
    log["mse_profile"] = dict(sigmas=sig_grid, mse=mse_profile(ema, xte, yte, sig_grid))
    if a.ia:
        log["ia_bins"] = dict(edges=sampler.edges.tolist(), l2=sampler.l2.tolist())
    log["steps"], log["wall"] = step, time.time() - t0
    torch.save(dict(state=ema.net.state_dict(), config=vars(a), sigma_data=sd), os.path.join(out_dir, "ema.pt"))
    with open(os.path.join(out_dir, "log.json"), "w") as f:
        json.dump(log, f, indent=1)
    print("done", out_dir, flush=True)


if __name__ == "__main__":
    main()
