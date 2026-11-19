"""Pass 3: FLOP-budgeted EDM training on Imagenette 64x64, three roles:
  --mode pix     : class-conditional EDM on 64x64 pixels (baseline)
  --mode coarse  : class-conditional EDM on the 32x32 Haar LL band (pyramid coarse level)
  --mode detail  : conditional EDM on the 9-channel 32x32 detail band given the clean LL band, trained on random
                   CROPS (local field; no attention), sigma log-uniform over the detail sampler's range.
All FLOPs measured with FlopCounterMode (forward+backward per sample, at the actual training input size)."""
import argparse, copy, json, math, os, sys, time
import torch
import torch.nn as nn
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import RESULTS
from crisp.data import haar_fwd, load_imagenette
from crisp.edm import Denoiser, LogNormalSigma, edm_weight, measure_train_flops
from crisp.unet import UNet

DET_SMIN, DET_SMAX = 0.002, 5.0


class DetailDenoiser(nn.Module):
    def __init__(self, net, sd):
        super().__init__()
        self.net, self.sd = net, sd

    def forward(self, dt, sigma, y, ll):
        s = sigma.reshape(-1, 1, 1, 1); sd = self.sd
        c_in, c_out, c_skip = 1 / torch.sqrt(s**2 + sd**2), s * sd / torch.sqrt(s**2 + sd**2), sd**2 / (s**2 + sd**2)
        return c_skip * dt + c_out * self.net(torch.cat([c_in * dt, ll], 1), torch.log(sigma) / 4, y)


def views(mode):
    xtr, ytr, xte, yte = load_imagenette(64)
    if mode == "pix":
        return xtr, ytr, xte, yte, None, None
    lltr, dtr = haar_fwd(xtr); llte, dte = haar_fwd(xte)
    if mode == "coarse":
        return lltr, ytr, llte, yte, None, None
    return dtr, ytr, dte, yte, lltr, llte


def build(mode, base, sd):
    if mode == "pix":
        return Denoiser(UNet(3, 3, base=base, mults=(1, 2, 2, 2), num_classes=10), sd)
    if mode == "coarse":
        return Denoiser(UNet(3, 3, base=base, mults=(1, 2, 2), num_classes=10), sd)
    return DetailDenoiser(UNet(12, 9, base=base, mults=(1, 2, 2), num_classes=10, attn_lowest=False), sd)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True); ap.add_argument("--mode", required=True, choices=["pix", "coarse", "detail"])
    ap.add_argument("--budget", type=float, required=True); ap.add_argument("--base", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-3); ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--crop", type=int, default=16); ap.add_argument("--evals", type=int, default=10)
    ap.add_argument("--seed", type=int, default=0); ap.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    torch.set_num_threads(a.threads); torch.manual_seed(a.seed)
    out = os.path.join(RESULTS, "runs", a.name); os.makedirs(out, exist_ok=True)
    xtr, ytr, xte, yte, ctr, cte = views(a.mode)
    sd = float(xtr.std())
    model = build(a.mode, a.base, sd)
    ema = copy.deepcopy(model).eval()
    for p in ema.parameters():
        p.requires_grad_(False)
    opt = torch.optim.Adam(model.net.parameters(), lr=a.lr, betas=(0.9, 0.99))
    g = torch.Generator().manual_seed(a.seed + 7)
    lognorm = LogNormalSigma(seed=a.seed)

    def sample_sigma(B):
        if a.mode == "detail":
            return torch.exp(torch.empty(B).uniform_(math.log(DET_SMIN), math.log(DET_SMAX), generator=g))
        return lognorm.sample(B)[0]

    def batch():
        idx = torch.randint(0, len(xtr), (a.batch,), generator=g)
        x0, y = xtr[idx], ytr[idx]
        if a.mode != "detail":
            return x0, y, None
        c = ctr[idx]
        i, j = torch.randint(0, x0.shape[-1] - a.crop + 1, (2,), generator=g).tolist()
        return x0[..., i:i + a.crop, j:j + a.crop], y, c[..., i:i + a.crop, j:j + a.crop]

    x0, y, c = batch()
    if a.mode == "detail":
        from torch.utils.flop_counter import FlopCounterMode
        with FlopCounterMode(display=False) as fc:
            model(x0, torch.rand(a.batch) + 0.1, y, c).square().mean().backward()
        fl = fc.get_total_flops() / a.batch; model.zero_grad(set_to_none=True)
    else:
        fl = measure_train_flops(model, x0, torch.rand(a.batch) + 0.1, y)
    # fixed held-out eval set (full-size inputs)
    ge = torch.Generator().manual_seed(1234)
    ev = torch.randperm(len(xte), generator=ge)[:512]
    ex, ey = xte[ev], yte[ev]
    ec = cte[ev] if cte is not None else None
    es = (torch.exp(torch.empty(512).uniform_(math.log(DET_SMIN), math.log(DET_SMAX), generator=ge)) if a.mode == "detail"
          else torch.exp(torch.randn(512, generator=ge) * 1.2 - 1.2))
    en = torch.randn(ex.shape, generator=ge)

    @torch.no_grad()
    def evaluate():
        tot = []
        for i in range(0, 512, 128):
            s = es[i:i + 128]; xt = ex[i:i + 128] + s.reshape(-1, 1, 1, 1) * en[i:i + 128]
            D = ema(xt, s, ey[i:i + 128], ec[i:i + 128]) if a.mode == "detail" else ema(xt, s, ey[i:i + 128])
            tot.append(edm_weight(s, sd) * ((D - ex[i:i + 128]) ** 2).mean((1, 2, 3)))
        return float(torch.cat(tot).mean())

    log = dict(config=vars(a), sigma_data=sd, train_flops_per_sample=fl, curve=[])
    print(json.dumps({k: v for k, v in log.items() if k != "curve"}), flush=True)
    flops, step, t0, nxt = 0.0, 0, time.time(), 0.0
    while True:
        if flops >= nxt or flops >= a.budget:
            l = evaluate(); log["curve"].append(dict(step=step, flops=flops, test_loss=l, wall=time.time() - t0))
            print(f"step {step} flops {flops:.3e} test {l:.4f} t {time.time() - t0:.0f}s", flush=True)
            nxt += a.budget / a.evals
            if flops >= a.budget:
                break
        x0, y, c = batch()
        sigma = sample_sigma(a.batch)
        xt = x0 + sigma.reshape(-1, 1, 1, 1) * torch.randn(x0.shape, generator=g)
        D = model(xt, sigma, y, c) if a.mode == "detail" else model(xt, sigma, y)
        loss = (edm_weight(sigma, sd) * ((D - x0) ** 2).mean((1, 2, 3))).mean()
        opt.zero_grad(set_to_none=True); loss.backward()
        torch.nn.utils.clip_grad_norm_(model.net.parameters(), 1.0)
        for pg in opt.param_groups:
            pg["lr"] = a.lr * min(1.0, (step + 1) / 200)
        opt.step()
        dec = min(0.999, (1 + step) / (10 + step))
        with torch.no_grad():
            for pe, pm in zip(ema.net.parameters(), model.net.parameters()):
                pe.lerp_(pm, 1 - dec)
        step += 1
        flops = step * a.batch * fl
    log["steps"], log["wall"] = step, time.time() - t0
    torch.save(dict(state=ema.net.state_dict(), config=vars(a), sigma_data=sd), os.path.join(out, "ema.pt"))
    json.dump(log, open(os.path.join(out, "log.json"), "w"), indent=1)
    print("done", out, flush=True)


if __name__ == "__main__":
    main()
