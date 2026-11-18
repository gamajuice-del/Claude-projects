"""Experiment H0: does the game-host calibrator measure the true rotation per mouse count?

Synthetic perspective views of a textured panorama at the test game's field of view (90 deg vertical, 640x360),
turned by a known 0.2 deg per count, so the true answer is exact: fx * tan(0.2 deg) pixels at the image centre.
Compared: the calibrator in plain pixels (no field of view given) and in angle space (field of view given),
with the player looking level and looking 20 deg up.  The pitch random-walks a few degrees, as during play.
"""
import json
import math
import os
import sys

import numpy as np

from common import RESULTS, ROOT

sys.path.insert(0, ROOT)
import host as Hm  # noqa: E402

W, H, FOV, DEG = 640, 360, 90.0, 0.2
rng0 = np.random.default_rng(1)
PAN = np.kron(np.kron((rng0.random((64, 256)) * 255).astype(np.float32), np.ones((1, 8))), np.ones((4, 1)))


def view(yaw_deg, pitch_deg):
    """perspective view of the panorama (blocky pixel-art texture, nearest-neighbour, like the test game)"""
    tfy = math.tan(math.radians(FOV) / 2); tfx = tfy * W / H
    xs = ((np.arange(W) + 0.5) / W * 2 - 1) * tfx; ys = (1 - (np.arange(H) + 0.5) / H * 2) * tfy
    d = np.stack(np.broadcast_arrays(xs[None, :], ys[:, None], np.ones((H, W))), -1)
    p = math.radians(pitch_deg); cp, sp = math.cos(p), math.sin(p)
    d = d @ np.array([[1, 0, 0], [0, cp, sp], [0, -sp, cp]]).T          # look up/down, then turn about world-up
    az = np.arctan2(d[..., 0], d[..., 2]) + math.radians(yaw_deg)
    el = np.arctan2(d[..., 1], np.hypot(d[..., 0], d[..., 2]))
    u = ((az / (2 * math.pi)) % 1.0) * PAN.shape[1]
    v = np.clip((0.5 - el / math.pi * 1.6) * PAN.shape[0], 0, PAN.shape[0] - 1)
    g = PAN[v.astype(int), u.astype(int) % PAN.shape[1]]
    return np.repeat(g[..., None], 3, 2).astype(np.uint8)


def main():
    tfy = math.tan(math.radians(FOV) / 2); tfx = tfy * W / H
    true = (W / 2) / tfx * math.tan(math.radians(DEG))
    rows = []
    for pitch0 in (0.0, 20.0):
        for fov in (None, FOV):
            cal = Hm.Calibrator(fov_v=fov)
            rng = np.random.default_rng(0); cx = cy = 0
            for k in range(300):                       # ordinary mouse-look: mostly turning, a little nodding
                dx = int(rng.choice([-12, -6, 6, 12])); dy = int(rng.integers(-3, 4))
                cx += dx; cy += dy
                cal.update(view(-cx * DEG, -(pitch0 + cy * DEG)), cx, cy, t=k / 30)
            st = cal.state()
            rows.append(dict(pitch_deg=pitch0, model="angles" if fov else "pixels", kx=st["kx"], ky=st["ky"], r2=st["r2"],
                             true=round(true, 4), err_x_pct=round(100 * (abs(st["kx"]) / true - 1), 1),
                             err_y_pct=round(100 * (abs(st["ky"]) / true - 1), 1)))
            print(rows[-1], flush=True)
    json.dump(rows, open(os.path.join(RESULTS, "host_calib.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
