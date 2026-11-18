"""Experiment V: bandwidth headroom from inter-frame coding.

The PoC ships every shell layer as an intra-only JPEG (lowest latency, loss-tolerant, trivially decodable
in any browser).  Both T4s carry an NVENC engine, so the obvious upgrade is H.264/HEVC for the colour
layers.  This experiment renders the same 2-second walk-and-turn path as (a) classic frames and (b) shell
focus layers (fixed size, FOV breathing with the guard band), and compares JPEG q85 bytes with x264
(zerolatency, no B-frames, CRF 20) bytes.  x264 stands in for NVENC here (no GPU in the dev container).
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np

from common import E, RESULTS

N, FPS = 48, 24
W, H = 640, 400


def path(i):
    t = i / FPS
    yaw = 0.15 + 0.6 * math.sin(t * 1.2)
    fwd = np.array([-math.sin(yaw), 0, -math.cos(yaw)])
    return np.array([4.0, 1.7, 26.0]) + fwd * 4.0 * t, yaw, 0.6 * 1.2 * math.cos(t * 1.2)


def x264_bytes(frames):
    with tempfile.TemporaryDirectory() as d:
        raw = os.path.join(d, "in.rgb")
        with open(raw, "wb") as f:
            for fr in frames:
                f.write(np.ascontiguousarray(fr).tobytes())
        out = os.path.join(d, "out.264")
        h, w = frames[0].shape[:2]
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
                        "-r", str(FPS), "-i", raw, "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
                        "-bf", "0", "-crf", "20", "-g", "600", "-pix_fmt", "yuv420p", out], check=True)
        return os.path.getsize(out)


def main():
    be = E.CpuBackend()
    jp = E.JpegEncoder(85, prefer_gpu=False)
    classic, shell = [], []
    for i in range(N):
        pos, yaw, yr = path(i)
        r, u, f = E.basis_from_yaw_pitch(yaw, 0.0)
        v = E.make_view(pos, r, u, f, -1, 1, -H / W, H / W, (0, 0, W, H))
        rgb, _, _ = be.render(E.pack_params([v], t=i / FPS), W, H, E.MODE_COLOR)
        classic.append(rgb)
        # shell focus: fixed pixel size, field of view grows with angular speed (guard band)
        m = math.radians(7) + abs(yr) * 0.12
        tx = math.tan(math.radians(45) + m); ty = math.tan(math.atan(H / W) + m * 0.8)
        pf = pos + np.array([-math.sin(yaw), 0, -math.cos(yaw)]) * 4.0 * 0.12
        v2 = E.make_view(pf, r, u, f, -tx, tx, -ty, ty, (0, 0, W, H))
        rgb2, _, _ = be.render(E.pack_params([v2], t=i / FPS), W, H, E.MODE_COLOR)
        shell.append(rgb2)
        print(i, end=" ", flush=True)
    res = {}
    for name, frames in (("classic", classic), ("shell_focus", shell)):
        jpeg = sum(len(jp.encode_host(fr, 85)) for fr in frames) / len(frames)
        x264 = x264_bytes(frames) / len(frames)
        res[name] = dict(jpeg_q85_bytes_per_frame=round(jpeg), x264_crf20_bytes_per_frame=round(x264), ratio=round(jpeg / x264, 2))
    res["frames"], res["size"] = N, f"{W}x{H}"
    print("\n", json.dumps(res, indent=1))
    json.dump(res, open(f"{RESULTS}/video.json", "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
