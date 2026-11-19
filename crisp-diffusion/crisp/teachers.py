"""Closed-form *generalizing* denoisers that can serve as low-variance training targets.

LocalPosterior (the "LS machine" of Kamb & Ganguli, class-conditional, non-equivariant):
    D(x_t)[u] = sum_j softmax_j( -||x_t[W_u] - x0^j[W_u]||^2 / (2 sigma^2) ) * x0^j[u]
where W_u is a P(sigma) x P(sigma) window around pixel u. Unlike the global empirical posterior (which is
one-hot -> memorization), the window makes the posterior spread over many training images at every
pixel, so the estimate generalizes (patch mosaics) and has low variance. P(sigma) is chosen per noise level
by closed-form held-out MSE (no gradients). Cost per query image: O(N * d * (1 + box filter)).
"""
import torch
import torch.nn.functional as F


class LocalPosterior:
    def __init__(self, x, y, num_classes=10, sizes=(1, 3, 5, 7, 9, 11, 13, 15, 17, 33), max_pool=None, seed=0):
        self.sizes = sizes
        self.pools = {}
        self.pos = torch.full((len(y),), -1, dtype=torch.long)  # dataset index -> position in its class pool
        g = torch.Generator().manual_seed(seed)
        for c in range(num_classes):
            members = (y == c).nonzero(as_tuple=True)[0]
            self.pos[members] = torch.arange(len(members))
            p = x[y == c]
            if max_pool is not None and len(p) > max_pool:
                p = p[torch.randperm(len(p), generator=g)[:max_pool]]
            self.pools[c] = p.contiguous()
        self.patch_for_sigma = {}
        self.flops = 0.0

    def _window_dist(self, xt, pool, P, chunk):
        """xt: (C,H,W); pool: (N,C,H,W) -> (N,H,W) windowed squared distances."""
        out = []
        for i in range(0, len(pool), chunk):
            d2 = ((pool[i:i + chunk] - xt[None]) ** 2).sum(1, keepdim=True)  # (n,1,H,W)
            if P > 1:
                pad = P // 2
                d2 = F.avg_pool2d(F.pad(d2, [pad] * 4, mode="replicate"), P, stride=1) * (P * P)
            out.append(d2[:, 0])
        return torch.cat(out)

    @torch.no_grad()
    def denoise(self, xt, sigma, y, P=None, chunk=2500, exclude=None):
        """xt (B,C,H,W), sigma (B,), y (B,). exclude: optional (B,) positions inside the class pool to leave
        out (leave-one-out targets for training images). Returns (B,C,H,W)."""
        out = torch.empty_like(xt)
        for b in range(xt.shape[0]):
            s = float(sigma[b])
            p = P if P is not None else self.patch_size(s)
            pool = self.pools[int(y[b])]
            d = self._window_dist(xt[b], pool, p, chunk)  # (N,H,W)
            if exclude is not None and exclude[b] >= 0:
                d[int(exclude[b])] = float("inf")
            w = torch.softmax(-d / (2 * s * s), dim=0)    # posterior over training images, per pixel
            out[b] = (w[:, None] * pool).sum(0)
            n, C, H, W = pool.shape
            self.flops += n * H * W * (3 * C + 6 + 2 * C)
        return out

    def patch_size(self, s):
        keys = sorted(self.patch_for_sigma)
        k = min(keys, key=lambda v: abs(torch.log(torch.tensor(v / s)).item()))
        return self.patch_for_sigma[k]

    @torch.no_grad()
    def calibrate(self, xval, yval, sigmas, n=64, seed=1):
        """Pick the window size per sigma by held-out MSE (closed form; no gradients)."""
        g = torch.Generator().manual_seed(seed)
        idx = torch.randperm(len(xval), generator=g)[:n]
        x0, yy = xval[idx], yval[idx]
        table = {}
        for s in sigmas:
            xt = x0 + s * torch.randn(x0.shape, generator=g)
            st = torch.full((n,), s)
            errs = {P: float(((self.denoise(xt, st, yy, P=P) - x0) ** 2).sum((1, 2, 3)).mean()) for P in self.sizes}
            best = min(errs, key=errs.get)
            self.patch_for_sigma[s] = best
            table[s] = errs
        return table
