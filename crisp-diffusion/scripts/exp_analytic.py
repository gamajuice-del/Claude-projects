"""E1 + E2: where does a diffusion model actually have to learn, and how noisy are its labels?

E1 (gap profile, held-out test images): per-image MSE vs sigma of
    - EDM skip  c_skip x               (LMMSE under an isotropic N(0, sd^2 I) prior: what EDM gets free)
    - spectral scaffold                (stationary Gaussian, O(d log d))
    - Gaussian scaffold, unconditional (full covariance)
    - Gaussian scaffold, class-cond.   (the CRISP scaffold)
    - empirical posterior mean          (exact, class-conditional, over the training set: memorizer)
E2 (label noise, training images, class-conditional empirical posterior):
    - V_std   = E||x0 - E[x0|x_t]||^2         label-noise energy seen by standard DSM
    - V_strat = E||yhat_strat - E[x0|x_t]||^2  residual label noise of the scalable RB estimator
    - R_rb    = E||E[x0|x_t] - D_G||^2         residual a CRISP network must fit (RB targets)
    - ESS of the exact posterior; FLOPs of the estimators
"""
import os
import sys
import time

import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import cifar_view, save_json
from crisp.rb import StratifiedPosterior, exact_posterior_mean
from crisp.scaffold import GaussianScaffold, SpectralScaffold

SIGMAS = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 40.0, 80.0]


def class_exact(xt, sigma, y, pools):
    out = torch.empty(xt.shape[0], xt[0].numel())
    ess = torch.empty(xt.shape[0])
    for c in torch.unique(y).tolist():
        r = (y == c).nonzero(as_tuple=True)[0]
        P, sq = pools[c]
        out[r], ess[r] = exact_posterior_mean(xt[r].reshape(len(r), -1), sigma[r], P, sq)
    return out.reshape(xt.shape), ess


def run(res, threads, n=512):
    torch.set_num_threads(threads)
    xtr, ytr, xte, yte = cifar_view(res)
    d = xtr[0].numel()
    sd = float(xtr.std())
    t0 = time.time()
    g_unc = GaussianScaffold(xtr)
    g_cls = GaussianScaffold(xtr, ytr, num_classes=10)
    spec = SpectralScaffold(xtr)
    fit_time = time.time() - t0
    flat = xtr.reshape(len(xtr), -1)
    pools = {c: (flat[ytr == c].contiguous(), (flat[ytr == c] ** 2).sum(1)) for c in range(10)}
    strat = StratifiedPosterior(xtr, ytr, num_classes=10, k=32, s=256, rank=64)
    g = torch.Generator().manual_seed(0)
    te = torch.randperm(len(xte), generator=g)[:n]
    tr = torch.randperm(len(xtr), generator=g)[:n]
    E1 = {k: [] for k in ["edm_skip", "spectral", "gauss_uncond", "gauss_class", "empirical_posterior", "lmmse_theory_uncond"]}
    E2 = {k: [] for k in ["V_std", "V_strat", "R_rb", "R_std", "ess_exact", "ess_strat"]}
    for s in SIGMAS:
        st = torch.full((n,), s)
        x0, y = xte[te], yte[te]
        xt = x0 + s * torch.randn(x0.shape, generator=g)
        mse = lambda D: float(((D - x0) ** 2).sum((1, 2, 3)).mean())
        E1["edm_skip"].append(mse(sd ** 2 / (s ** 2 + sd ** 2) * xt))
        E1["spectral"].append(mse(spec(xt, st)))
        E1["gauss_uncond"].append(mse(g_unc(xt, st)))
        E1["gauss_class"].append(mse(g_cls(xt, st, y)))
        E1["empirical_posterior"].append(mse(class_exact(xt, st, y, pools)[0]))
        E1["lmmse_theory_uncond"].append(g_unc.lmmse(s))
        # ---- E2 on training images (the distribution the labels come from)
        x0, y, idx = xtr[tr], ytr[tr], tr
        xt = x0 + s * torch.randn(x0.shape, generator=g)
        ex, ess = class_exact(xt, st, y, pools)
        sa, ess_s = strat(xt, st, idx, y)
        dg = g_cls(xt, st, y)
        E2["V_std"].append(float(((x0 - ex) ** 2).sum((1, 2, 3)).mean()))
        E2["V_strat"].append(float(((sa - ex) ** 2).sum((1, 2, 3)).mean()))
        E2["R_rb"].append(float(((ex - dg) ** 2).sum((1, 2, 3)).mean()))
        E2["R_std"].append(float(((x0 - dg) ** 2).sum((1, 2, 3)).mean()))
        E2["ess_exact"].append(float(ess.mean()))
        E2["ess_strat"].append(float(ess_s.mean()))
        print(f"res {res} sigma {s:7.3f} | E1 skip {E1['edm_skip'][-1]:9.2f} spec {E1['spectral'][-1]:9.2f} gu {E1['gauss_uncond'][-1]:9.2f} "
              f"gc {E1['gauss_class'][-1]:9.2f} emp {E1['empirical_posterior'][-1]:9.2f} | E2 Vstd {E2['V_std'][-1]:9.3f} "
              f"Vstrat {E2['V_strat'][-1]:9.4f} Rrb {E2['R_rb'][-1]:8.3f} Rstd {E2['R_std'][-1]:9.3f} ess {E2['ess_exact'][-1]:7.1f}", flush=True)
    flops = dict(scaffold_fit_class=g_cls.flops_fit, scaffold_call=g_cls.flops_per_call(), spectral_fit=spec.flops_fit,
                 rb_exact_per_sample=4 * 5000 * d, rb_strat_per_sample=strat.flops_per_sample(5000))
    return dict(res=res, d=d, sigma_data=sd, sigmas=SIGMAS, E1=E1, E2=E2, flops=flops, fit_seconds=fit_time)


if __name__ == "__main__":
    threads = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    out = {f"res{r}": run(r, threads) for r in (32, 16)}
    print("saved", save_json(out, "analytic.json"))
