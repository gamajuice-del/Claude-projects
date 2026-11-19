"""Pillar SP (fine scales): Noise-Marginalized Closed-form Regression (NMCR) local fields.

A local field predicts the clean value at one site from a small noisy neighbourhood plus clean
conditioning (the coarser scale):  z_t = z0 + sigma * M eps,  M selects the noisy coordinates.

Feature map (linear + random Fourier):
    phi(z) = [ 1,  z,  sqrt(2/m) cos(W z + b) ]           (1 + d_in + m features)

Key identity.  With u_k = M^T w_k, A_k = w_k.z0 + b_k, C_k = cos A_k, S_k = sin A_k:
    E_eps[cos(A_k + sigma u_k.eps)]                       = e^{-sigma^2 |u_k|^2/2} C_k
    E_eps[phi_k phi_l] = (1/m)[ e^{-sigma^2|u_k-u_l|^2/2}(C_kC_l + S_kS_l)
                              + e^{-sigma^2|u_k+u_l|^2/2}(C_kC_l - S_kS_l) ]
    E_eps[z_t phi_k]   = sqrt(2/m) e^{-sigma^2|u_k|^2/2} ( z0 C_k - sigma^2 M u_k S_k )   (Stein)
    E_eps[z_t z_t^T]   = z0 z0^T + sigma^2 M M^T
Every data-dependent factor (z0 z0^T, z0 C^T, C C^T, S S^T, C y^T, means) is INDEPENDENT of sigma.
So a single pass over clean data yields the exact noise-integrated normal equations
    G(sigma) W(sigma) = B(sigma)
for every noise level at once: no noise sampling, no noise-level sampling, no back-propagation,
no epochs.  Each sigma then costs one (1+d_in+m)^3 solve.  The population training loss and a
held-out validation loss are also closed form, which we use to pick the ridge per sigma.
"""
import math

import torch


