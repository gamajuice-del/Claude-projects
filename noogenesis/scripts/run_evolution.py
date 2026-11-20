#!/usr/bin/env python3
"""Run one Noogenesis universe (or an archipelago of them).

Examples
  python scripts/run_evolution.py --steps 50000 --out results/run_a
  python scripts/run_evolution.py --steps 50000 --unfold off --out results/ctrl
  python scripts/run_evolution.py --steps 50000 --iff --out results/iff
  python scripts/run_evolution.py --islands 4 --rounds 50 --budget 2000 --out results/arch
  # 2x T4: one process per GPU sharing a migration directory
  python scripts/run_evolution.py --device cuda:0 --H 256 --W 256 --max-agents 32768 \
      --migrate-dir results/mig --island-id 0 --out results/gpu0 &
  python scripts/run_evolution.py --device cuda:1 --H 256 --W 256 --max-agents 32768 \
      --migrate-dir results/mig --island-id 1 --out results/gpu1 &
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.accelerate import InvasionScreen  # noqa: E402
from noogenesis.archipelago import Archipelago, default_islands  # noqa: E402
from noogenesis.config import Config  # noqa: E402
from noogenesis.sim import Simulation  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=20000)
    ap.add_argument("--H", type=int, default=96)
    ap.add_argument("--W", type=int, default=96)
    ap.add_argument("--max-agents", type=int, default=2048)
    ap.add_argument("--init-agents", type=int, default=700)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--unfold", default="activity", choices=["activity", "schedule", "off"])
    ap.add_argument("--unfold-every", type=int, default=20000)
    ap.add_argument("--iff", action="store_true", help="invasion-fitness look-ahead screening")
    ap.add_argument("--iff-every", type=int, default=2000)
    ap.add_argument("--iff-probes", type=int, default=48)
    ap.add_argument("--iff-horizon", type=int, default=200)
    ap.add_argument("--islands", type=int, default=1)
    ap.add_argument("--rounds", type=int, default=20)
    ap.add_argument("--budget", type=int, default=2000)
    ap.add_argument("--migrate-dir", default=None)
    ap.add_argument("--island-id", type=int, default=0)
    ap.add_argument("--log-every", type=int, default=250)
    ap.add_argument("--out", default=None)
    ap.add_argument("--save-state", action="store_true")
    a = ap.parse_args()

    cfg = Config(H=a.H, W=a.W, max_agents=a.max_agents, init_agents=a.init_agents,
                 seed=a.seed, device=a.device)
    iff = (InvasionScreen(n_probes=a.iff_probes, horizon=a.iff_horizon, every=a.iff_every,
                          seed=a.seed) if a.iff else None)
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, "args.json"), "w") as f:
            json.dump(vars(a), f, indent=1)
    if a.islands > 1:
        arch = Archipelago(default_islands(cfg, a.islands), out_dir=a.out,
                           unfold_mode=a.unfold, unfold_every=a.unfold_every,
                           log_every=a.log_every)
        arch.run(a.rounds, a.budget)
        if a.out:
            with open(os.path.join(a.out, "allocation.json"), "w") as f:
                json.dump(arch.alloc_history, f)
        return
    sim = Simulation(cfg, out_dir=a.out, unfold_mode=a.unfold, unfold_every=a.unfold_every,
                     iff=iff, log_every=a.log_every, migrate_dir=a.migrate_dir,
                     island_id=a.island_id)
    sim.run(a.steps)
    if a.out:
        sim.welfare.dump(os.path.join(a.out, "welfare.json"))
        if iff:
            with open(os.path.join(a.out, "iff.json"), "w") as f:
                json.dump(iff.history, f, indent=1)
        with open(os.path.join(a.out, "events.json"), "w") as f:
            json.dump(sim.world.events, f)
        if a.save_state:
            sim.save_state(os.path.join(a.out, "world_final.pkl"))


if __name__ == "__main__":
    main()
