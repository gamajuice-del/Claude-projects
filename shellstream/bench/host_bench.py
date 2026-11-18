"""Experiment H: ANY game (here: the unmodified open-source game Minetest), through the game host.

H1  prediction accuracy (no browser), step response: capture the game at rest, inject a known mouse movement,
    capture again once the game has shown it.  Predict the second frame from the first by input-predicted
    reprojection (online calibration, same math as the client shader).  Baseline: the first frame unchanged,
    which is what any frame-streaming client shows until the new frame arrives.
H2  look latency in the browser vs RTT, prediction on/off: inject a mouse move, detect when the displayed
    image has shifted (1-D cross-correlation of a framebuffer row read back after every frame).
"""
import json
import math
import os
import subprocess
import sys
import time

import numpy as np

from common import RESULTS, ROOT, launch, psnr, wait_for

sys.path.insert(0, ROOT)
import host as Hm  # noqa: E402

W, H, FOV, OS = 640, 360, 90.0, 1.12
WORK = os.path.join(RESULTS, "..", "build", "minetest_bench")


def predict(frame, px, py, cal, fov_v=FOV, overscan=OS, rotate=True, hud=None):
    """numpy twin of client/host.js: display crop of `frame` after a pending rotation of (px, py) counts"""
    h, w = frame.shape[:2]
    tanFy = math.tan(math.radians(fov_v) / 2); tanFx = tanFy * w / h
    tDy, tDx = tanFy / overscan, tanFx / overscan
    sx, sy = cal["kx"] * px, cal["ky"] * py
    fx, fy = (w / 2) / tanFx, (h / 2) / tanFy
    yaw, pitch = (math.atan(-sx / fx), math.atan(-sy / fy)) if rotate else (0.0, 0.0)
    cy, syw, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    R = np.array([[cy, syw * sp, syw * cp], [0, cp, -sp], [-syw, cy * sp, cy * cp]])
    oh, ow = int(h / overscan) // 2 * 2, int(w / overscan) // 2 * 2
    ys = 1 - (np.arange(oh) + 0.5) / oh * 2; xs = (np.arange(ow) + 0.5) / ow * 2 - 1
    d = np.stack(np.broadcast_arrays(xs[None, :] * tDx, ys[:, None] * tDy, np.ones((oh, ow))), -1) @ R.T
    t = d[..., :2] / d[..., 2:3]
    u = np.clip((t[..., 0] / tanFx * 0.5 + 0.5) * w - 0.5, 0, w - 1.001)
    v = np.clip((0.5 - t[..., 1] / tanFy * 0.5) * h - 0.5, 0, h - 1.001)
    x0, y0 = u.astype(int), v.astype(int); fx_, fy_ = (u - x0)[..., None], (v - y0)[..., None]
    f = frame.astype(np.float32)
    out = (f[y0, x0] * (1 - fx_) * (1 - fy_) + f[y0, x0 + 1] * fx_ * (1 - fy_) + f[y0 + 1, x0] * (1 - fx_) * fy_ + f[y0 + 1, x0 + 1] * fx_ * fy_)
    if hud is not None and rotate:
        # screen-fixed overlay: keep the unrotated pixels where the learned mask says "overlay"
        still = predict(frame, 0, 0, cal, fov_v, overscan, rotate=False).astype(np.float32)
        u0 = ((xs[None, :] * tDx / tanFx * 0.5 + 0.5) * w).astype(int).clip(0, w - 1)
        v0 = ((0.5 - ys[:, None] * tDy / tanFy * 0.5) * h).astype(int).clip(0, h - 1)
        b = hud.shape[0] / h
        m = hud[(v0 * b).astype(int).clip(0, hud.shape[0] - 1), (u0 * b).astype(int).clip(0, hud.shape[1] - 1)].astype(np.float32) / 255
        m = np.clip((m - 0.3) / 0.4, 0, 1)[..., None]
        out = out * (1 - m) + still * m
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def h1():
    """step response on the real game: rest, capture, inject a known mouse movement, wait until the game has
    shown it, capture again.  Prediction = the first frame re-projected by the calibrated rotation."""
    gh = Hm.GameHost(Hm.minetest_command(WORK + "_h1", W, H, fov=FOV), size=(W, H), fov_v=FOV, overscan=OS,
                     codec="jpeg", window_name="Minetest")
    time.sleep(3)
    rng = np.random.default_rng(3)

    def settle(sec=0.7):
        t = time.time()
        while time.time() - t < sec:
            rgb = np.ascontiguousarray(gh.grab.grab())
            gh.cal.update(rgb, gh.inj.cx, gh.inj.cy)
            time.sleep(1 / 30)
        return rgb
    # warm-up: ordinary mouse-look so the online calibration converges (as during play)
    t0 = time.time()
    while time.time() - t0 < 20:
        gh.inject([["m", int(rng.choice([-12, -6, 6, 12])), int(rng.integers(-3, 4))]])
        gh.cal.update(np.ascontiguousarray(gh.grab.grab()), gh.inj.cx, gh.inj.cy)
        time.sleep(1 / 30)
    cal = gh.cal.state()
    hud = gh.cal.hud_mask()
    print("calibration", cal, "hud mask", None if hud is None else f"{hud.shape}, {100 * (hud > 127).mean():.1f}% overlay", flush=True)
    if hud is not None:
        from PIL import Image
        Image.fromarray(hud).resize((W, H), Image.NEAREST).save(os.path.join(RESULTS, "hud_mask.png"))
    rows = []
    for (dx, dy) in [(8, 0), (20, 0), (40, 0), (80, 0), (-20, 0), (0, 15), (0, -15), (25, 10)]:
        ps, ph, pn, rp, rs, dk = [], [], [], [], [], []
        for trial in range(4):
            gh.inject([["m", int(rng.integers(-60, 61)), 0]])     # look somewhere else between trials
            a = settle()
            gh.inject([["m", dx, dy]])
            b = settle()
            truth = predict(b, 0, 0, cal, rotate=False)
            pred = predict(a, dx, dy, cal, hud=gh.cal.hud_mask())
            stale = predict(a, 0, 0, cal, rotate=False)
            ps.append(psnr(predict(a, dx, dy, cal), truth))
            ph.append(psnr(pred, truth))
            pn.append(psnr(stale, truth))
            # perceptual criterion: does the predicted world line up with what the game shows next?
            # residual misalignment (px) by phase correlation over the world region (above the crosshair)
            def reg(x):
                g = x[30:140, 60:540].astype(np.float32).mean(2)
                return g - g.mean()
            rp.append(float(np.hypot(*Hm.phase_shift(reg(truth), reg(pred))[:2])))
            rs.append(float(np.hypot(*Hm.phase_shift(reg(truth), reg(stale))[:2])))
            # direct measurement of this step's rotation (centre px per count): one large-step correlation in
            # the calibrator's angle space, where a turn is a uniform shift
            if dy == 0 and abs(dx) >= 20:
                ga, gb = gh.cal._small(a), gh.cal._small(b)
                dk.append(Hm.phase_shift(ga[0], gb[0])[0] * gh.cal._ux / dx)
            gh.inject([["m", -dx, -dy]]); settle(0.3)
        rows.append(dict(step_counts=[dx, dy], step_px=round(float(np.hypot(cal["kx"] * dx, cal["ky"] * dy)), 1),
                         psnr_predicted=round(float(np.mean(ps)), 2), psnr_predicted_hud=round(float(np.mean(ph)), 2),
                         psnr_stale=round(float(np.mean(pn)), 2),
                         misalign_px_predicted=round(float(np.median(rp)), 2), misalign_px_stale=round(float(np.median(rs)), 2),
                         direct_kx=round(float(np.median(dk)), 4) if dk else None, trials=len(ps)))
        print(rows[-1], flush=True)
    gh.close()
    return dict(calibration=cal, rows=rows)


