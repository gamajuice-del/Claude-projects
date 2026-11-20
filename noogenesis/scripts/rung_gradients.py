#!/usr/bin/env python3
"""What does the world pay for each rung? Invasion ratios of oracle pairs under
world variants (any Config overrides, plus physics night radius).

  python scripts/rung_gradients.py --pairs reflex:memory reflex:persist --set night=0
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from noogenesis.config import Config  # noqa: E402
from noogenesis.oracles import LADDER, invasion  # noqa: E402
from noogenesis.unfolding import Physics  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", nargs="+", default=["reflex:memory", "reflex:persist"])
    ap.add_argument("--set", nargs="*", default=[])
    ap.add_argument("--night-radius", type=int, default=1)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1])
    ap.add_argument("--extra", default="{}", help="JSON kwargs for the invader oracle")
    a = ap.parse_args()
    cfg = Config()
    over = {}
    for kv in a.set:
        k, v = kv.split("=", 1)
        cur = getattr(cfg, k)
        over[k] = (v.lower() in ("1", "true")) if isinstance(cur, bool) else type(cur)(v)
    cfg = cfg.replace(**over)
    phys = Physics(night_radius=a.night_radius)
    for pair in a.pairs:
        r_name, i_name = pair.split(":")
        res = [invasion(cfg, LADDER[r_name](seed=s), LADDER[i_name](seed=s + 7, **json.loads(a.extra)),
                        physics=phys, seed=s, settle=400, measure=800) for s in a.seeds]
        rs = [r["ratio"] for r in res]
        print(json.dumps(dict(pair=pair, set=a.set, night_radius=a.night_radius,
                              ratios=[round(x, 3) for x in rs], mean=round(sum(rs) / len(rs), 3),
                              resident_intake=round(sum(r["resident"] for r in res) / len(res), 4),
                              invader_intake=round(sum(r["invader"] for r in res) / len(res), 4),
                              diff=round(sum(r["invader"] - r["resident"] for r in res) / len(res), 4))),
              flush=True)


if __name__ == "__main__":
    main()
