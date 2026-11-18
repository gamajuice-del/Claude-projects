"""Experiment B: what does a shell cost on the wire, and how good is the depth/topology coding?

* per-layer byte breakdown for a 1920x1080 / 90 deg client in three scenes, standing and turning
* depth codec comparison on the same inverse-depth buffers
* a classic 1080p JPEG frame of the same view for reference
"""
import io
import json
import math
import sys
import time
import zlib

import numpy as np
from PIL import Image

from common import E, RESULTS

SCENES = {
    "plaza": ((4.0, 1.7, 26.0), 0.15, 0.0),
    "pillars": ((1.5, 1.7, 11.5), -0.55, -0.05),
    "street": ((7.0, 1.7, 45.0), 0.0, 0.02),
}


def depth_codecs(code):
    raw = code.tobytes()
    a = code.astype(np.int32)
    d1 = np.zeros_like(a); d1[:, 0] = a[:, 0]; d1[:, 1:] = a[:, 1:] - a[:, :-1]
    d1 = (d1 & 0xFFFF).astype(np.uint16)
    out = {"raw u16": len(raw), "deflate(raw)": len(zlib.compress(raw, 6)),
           "deflate(1st-order delta)": len(zlib.compress(d1.tobytes(), 6))}
    b = io.BytesIO(); Image.fromarray(code.astype(np.uint16)).save(b, format="PNG", optimize=False)
    out["PNG 16-bit"] = len(b.getvalue())
    t = time.perf_counter(); enc = E.encode_depth(code, 1); out["ours level1 ms"] = round((time.perf_counter() - t) * 1000, 2)
    out["ours: 2nd-order affine pred + zigzag + planes, deflate-1"] = len(enc)
    out["ours (deflate-6)"] = len(E.encode_depth(code, 6))
    assert np.array_equal(E.decode_depth(enc, *code.shape), code), "depth codec not lossless"
    return out


def main():
    be = E.CpuBackend()
    rows = []
    codec_rows = []
    for sname, (pos, yaw, pitch) in SCENES.items():
        for motion, st_extra in (("standing", {}), ("running+turning", dict(vel=(3.0, 0, -4.0), yawRate=1.2))):
            b = E.ShellBuilder([be], focus_budget=1.0e6, omni_R=256, quality="high")
            b.pipe_ms = 15.0     # pretend T4 pipeline latency for the look-ahead
            st = dict(pos=pos, yaw=yaw, pitch=pitch, fov=90, aspect=16 / 9, vw=1920, rtt=60, mode="shell", time=0.0, **st_extra)
            t = time.perf_counter()
            msg, stats, pl = b.build(st, 0)
            dt = time.perf_counter() - t
            b.pipe_ms = 15.0
            hlen = int.from_bytes(msg[:4], "little")
            hdr = json.loads(msg[4:4 + hlen])
            parts = {}
            for sh in hdr["sheets"]:
                parts[f"{sh['name']} colour"] = sum(t["data"][1] for t in sh["tiles"])
                parts[f"{sh['name']} depth"] = sh["depth"]["data"][1]
                parts[f"{sh['name']} topology"] = sh["conn"]["data"][1]
            parts["collision brick"] = hdr["brick"]["data"][1]
            parts["header"] = hlen
            # classic reference: one 1080p frame of exactly the client's view
            r, u, f = E.basis_from_yaw_pitch(yaw, pitch)
            v = E.make_view(pos, r, u, f, -1, 1, -9 / 16, 9 / 16, (0, 0, 1920, 1080))
            rgb, _, _ = be.render(E.pack_params([v]), 1920, 1080, E.MODE_COLOR)
            classic = len(b.jpeg.encode_host(rgb, 85))
            rows.append(dict(scene=sname, motion=motion, total=len(msg), classic_jpeg_1080p=classic, parts=parts,
                             focus=f"{stats['W']}x{stats['H']}", margins=stats["margins_deg"], band=stats["band"],
                             cpu_build_ms=round(dt * 1000)))
            print(rows[-1], flush=True)
            if motion == "standing":
                # depth codec comparison on the focus geometry buffer
                Pg = E.pack_params(E.scale_views([pl["front"]], 2))
                _, dc, geo = be.render(Pg, stats["W"] // 2, stats["H"] // 2, E.MODE_GEO | E.MODE_GEOONLY)
                c = depth_codecs(dc); c["scene"] = sname; c["texels"] = dc.size
                bits = be.conn(Pg, geo, stats["W"] // 2, stats["H"] // 2)
                c["topology deflate"] = len(E.encode_bytes(bits))
                codec_rows.append(c)
                print(c, flush=True)
    json.dump(dict(shells=rows, depth_codecs=codec_rows), open(f"{RESULTS}/bandwidth.json", "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
