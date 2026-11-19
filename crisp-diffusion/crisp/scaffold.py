"""Pillar C: the closed-form scaffold.

For ANY data distribution with mean mu and covariance Sigma, the best *affine* denoiser of
x_sigma = x0 + sigma * eps is the Wiener / LMMSE filter

    D_G(x, sigma) = mu + Sigma (Sigma + sigma^2 I)^{-1} (x - mu)
                  = mu + U diag(lam / (lam + sigma^2)) U^T (x - mu),

and its MSE is lmmse(sigma) = sum_k lam_k sigma^2 / (lam_k + sigma^2).  By orthogonality of the
LMMSE error to affine functions,  E||D_G - x0||^2 = E||D* - x0||^2 + E||D* - D_G||^2,  so the only
thing any network has to learn at noise level sigma is the residual D* - D_G, whose energy is
gap(sigma) = lmmse(sigma) - mmse(sigma).  The scaffold is one pass of second-order statistics and
is exact for all noise levels simultaneously.

Two variants:
  * GaussianScaffold   -- full (class-conditional) covariance, eigendecomposed.  O(N d^2 + d^3).
  * SpectralScaffold   -- translation-stationary covariance, diagonal in the Fourier basis with a
                          CxC cross-spectrum per frequency.  O(N d log d); scales to megapixels.
"""
import math

import torch


class GaussianScaffold:
    def __init__(self, x, y=None, num_classes=None, pool_weight=0.2, ridge=1e-4):
        """x: (N, C, H, W). y: optional labels -> class-conditional means/covariances, blended with
        the pooled covariance (weight `pool_weight`) to tame estimation noise."""
        self.shape = x.shape[1:]
        X = x.reshape(len(x), -1).double()
        d = X.shape[1]
        mu = X.mean(0)
        Xc = X - mu
        S_pool = Xc.T @ Xc / (len(X) - 1)
        self.flops_fit = 2 * len(X) * d * d + 10 * d ** 3
        self.conditional = y is not None
        self.mus, self.Us, self.lams = [], [], []
        groups = range(num_classes) if self.conditional else [None]
        for c in groups:
            if c is None:
                m, S = mu, S_pool
            else:
                Xk = X[y == c]
                m = Xk.mean(0)
                S = (Xk - m).T @ (Xk - m) / (len(Xk) - 1)
                S = (1 - pool_weight) * S + pool_weight * S_pool
                self.flops_fit += 2 * len(Xk) * d * d + 10 * d ** 3
            S = S + ridge * S.diagonal().mean() * torch.eye(d, dtype=S.dtype)
            lam, U = torch.linalg.eigh(S)
            self.mus.append(m.float())
            self.Us.append(U.float())
            self.lams.append(lam.clamp_min(0).float())
        self.d = d

    def flops_per_call(self):
        return 4 * self.d * self.d + 6 * self.d  # two dense mat-vecs

    def __call__(self, x, sigma, y=None):
        """x: (B, C, H, W), sigma: (B,) tensor.  Returns D_G(x, sigma | y)."""
        B = x.shape[0]
        X = x.reshape(B, -1)
        out = torch.empty_like(X)
        s2 = (sigma.reshape(B, 1) ** 2).to(X)
        groups = [(None, torch.arange(B, device=x.device))] if not self.conditional else \
            [(int(c), (y == c).nonzero(as_tuple=True)[0]) for c in torch.unique(y)]
        for c, idx in groups:
            k = 0 if c is None else c
            m, U, lam = self.mus[k], self.Us[k], self.lams[k]
            coef = (X[idx] - m) @ U
            coef = coef * (lam / (lam + s2[idx]))
            out[idx] = m + coef @ U.T
        return out.reshape(x.shape)

    def lmmse(self, sigma, c=0):
        lam = self.lams[c].double()
        return float((lam * sigma ** 2 / (lam + sigma ** 2)).sum())


class SpectralScaffold:
    """Stationary Gaussian prior: per-frequency CxC cross-spectrum, periodic boundary.
    Denoiser = per-frequency complex Wiener filter.  Cost O(d log d) per image."""

    def __init__(self, x, chunk=2048):
        N, C, H, W = x.shape
        self.C, self.H, self.W = C, H, W
        self.mean = x.mean(dim=(0, 2, 3), keepdim=True)  # stationary mean: one value per channel
        S = torch.zeros(H, W, C, C, dtype=torch.complex128)
        for i in range(0, N, chunk):
            F = torch.fft.fft2((x[i:i + chunk] - self.mean).double(), norm="ortho")  # (n,C,H,W)
            F = F.permute(0, 2, 3, 1)  # (n,H,W,C)
            S += torch.einsum("nhwc,nhwd->hwcd", F, F.conj())
        self.S = (S / N)
        self.flops_fit = N * (5 * C * H * W * math.log2(H * W) + 8 * H * W * C * C)

    def __call__(self, x, sigma):
        B = x.shape[0]
        F = torch.fft.fft2((x - self.mean).double(), norm="ortho").permute(0, 2, 3, 1)  # (B,H,W,C)
        I = torch.eye(self.C, dtype=torch.complex128)
        out = torch.empty_like(F)
        for b in range(B):
            s2 = float(sigma[b]) ** 2
            Wf = self.S @ torch.linalg.inv(self.S + s2 * I)  # (H,W,C,C)
            out[b] = torch.einsum("hwcd,hwd->hwc", Wf, F[b])
        x0 = torch.fft.ifft2(out.permute(0, 3, 1, 2), norm="ortho").real.float()
        return x0 + self.mean