class NMCRField:
    def __init__(self, d_noisy, d_cond, d_out, m=2048, scale_noisy=1.0, scale_cond=1.0,
                 ls_noisy=(0.5, 100.0), ls_cond=(1.0, 20.0), frac=(0.25, 0.25), seed=0):
        """scale_*: typical std of the noisy / conditioning coordinates (features are drawn in
        standardized units).  ls_*: log-uniform range of kernel length-scales (standardized units).
        frac: fraction of features that see only noisy coords / only conditioning coords."""
        g = torch.Generator().manual_seed(seed)
        self.dn, self.dc, self.do, self.m = d_noisy, d_cond, d_out, m
        d_in = d_noisy + d_cond
        self.d_in = d_in
        lu = lambda lo, hi, n: torch.exp(torch.empty(n).uniform_(math.log(lo), math.log(hi), generator=g))
        Wn = torch.randn(m, d_noisy, generator=g) / lu(*ls_noisy, m)[:, None] / scale_noisy
        Wc = torch.randn(m, d_cond, generator=g) / lu(*ls_cond, m)[:, None] / scale_cond
        n1, n2 = int(frac[0] * m), int(frac[1] * m)
        Wc[:n1] = 0.0          # noisy-only features
        Wn[n1:n1 + n2] = 0.0   # conditioning-only features (immune to noise)
        self.W = torch.cat([Wn, Wc], 1).double()  # (m, d_in)
        self.b = (torch.rand(m, generator=g, dtype=torch.float64) * 2 * math.pi)
        U = self.W[:, :d_noisy]
        q = (U * U).sum(1)
        R = U @ U.T
        self.Dm = (q[:, None] + q[None, :] - 2 * R).clamp_min(0)  # |u_k - u_l|^2
        self.Dp = (q[:, None] + q[None, :] + 2 * R).clamp_min(0)  # |u_k + u_l|^2
        self.q = q
        self.MU = torch.zeros(d_in, m, dtype=torch.float64)
        self.MU[:d_noisy] = U.T
        self.mmT = torch.zeros(d_in, dtype=torch.float64)
        self.mmT[:d_noisy] = 1.0
        self.stats = {"train": self._empty(), "val": self._empty()}
        self.solutions = {}
        self.flops = 0.0

    # ---------------------------------------------------------------- sufficient statistics
    def _empty(self):
        d, m, o = self.d_in, self.m, self.do
        f64 = torch.float64
        return dict(n=0, LL=torch.zeros(d + m, d + m, dtype=f64), SS=torch.zeros(m, m, dtype=f64),
                    L=torch.zeros(d + m, dtype=f64), S=torch.zeros(m, dtype=f64),
                    Ly=torch.zeros(d + m, o, dtype=f64), y=torch.zeros(o, dtype=f64), yy=0.0)

    def accumulate(self, z0, y, split="train", chunk=16384):
        """z0: (n, d_in) clean inputs [noisy-coords first]; y: (n, d_out) clean targets."""
        st = self.stats[split]
        Wf, bf = self.W.float(), self.b.float()
        for i in range(0, z0.shape[0], chunk):
            z, t = z0[i:i + chunk].float(), y[i:i + chunk].float()
            A = z @ Wf.T + bf
            C, S = torch.cos(A), torch.sin(A)
            L = torch.cat([z, C], 1)
            st["LL"] += (L.T @ L).double()
            st["SS"] += (S.T @ S).double()
            st["L"] += L.sum(0).double()
            st["S"] += S.sum(0).double()
            st["Ly"] += (L.T @ t).double()
            st["y"] += t.sum(0).double()
            st["yy"] += float((t.double() ** 2).sum())
            st["n"] += z.shape[0]
            n, D = z.shape[0], self.d_in + self.m
            self.flops += n * (2 * self.d_in * self.m + 20 * self.m + 2 * D * D + 2 * self.m ** 2 + 2 * D * self.do)

    # ---------------------------------------------------------------- normal equations
    def system(self, sigma, split="train"):
        st = self.stats[split]
        n, d, m = st["n"], self.d_in, self.m
        s2 = float(sigma) ** 2
        LL, SS = st["LL"] / n, st["SS"] / n
        zz, zC, CC = LL[:d, :d], LL[:d, d:], LL[d:, d:]
        zbar, Cbar, Sbar = st["L"][:d] / n, st["L"][d:] / n, st["S"] / n
        e = torch.exp(-0.5 * s2 * self.q)
        r = math.sqrt(2.0 / m)
        Em, Ep = torch.exp(-0.5 * s2 * self.Dm), torch.exp(-0.5 * s2 * self.Dp)
        P = 1 + d + m
        G = torch.empty(P, P, dtype=torch.float64)
        G[0, 0] = 1.0
        G[0, 1:d + 1] = zbar
        G[0, d + 1:] = r * e * Cbar
        G[1:d + 1, 1:d + 1] = zz + s2 * torch.diag(self.mmT)
        G[1:d + 1, d + 1:] = r * (zC * e[None, :] - s2 * self.MU * (e * Sbar)[None, :])
        G[d + 1:, d + 1:] = (Em * (CC + SS) + Ep * (CC - SS)) / m
        iu = torch.triu_indices(P, P, 1)
        G[iu[1], iu[0]] = G[iu[0], iu[1]]
        Bm = torch.empty(P, self.do, dtype=torch.float64)
        Bm[0] = st["y"] / n
        Bm[1:d + 1] = st["Ly"][:d] / n
        Bm[d + 1:] = r * e[:, None] * st["Ly"][d:] / n
        return G, Bm, st["yy"] / n

    @staticmethod
    def quad_loss(W, G, Bm, yy):
        return float(yy - 2 * (W * Bm).sum() + (W * (G @ W)).sum())

    def solve(self, sigma, ridges=(1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2)):
        """Closed-form fit at one noise level; ridge chosen by the closed-form held-out loss."""
        G, Bm, yy = self.system(sigma, "train")
        has_val = self.stats["val"]["n"] > 0
        if has_val:
            Gv, Bv, yyv = self.system(sigma, "val")
        P = G.shape[0]
        scale = G.diagonal()[1:].mean()
        best = None
        for lam in ridges:
            reg = lam * scale * torch.eye(P, dtype=torch.float64)
            reg[0, 0] = 0.0
            try:
                Lc = torch.linalg.cholesky(G + reg)
            except RuntimeError:
                continue
            W = torch.cholesky_solve(Bm, Lc)
            self.flops += P ** 3 / 3 + 2 * P * P * self.do
            score = self.quad_loss(W, Gv, Bv, yyv) if has_val else self.quad_loss(W, G, Bm, yy)
            if best is None or score < best[0]:
                best = (score, lam, W)
        val_loss, lam, W = best
        self.solutions[float(sigma)] = W.float()
        return dict(sigma=float(sigma), ridge=lam, train_loss=self.quad_loss(W, G, Bm, yy) / self.do,
                    val_loss=val_loss / self.do if has_val else None,
                    prior_var=float(yy / self.do - ((Bm[0] ** 2).sum() / self.do)))

    # ---------------------------------------------------------------- inference
    def features(self, z):
        A = z @ self.W.float().T + self.b.float()
        return torch.cat([torch.ones(z.shape[0], 1), z, math.sqrt(2.0 / self.m) * torch.cos(A)], 1)

    def predict(self, z, sigma):
        W = self.solutions[float(sigma)]
        return self.features(z.float()) @ W

    def flops_per_prediction(self):
        return 2 * self.d_in * self.m + 20 * self.m + 2 * (1 + self.d_in + self.m) * self.do
