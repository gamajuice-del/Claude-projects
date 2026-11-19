"""Correctness checks for the closed-form pieces.  Run: python -m pytest -q tests  (or python tests/test_core.py)"""
import math
import os
import sys

import torch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.data import haar_fwd, haar_inv
from crisp.nmcr import NMCRField
from crisp.rb import StratifiedPosterior, exact_posterior_mean
from crisp.scaffold import GaussianScaffold, SpectralScaffold


def test_haar_orthonormal():
    x = torch.randn(4, 3, 8, 8)
    ll, det = haar_fwd(x)
    assert torch.allclose(haar_inv(ll, det), x, atol=1e-6)
    assert abs(float((ll ** 2).sum() + (det ** 2).sum() - (x ** 2).sum())) < 1e-3


def test_nmcr_closed_form_matches_monte_carlo():
    torch.manual_seed(0)
    n, dn, dc, do, m = 400, 5, 3, 2, 64
    z0 = torch.randn(n, dn + dc) * 0.5
    y = torch.tanh(z0[:, :do] * 2) + 0.1 * z0[:, dn:dn + do]
    f = NMCRField(dn, dc, do, m=m, ls_noisy=(0.5, 5), ls_cond=(0.5, 5), seed=1)
    f.accumulate(z0, y)
    for sigma in [0.05, 0.4, 1.5]:
        G, Bm, _ = f.system(sigma)
        # Monte Carlo over many noise draws
        K = 4000
        Gmc = torch.zeros_like(G); Bmc = torch.zeros_like(Bm)
        zz = z0.double().repeat(K // 100, 1)
        yy = y.double().repeat(K // 100, 1)
        for _ in range(100):
            zt = zz.clone()
            zt[:, :dn] += sigma * torch.randn(zt.shape[0], dn, dtype=torch.float64)
            A = zt @ f.W.T + f.b
            phi = torch.cat([torch.ones(zt.shape[0], 1, dtype=torch.float64), zt, math.sqrt(2 / m) * torch.cos(A)], 1)
            Gmc += phi.T @ phi / zt.shape[0] / 100
            Bmc += phi.T @ yy / zt.shape[0] / 100
        err_G = (G - Gmc).abs().max() / G.abs().max()
        err_B = (Bm - Bmc).abs().max() / Bm.abs().max()
        assert err_G < 0.02 and err_B < 0.02, (sigma, float(err_G), float(err_B))


def test_rb_stratified_matches_exact():
    torch.manual_seed(0)
    N, d = 3000, 48
    X = torch.randn(N, d) * torch.linspace(2, 0.1, d)
    idx = torch.randint(0, N, (32,))
    est = StratifiedPosterior(X.reshape(N, 3, 4, 4), k=64, s=1024, rank=16)
    sq = (X * X).sum(1)
    for sigma in [0.05, 1.0, 20.0]:
        s = torch.full((32,), sigma)
        xt = X[idx] + sigma * torch.randn(32, d)
        ex, _ = exact_posterior_mean(xt, s, X, sq)
        st, _ = est(xt.reshape(32, 3, 4, 4), s, idx)
        rel = ((st.reshape(32, d) - ex) ** 2).sum() / ((X[idx] - ex) ** 2).sum().clamp_min(1e-12)
        assert rel < 0.15, (sigma, float(rel))


def test_scaffold_is_lmmse():
    torch.manual_seed(0)
    N, d = 20000, 16
    A = torch.randn(d, d) / 3
    X = (torch.randn(N, d) @ A + 0.3).reshape(N, 1, 4, 4)
    sc = GaussianScaffold(X)
    sigma = 0.7
    xt = X + sigma * torch.randn_like(X)
    mse = float(((sc(xt, torch.full((N,), sigma)) - X) ** 2).sum() / N)
    assert abs(mse - sc.lmmse(sigma)) / sc.lmmse(sigma) < 0.03


def test_spectral_scaffold_runs():
    x = torch.randn(64, 3, 8, 8)
    sp = SpectralScaffold(x)
    out = sp(x + 0.5 * torch.randn_like(x), torch.full((64,), 0.5))
    assert out.shape == x.shape


if __name__ == "__main__":
    for k, v in list(globals().items()):
        if k.startswith("test_"):
            v(); print("ok", k)
