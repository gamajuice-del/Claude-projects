"""Generate the markdown result tables of the report directly from results/*.json (no hand-copied numbers)."""
import json
import os
import sys

import numpy as np

from common import RESULTS

MODES = ["local1", "local2", "stale", "rot", "naive", "noback", "shell"]
NAMES = {"local1": "local PC, 1 spp", "local2": "local PC, 2 spp", "stale": "classic (stale frame)", "rot": "rotation-only warp",
         "naive": "naive depth warp", "noback": "ShellStream w/o band", "shell": "**ShellStream**"}


def load(n):
    p = os.path.join(RESULTS, n)
    return json.load(open(p)) if os.path.exists(p) else None


def t_latency(L):
    rows = {}
    for r in L["steps"]:
        rows.setdefault(r["rtt_ms"], {})[r["mode"]] = r
    out = ["| emulated RTT | ShellStream: input -> frame (median / p90) | classic: input -> frame (median / p90) | classic server build (CPU) | client frame interval (shell / classic) |",
           "|---|---|---|---|---|"]
    for rtt in sorted(rows):
        s, c = rows[rtt].get("shell"), rows[rtt].get("classic")
        out.append(f"| {rtt} ms | **{s['pixel_ms_median']:.0f}** / {s['pixel_ms_p90']:.0f} ms | {c['pixel_ms_median']:.0f} / {c['pixel_ms_p90']:.0f} ms | "
                   f"{c['server_build_ms_median']:.0f} ms | {s['frame_interval_ms_median']:.0f} / {c['frame_interval_ms_median']:.0f} ms |")
    return "\n".join(out)


def t_stall(L):
    out = ["| | view lag while turning, before the stall (median) | max view lag during the 1 s stall | client frames rendered during the stall | max frame interval |",
           "|---|---|---|---|---|"]
    for m in ("shell", "classic"):
        s = L["stall"][m]
        out.append(f"| {'ShellStream' if m == 'shell' else 'classic'} | {s.get('view_lag_deg_median_before_stall', 0):.1f} deg | "
                   f"{s['view_lag_deg_max_during_stall']:.1f} deg | {s['frames_during_stall']} | {s['frame_interval_ms_max']:.0f} ms |")
    return "\n".join(out)


def t_quality(Q, offsets=None, metric="psnr"):
    offs = []
    for r in Q:
        if r["offset"] not in offs:
            offs.append(r["offset"])
    offs = offsets or offs
    modes = [m for m in MODES if any(r["mode"] == m for r in Q)]
    out = ["| displacement | " + " | ".join(NAMES[m] for m in modes) + " |", "|---|" + "---|" * len(modes)]
    for o in offs:
        cells = []
        best = max(np.mean([r[metric] for r in Q if r["offset"] == o and r["mode"] == m]) for m in modes if m not in ("local1", "local2"))
        for m in modes:
            v = np.mean([r[metric] for r in Q if r["offset"] == o and r["mode"] == m])
            txt = f"{v:.2f}" if metric == "psnr" else f"{v:.3f}"
            if m not in ("local1", "local2") and abs(v - best) < 1e-9:
                txt = f"**{txt}**"
            cells.append(txt)
        out.append(f"| {o} | " + " | ".join(cells) + " |")
    return "\n".join(out)


def t_ablation(Qr, Qn):
    out = ["| displacement | ShellStream, scene with reflections | gap to local 2 spp | ShellStream, reflections off | gap to local 2 spp |", "|---|---|---|---|---|"]
    offs = []
    for r in Qr:
        if r["offset"] not in offs:
            offs.append(r["offset"])
    for o in offs:
        a = np.mean([r["psnr"] for r in Qr if r["offset"] == o and r["mode"] == "shell"])
        la = np.mean([r["psnr"] for r in Qr if r["offset"] == o and r["mode"] == "local2"])
        b = np.mean([r["psnr"] for r in Qn if r["offset"] == o and r["mode"] == "shell"])
        lb = np.mean([r["psnr"] for r in Qn if r["offset"] == o and r["mode"] == "local2"])
        out.append(f"| {o} | {a:.2f} dB | {la - a:.2f} dB | {b:.2f} dB | {lb - b:.2f} dB |")
    return "\n".join(out)


def t_disocc(D):
    modes = ["stale", "rot", "naive", "noback", "shell"]
    out = ["| scene, displacement | pixels newly revealed | " + " | ".join(NAMES[m] for m in modes) + " |", "|---|---|" + "---|" * len(modes)]
    for r in D:
        best = max(r[m] for m in modes if r[m] is not None)
        cells = [(f"**{r[m]:.2f}**" if r[m] == best else f"{r[m]:.2f}") if r[m] is not None else "n/a" for m in modes]
        out.append(f"| {r['scene']}, {r['offset']} | {100 * r['disoccluded_fraction']:.1f} % | " + " | ".join(cells) + " |")
    means = [np.mean([r[m] for r in D if r[m] is not None]) for m in modes]
    out.append("| **mean** | | " + " | ".join(f"**{v:.2f}**" if v == max(means) else f"{v:.2f}" for v in means) + " |")
    return "\n".join(out)


