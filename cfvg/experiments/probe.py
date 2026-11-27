"""Evaluation probe: reads the world (context) and the events (content) back out
of any clip. It is trained only on ground-truth renders, over the whole
parameter space (including the gravity band the generators never see), and is
then frozen and used to score generated videos, the way FVD uses a fixed
pretrained network to score samples.
"""
from __future__ import annotations

import argparse
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from engine import (CONTENT_RANGES, G_RANGE, GIANT, SIZE_RANGE, WIND, render, sample_content,
                    sample_contexts)

# continuous targets: bg(3) fg(3) size gravity wind ghost noise | x0 y0 vx vy
CTX_NAMES = ["bg_r", "bg_g", "bg_b", "fg_r", "fg_g", "fg_b",
             "size", "gravity", "wind", "ghost", "noise"]
CON_NAMES = list(CONTENT_RANGES)
LO = np.array([0] * 6 + [SIZE_RANGE[0], 0.0, -WIND, 0.0, 0.0] + [r[0] for r in CONTENT_RANGES.values()], np.float32)
HI = np.array([1] * 6 + [SIZE_RANGE[1] * GIANT, G_RANGE[1], WIND, 0.75, 0.12] + [r[1] for r in CONTENT_RANGES.values()], np.float32)


def targets(ctx, c, giant):
    v = ctx.vector().copy()
    v[:, 6] = ctx.size * np.where(giant, GIANT, 1.0)       # rendered size
    y = np.concatenate([v, c.vector()], 1)
    return (y - LO) / (HI - LO), ctx.shape, ctx.hold - 1


class Probe(nn.Module):
    def __init__(self):
        super().__init__()
        def blk(i, o, s):
            return nn.Sequential(nn.Conv3d(i, o, 3, s, 1), nn.GroupNorm(8, o), nn.GELU())
        self.net = nn.Sequential(blk(3, 32, 1), blk(32, 64, (1, 2, 2)), blk(64, 96, (2, 2, 2)),
                                 blk(96, 128, (2, 1, 1)), blk(128, 128, 1))
        self.head = nn.Sequential(nn.Flatten(), nn.Linear(128 * 2 * 4 * 4, 512), nn.GELU(),
                                  nn.Linear(512, 15 + 3 + 3))

    def forward(self, x):                      # x: (B, T, 3, H, W)
        o = self.head(self.net(x.transpose(1, 2)))
        return o[:, :15], o[:, 15:18], o[:, 18:21]

    @torch.no_grad()
    def read(self, x, bs=128):
        """Returns dict of physical values for clips in [-1, 1]."""
        outs = [self(x[i:i + bs]) for i in range(0, len(x), bs)]
        reg = torch.cat([o[0] for o in outs]).numpy() * (HI - LO) + LO
        shape = torch.cat([o[1] for o in outs]).argmax(1).numpy()
        hold = torch.cat([o[2] for o in outs]).argmax(1).numpy() + 1
        d = {n: reg[:, i] for i, n in enumerate(CTX_NAMES + CON_NAMES)}
        d["shape"], d["hold"] = shape, hold
        return d


class _Stream(torch.utils.data.IterableDataset):
    def __iter__(self):
        rng = np.random.default_rng(123)
        while True:
            yield batch(rng, 64)


def batch(rng, n):
    ctx = sample_contexts(rng, n, "any")
    c = sample_content(rng, n)
    giant = rng.random(n) < 0.3
    x = render(ctx, c, giant, rng)
    y, s, h = targets(ctx, c, giant)
    return torch.from_numpy(x), torch.from_numpy(y), torch.from_numpy(s), torch.from_numpy(h)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=2500)
    ap.add_argument("--out", default="runs/probe.pt")
    a = ap.parse_args()
    torch.manual_seed(0)
    rng = np.random.default_rng(123)
    p = Probe()
    opt = torch.optim.AdamW(p.parameters(), 1e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 1e-3, total_steps=a.steps, pct_start=0.05)
    t0 = time.time()
    torch.set_num_threads(3)
    loader = torch.utils.data.DataLoader(_Stream(), batch_size=None, num_workers=1, prefetch_factor=4)
    for step, (x, y, s, h) in zip(range(a.steps), loader):
        with torch.autocast("cpu", dtype=torch.bfloat16):
            r, ls, lh = p(x)
        loss = F.smooth_l1_loss(r.float(), y, beta=0.05) + 0.1 * (
            F.cross_entropy(ls.float(), s) + F.cross_entropy(lh.float(), h))
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % 250 == 0:
            print(f"step {step} loss {loss.item():.4f} {time.time() - t0:.0f}s", flush=True)
    torch.save(p.state_dict(), a.out)

    # held-out accuracy of the probe itself: the measurement floor
    p.eval()
    erng = np.random.default_rng(999)
    ctx = sample_contexts(erng, 1024, "any")
    c = sample_content(erng, 1024)
    giant = erng.random(1024) < 0.3
    d = p.read(torch.from_numpy(render(ctx, c, giant, erng)))
    truth = dict(zip(CTX_NAMES, ctx.vector().T))
    truth["size"] = ctx.size * np.where(giant, GIANT, 1.0)
    truth.update(zip(CON_NAMES, c.vector().T))
    for n in CTX_NAMES + CON_NAMES:
        print(f"{n:8s} MAE {np.abs(d[n] - truth[n]).mean():.4f}  "
              f"R2 {1 - ((d[n] - truth[n]) ** 2).mean() / truth[n].var():.3f}")
    print("shape acc", (d["shape"] == ctx.shape).mean(), "hold acc", (d["hold"] == ctx.hold).mean())
