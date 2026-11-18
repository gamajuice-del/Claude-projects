"""Experiment Q: how good is the locally re-projected image compared with a perfect local render?

Reference = a 16-sample anti-aliased render at exactly the displaced pose (ordered 4x4 supersampling).
"local1"/"local2" = what a local PC running the same renderer at 1 / 2 samples per pixel would show
(the ceiling for any streaming scheme with those settings).  The server renders shells at 2 spp.

A shell is rendered once at pose P0 and frozen.  The browser client then renders the scene from
displaced poses P0 + delta (what happens while a shell is in flight / being used) using different
reconstruction strategies.  Each image is compared with a ground-truth render at exactly P0 + delta.

modes:
  stale   - classic cloud gaming: show the last frame as-is (the view the server rendered)
  rot     - rotation-only re-projection (VR 'timewarp' style), all content at infinity
  naive   - depth mesh warp without topology (rubber sheets across occlusion edges)
  noback  - ours without the background (2nd-surface) layer
  shell1  - ours, one shell: topology-aware warp of focus + background band + omni fallback (pass 1)
  shell   - ours with both T4s: every shell the client holds (predicted centre + left/right hedges), composited
"""
import json
import math
import os
import sys
import time

import numpy as np
from playwright.sync_api import sync_playwright

from common import E, S, RESULTS, decode_capture, ground_truth, launch, psnr, ssim, wait_for

W, H, FOV = int(sys.argv[1]) if len(sys.argv) > 1 else 640, int(sys.argv[2]) if len(sys.argv) > 2 else 400, 90.0
MODES = ["stale", "rot", "naive", "noback", "shell1", "shell"]   # shell1: one shell (pass 1); shell: all shells (dual-T4)
SCENES = {
    "plaza": ((4.0, 1.7, 26.0), 0.15, 0.0),
    "pillars": ((1.5, 1.7, 11.5), -0.55, -0.05),
    "street": ((7.0, 1.7, 45.0), 0.0, 0.02),
}
OFFSETS = [  # name, right, up, forward (m), dyaw, dpitch (deg)
    ("none", 0, 0, 0, 0, 0),
    ("yaw 15deg", 0, 0, 0, 15, 0), ("yaw 30deg", 0, 0, 0, 30, 0), ("yaw 60deg", 0, 0, 0, 60, 0),
    ("pitch 10deg", 0, 0, 0, 0, 10),
    ("strafe 0.1m", 0.1, 0, 0, 0, 0), ("strafe 0.25m", 0.25, 0, 0, 0, 0), ("strafe 0.5m", 0.5, 0, 0, 0, 0),
    ("strafe 1.0m", 1.0, 0, 0, 0, 0), ("forward 0.5m", 0, 0, 0.5, 0, 0),
    ("jump 0.5m", 0, 0.5, 0, 0, 0), ("strafe 0.5m + yaw 10deg", 0.5, 0, 0, 10, 0),
]


PRESET = os.environ.get("SS_QUALITY", "high")
TAG = os.environ.get("SS_TAG", "")
if os.environ.get("SS_SCENES"):
    SCENES = {k: v for k, v in SCENES.items() if k in os.environ["SS_SCENES"].split(",")}
if os.environ.get("SS_OFFSETS"):
    OFFSETS = [o for o in OFFSETS if o[0] in os.environ["SS_OFFSETS"].split(",")]


