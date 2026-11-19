"""E9: closed-form translation-equivariant patch posterior (approximate ELS machine) as a held-out denoiser.
For each 4x4 tile: candidates = top-32 windows (8x8 context, any position, same class) found in a PCA sketch
of the Wiener-denoised query; weights = softmax(-||x_t[window] - w_j||^2 / 2 sigma^2) computed exactly on the
NOISY query; output tile = weighted average of candidate centres.  Window size is also varied (W=8,12)."""
import os, sys
import torch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from crisp.common import cifar_view, save_json
from crisp.edm import PatchRetrievalDenoiser
from crisp.scaffold import GaussianScaffold
from crisp.unet import UNet
from generate_eval import load_model

SIGMAS = [0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 1.0, 2.0, 5.0]


@torch.no_grad()
def els(m, xt, base, sigma, y, K=32):
    B, C, H, W = xt.shape
    nh, nw = H // m.T, W // m.T
    qs = (m._windows(base) - m.wmean) @ m.P
    raw = m._windows(xt)                                   # noisy windows (B, n_pos, D)
    out = torch.empty_like(xt)
    for c in torch.unique(y).tolist():
        rows = (y == c).nonzero(as_tuple=True)[0]
        db = m.db[c]
        Q = qs[rows].reshape(-1, db.shape[1])
        d = (db * db).sum(1)[None, :] - 2 * Q @ db.T
        idx = d.topk(K, dim=1, largest=False).indices      # (b*n_pos, K)
        full = m.full[c][idx]                              # (b*n_pos, K, D)
        r = raw[rows].reshape(-1, 1, raw.shape[-1])
        s2 = sigma[rows].repeat_interleave(nh * nw)[:, None] ** 2
        w = torch.softmax(-((full - r) ** 2).sum(-1) / (2 * s2), dim=1)
        t = (w[:, :, None, None, None] * m.tiles[c][idx]).sum(1)
        t = t.reshape(len(rows), nh, nw, C, m.T, m.T).permute(0, 3, 1, 4, 2, 5)
        out[rows] = t.reshape(len(rows), C, H, W)
    return out


def main():
    torch.set_num_threads(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
    xtr, ytr, xte, yte = cifar_view(16)
    sc = GaussianScaffold(xtr, ytr, num_classes=10)
    edm = load_model("edm16_lr1e3", xtr, ytr)
    g = torch.Generator().manual_seed(11)
    ev = torch.randperm(len(xte), generator=g)[:200]
    x0, y = xte[ev], yte[ev]
    res = {"sigmas": SIGMAS, "scaffold": [], "edm16_lr1e3": []}
    for Wn in (8, 12):
        m = PatchRetrievalDenoiser(UNet(3, 3, base=16), 0.97, None, {c: xtr[ytr == c] for c in range(10)}, k=1, W=Wn)
        m.full = {c: (m.db[c] @ m.P.T + m.wmean) for c in m.db}  # sketch reconstruction is lossy; use exact windows:
        for c in m.db:
            m.full[c] = m._windows(xtr[ytr == c]).reshape(-1, m.wmean.numel())
        res[f"els_W{Wn}"] = []
        for s in SIGMAS:
            xt = x0 + s * torch.randn(x0.shape, generator=torch.Generator().manual_seed(int(s * 1000)))
            st = torch.full((len(x0),), s)
            base = sc(xt, st, y)
            mse = lambda D: float(((D - x0) ** 2).sum((1, 2, 3)).mean())
            res[f"els_W{Wn}"].append(mse(els(m, xt, base, st, y)))
            if Wn == 8:
                res["scaffold"].append(mse(base))
                res["edm16_lr1e3"].append(mse(torch.cat([edm(xt[i:i+100], st[i:i+100], y[i:i+100]) for i in range(0, len(x0), 100)])))
            print(f"W={Wn} sigma {s:5.2f} ELS {res[f'els_W{Wn}'][-1]:8.3f} scaffold {res['scaffold'][SIGMAS.index(s)]:8.3f} "
                  f"EDM(1.5e14) {res['edm16_lr1e3'][SIGMAS.index(s)]:8.3f}", flush=True)
    save_json(res, "els_quality.json")


if __name__ == "__main__":
    main()
