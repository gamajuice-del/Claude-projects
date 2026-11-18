"""Render the report figures from results/*.json (+ the image gallery from quality_gallery.npz)."""
import json
import os
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from common import RESULTS

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notebook_plots as NP  # noqa: E402


def load(n):
    p = os.path.join(RESULTS, n)
    return json.load(open(p)) if os.path.exists(p) else None


def main():
    R = {}
    for key, fn in (("quality", "quality.json"), ("latency", "latency.json"), ("bandwidth", "bandwidth.json"),
                    ("cost_model", "cost_model.json"), ("disocclusion", "disocclusion.json")):
        v = load(fn)
        if v is not None:
            R[key] = v
    NP.plot_all(R, save=RESULTS)
    g = os.path.join(RESULTS, "quality_gallery.npz")
    if os.path.exists(g) and "quality" in R:
        z = np.load(g)
        rows = [("pillars", "strafe 0.5m"), ("plaza", "strafe 0.5m + yaw 10deg"), ("street", "yaw 30deg")]
        cols = ["truth", "stale", "rot", "naive", "shell"]
        names = {"truth": "ground truth", **NP.MODE_NAMES}
        fig, ax = plt.subplots(len(rows), len(cols), figsize=(3.3 * len(cols), 2.25 * len(rows)))
        for i, (sc, off) in enumerate(rows):
            for j, m in enumerate(cols):
                a = ax[i, j]
                k = f"{sc}|{off}|{m}"
                if k in z:
                    a.imshow(z[k])
                a.set_xticks([]); a.set_yticks([])
                for s in a.spines.values():
                    s.set_visible(False)
                lab = names[m]
                if m != "truth":
                    q = [r for r in R["quality"] if r["scene"] == sc and r["offset"] == off and r["mode"] == m]
                    if q:
                        lab += f"\n{q[0]['psnr']:.1f} dB"
                if i == 0 or m != "truth":
                    a.set_title(lab, fontsize=8.5, color=NP.INK)
                if j == 0:
                    a.set_ylabel(f"{sc}\n{off}", fontsize=8.5, color=NP.INK2)
        fig.tight_layout()
        fig.savefig(os.path.join(RESULTS, "fig_gallery.png"), dpi=110, bbox_inches="tight", facecolor="#fcfcfb")
    print("figures written to", RESULTS)


if __name__ == "__main__":
    main()
