"""Experiment L: look latency vs. network RTT, and behaviour during a network stall.

Look latency = time from an input event (a 7 degree mouse-look step) to the GPU completion of the first
rendered frame whose framebuffer reflects it (forced with a one-row readPixels after every frame).  Measured two ways: from the pose actually used for drawing, and from a
pixel probe (hash of one framebuffer row read back after every frame) -- the latter is a 'photon' proxy
short of the display scan-out, which headless Chromium cannot observe.

Stall: the camera turns continuously at 1 rad/s while the downlink is frozen for 1 s.
"""
import json
import statistics
import sys
import time

from playwright.sync_api import sync_playwright

from common import E, S, RESULTS, launch, wait_for

W, H = 400, 250
RTTS = [0, 25, 50, 100, 200]
MODES = ["shell", "classic"]
TRIALS = 12
STEP = 0.12


def measure_steps(pg, rtt, srv_ms):
    lat_pose, lat_px, frame_dt = [], [], []
    for k in range(TRIALS):
        sign = 1 if k % 2 == 0 else -1
        time.sleep(0.25)
        t_inj = pg.evaluate(f"SS.inject({sign * STEP})")
        time.sleep(0.35 + 2.2 * rtt / 1000 + 3 * srv_ms / 1000)
        log = pg.evaluate(f"SS.frameLog.filter(f => f.t >= {t_inj} - 400)")
        before = [f for f in log if f["t"] < t_inj]
        after = [f for f in log if f["t"] >= t_inj]
        if not before or not after:
            continue
        y0, p0 = before[-1]["shownYaw"], before[-1]["probe"]
        hit = next((f for f in after if abs(f["shownYaw"] - y0) > 0.8 * STEP), None)
        hitp = next((f for f in after if f["probe"] != p0), None)
        if hit:
            lat_pose.append(hit["tDone"] - t_inj)       # input -> GPU-complete frame using the new pose
        if hitp:
            lat_px.append(hitp["tDone"] - t_inj)        # input -> GPU-complete frame whose pixels changed
        ts = [f["t"] for f in log]
        frame_dt += [b - a for a, b in zip(ts, ts[1:])]
    med = lambda a: round(statistics.median(a), 1) if a else None
    p90 = lambda a: round(sorted(a)[int(0.9 * (len(a) - 1))], 1) if a else None
    return dict(pose_ms_median=med(lat_pose), pose_ms_p90=p90(lat_pose), pixel_ms_median=med(lat_px),
                pixel_ms_p90=p90(lat_px), frame_interval_ms_median=med(frame_dt), n=len(lat_pose),
                raw_pose=[round(x, 1) for x in lat_pose], raw_pixel=[round(x, 1) for x in lat_px])


def main():
    be = E.CpuBackend(threads=2)
    b = E.ShellBuilder([be], focus_budget=0.06e6, omni_R=64, quality="low", spp=1)
    srv = S.ShellServer(b, port=8841, max_rate=60, animate=False, max_refine=0).start()
    out = dict(steps=[], stall={})
    with sync_playwright() as p:
        br = launch(p)
        pg = br.new_page(viewport={"width": W, "height": H})
        pg.goto(f"http://127.0.0.1:8841/?test=1&w={W}&h={H}&orbs=0&cubic=0")
        wait_for(pg, "SS.stats.shells >= 1", 120)
        pg.evaluate("SS.setPose([4, 1.7, 26], 0.15, 0)")
        time.sleep(1.0)
        for mode in MODES:
            pg.evaluate(f"SS.setMode('{mode}')")
            for rtt in RTTS:
                pg.evaluate(f"SS.netemu({{up_ms: {rtt / 2}, down_ms: {rtt / 2}, jitter_ms: 0}})")
                time.sleep(1.5 + 3 * rtt / 1000)
                srv_ms = statistics.median([s["build_ms"] for s in list(srv.session.log)[-20:]] or [20])
                pg.evaluate("SS.probeEach = true")
                r = measure_steps(pg, rtt, srv_ms)
                pg.evaluate("SS.probeEach = false")
                r.update(mode=mode, rtt_ms=rtt, server_build_ms_median=round(srv_ms, 1))
                out["steps"].append(r)
                print({k: v for k, v in r.items() if not k.startswith("raw")}, flush=True)
        # ------------------------------------------------------------ stall experiment
        for mode in MODES:
            pg.evaluate(f"SS.setMode('{mode}')")
            pg.evaluate("SS.netemu({up_ms: 25, down_ms: 25, jitter_ms: 0})")
            pg.evaluate("SS.game.spin = 1.0")
            time.sleep(2.0)
            t_s = pg.evaluate("performance.now()")
            pg.evaluate("SS.netemu({stall_ms: 1000})")
            time.sleep(2.5)
            pg.evaluate("SS.game.spin = 0")
            log = pg.evaluate(f"SS.frameLog.filter(f => f.t >= {t_s} - 1000 && f.t <= {t_s} + 2500)")
            pts = [dict(t=round(f["t"] - t_s, 1), yaw=round(f["yaw"], 4), shown=round(f["shownYaw"], 4), shell=f["shell"]) for f in log]
            dts = [b2["t"] - a["t"] for a, b2 in zip(pts, pts[1:])]
            during = [x for x in pts if 0 <= x["t"] <= 1000]
            import math
            lag = [abs(math.degrees((x["yaw"] - x["shown"] + math.pi) % (2 * math.pi) - math.pi)) for x in during]
            out["stall"][mode] = dict(series=pts, frame_interval_ms_median=round(statistics.median(dts), 1),
                                      frame_interval_ms_max=round(max(dts), 1), view_lag_deg_max_during_stall=round(max(lag), 1),
                                      frames_during_stall=len(during))
            print(mode, {k: v for k, v in out["stall"][mode].items() if k != "series"}, flush=True)
            time.sleep(1.0)
        br.close()
    srv.stop()
    json.dump(out, open(f"{RESULTS}/latency.json", "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
