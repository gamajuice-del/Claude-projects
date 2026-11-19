"""Pillar R: Rao-Blackwellized denoising targets.

Standard denoising score matching regresses D(x_t) onto the clean sample x0 that produced x_t.
Given x_t, x0 is random (any training image could have produced x_t), so the label carries
irreducible noise of energy mmse(t).  Under the empirical data distribution the conditional mean
is available in closed form,

    yhat(x_t) = E[x0 | x_t] = sum_j pi_j(x_t) x0^j,   pi_j ∝ exp(-||x_t - x0^j||^2 / (2 sigma^2)),

and E[ ||D - x0||^2 | x_t ] = ||D - yhat||^2 + const, so replacing x0 by yhat leaves the expected
gradient *exactly* unchanged (Rao-Blackwell) while removing the label-noise part of its variance.
The remaining gradient noise is proportional to the model's excess loss, not to mmse(t).

Two estimators:
  exact_posterior_mean   -- full softmax over a pool (cost B*N*d).  Feasible for N <= ~1e5.
  StratifiedPosterior    -- scalable: exact head over k approximate nearest neighbours (found in a
                            PCA sketch; at scale an IVF index), plus a uniformly sampled tail with
                            importance weight (N - k)/s.  Cost B*(N*r [index] + (k + s)*d).
"""
import math

import torch


def exact_posterior_mean(xt, sigma, pool, pool_sq, chunk=8192):
    """xt: (B, d), sigma: (B,), pool: (N, d), pool_sq: (N,).  Returns (yhat (B,d), ess (B,))."""
    s2 = (sigma ** 2).reshape(-1, 1)
    # streaming log-sum-exp over pool chunks
    m = torch.full((xt.shape[0], 1), -float("inf"), dtype=xt.dtype)
    num = torch.zeros_like(xt)
    den = torch.zeros(xt.shape[0], 1, dtype=xt.dtype)
    den2 = torch.zeros(xt.shape[0], 1, dtype=xt.dtype)
    for i in range(0, pool.shape[0], chunk):
        P = pool[i:i + chunk]
        lg = (xt @ P.T - 0.5 * pool_sq[i:i + chunk]) / s2
        m_new = torch.maximum(m, lg.max(1, keepdim=True).values)
        scale = torch.exp(m - m_new)
        w = torch.exp(lg - m_new)
        num = num * scale + w @ P
        den = den * scale + w.sum(1, keepdim=True)
        den2 = den2 * scale ** 2 + (w * w).sum(1, keepdim=True)
        m = m_new
    return num / den, (den ** 2 / den2).squeeze(1)


class StratifiedPosterior:
    """Scalable estimator of the empirical posterior mean, optionally per class."""

    def __init__(self, x, y=None, num_classes=None, k=32, s=256, rank=64, seed=0):
        X = x.reshape(len(x), -1).float()
        self.d = X.shape[1]
        self.k, self.s, self.rank = k, s, rank
        self.mean = X.mean(0)
        # PCA sketch used only to *find* candidates; posterior weights are always computed exactly.
        Xs = X[torch.randperm(len(X), generator=torch.Generator().manual_seed(seed))[:min(len(X), 20000)]]
        _, _, V = torch.linalg.svd(Xs - self.mean, full_matrices=False)
        self.P = V[:rank].T.contiguous()  # (d, r)
        self.gen = torch.Generator().manual_seed(seed + 1)
        self.groups = {}
        labels = [None] if y is None else list(range(num_classes))
        self.global_index = {}
        for c in labels:
            idx = torch.arange(len(X)) if c is None else (y == c).nonzero(as_tuple=True)[0]
            pool = X[idx].contiguous()
            self.groups[c] = dict(idx=idx, pool=pool, sq=(pool * pool).sum(1),
                                  sketch=((pool - self.mean) @ self.P).contiguous())
            # map global dataset index -> position inside the group
            for pos, g in enumerate(idx.tolist()):
                self.global_index[g] = pos
        self.flops = 0.0
        self.calls = 0

    def flops_per_sample(self, n_pool):
        return 2 * self.d * self.rank + 2 * n_pool * self.rank + 4 * (self.k + self.s) * self.d + 6 * (self.k + self.s)

    def __call__(self, xt, sigma, self_idx, y=None):
        """xt (B,C,H,W) noisy; self_idx (B,) dataset indices of the clean samples (always included in
        the exact head so the estimator is exact in the low-noise limit)."""
        B = xt.shape[0]
        Xt = xt.reshape(B, -1)
        out = torch.empty_like(Xt)
        ess = torch.empty(B)
        keys = [None] * B if y is None else y.tolist()
        for c in set(keys):
            rows = torch.tensor([i for i in range(B) if keys[i] == c])
            g = self.groups[c]
            pool, sq, sketch = g["pool"], g["sq"], g["sketch"]
            N = pool.shape[0]
            q = (Xt[rows] - self.mean) @ self.P
            dist = (q * q).sum(1, keepdim=True) - 2 * q @ sketch.T + (sketch * sketch).sum(1)
            k = min(self.k, N)
            head = dist.topk(k, dim=1, largest=False).indices  # (b, k)
            own = torch.tensor([self.global_index[int(self_idx[i])] for i in rows.tolist()])
            has_own = (head == own[:, None]).any(1)
            head[~has_own, -1] = own[~has_own]
            s = min(self.s, N)
            tail = torch.randperm(N, generator=self.gen)[:s]  # shared uniform tail sample
            in_head = (tail[None, None, :] == head[:, :, None]).any(1)  # (b, s)
            xr, s2 = Xt[rows], (sigma[rows] ** 2).reshape(-1, 1)
            Ph = pool[head]  # (b, k, d)
            lg_h = (torch.einsum("bd,bkd->bk", xr, Ph) - 0.5 * sq[head]) / s2
            Pt = pool[tail]
            lg_t = (xr @ Pt.T - 0.5 * sq[tail]) / s2
            n_valid = (~in_head).sum(1, keepdim=True).clamp_min(1)
            lg_t = lg_t + torch.log((N - k) / n_valid.float())
            lg_t = lg_t.masked_fill(in_head, -float("inf"))
            w = torch.softmax(torch.cat([lg_h, lg_t], 1), 1)
            out[rows] = torch.einsum("bk,bkd->bd", w[:, :k], Ph) + w[:, k:] @ Pt
            ess[rows] = 1.0 / (w * w).sum(1)
            self.flops += len(rows) * self.flops_per_sample(N)
        self.calls += B
        return out.reshape(xt.shape), ess
