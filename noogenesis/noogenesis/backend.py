"""Array backend: NumPy on CPU, CuPy on NVIDIA GPUs (e.g. 2x T4).

Every tensor operation in the engine goes through `xp`, so the same code runs on
both. Only a small, CuPy-compatible subset of NumPy is used (no np.add.at, no
object arrays); scatter-adds are written with `bincount(weights=...)`.
"""
from __future__ import annotations

import contextlib

import numpy as np


def get_xp(device: str = "cpu"):
    if device == "cpu":
        return np
    import cupy as cp  # noqa: WPS433  (optional dependency)

    return cp


def device_context(device: str):
    """`with device_context("cuda:1"):` pins CuPy allocations to GPU 1."""
    if device == "cpu":
        return contextlib.nullcontext()
    import cupy as cp

    idx = int(device.split(":")[1]) if ":" in device else 0
    return cp.cuda.Device(idx)


def to_numpy(a):
    if isinstance(a, np.ndarray) or np.isscalar(a):
        return a
    try:  # cupy array
        return a.get()
    except AttributeError:
        return np.asarray(a)


def scatter_add(xp, size: int, idx, vals):
    """Return a length-`size` vector with vals summed at idx (duplicates allowed)."""
    if idx.size == 0:
        return xp.zeros(size, dtype=xp.float32)
    return xp.bincount(idx, weights=vals, minlength=size).astype(xp.float32)


def fsum(a) -> float:
    """Float64 host-side sum (used by the energy ledger)."""
    return float(a.sum(dtype=np.float64)) if a.size else 0.0
