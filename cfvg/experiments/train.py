"""Train one CFVG variant. Resumable: rerunning the same command continues
from the last checkpoint (the cloud worker can restart under us)."""
from __future__ import annotations

import argparse
import copy
import json
import os
import time

import numpy as np
import torch

from engine import ContextPool, make_batch
from model import CFVG, flow_loss


class Stream(torch.utils.data.IterableDataset):
    def __init__(self, a, seed):
        self.a, self.seed = a, seed

    def __iter__(self):
        a = self.a
        pool = ContextPool(a.pool or None, seed=a.pool_seed)       # same worlds for every worker
        pool.rng = np.random.default_rng(self.seed)                 # but fresh event draws
        while True:
            refs, mask, tgt, text, _, _, giant, wid = make_batch(pool, a.bs, a.kmax, a.mode, leaky=a.leaky)
            yield tuple(map(torch.from_numpy, (refs, mask, tgt, text, giant, wid)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--mode", default="cfvg", choices=["cfvg", "paired"])
    ap.add_argument("--bottleneck", type=int, default=16)
    ap.add_argument("--pool", type=int, default=0, help="number of distinct worlds; 0 = unlimited")
    ap.add_argument("--pool_seed", type=int, default=7)
    ap.add_argument("--leaky", action="store_true", help="captions also name gravity and shape")
    ap.add_argument("--steps", type=int, default=6000)
    ap.add_argument("--bs", type=int, default=32)
    ap.add_argument("--kmax", type=int, default=3)
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--depth", type=int, default=5)
    ap.add_argument("--enc_depth", type=int, default=2)
    ap.add_argument("--contrastive", type=float, default=0.1, help="weight of group-contrastive loss")
    a = ap.parse_args()

    torch.set_num_threads(a.threads)
    out = f"runs/{a.name}"
    os.makedirs(out, exist_ok=True)
    json.dump(vars(a), open(f"{out}/args.json", "w"), indent=1)

    torch.manual_seed(0)
    model = CFVG(depth=a.depth, enc_depth=a.enc_depth, bottleneck=a.bottleneck,
                 text_len=7 if a.leaky else 5)
    ema = copy.deepcopy(model).requires_grad_(False)
    opt = torch.optim.AdamW(model.parameters(), a.lr, weight_decay=0.01, betas=(0.9, 0.99))
    warm = 300
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1, (s + 1) / warm) * (0.1 + 0.9 * 0.5 * (1 + np.cos(np.pi * min(1, s / a.steps)))))
    step = 0
    ck = f"{out}/ckpt.pt"
    if os.path.exists(ck):
        s = torch.load(ck, weights_only=False)
        model.load_state_dict(s["model"]); ema.load_state_dict(s["ema"])
        opt.load_state_dict(s["opt"]); sched.load_state_dict(s["sched"]); step = s["step"]
        print("resumed at", step, flush=True)
    if step >= a.steps:
        return

    loader = torch.utils.data.DataLoader(Stream(a, seed=1000 + step), batch_size=None,
                                         num_workers=1, prefetch_factor=4)
    log = open(f"{out}/log.jsonl", "a")
    t0, run = time.time(), []
    for refs, mask, tgt, text, giant, wid in loader:
        with torch.autocast("cpu", dtype=torch.bfloat16):
            loss, stats = flow_loss(model, refs, mask, tgt, text, contrastive=a.contrastive,
                                    world_id=wid, giant=giant)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step(); sched.step(); step += 1
        decay = min(0.999, (1 + step) / (10 + step))
        with torch.no_grad():
            for pe, pm in zip(ema.parameters(), model.parameters()):
                pe.lerp_(pm, 1 - decay)
        run.append(stats)
        if step % 50 == 0:
            rec = {"step": step, **{k: float(np.mean([r[k] for r in run])) for k in run[0]},
                   "sec": time.time() - t0}
            log.write(json.dumps(rec) + "\n"); log.flush(); run = []
            if step % 250 == 0:
                print(rec, flush=True)
        if step % 500 == 0 or step >= a.steps:
            torch.save({"model": model.state_dict(), "ema": ema.state_dict(), "opt": opt.state_dict(),
                        "sched": sched.state_dict(), "step": step}, ck + ".tmp")
            os.replace(ck + ".tmp", ck)
        if step >= a.steps:
            break
    print("done", step, flush=True)


if __name__ == "__main__":
    main()