def t_bandwidth(B):
    out = ["| scene, motion | focus | focus colour | focus depth + topology | background band | omni cube | brick + header | **total** | classic 1080p JPEG |",
           "|---|---|---|---|---|---|---|---|---|"]
    k = lambda v: f"{v / 1024:.0f}"
    for s in B["shells"]:
        p = s["parts"]
        out.append(f"| {s['scene']}, {s['motion']} | {s['focus']} | {k(p['front colour'])} | {k(p['front depth'] + p['front topology'])} | "
                   f"{k(p.get('back colour', 0) + p.get('back depth', 0) + p.get('back topology', 0))} | "
                   f"{k(p['omni colour'] + p['omni depth'] + p['omni topology'])} | {k(p['collision brick'] + p['header'])} | "
                   f"**{k(s['total'])}** | {k(s['classic_jpeg_1080p'])} |")
    tot = np.mean([s["total"] for s in B["shells"]])
    out.append(f"\nAll sizes in KiB. Mean shell: **{tot / 1024:.0f} KiB**, which is {tot * 8 * 30 / 1e6:.0f} Mbit/s at 30 shells/s with intra-only JPEG.")
    return "\n".join(out)


def t_codec(C):
    by = {}
    for r in C["rows"]:
        by.setdefault((r["codec"], r["level"]), []).append(r)
    rows = sorted([(np.mean([x["bytes"] for x in v]), k, np.mean([x["ms"] or 0 for x in v])) for k, v in by.items()])
    out = ["| depth codec (16-bit inverse depth, 672x376 texels, mean of 3 scenes) | KiB | bits/texel | encode ms (1 core) |", "|---|---|---|---|"]
    keep = [r for r in rows if r[1][1] in (None, 1, 6) and ("interleaved" not in r[1][0])][:9]
    for b, (name, lvl), ms in keep:
        lab = name + (f", deflate-{lvl}" if lvl else "")
        if name.startswith("MED") and lvl == 6:
            lab = f"**{lab} (shipped)**"
        out.append(f"| {lab} | {b / 1024:.1f} | {b * 8 / C['texels']:.2f} | {ms:.1f} |" if lvl else f"| {lab} | {b / 1024:.1f} | {b * 8 / C['texels']:.2f} | n/a |")
    return "\n".join(out)


def t_video(V):
    return ("| sequence (48 frames, 640x400, walk + turn) | JPEG q85 bytes/frame | H.264 (x264 zerolatency, CRF 20) bytes/frame | ratio |\n|---|---|---|---|\n"
            + "\n".join(f"| {'classic frames' if k == 'classic' else 'ShellStream focus layer'} | {v['jpeg_q85_bytes_per_frame']:,} | {v['x264_crf20_bytes_per_frame']:,} | {v['ratio']:.2f}x |"
                        for k, v in V.items() if isinstance(v, dict)))


def t_cost(CM, CC):
    keys = sorted(CM["t4_ms"])
    lo, mid, hi = CM["t4_ms"][keys[2]], CM["t4_ms"][keys[1]], CM["t4_ms"][keys[0]]
    p = CM["passes"]
    names = [("front_color", "focus colour, 1280x800, 2 spp"), ("front_geometry", "focus geometry + depth, 640x400"),
             ("background_band", "background band, 640x400"), ("omni_color", "omni colour, 6x256^2"),
             ("omni_geometry", "omni geometry, 6x128^2"), ("classic_1080p", "*classic frame, 1920x1080, 2 spp*")]
    out = ["| pass | pixels | SDF evaluations / pixel (measured) | CPU ms (4 cores, measured) | T4 ms, modelled (range) |", "|---|---|---|---|---|"]
    for k, lab in names:
        out.append(f"| {lab} | {p[k]['pixels']:,} | {p[k]['evals_per_px']:.1f} | {p[k]['cpu_ms']:.0f} | {mid[k]:.1f} ({lo[k]:.1f}-{hi[k]:.1f}) |")
    out.append(f"| **whole shell, 1 T4** | | | | **{mid['shell_total_1gpu']:.1f}** ({lo['shell_total_1gpu']:.1f}-{hi['shell_total_1gpu']:.1f}) |")
    out.append(f"| **whole shell, 2 T4 (balanced split)** | | | | **{mid['shell_total_2gpu_balanced']:.1f}** ({lo['shell_total_2gpu_balanced']:.1f}-{hi['shell_total_2gpu_balanced']:.1f}) |")
    r = CC["ss_render"]
    out.append(f"\nSASS for one `map()` evaluation: {CM['map_instructions']} instructions (sm_75). `ss_render`: {r['registers']} registers, "
               f"{r['stack']} B stack, {r['spill_st']} B spills. Model: 40 SMs x 4 schedulers x 0.75 warp-instr/clk, 1.25-1.45 GHz, "
               f"SIMT efficiency 45-70 %, 0.8 dynamic/static instruction ratio, +15 % shading/control.")
    return "\n".join(out)


def main():
    parts = {}
    L, Q, B, C, V, CM, CC = (load(x) for x in ("latency.json", "quality.json", "bandwidth.json", "codec_explore.json", "video.json",
                                                "cost_model.json", "cuda_check.json"))
    Qr, Qn = load("quality_reflect_subset.json"), load("quality_noreflect.json")
    if L: parts["LATENCY"] = t_latency(L); parts["STALL"] = t_stall(L)
    if Q: parts["QUALITY"] = t_quality(Q); parts["SSIM"] = t_quality(Q, metric="ssim")
    if Qr and Qn: parts["ABLATION"] = t_ablation(Qr, Qn)
    if B: parts["BANDWIDTH"] = t_bandwidth(B)
    D = load("disocclusion.json")
    if D: parts["DISOCC"] = t_disocc(D)
    if C: parts["CODEC"] = t_codec(C)
    if V: parts["VIDEO"] = t_video(V)
    if CM and CC: parts["COST"] = t_cost(CM, CC)
    json.dump(parts, open(os.path.join(RESULTS, "tables.json"), "w"), indent=1)
    for k, v in parts.items():
        print(f"\n### {k}\n{v}")


if __name__ == "__main__":
    sys.exit(main())
