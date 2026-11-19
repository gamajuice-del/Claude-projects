"""Shared helpers for the experiment scripts: data views, patch extraction, eval sets."""
import json
import os

import torch
import torch.nn.functional as F

from .data import haar_fwd, load_cifar10

RESULTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results")


def cifar_view(res):
    """res=32: pixels.  res=16: the Haar low-pass (LL) band -- the coarse scale of the pyramid."""
    xtr, ytr, xte, yte = load_cifar10()
    if res == 16:
        xtr, xte = haar_fwd(xtr)[0], haar_fwd(xte)[0]
    return xtr.contiguous(), ytr, xte.contiguous(), yte


def local_patches(noisy, cond, y_onehot=None, pn=3, pc=5, cls_scale=1.0):
    """Builds per-site inputs for a local field.
    noisy: (B, Cn, H, W) noisy detail band.  cond: (B, Cc, H, W) clean coarse band.
    Returns z (B*H*W, Cn*pn^2 + Cc*pc^2 [+10]) with the noisy coordinates first."""
    B, Cn, H, W = noisy.shape
    zn = F.unfold(F.pad(noisy, [pn // 2] * 4, mode="reflect"), pn)  # (B, Cn*pn^2, HW)
    zc = F.unfold(F.pad(cond, [pc // 2] * 4, mode="reflect"), pc)
    parts = [zn, zc]
    if y_onehot is not None:
        parts.append(cls_scale * y_onehot[:, :, None].expand(-1, -1, H * W))
    return torch.cat(parts, 1).permute(0, 2, 1).reshape(B * H * W, -1)


def save_json(obj, *path):
    p = os.path.join(RESULTS, *path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        json.dump(obj, f, indent=1)
    return p