def main():
    be = E.CpuBackend()
    # two backends = the two T4s: GPU0 renders the predicted-centre shell, GPU1 a hedge shell (+ omni)
    b = E.ShellBuilder([be, E.CpuBackend()], focus_budget=0.6e6, omni_R=256, quality=PRESET, spp=2, strategy="dual")
    srv = S.ShellServer(b, port=8831, max_rate=5, animate=False, max_refine=0).start()
    rows = []
    gallery = {}
    with sync_playwright() as p:
        br = launch(p)
        pg = br.new_page(viewport={"width": W, "height": H})
        pg.on("pageerror", lambda e: print("PAGEERROR", e, flush=True))
        pg.on("crash", lambda: print("PAGE CRASH", flush=True))
        pg.on("console", lambda m: print("console:", m.text, flush=True) if "WebGL" not in m.text else None)
        pg.goto(f"http://127.0.0.1:8831/?test=1&w={W}&h={H}&orbs=0&fov={FOV}")
        wait_for(pg, "SS.stats.shells >= 1", 120)
        pg.evaluate("SS.pause(true)")
        for sname, (pos, yaw, pitch) in SCENES.items():
            pg.evaluate("SS.pause(true); SS.freezeShell(false)")
            seq0 = pg.evaluate(f"SS.setPose({list(pos)}, {yaw}, {pitch}), SS.sendNow()")
            wait_for(pg, f"SS.shell && SS.shell.in_seq >= {seq0}", 300)
            # a second update while standing gives the other hedge side (left + right), as during play
            seq1 = pg.evaluate("SS.game.pos[0] += 0.002, SS.sendNow()")
            wait_for(pg, f"SS.shell && SS.shell.in_seq >= {seq1}", 300)
            pg.evaluate(f"SS.game.pos = {list(pos)}")
            pg.evaluate("SS.freezeShell(true)")
            sh = pg.evaluate("SS.shell.stats")
            print(sname, "shell", sh, flush=True)
            r0, u0, f0 = E.basis_from_yaw_pitch(yaw, pitch)
            for (oname, dr, du, dfw, dyaw, dpit) in OFFSETS:
                # translation in the camera's horizontal frame
                fh = np.array([f0[0], 0, f0[2]]); fh /= np.linalg.norm(fh)
                P = np.array(pos) + r0 * dr + np.array([0, du, 0]) + fh * dfw
                Y, Pi = yaw + math.radians(dyaw), pitch + math.radians(dpit)
                gt = ground_truth(be, P, Y, Pi, W, H, FOV, ss=4, quality=PRESET)          # 16-sample reference
                for m, spp in (("local1", 1), ("local2", 2)):
                    img = ground_truth(be, P, Y, Pi, W, H, FOV, spp=spp, quality=PRESET)
                    rows.append(dict(scene=sname, offset=oname, mode=m, psnr=round(psnr(img, gt), 2), ssim=round(ssim(img, gt), 4)))
                for m in MODES:
                    cap = pg.evaluate(f"SS.capture({P.tolist()}, {Y}, {Pi}, '{m}')")
                    img = decode_capture(cap)
                    row = dict(scene=sname, offset=oname, mode=m, psnr=round(psnr(img, gt), 2), ssim=round(ssim(img, gt), 4))
                    rows.append(row)
                    if oname in ("strafe 0.5m", "yaw 30deg", "strafe 0.5m + yaw 10deg", "none"):
                        gallery[(sname, oname, m)] = img
                gallery[(sname, oname, "truth")] = gt
                print(sname, oname, {r["mode"]: r["psnr"] for r in rows[-len(MODES) - 2:]}, flush=True)
        br.close()
    srv.stop()
    json.dump(rows, open(f"{RESULTS}/quality{TAG}.json", "w"), indent=1)
    np.savez_compressed(f"{RESULTS}/quality_gallery{TAG}.npz", **{"|".join(k): v for k, v in gallery.items()})
    # summary table
    print("\nmean PSNR / SSIM over scenes")
    for (oname, *_r) in OFFSETS:
        line = f"{oname:26s}"
        for m in ["local1", "local2"] + MODES:
            sel = [r for r in rows if r["offset"] == oname and r["mode"] == m]
            line += f" {m}:{np.mean([r['psnr'] for r in sel]):5.2f}/{np.mean([r['ssim'] for r in sel]):.3f}"
        print(line)


if __name__ == "__main__":
    main()
