"""EDM preconditioning, objectives, noise-level samplers (incl. Pillar I) and the Heun sampler."""
import math

import torch
import torch.nn as nn
from torch.utils.flop_counter import FlopCounterMode

SIGMA_MIN, SIGMA_MAX = 0.002, 80.0


class Denoiser(nn.Module):
    """EDM: D = c_skip x + c_out F(c_in x).  CRISP: D = D_G(x) + c_out F([c_in x, D_G/sd]).
    The CRISP form replaces EDM's isotropic-Gaussian skip (c_skip x is the LMMSE estimator under an
    N(0, sd^2 I) prior) with the full LMMSE scaffold, so F only has to model D* - D_G."""

    def __init__(self, net, sigma_data, scaffold=None):
        super().__init__()
        self.net, self.sd, self.scaffold = net, sigma_data, scaffold

    def forward(self, x, sigma, y=None):
        s = sigma.reshape(-1, 1, 1, 1)
        sd = self.sd
        c_in = 1 / torch.sqrt(s ** 2 + sd ** 2)
        c_out = s * sd / torch.sqrt(s ** 2 + sd ** 2)
        c_noise = torch.log(sigma) / 4
        if self.scaffold is None:
            c_skip = sd ** 2 / (s ** 2 + sd ** 2)
            return c_skip * x + c_out * self.net(c_in * x, c_noise, y)
        with torch.no_grad():
            base = self.scaffold(x, sigma, y)
        return base + c_out * self.net(torch.cat([c_in * x, base / sd], 1), c_noise, y)


def edm_weight(sigma, sd):
    return (sigma ** 2 + sd ** 2) / (sigma * sd) ** 2


class LogNormalSigma:
    def __init__(self, p_mean=-1.2, p_std=1.2, seed=0):
        self.pm, self.ps = p_mean, p_std
        self.g = torch.Generator().manual_seed(seed)

    def sample(self, B):
        s = torch.exp(torch.randn(B, generator=self.g) * self.ps + self.pm)
        return s, torch.ones(B)

    def update(self, sigma, loss):
        pass


class InfoAllocatedSigma(LogNormalSigma):
    """Pillar I: importance-sample noise levels where there is still something to learn.

    Proposal q(sigma) ∝ p(sigma) * r(sigma), r = sqrt(E[l^2 | bin]) (variance-optimal for SGD when the
    gradient norm tracks the loss), mixed with p for safety; samples carry weight p/q so the
    objective is unchanged.  With standard targets l is dominated by irreducible mmse(sigma) and
    this proposal is nearly uninformative; with Rao-Blackwellized targets + scaffold, l is the
    *excess* loss, i.e. the remaining learnable information at that noise level."""

    def __init__(self, nbins=24, floor=0.2, ema=0.98, **kw):
        super().__init__(**kw)
        self.edges = torch.linspace(math.log(SIGMA_MIN), math.log(SIGMA_MAX), nbins + 1)
        self.l2 = torch.ones(nbins)
        self.seen = torch.zeros(nbins)
        self.floor, self.ema = floor, ema

    def bins(self, sigma):
        return torch.bucketize(torch.log(sigma), self.edges[1:-1])

    def ratio(self, sigma):
        r = torch.sqrt(self.l2[self.bins(sigma)])
        return r

    def sample(self, B):
        pool, _ = super().sample(8 * B)
        r = self.ratio(pool)
        r = (1 - self.floor) * r / r.mean() + self.floor
        idx = torch.multinomial(r, B, replacement=True, generator=self.g)
        return pool[idx], (r.mean() / r[idx])

    def update(self, sigma, loss):
        b = self.bins(sigma)
        for k in torch.unique(b):
            v = (loss[b == k].detach() ** 2).mean()
            a = self.ema if self.seen[k] > 0 else 0.0
            self.l2[k] = a * self.l2[k] + (1 - a) * v
            self.seen[k] += 1


def karras_sigmas(n=18, rho=7.0, smin=SIGMA_MIN, smax=SIGMA_MAX):
    i = torch.arange(n, dtype=torch.float64)
    s = (smax ** (1 / rho) + i / (n - 1) * (smin ** (1 / rho) - smax ** (1 / rho))) ** rho
    return torch.cat([s, torch.zeros(1, dtype=torch.float64)])


@torch.no_grad()
def heun_sample(denoise, shape, y=None, n=18, smax=SIGMA_MAX, smin=SIGMA_MIN, seed=0):
    """EDM Algorithm 1 (deterministic Heun).  `denoise(x, sigma_tensor, y)` -> x0 estimate."""
    g = torch.Generator().manual_seed(seed)
    ts = karras_sigmas(n, smin=smin, smax=smax)
    x = torch.randn(shape, generator=g) * ts[0]
    B = shape[0]
    for i in range(n):
        t, tn = float(ts[i]), float(ts[i + 1])
        d = (x - denoise(x, torch.full((B,), t), y)) / t
        xn = x + (tn - t) * d
        if tn > 0:
            d2 = (xn - denoise(xn, torch.full((B,), tn), y)) / tn
            xn = x + (tn - t) * 0.5 * (d + d2)
        x = xn
    return x


def measure_train_flops(model, x, sigma, y):
    """Exact forward+backward FLOPs (convs, matmuls, attention) of one training step, per sample."""
    with FlopCounterMode(display=False) as fc:
        out = model(x, sigma, y)
        out.square().mean().backward()
    model.zero_grad(set_to_none=True)
    return fc.get_total_flops() / x.shape[0]


def measure_fwd_flops(model, x, sigma, y):
    with torch.no_grad(), FlopCounterMode(display=False) as fc:
        model(x, sigma, y)
    return fc.get_total_flops() / x.shape[0]
