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


class RetrievalDenoiser(Denoiser):
    """Denoiser with read access to the training set (non-parametric memory + parametric reasoning).

    The k nearest same-class training images to the scaffold-denoised query (or the EDM-skip estimate if no
    scaffold) are concatenated as input channels, aligned in image coordinates. During training, set
    `self.exclude` to the pool positions of the generating images (leave-one-out) so the network cannot copy
    its own target. Distances are computed with matmuls so FlopCounterMode counts the retrieval."""

    def __init__(self, net, sigma_data, scaffold, pools, k=4, skip="scaffold"):
        super().__init__(net, sigma_data, scaffold)
        self.skip = skip  # "scaffold": D = D_G + c_out F ; "edm": D = c_skip x + c_out F (scaffold/neighbours only as inputs)
        self.pools = {c: p.reshape(len(p), -1).contiguous() for c, p in pools.items()}
        self.sq = {c: (p * p).sum(1) for c, p in self.pools.items()}
        self.k = k
        self.exclude = None

    def neighbours(self, q, y):
        if self.k == 0:
            return None
        B = q.shape[0]
        Q = q.reshape(B, -1)
        out = torch.empty(B, self.k, Q.shape[1], dtype=q.dtype)
        for c in torch.unique(y).tolist():
            rows = (y == c).nonzero(as_tuple=True)[0]
            P, sq = self.pools[c], self.sq[c]
            d = sq[None, :] - 2 * Q[rows] @ P.T
            if self.exclude is not None:
                d[torch.arange(len(rows)), self.exclude[rows]] = float("inf")
            nn_idx = d.topk(self.k, dim=1, largest=False).indices
            out[rows] = P[nn_idx]
        return out.reshape(B, self.k * q.shape[1], *q.shape[2:])

    def forward(self, x, sigma, y=None):
        s = sigma.reshape(-1, 1, 1, 1)
        sd = self.sd
        c_in = 1 / torch.sqrt(s ** 2 + sd ** 2)
        c_out = s * sd / torch.sqrt(s ** 2 + sd ** 2)
        with torch.no_grad():
            base = self.scaffold(x, sigma, y) if self.scaffold is not None else (sd ** 2 / (s ** 2 + sd ** 2)) * x
            nb = self.neighbours(base, y)
        parts = [c_in * x, base / sd] + ([nb / sd] if self.k > 0 else [])
        out = c_out * self.net(torch.cat(parts, 1), torch.log(sigma) / 4, y)
        if self.skip == "edm":
            return (sd ** 2 / (s ** 2 + sd ** 2)) * x + out
        return base + out


class PatchRetrievalDenoiser(RetrievalDenoiser):
    """Translation-equivariant patch retrieval: for each TxT tile of the query (scaffold estimate), find the k
    most similar WxW context windows from ANY tile position of any same-class training image (PCA sketch
    search, exact in the sketch), and paste their central tiles into k aligned 'exemplar mosaics' that are fed
    to the network.  Leave-one-out: windows from the generating image are excluded during training."""

    def __init__(self, net, sigma_data, scaffold, pools, k=2, skip="edm", T=4, W=8, rank=24, seed=0):
        torch.nn.Module.__init__(self)
        self.net, self.sd, self.scaffold, self.k, self.skip, self.exclude = net, sigma_data, scaffold, k, skip, None
        self.T, self.W, self.pad = T, W, (W - T) // 2
        C = next(iter(pools.values())).shape[1]
        self.C = C
        wins = {c: self._windows(p) for c, p in pools.items()}          # (N, n_pos, C*W*W)
        sample = torch.cat([w.reshape(-1, w.shape[-1])[::50] for w in wins.values()])
        self.wmean = sample.mean(0)
        _, _, V = torch.linalg.svd(sample - self.wmean, full_matrices=False)
        self.P = V[:rank].T.contiguous()
        self.db, self.tiles, self.img = {}, {}, {}
        for c, w in wins.items():
            N, npos, D = w.shape
            flat = w.reshape(N * npos, D)
            self.db[c] = ((flat - self.wmean) @ self.P).contiguous()
            ww = flat.reshape(N * npos, C, W, W)
            self.tiles[c] = ww[:, :, self.pad:self.pad + T, self.pad:self.pad + T].contiguous()
            self.img[c] = torch.arange(N).repeat_interleave(npos)

    def _windows(self, x):
        xp = torch.nn.functional.pad(x, [self.pad] * 4, mode="reflect")
        u = torch.nn.functional.unfold(xp, self.W, stride=self.T)          # (N, C*W*W, n_pos)
        return u.transpose(1, 2).contiguous()

    def neighbours(self, q, y):
        B, C, H, Wd = q.shape
        nh, nw = H // self.T, Wd // self.T
        qs = (self._windows(q) - self.wmean) @ self.P                          # (B, n_pos, r)
        out = torch.empty(B, self.k, C, H, Wd, dtype=q.dtype)
        for c in torch.unique(y).tolist():
            rows = (y == c).nonzero(as_tuple=True)[0]
            db = self.db[c]
            Q = qs[rows].reshape(-1, db.shape[1])                              # (b*n_pos, r)
            d = (db * db).sum(1)[None, :] - 2 * Q @ db.T
            if self.exclude is not None:
                ex = self.exclude[rows].repeat_interleave(nh * nw)
                d = d.masked_fill(self.img[c][None, :] == ex[:, None], float("inf"))
            nn_idx = d.topk(self.k, dim=1, largest=False).indices                # (b*n_pos, k)
            t = self.tiles[c][nn_idx]                                           # (b*n_pos, k, C, T, T)
            t = t.reshape(len(rows), nh, nw, self.k, C, self.T, self.T).permute(0, 3, 4, 1, 5, 2, 6)
            out[rows] = t.reshape(len(rows), self.k, C, H, Wd)
        return out.reshape(B, self.k * C, H, Wd)