def h2():
    port = 8945
    log = open(os.path.join(RESULTS, "..", "build", "h2_server.log"), "w")
    srv = subprocess.Popen([sys.executable, "-u", os.path.join(ROOT, "server.py"), "--game", "minetest", "--size", f"{W}x{H}",
                            "--fov", str(FOV), "--overscan", str(OS), "--port", str(port), "--rate", "30"],
                           cwd=os.path.join(RESULTS, "..", "build"), stdout=log, stderr=subprocess.STDOUT)
    out = []
    try:
        time.sleep(12)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            br = launch(p)
            pg = br.new_page(viewport={"width": W, "height": H})
            pg.goto(f"http://127.0.0.1:{port}/?test=1&w={W}&h={H}")
            wait_for(pg, "SS.host.active && SS.host.frames > 10", 90)
            for i in range(240):                                   # let the online calibration converge
                pg.evaluate(f"SS.hostMove({[-14, 14][(i // 4) % 2]}, {[-3, 3][(i // 7) % 2]})"); time.sleep(0.05)
            time.sleep(1.5)
            cal = pg.evaluate("SS.host.frame.cal")
            print("calibration seen by the browser", cal, flush=True)
            for rtt in (0, 50, 100, 200):
                pg.evaluate(f"SS.netemu({{up_ms: {rtt / 2}, down_ms: {rtt / 2}}})")
                for ipr in (True, False):
                    pg.evaluate(f"SS.host.ipr = {str(ipr).lower()}; SS.host.probeEach = true")
                    time.sleep(1.0 + rtt / 1000)
                    lat, jumps = [], []
                    for k in range(10):
                        step = 30 if k % 2 == 0 else -30
                        expect = abs(cal["kx"] * step) * OS
                        t_inj = pg.evaluate(f"SS.hostMove({step}, 0)")
                        time.sleep(0.9 + 2.5 * rtt / 1000)
                        log_ = pg.evaluate(f"SS.host.log.filter(e => e.t >= {t_inj} - 1)")
                        hit = next((e for e in log_ if abs(e["shift"]) >= 0.5 * expect), None)
                        if hit:
                            lat.append(hit["tDone"] - t_inj)
                        # how far the image jumps when the real frame arrives (prediction error, px)
                        if ipr and len(log_) > 3:
                            sh = [e["shift"] for e in log_]
                            jumps.append(max(abs(sh[i + 1] - sh[i]) for i in range(len(sh) - 1) if i > 0) if len(sh) > 2 else 0)
                    med = lambda a: round(float(np.median(a)), 1) if a else None
                    out.append(dict(rtt_ms=rtt, prediction=ipr, latency_ms_median=med(lat), n=len(lat),
                                    max_jump_px_median=med(jumps) if ipr else None))
                    print(out[-1], flush=True)
                    pg.evaluate("SS.host.probeEach = false")
            br.close()
    finally:
        srv.terminate(); log.close()
        subprocess.run(["pkill", "-f", "minetest_run"], check=False)
    return out


def main():
    os.makedirs(os.path.join(RESULTS, "..", "build"), exist_ok=True)
    res = {"h1": h1()}
    subprocess.run(["pkill", "-f", "minetest"], check=False); time.sleep(1)
    res["h2"] = h2()
    json.dump(res, open(os.path.join(RESULTS, "host.json"), "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
