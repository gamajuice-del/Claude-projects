"""E7: how good are candidate *generalizing* teachers as denoisers on held-out images (paired, per sigma)?
  scaffold (closed form), LS machine (closed form, window size calibrated per sigma on separate held-out
  images), and the EDM-16 network trained for 4.5e14 FLOPs (the 'oracle' teacher used in E8)."""
import os, sys, time
import torch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import cifar_view, save_json
from crisp.scaffold import GaussianScaffold
from crisp.teachers import LocalPosterior
from generate_eval import load_model

SIGMAS = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 80.0]

@torch.no_grad()
def main():
    torch.set_num_threads(4)
    xtr, ytr, xte, yte = cifar_view(16)
    sc = GaussianScaffold(xtr, ytr, num_classes=10)
    ls = LocalPosterior(xtr, ytr)
    t0 = time.time()
    cal_idx = torch.arange(0, 64)                     # calibration images (test split, disjoint from eval)
    table = ls.calibrate(xte[cal_idx], yte[cal_idx], SIGMAS, n=64)
    cal_time = time.time() - t0
    edm = load_model("edm16", xtr, ytr)
    g = torch.Generator().manual_seed(7)
    ev = 64 + torch.randperm(len(xte) - 64, generator=g)[:256]
    x0, y = xte[ev], yte[ev]
    out = {"sigmas": SIGMAS, "patch": {}, "scaffold": [], "ls": [], "edm16": [], "cal_table": {str(k): v for k, v in table.items()}}
    for s in SIGMAS:
        xt = x0 + s * torch.randn(x0.shape, generator=g)
        st = torch.full((len(x0),), s)
        m = lambda D: float(((D - x0) ** 2).sum((1, 2, 3)).mean())
        out["scaffold"].append(m(sc(xt, st, y)))
        out["ls"].append(m(ls.denoise(xt, st, y)))
        out["edm16"].append(m(torch.cat([edm(xt[i:i+128], st[i:i+128], y[i:i+128]) for i in range(0, len(x0), 128)])))
        out["patch"][str(s)] = ls.patch_size(s)
        print(f"sigma {s:7.3f} P={ls.patch_size(s):2d} scaffold {out['scaffold'][-1]:8.3f} LS {out['ls'][-1]:8.3f} EDM16 {out['edm16'][-1]:8.3f}", flush=True)
    out["ls_flops_per_query"] = ls.flops / max(1, (len(SIGMAS) * len(x0)) + 64 * len(SIGMAS) * len(ls.sizes))
    out["calibration_seconds"] = cal_time
    save_json(out, "teacher_quality.json")

if __name__ == "__main__":
    main()
