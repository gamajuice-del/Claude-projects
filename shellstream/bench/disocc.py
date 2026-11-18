"""Experiment D: quality *inside disocclusions only*.

Whole-frame PSNR is dominated by errors every method shares (view-dependent reflections, resampling).  The
topology map and the background band only change what is shown where the displaced camera sees surfaces
that were hidden from the shell's viewpoint.  This script finds exactly those pixels with a shadow-map test:
  target pixel -> world point X (ground-truth geometry at the displaced pose)
  X projected into a wide source view at P0 -> if the source sees something nearer than X, X was hidden.
and reports PSNR over those pixels for each reconstruction mode (images from the quality run's gallery).
"""
import json
import math
import sys

import numpy as np

from common import E, RESULTS

W, H, FOV = 640, 400, 90.0
SCENES = {"plaza": ((4.0, 1.7, 26.0), 0.15, 0.0), "pillars": ((1.5, 1.7, 11.5), -0.55, -0.05), "street": ((7.0, 1.7, 45.0), 0.0, 0.02)}
OFFSETS = {"strafe 0.5m": (0.5, 0, 0, 0), "strafe 0.5m + yaw 10deg": (0.5, 0, 0, 10)}
MODES = ["stale", "rot", "naive", "noback", "shell1", "shell"]


def rays(r, u, f, tx, ty, w, h):
    xs = (np.arange(w) + 0.5) / w * 2 - 1
    ys = 1 - (np.arange(h) + 0.5) / h * 2
    d = f[None, None, :] + r[None, None, :] * (xs[None, :, None] * tx) + u[None, None, :] * (ys[:, None, None] * ty)
    return d / np.linalg.norm(d, axis=2, keepdims=True)


def main():
    be = E.CpuBackend()
    z = np.load(f"{RESULTS}/quality_gallery.npz")
    out = []
    for sname, (pos, yaw, pitch) in SCENES.items():
        pos = np.array(pos)
        r0, u0, f0 = E.basis_from_yaw_pitch(yaw, pitch)
        # wide source depth map at P0 (covers any displaced view of interest)
        tS = math.tan(math.radians(65)); Ws, Hs = 1200, 900; tSy = tS * Hs / Ws
        vs = E.make_view(pos, r0, u0, f0, -tS, tS, -tSy, tSy, (0, 0, Ws, Hs))
        _, _, gs = be.render(E.pack_params([vs]), Ws, Hs, E.MODE_GEO | E.MODE_GEOONLY)
        tsrc = gs[:, :, 0]
        for oname, (dr, du, dfw, dyaw) in OFFSETS.items():
            fh = np.array([f0[0], 0, f0[2]]); fh /= np.linalg.norm(fh)
            P = pos + r0 * dr + np.array([0, du, 0]) + fh * dfw
            Y = yaw + math.radians(dyaw)
            r, u, f = E.basis_from_yaw_pitch(Y, pitch)
            tx = math.tan(math.radians(FOV) / 2); ty = tx * H / W
            v = E.make_view(P, r, u, f, -tx, tx, -ty, ty, (0, 0, W, H))
            _, _, g = be.render(E.pack_params([v]), W, H, E.MODE_GEO | E.MODE_GEOONLY)
            t = g[:, :, 0]
            X = P[None, None, :] + rays(r, u, f, tx, ty, W, H) * t[:, :, None]
            rel = X - pos[None, None, :]
            zc = rel @ f0
            xs = (rel @ r0) / np.maximum(zc, 1e-6); ys = (rel @ u0) / np.maximum(zc, 1e-6)
            px = ((xs / tS + 1) / 2 * Ws).astype(int); py = ((1 - ys / tSy) / 2 * Hs).astype(int)
            inside = (zc > 0.05) & (px >= 0) & (px < Ws) & (py >= 0) & (py < Hs)
            dist = np.linalg.norm(rel, axis=2)
            ts = np.where(inside, tsrc[np.clip(py, 0, Hs - 1), np.clip(px, 0, Ws - 1)], np.inf)
            hidden = inside & (t > 0) & (ts > 0) & (ts < dist * 0.97 - 0.05)
            truth = z[f"{sname}|{oname}|truth"].astype(np.float64)
            row = dict(scene=sname, offset=oname, disoccluded_fraction=round(float(hidden.mean()), 4))
            for m in MODES:
                img = z[f"{sname}|{oname}|{m}"].astype(np.float64)
                mse = np.mean((img[hidden] - truth[hidden]) ** 2) if hidden.any() else np.nan
                row[m] = round(10 * math.log10(255 ** 2 / mse), 2) if mse == mse and mse > 0 else None
            out.append(row)
            print(row, flush=True)
    json.dump(out, open(f"{RESULTS}/disocclusion.json", "w"), indent=1)
    print("\nmean PSNR inside disocclusions:", {m: round(float(np.nanmean([r[m] for r in out if r[m] is not None])), 2) for m in MODES})


if __name__ == "__main__":
    sys.exit(main())
