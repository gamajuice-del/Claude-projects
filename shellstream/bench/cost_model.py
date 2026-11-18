"""T4 cost model (no GPU available in the development container).

1. Count signed-distance evaluations per pixel for every pass of a representative shell (instrumented
   CPU build of the *same* kernel.cu, -DSS_COUNT).
2. Count SASS instructions of one map() evaluation on sm_75 (ptxas -> cubin, size of the
   .text.ss_mapbench section / 16 bytes per Turing instruction).
3. Convert to T4 time with an explicit throughput model:
      T4: 40 SMs x 4 schedulers, 1 warp-instruction / clock / scheduler (FP32 pipe is 16 lanes -> 0.5),
      sustained clock under the 70 W cap ~ 1.25-1.45 GHz, SIMT efficiency of sphere tracing 45-70 %.
   The notebook's benchmark cell replaces these estimates with measurements on the real T4s.
"""
import ctypes
import json
import math
import os
import subprocess
import sys
import time

import numpy as np

from common import E, RESULTS, ROOT
from cuda_check import find, nvrtc_compile


def build_counting_lib():
    so = os.path.join(ROOT, "build", "ss_count.so")
    subprocess.check_call(["g++", "-O2", "-fopenmp", "-shared", "-fPIC", "-DSS_CPU", "-DSS_COUNT", "-x", "c++",
                           os.path.join(ROOT, "kernel.cu"), "-o", so])
    lib = ctypes.CDLL(so)
    vp = ctypes.c_void_p
    lib.ss_render.argtypes = [vp, vp, vp, vp, vp, vp, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    lib.ss_conn.argtypes = [vp, vp, vp, ctypes.c_int, ctypes.c_int]
    lib.ss_evals.restype = ctypes.c_ulonglong
    return lib


def sass_instructions():
    src = open(os.path.join(ROOT, "kernel.cu")).read()
    ptx, _ = nvrtc_compile(src, ["--gpu-architecture=compute_75", "-use_fast_math", "-std=c++14"])
    p = os.path.join(RESULTS, "k.ptx"); open(p, "w").write(ptx)
    cub = os.path.join(RESULTS, "k.cubin")
    subprocess.check_call([find("nvidia/cuda_nvcc/bin/ptxas"), "-arch=sm_75", "-O3", p, "-o", cub])
    out = subprocess.run(["readelf", "-S", "-W", cub], capture_output=True, text=True).stdout
    sizes = {}
    for line in out.splitlines():
        if ".text." in line:
            parts = line.split()
            name = [x for x in parts if x.startswith(".text.")][0][6:]
            idx = parts.index("." + "text." + name)
            sizes[name] = int(parts[idx + 4], 16) // 16      # Turing SASS: 128-bit instructions
    os.remove(p); os.remove(cub)
    return sizes


def count_frame(lib, W=1280, H=800, R=256, ds=2):
    """evals for a representative shell: plaza view with arches, pillars and monument"""
    pos, yaw, pitch = (4.0, 1.7, 26.0), 0.15, 0.0
    r, u, f = E.basis_from_yaw_pitch(yaw, pitch)
    tx = math.tan(math.radians(45 + 7)); ty = tx * H / W
    front = E.make_view(pos, r, u, f, -tx, tx, -ty, ty, (0, 0, W, H))
    P = E.pack_params([front], quality="high", spp=2)          # shipped default: 2 spp focus colour
    Pg = E.pack_params(E.scale_views([front], ds), quality="high", band_delta=0.4)
    Wg, Hg = W // ds, H // ds
    cv = E.cube_views(np.array(pos), R, ds)
    Po, Pog = E.pack_params(cv, quality="high"), E.pack_params(E.scale_views(cv, ds), quality="high")
    ptr = lambda a: None if a is None else a.ctypes.data_as(ctypes.c_void_p)
    res = {}

    def run(name, PP, w, h, mode, pre=None):
        rgb = np.empty((h, w, 3), np.uint8); dc = np.empty((h, w), np.uint16); geo = np.empty((h, w, 4), np.float32)
        lib.ss_evals_reset()
        t = time.perf_counter()
        lib.ss_render(ptr(PP), ptr(rgb), ptr(dc), ptr(geo), ptr(pre[1]) if pre else None, ptr(pre[0]) if pre else None,
                      w, h, mode, 0, h)
        res[name] = dict(pixels=w * h, evals=int(lib.ss_evals()), cpu_ms=(time.perf_counter() - t) * 1000)
        res[name]["evals_per_px"] = res[name]["evals"] / (w * h)
        return dc, geo

    run("front_color", P, W, H, E.MODE_COLOR)
    fdc, fgeo = run("front_geometry", Pg, Wg, Hg, E.MODE_GEO | E.MODE_GEOONLY)
    run("background_band", Pg, Wg, Hg, E.MODE_COLOR | E.MODE_GEO | E.MODE_BACK, pre=(fdc, fgeo))
    run("omni_color", Po, 3 * R, 2 * R, E.MODE_COLOR)
    run("omni_geometry", Pog, 3 * R // ds, 2 * R // ds, E.MODE_GEO | E.MODE_GEOONLY)
    run("classic_1080p", E.pack_params([E.make_view(pos, r, u, f, -1, 1, -1080 / 1920, 1080 / 1920, (0, 0, 1920, 1080))], spp=2),
        1920, 1080, E.MODE_COLOR)
    return res


def main():
    lib = build_counting_lib()
    sass = sass_instructions()
    passes = count_frame(lib)
    I_map = sass.get("ss_mapbench", 0) - 12      # minus load/store/index overhead of the wrapper
    # per-pixel instruction estimate: evals * I_map * branch factor (static count over-states the dynamic path)
    model = {}
    for clk_ghz, simt in ((1.25, 0.45), (1.35, 0.55), (1.45, 0.70)):
        thr = 40 * 4 * 0.75 * 32 * clk_ghz * 1e9 * simt   # thread-instructions per second
        tot = {}
        for k, v in passes.items():
            instr = v["evals"] * I_map * 0.8 * 1.15      # 0.8 dynamic/static, +15 % shading & control
            tot[k] = instr / thr * 1000
        model[f"{clk_ghz}GHz_simt{simt}"] = {k: round(x, 2) for k, x in tot.items()}
    shell = ["front_color", "front_geometry", "background_band", "omni_color", "omni_geometry"]
    for k, v in model.items():
        v["shell_total_1gpu"] = round(sum(v[x] for x in shell), 2)
        v["shell_total_2gpu_balanced"] = round(sum(v[x] for x in shell) / 2, 2)
    out = dict(sass_instructions=sass, map_instructions=I_map, passes=passes, t4_ms=model)
    print(json.dumps(out, indent=1))
    json.dump(out, open(os.path.join(RESULTS, "cost_model.json"), "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
