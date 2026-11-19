"""FLOPs-to-target comparison across runs.  Usage:
    python scripts/speedup.py BASELINE_RUN TARGET_FLOPS RUN [RUN ...]
Target loss = the baseline's held-out loss at TARGET_FLOPS (log-linear interpolation between evals).
Speed-up = TARGET_FLOPS / (FLOPs the run needs to reach that loss)."""
import json
import math
import os
import sys

import numpy as np

RUNS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "results", "runs")


def curve(name):
    return json.load(open(os.path.join(RUNS, name, "log.json")))["curve"]


def loss_at(c, f):
    xs = np.log([max(p["flops"], 1e9) for p in c]); ys = [p["test_loss"] for p in c]
    return float(np.interp(math.log(f), xs, ys)) if f <= c[-1]["flops"] * 1.02 else None


def flops_to(c, target):
    for a, b in zip(c, c[1:]):
        if b["test_loss"] <= target:
            if a["test_loss"] <= target:
                return max(a["flops"], 1e9)
            t = (a["test_loss"] - target) / (a["test_loss"] - b["test_loss"])
            la, lb = math.log(max(a["flops"], 1e9)), math.log(b["flops"])
            return math.exp(la + t * (lb - la))
    return None


def trend(base, runs, refs=(2.5e13, 5e13, 1e14, 1.5e14)):
    """Speed-up of each run at several reference budgets: does the advantage grow or shrink with compute?"""
    bc = curve(base)
    print("speed-up vs", base, "at reference budgets", " ".join(f"{r:.1e}" for r in refs))
    for r in runs:
        try:
            c = curve(r)
        except FileNotFoundError:
            continue
        cells = []
        for f in refs:
            t = loss_at(bc, f)
            ft = flops_to(c, t) if t is not None else None
            cells.append(f"{f / ft:5.2f}x" if ft else "   - ")
        print(f"  {r:24s} " + "  ".join(cells))


def main():
    if sys.argv[1] == "--trend":
        return trend(sys.argv[2], sys.argv[3:])
    base, f = sys.argv[1], float(sys.argv[2])
    target = loss_at(curve(base), f)
    print(f"target: {base} at {f:.2e} FLOPs -> loss {target:.4f}")
    for r in sys.argv[3:]:
        try:
            c = curve(r)
        except FileNotFoundError:
            print(f"{r:24s} (missing)"); continue
        ft = flops_to(c, target)
        fin = c[-1]
        s = f"{f / ft:6.2f}x  (reaches at {ft:.2e})" if ft else "   not reached"
        print(f"{r:24s} final {fin['test_loss']:.4f} @ {fin['flops']:.2e}   speed-up {s}")


if __name__ == "__main__":
    main()
