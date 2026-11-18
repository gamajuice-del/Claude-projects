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
    gap_r = q(Qr, "strafe 0.5m", "local2") - q(Qr, "strafe 0.5m", "shell")
    gap_n = q(Qn, "strafe 0.5m", "local2") - q(Qn, "strafe 0.5m", "shell")
    S = dict(
        SLOPE=f"{slope:.2f} ms per ms of RTT",
        ROTGAP=f"{rotgap:.1f}",
        ROT_VS_LOCAL1=f"30 degrees: {q(Q, 'yaw 30deg', 'shell'):.1f} dB vs. {q(Q, 'yaw 30deg', 'local1'):.1f} dB for a local 1-spp render",
        S05=f"{q(Q, 'strafe 0.5m', 'shell'):.1f}", C05=f"{q(Q, 'strafe 0.5m', 'stale'):.1f}", N05=f"{q(Q, 'strafe 0.5m', 'naive'):.1f}",
        BAND05=f"{q(Q, 'strafe 0.5m', 'shell') - q(Q, 'strafe 0.5m', 'noback'):.1f}",
        ZEROGAP=f"{q(Q, 'none', 'local2') - q(Q, 'none', 'shell'):.1f}",
        ABL_GAIN=f"{gap_r - gap_n:.1f}",
        YAW60=f"{q(Q, 'yaw 60deg', 'shell'):.1f}",
        ABL_01=f"{(q(Qr, 'strafe 0.1m', 'local2') - q(Qr, 'strafe 0.1m', 'shell')) - (q(Qn, 'strafe 0.1m', 'local2') - q(Qn, 'strafe 0.1m', 'shell')):.1f}",
        GAP_01=f"{q(Qr, 'strafe 0.1m', 'local2') - q(Qr, 'strafe 0.1m', 'shell'):.1f}",
        ABL_FWD=f"{(q(Qr, 'forward 0.5m', 'local2') - q(Qr, 'forward 0.5m', 'shell')) - (q(Qn, 'forward 0.5m', 'local2') - q(Qn, 'forward 0.5m', 'shell')):.1f}",
        SHELL_VS_CLASSIC=f"{tot / np.mean([s['classic_jpeg_1080p'] for s in B['shells']]):.1f}",
        MBPS=f"{tot * 8 * 30 / 1e6:.0f}",
        MBPS_H264=f"{(tot - colour + colour / ratio_v) * 8 * 30 / 1e6:.0f}",
        SHELL1=f"{mid['shell_total_1gpu']:.1f}", SHELL2=f"{mid['shell_total_2gpu_balanced']:.1f}",
        CLASSIC_MS=f"{mid['classic_1080p']:.1f}",
    )
    tpl = open(os.path.join(RESULTS, "report_results_template.md")).read()
    for k, v in T.items():
        tpl = tpl.replace("{{" + k + "}}", v)
    for k, v in S.items():
        tpl = tpl.replace("{{" + k + "}}", v)
    missing = re.findall(r"\{\{(\w+)\}\}", tpl)
    if missing:
        print("WARNING unfilled:", missing)
    tail = open(os.path.join(RESULTS, "report_tail.md")).read()

    summary = f"""
**Key results (development run; see the report for method and caveats)**

| | ShellStream | classic cloud streaming |
|---|---|---|
| look latency, input to finished frame, RTT 0 to 200 ms | **{min(r['pixel_ms_median'] for r in sh):.0f}-{max(r['pixel_ms_median'] for r in sh):.0f} ms, flat** (= one frame of the software-rendered test client; one display refresh on a real GPU) | {cl[0]['pixel_ms_median']:.0f} -> {cl[-1]['pixel_ms_median']:.0f} ms, grows with RTT |
| view lag while turning through a 1 s network stall | **0.0 deg** | up to {L['stall']['classic']['view_lag_deg_max_during_stall']:.0f} deg |
| image after a 30-degree turn (PSNR vs. 16-spp truth) | **{q(Q, 'yaw 30deg', 'shell'):.1f} dB** (local 1-spp render: {q(Q, 'yaw 30deg', 'local1'):.1f}) | {q(Q, 'yaw 30deg', 'stale'):.1f} dB (stale frame) |
| image after a 0.5 m strafe | **{q(Q, 'strafe 0.5m', 'shell'):.1f} dB** (naive depth warp {q(Q, 'strafe 0.5m', 'naive'):.1f}) | {q(Q, 'strafe 0.5m', 'stale'):.1f} dB |
| inside regions newly revealed by a 0.5 m strafe | **{dmean('shell'):.1f} dB** (naive depth warp {dmean('naive'):.1f}, no band {dmean('noback'):.1f}) | {dmean('stale'):.1f} dB |
| T4 time per update (modelled; measured by the notebook) | {mid['shell_total_2gpu_balanced']:.1f} ms on 2 T4s ({mid['shell_total_1gpu']:.1f} on one) | {mid['classic_1080p']:.1f} ms per 1080p frame on one T4 |
| bytes per update, 1080p client | {tot / 1024:.0f} KiB (JPEG; about {ratio_v:.0f}x less colour with NVENC-class video) | {np.mean([s['classic_jpeg_1080p'] for s in B['shells']]) / 1024:.0f} KiB |

Under translation the gap to a local render is still large. Wet-floor mirror reflections explain much
of it for small moves (a reflection ablation is in the report); the rest is open and is the main item of
future work.
"""
    open(os.path.join(RESULTS, "SUMMARY.md"), "w").write(summary)
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
