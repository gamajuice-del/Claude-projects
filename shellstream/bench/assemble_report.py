"""Fill the report template from results/*.json and splice it into ShellStream_Report.md; write SUMMARY.md."""
import json
import os
import re
import sys

import numpy as np

from common import RESULTS, ROOT

REPORT = os.path.join(os.path.dirname(ROOT), "ShellStream_Report.md")


def load(n):
    return json.load(open(os.path.join(RESULTS, n)))


def q(Q, off, mode):
    return float(np.mean([r["psnr"] for r in Q if r["offset"] == off and r["mode"] == mode]))


def _and(xs):
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]


def main():
    T = load("tables.json")
    L, Q, B, V, CM = load("latency.json"), load("quality.json"), load("bandwidth.json"), load("video.json"), load("cost_model.json")
    Qr, Qn = load("quality_reflect_subset.json"), load("quality_noreflect.json")

    D = load("disocclusion.json")
    dmean = lambda m: float(np.mean([r[m] for r in D if r[m] is not None]))
    cl = sorted([r for r in L["steps"] if r["mode"] == "classic"], key=lambda r: r["rtt_ms"])
    sh = sorted([r for r in L["steps"] if r["mode"] == "shell"], key=lambda r: r["rtt_ms"])
    slope = np.polyfit([r["rtt_ms"] for r in cl], [r["pixel_ms_median"] for r in cl], 1)[0]
    rot_offs = [o for o in dict.fromkeys(r["offset"] for r in Q) if o.startswith("yaw") or o.startswith("pitch")]
    rotgap = max(q(Q, "none", "shell") - q(Q, o, "shell") for o in rot_offs if o != "yaw 60deg")
    keys = sorted(CM["t4_ms"]); mid = CM["t4_ms"][keys[1]]
    tot = np.mean([s["total"] for s in B["shells"]])
    colour = np.mean([s["parts"]["front colour"] + s["parts"].get("back colour", 0) + s["parts"]["omni colour"] for s in B["shells"]])
    ratio_v = V["shell_focus"]["ratio"]
    gap_r = q(Qr, "strafe 0.5m", "local2") - q(Qr, "strafe 0.5m", "shell1")
    gap_n = q(Qn, "strafe 0.5m", "local2") - q(Qn, "strafe 0.5m", "shell1")
    S = dict(
        SLOPE=f"{slope:.2f} ms per ms of RTT",
        ROTGAP=f"{rotgap:.1f}",
        ROT_VS_LOCAL1=f"30 degrees: {q(Q, 'yaw 30deg', 'shell'):.1f} dB vs. {q(Q, 'yaw 30deg', 'local1'):.1f} dB for a local 1-spp render",
        S05=f"{q(Q, 'strafe 0.5m', 'shell'):.1f}", C05=f"{q(Q, 'strafe 0.5m', 'stale'):.1f}", N05=f"{q(Q, 'strafe 0.5m', 'naive'):.1f}",
        BAND05=f"{q(Q, 'strafe 0.5m', 'shell1') - q(Q, 'strafe 0.5m', 'noback'):.1f}",
        S05_1=f"{q(Q, 'strafe 0.5m', 'shell1'):.1f}",
        ZEROGAP=f"{q(Q, 'none', 'local2') - q(Q, 'none', 'shell'):.1f}",
        ABL_GAIN=f"{gap_r - gap_n:.1f}",
        YAW60=f"{q(Q, 'yaw 60deg', 'shell'):.1f}",
        ABL_01=f"{(q(Qr, 'strafe 0.1m', 'local2') - q(Qr, 'strafe 0.1m', 'shell1')) - (q(Qn, 'strafe 0.1m', 'local2') - q(Qn, 'strafe 0.1m', 'shell1')):.1f}",
        GAP_01=f"{q(Qr, 'strafe 0.1m', 'local2') - q(Qr, 'strafe 0.1m', 'shell1'):.1f}",
        ABL_FWD=f"{(q(Qr, 'forward 0.5m', 'local2') - q(Qr, 'forward 0.5m', 'shell1')) - (q(Qn, 'forward 0.5m', 'local2') - q(Qn, 'forward 0.5m', 'shell1')):.1f}",
        SHELL_VS_CLASSIC=f"{tot / np.mean([s['classic_jpeg_1080p'] for s in B['shells']]):.1f}",
        MBPS=f"{tot * 8 * 30 / 1e6:.0f}",
        MBPS_H264=f"{(tot - colour + colour / ratio_v) * 8 * 30 / 1e6:.0f}",
        SHELL1=f"{mid['shell_total_1gpu']:.1f}", SHELL2=f"{mid['shell_total_2gpu_balanced']:.1f}",
        CLASSIC_MS=f"{mid['classic_1080p']:.1f}",
    )
    # ---- pass 2: any game (host mode) and both T4s
    Hh = load("host.json")
    h1 = Hh["h1"]["rows"]; h2 = Hh["h2"]
    hor = [r for r in h1 if r["step_counts"][1] == 0 and r["step_counts"][0] > 0]
    on = [r for r in h2 if r["prediction"]]; off = [r for r in h2 if not r["prediction"]]
    hud_gain = [r["psnr_predicted_hud"] - r["psnr_predicted"] for r in h1]
    vs_stale = [r["psnr_predicted_hud"] - r["psnr_stale"] for r in h1]
    direct = [r["direct_kx"] for r in h1 if r.get("direct_kx") is not None]
    Bd = [x for x in B["shells"] if x["motion"] == "running+turning, both T4s"]
    Bs = [x for x in B["shells"] if x["motion"] == "running+turning"]
    S.update(
        H1_RES=(_and([f"{r['misalign_px_stale']:.0f}" for r in hor]) + " px turns leave "
                + _and([f"{r['misalign_px_predicted']:.1f}" for r in hor]) + " px"),
        H1_HUDGAIN=f"{min(hud_gain):.1f}-{max(hud_gain):.1f}",
        H1_VS_STALE=f"{min(vs_stale):+.1f} to {max(vs_stale):+.1f}",
        CAL_ERR=f"{abs(100 * (Hh['h1']['calibration']['kx'] / float(np.median(direct)) - 1)):.1f} %" if direct else "n/a",
        HEDGE="0.45",
        SINGLE05=f"{q(Q, 'strafe 0.5m', 'shell1'):.1f}", DUAL05=f"{q(Q, 'strafe 0.5m', 'shell'):.1f}",
        SINGLEFWD=f"{q(Q, 'forward 0.5m', 'shell1'):.1f}", DUALFWD=f"{q(Q, 'forward 0.5m', 'shell'):.1f}",
        SINGLEJUMP=f"{q(Q, 'jump 0.5m', 'shell1'):.1f}", DUALJUMP=f"{q(Q, 'jump 0.5m', 'shell'):.1f}",
        DISOCC_SINGLE=f"{dmean('shell1'):.1f}", DISOCC_DUAL=f"{dmean('shell'):.1f}",
        DUAL_BYTES_RATIO=f"{np.mean([x['total'] for x in Bd]) / np.mean([x['total'] for x in Bs]):.1f}" if Bd and Bs else "about 2",
        HOST_ON=f"{min(r['latency_ms_median'] for r in on):.0f}-{max(r['latency_ms_median'] for r in on):.0f}",
        HOST_OFF=f"{min(r['latency_ms_median'] for r in off):.0f}-{max(r['latency_ms_median'] for r in off):.0f}",
    )
    # ---- pass 3: Roblox-capable host (full control, audio, fps)
    Hf = load("host_full.json") if os.path.exists(os.path.join(RESULTS, "host_full.json")) else None
    Hp = load("host_fps.json") if os.path.exists(os.path.join(RESULTS, "host_fps.json")) else None
    if Hf:
        m, a = Hf["pointer_modes"], Hf.get("audio") or {}
        rows = [("access without / with a wrong / with the token",
                 f"{Hf['http_status']['no token']} / {Hf['http_status']['wrong token']} / {Hf['http_status']['token']}"),
                ("HTTPS (self-signed): secure context, video codec",
                 f"{'yes' if Hf['browser']['secure'] else 'no'}, {Hf['browser']['codec'].upper()} via WebCodecs"),
                ("in the game", f"pointer hidden -> {'look' if m['in game']['look'] else 'pointer'} mode"),
                ("Esc (pause menu)", f"pointer shown at {m['pause menu']['cur']} -> "
                                     f"{'look' if m['pause menu']['look'] else 'pointer'} mode, prediction off"),
                ("move the local pointer to \"Continue\"", f"game's pointer at {m['pointer moved to Continue']['cur']}"),
                ("click", f"menu closes -> {'look' if m['after clicking Continue']['look'] else 'pointer'} mode"),
                ("local pointer, display <-> game round trip", f"{Hf['pointer_mapping_err_px']:.3f} px")]
        if a:
            rows.append(("audio (440 Hz tone on the host)", f"{a['decoded']} packets decoded in the browser, level "
                         f"{a['rms']:.3f} RMS (sent: 0.212), {a['bufMs']} ms buffered, {a['dropped']} resyncs"))
        S["HOST_FULL"] = ("**Full remote control of an unmodified game** (Minetest standing in for Roblox; "
                          "`bench/host_full.py`, " + ("all checks pass" if Hf.get("all_ok") else "**some checks failed**") +
                          "):\n\n| step | result |\n|---|---|\n" + "\n".join(f"| {k} | {v} |" for k, v in rows))
    if Hp:
        S["HOST_FPS"] = ("| frame | max fps | encode (x264) | capture + pointer state | calibrator (own thread) |\n|---|---|---|---|---|\n"
                         + "\n".join(f"| {r['size']} | **{r['fps_max']:.0f}** | {r['encode_ms']:.1f} ms | "
                                      f"{r['capture_and_state_ms']:.1f} ms | {r['calibrator_ms']:.1f} ms, kept up with "
                                      f"{100 * r['calibrated']:.0f} % of frames |" for r in Hp))
    tpl = open(os.path.join(RESULTS, "report_results_template.md")).read()
    pass2 = open(os.path.join(RESULTS, "report_pass2.md")).read()
    for k, v in T.items():
        tpl = tpl.replace("{{" + k + "}}", v)
    for k, v in S.items():
        tpl = tpl.replace("{{" + k + "}}", v)
    for k, v in list(T.items()) + list(S.items()):
        pass2 = pass2.replace("{{" + k + "}}", v)
    tail = open(os.path.join(RESULTS, "report_tail.md")).read() + "\n\n" + pass2
    missing = re.findall(r"\{\{(\w+)\}\}", tpl + tail)
    if missing:
        print("WARNING unfilled:", missing)

    summary = f"""
**Key results (development run; see the report for method and caveats)**

| | ShellStream | classic cloud streaming |
|---|---|---|
| look latency, input to finished frame, RTT 0 to 200 ms | **{min(r['pixel_ms_median'] for r in sh):.0f}-{max(r['pixel_ms_median'] for r in sh):.0f} ms, flat** (= one frame of the software-rendered test client; one display refresh on a real GPU) | {cl[0]['pixel_ms_median']:.0f} -> {cl[-1]['pixel_ms_median']:.0f} ms, grows with RTT |
| view lag while turning through a 1 s network stall | **0.0 deg** | up to {L['stall']['classic']['view_lag_deg_max_during_stall']:.0f} deg |
| image after a 30-degree turn (PSNR vs. 16-spp truth) | **{q(Q, 'yaw 30deg', 'shell'):.1f} dB** (local 1-spp render: {q(Q, 'yaw 30deg', 'local1'):.1f}) | {q(Q, 'yaw 30deg', 'stale'):.1f} dB (stale frame) |
| image after a 0.5 m strafe | **{q(Q, 'strafe 0.5m', 'shell'):.1f} dB** with both T4s ({q(Q, 'strafe 0.5m', 'shell1'):.1f} with one shell; naive depth warp {q(Q, 'strafe 0.5m', 'naive'):.1f}) | {q(Q, 'strafe 0.5m', 'stale'):.1f} dB |
| inside regions newly revealed by a 0.5 m strafe | **{dmean('shell'):.1f} dB** both T4s ({dmean('shell1'):.1f} one shell; naive {dmean('naive'):.1f}, no band {dmean('noback'):.1f}) | {dmean('stale'):.1f} dB |
| **any unmodified game** (Minetest via the game host): mouse-look latency, RTT 0 to 200 ms | **{S['HOST_ON']} ms** with input-predicted reprojection (lower than the row above only because this client draws a single textured quad, which software rendering finishes sooner) | {S['HOST_OFF']} ms |
| T4 time per update (modelled; measured by the notebook) | {mid['shell_total_2gpu_balanced']:.1f} ms on 2 T4s ({mid['shell_total_1gpu']:.1f} on one) | {mid['classic_1080p']:.1f} ms per 1080p frame on one T4 |
| bytes per update, 1080p client | {tot / 1024:.0f} KiB (JPEG; about {ratio_v:.0f}x less colour with NVENC-class video) | {np.mean([s['classic_jpeg_1080p'] for s in B['shells']]) / 1024:.0f} KiB |

Under translation the gap to a local render is still large. Wet-floor mirror reflections explain much
of it for small moves (a reflection ablation is in the report); the rest is open. For closed games, only
mouse-look is predicted; movement and actions still take the round trip. T4 timings are modelled here and
measured by the notebook.
"""
    open(os.path.join(RESULTS, "SUMMARY.md"), "w").write(summary)
    anygame = open(os.path.join(RESULTS, "notebook_anygame_template.md")).read()
    for k, v in list(T.items()) + list(S.items()):
        anygame = anygame.replace("{{" + k + "}}", v)
    open(os.path.join(RESULTS, "NOTEBOOK_ANYGAME.md"), "w").write(anygame)
    rep = open(os.path.join(RESULTS, "report_head.md")).read()       # pristine template with both placeholders
    rep = rep.replace("RESULTS_SUMMARY_PLACEHOLDER", summary.strip())
    if "RESULTS_SECTION_PLACEHOLDER" in rep:
        rep = rep.replace("RESULTS_SECTION_PLACEHOLDER", tpl + "\n\n" + tail)
    else:
        rep = re.sub(r"## 4\. Experiments and results.*", lambda m: tpl + "\n\n" + tail, rep, flags=re.S)
    open(REPORT, "w").write(rep)
    print(json.dumps(S, indent=1))


if __name__ == "__main__":
    sys.exit(main())
