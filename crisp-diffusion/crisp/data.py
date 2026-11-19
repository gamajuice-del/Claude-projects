"""Dataset loading and the orthonormal Haar pyramid."""
import os

import numpy as np
import torch

DATA_DIR = os.environ.get("CRISP_DATA", "/home/user/data/npz")


def load_cifar10(device="cpu"):
    """Returns (xtr, ytr, xte, yte); images NCHW float32 in [-1, 1]."""
    z = np.load(os.path.join(DATA_DIR, "cifar10.npz"))
    f = lambda a: torch.from_numpy(a).permute(0, 3, 1, 2).float().div(127.5).sub(1.0).to(device)
    return f(z["xtr"]), torch.from_numpy(z["ytr"]).to(device), f(z["xte"]), torch.from_numpy(z["yte"]).to(device)


def load_mnist(device="cpu"):
    z = np.load(os.path.join(DATA_DIR, "mnist.npz"))
    f = lambda a: torch.from_numpy(a.copy()).unsqueeze(1).float().div(127.5).sub(1.0).to(device)
    g = lambda a: torch.from_numpy(a.astype(np.int64)).to(device)
    return f(z["xtr"]), g(z["ytr"]), f(z["xte"]), g(z["yte"])


# --------------------------------------------------------------------------------------------
# Orthonormal 2-D Haar transform.  Orthonormality matters: white noise of std sigma in pixel space
# is white noise of std sigma in coefficient space, so a pixel-space diffusion is exactly a
# coefficient-space diffusion and every scale can be noised/denoised with the same sigma.
# --------------------------------------------------------------------------------------------
def haar_fwd(x):
    a, b = x[..., 0::2, 0::2], x[..., 0::2, 1::2]
    c, d = x[..., 1::2, 0::2], x[..., 1::2, 1::2]
    ll = (a + b + c + d) / 2
    lh = (a - b + c - d) / 2
    hl = (a + b - c - d) / 2
    hh = (a - b - c + d) / 2
    return ll, torch.cat([lh, hl, hh], 1)


def haar_inv(ll, det):
    lh, hl, hh = det.chunk(3, 1)
    a = (ll + lh + hl + hh) / 2
    b = (ll - lh + hl - hh) / 2
    c = (ll + lh - hl - hh) / 2
    d = (ll - lh - hl + hh) / 2
    n, ch, h, w = ll.shape
    x = ll.new_empty(n, ch, 2 * h, 2 * w)
    x[..., 0::2, 0::2], x[..., 0::2, 1::2] = a, b
    x[..., 1::2, 0::2], x[..., 1::2, 1::2] = c, d
    return x
