"""Depth codec exploration on real inverse-depth buffers (focus geometry, 3 scenes)."""
import io, json, math, time, zlib
import numpy as np
from PIL import Image
from common import E, RESULTS

SCENES = {"plaza": ((4.0, 1.7, 26.0), 0.15, 0.0), "pillars": ((1.5, 1.7, 11.5), -0.55, -0.05), "street": ((7.0, 1.7, 45.0), 0.0, 0.02)}
W, H = 1344 // 2, 752 // 2


def zz(r):  # int residual (mod 2^16) -> zig-zag uint16
    r = (r & 0xFFFF).astype(np.uint16).view(np.int16).astype(np.int32)
    return ((r << 1) ^ (r >> 31)).astype(np.uint16)


def pred(a, kind):
    a = a.astype(np.int32)
    p = np.zeros_like(a)
    L = np.zeros_like(a); L[:, 1:] = a[:, :-1]
    U = np.zeros_like(a); U[1:, :] = a[:-1, :]
    UL = np.zeros_like(a); UL[1:, 1:] = a[:-1, :-1]
    if kind == "left":
        p = L
    elif kind == "2nd-order":
        p[:, 1] = a[:, 0]; p[:, 2:] = 2 * a[:, 1:-1] - a[:, :-2]
    elif kind == "planar L+U-UL":
        p = L + U - UL
    elif kind == "MED (JPEG-LS)":
        mx, mn = np.maximum(L, U), np.minimum(L, U)
        p = np.where(UL >= mx, mn, np.where(UL <= mn, mx, L + U - UL))
    return a - p


def pack(z, layout):
    if layout == "planes":
        return np.concatenate([(z & 0xFF).astype(np.uint8).ravel(), (z >> 8).astype(np.uint8).ravel()]).tobytes()
    return z.astype("<u2").tobytes()


be = E.CpuBackend()
rows = []
for sname, (pos, yaw, pitch) in SCENES.items():
    r, u, f = E.basis_from_yaw_pitch(yaw, pitch)
    tx = math.tan(math.radians(52)); ty = tx * H / W
    v = E.make_view(pos, r, u, f, -tx, tx, -ty, ty, (0, 0, W, H))
    _, dc, _ = be.render(E.pack_params([v]), W, H, E.MODE_GEO | E.MODE_GEOONLY)
    b = io.BytesIO(); Image.fromarray(dc).save(b, format="PNG"); png = len(b.getvalue())
    rows.append(dict(scene=sname, codec="PNG 16-bit (reference)", level=None, bytes=png, ms=None))
    for kind in ["left", "2nd-order", "planar L+U-UL", "MED (JPEG-LS)"]:
        res = zz(pred(dc, kind))
        for layout in ["planes", "interleaved"]:
            data = pack(res, layout)
            for lvl in (1, 3, 6):
                t = time.perf_counter(); c = zlib.compress(data, lvl); ms = (time.perf_counter() - t) * 1000
                rows.append(dict(scene=sname, codec=f"{kind}, {layout}", level=lvl, bytes=len(c), ms=round(ms, 2)))
by = {}
for r_ in rows:
    k = (r_["codec"], r_["level"]); by.setdefault(k, []).append(r_)
summary = sorted([(sum(x["bytes"] for x in v) / 3, k, np.mean([x["ms"] or 0 for x in v])) for k, v in by.items()])
for avg, k, ms in summary[:14]:
    print(f"{avg/1024:7.1f} KiB  {ms:6.2f} ms  {k}")
json.dump(dict(rows=rows, texels=W * H), open(f"{RESULTS}/codec_explore.json", "w"), indent=1)
