#!/usr/bin/env python3
"""Throughput benchmark: simulation steps/s and agent-steps/s.

  python scripts/benchmark.py                 # CPU, a few sizes
  python scripts/benchmark.py --device cuda:0 --sizes 256:16384 512:65536
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.backend import device_context  # noqa: E402
from noogenesis.config import Config  # noqa: E402
from noogenesis.world import World  # noqa: E402


def bench(side, agents, device, steps, warm=20):
    cfg = Config(H=side, W=side, max_agents=agents, init_agents=int(agents * 0.6),
                 min_agents=int(agents * 0.5), device=device)
    with device_context(device):
        w = World(cfg)
        for _ in range(warm):
            w.step()
        t0 = time.time()
        pop = 0
        for _ in range(steps):
            w.step()
            pop += w.agents.n
        if device != "cpu":
            import cupy
            cupy.cuda.Stream.null.synchronize()
        dt = time.time() - t0
    return dict(side=side, capacity=agents, mean_pop=pop / steps, steps_per_s=steps / dt,
                agent_steps_per_s=pop / dt, neurons_eff=w.Ne, device=device)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--sizes", nargs="+", default=["64:1024", "96:2048", "128:4096"])
    ap.add_argument("--steps", type=int, default=150)
    a = ap.parse_args()
    rows = []
    for s in a.sizes:
        side, ag = map(int, s.split(":"))
        r = bench(side, ag, a.device, a.steps)
        rows.append(r)
        print(json.dumps(r))


if __name__ == "__main__":
    main()
