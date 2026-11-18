"""ShellStream engine: render backends, camera math, shell construction and codecs.

Backends
  * CudaBackend  - CuPy RawModule (NVRTC) on one GPU; one instance per T4.
  * CpuBackend   - the very same kernel.cu compiled by g++ -fopenmp (fallback + test oracle).
"""
from __future__ import annotations

import ctypes
import hashlib
import math
import os
import subprocess
import threading
import time
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KERNEL_PATH = os.path.join(HERE, "kernel.cu")

# ---- parameter layout (must match kernel.cu) ---------------------------------------
NV_MAX, NL_MAX = 8, 24
P_HDR, P_VSTRIDE = 32, 24
P_LIGHT0 = P_HDR + NV_MAX * P_VSTRIDE
P_LSTRIDE = 8
P_TOTAL = P_LIGHT0 + NL_MAX * P_LSTRIDE
H_TIME, H_NVIEWS, H_NLIGHTS, H_FLAGS, H_ZNEAR, H_STEPS = 0, 1, 2, 3, 4, 5
H_BAND_DELTA, H_SHADOW_ST, H_REFL_ST, H_MAXDIST, H_SUN, H_SPP = 6, 7, 8, 9, 10, 13
F_SHADOW, F_AO, F_REFL, F_GLOW = 1, 2, 4, 8
MODE_COLOR, MODE_GEO, MODE_BACK, MODE_GEOONLY = 1, 2, 4, 8
ZNEAR = 0.05

QUALITY = {
    # name: (flags, primary steps, shadow steps, reflection steps)
    "ultra": (F_SHADOW | F_AO | F_REFL | F_GLOW, 160, 40, 72),
    "high": (F_SHADOW | F_AO | F_REFL | F_GLOW, 128, 28, 56),
    "medium": (F_SHADOW | F_REFL | F_GLOW, 96, 20, 40),
    "low": (F_GLOW, 72, 0, 0),
    "high_noreflect": (F_SHADOW | F_AO | F_GLOW, 128, 28, 0),   # ablation: no view-dependent mirror term
}


# ====================================================================== camera math
def basis_from_yaw_pitch(yaw: float, pitch: float):
    """yaw=0 looks down -Z; positive yaw turns left (counter-clockwise seen from above)."""
    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw), math.sin(yaw)
    f = np.array([-sy * cp, sp, -cy * cp], np.float64)
    r = np.array([cy, 0.0, -sy], np.float64)
    u = np.cross(r, f)
    return r, u / np.linalg.norm(u), f


def make_view(origin, r, u, f, l, rr, b, t, rect):
    return dict(o=np.asarray(origin, np.float64), r=np.asarray(r, np.float64), u=np.asarray(u, np.float64),
                f=np.asarray(f, np.float64), tan=(float(l), float(rr), float(b), float(t)),
                rect=tuple(int(v) for v in rect))


CUBE_FACES = [  # (forward, up)
    ((1, 0, 0), (0, 1, 0)), ((-1, 0, 0), (0, 1, 0)),
    ((0, 1, 0), (0, 0, 1)), ((0, -1, 0), (0, 0, -1)),
    ((0, 0, 1), (0, 1, 0)), ((0, 0, -1), (0, 1, 0)),
]


def cube_views(origin, R: int, ds: int):
    """6 cube faces packed in a 3x2 atlas of RxR faces. Faces are slightly widened so that the
    client meshes (which span texel centres only) overlap instead of leaving cracks."""
    dr = R // ds
    tn = 1.0 / (1.0 - 1.0 / dr) + 1.5 / dr
    views = []
    for k, (f, up) in enumerate(CUBE_FACES):
        f = np.array(f, np.float64); up = np.array(up, np.float64)
        r = np.cross(f, up); r /= np.linalg.norm(r)
        u = np.cross(r, f)
        rect = ((k % 3) * R, (k // 3) * R, R, R)
        views.append(make_view(origin, r, u, f, -tn, tn, -tn, tn, rect))
    return views


def scale_views(views, s: int):
    out = []
    for v in views:
        x0, y0, w, h = v["rect"]
        assert x0 % s == 0 and y0 % s == 0 and w % s == 0 and h % s == 0, (v["rect"], s)
        nv = dict(v); nv["rect"] = (x0 // s, y0 // s, w // s, h // s)
        out.append(nv)
    return out


# ====================================================================== the world (static info)
STATIC_LIGHTS = []
_NEON = [(0.10, 0.85, 1.00), (1.00, 0.15, 0.65), (1.00, 0.55, 0.10), (0.45, 1.00, 0.25),
         (0.65, 0.30, 1.00), (1.00, 0.90, 0.35), (0.20, 0.45, 1.00), (1.00, 0.30, 0.25)]
for _k in range(8):
    _a = _k * 2 * math.pi / 8
    _c = _NEON[(_k + 8) % 8]
    STATIC_LIGHTS.append(((9.5 * math.cos(_a), 5.6, 9.5 * math.sin(_a)), tuple(2.2 * x for x in _c), 11.0))
STATIC_LIGHTS.append(((0.0, 3.3, 0.0), (0.4, 2.0, 2.6), 9.0))


def pack_params(views, lights=(), t=0.0, quality="high", band_delta=0.3, spp=1):
    flags, steps, sst, rst = QUALITY[quality]
    P = np.zeros(P_TOTAL, np.float32)
    P[H_TIME] = t
    P[H_NVIEWS] = len(views)
    all_lights = list(STATIC_LIGHTS) + list(lights)
    all_lights = all_lights[:NL_MAX]
    P[H_NLIGHTS] = len(all_lights)
    P[H_FLAGS] = flags
    P[H_ZNEAR] = ZNEAR
    P[H_STEPS] = steps
    P[H_BAND_DELTA] = band_delta
    P[H_SHADOW_ST] = sst
    P[H_REFL_ST] = rst
    P[H_MAXDIST] = 450.0
    P[H_SUN:H_SUN + 3] = (-0.35, 0.55, -0.75)
    P[H_SPP] = spp
    assert len(views) <= NV_MAX
    for k, v in enumerate(views):
        b = P_HDR + k * P_VSTRIDE
        P[b:b + 3] = v["o"]; P[b + 3:b + 6] = v["r"]; P[b + 6:b + 9] = v["u"]; P[b + 9:b + 12] = v["f"]
        P[b + 12:b + 16] = v["tan"]
        P[b + 16:b + 20] = v["rect"]
    for k, (pos, col, rad) in enumerate(all_lights):
        b = P_LIGHT0 + k * P_LSTRIDE
        P[b:b + 3] = pos; P[b + 3:b + 6] = col; P[b + 6] = rad
    return P


# ====================================================================== backends
class CpuBackend:
    """kernel.cu compiled for the host CPU (OpenMP).  Arrays are numpy."""
    name = "cpu"

    def __init__(self, build_dir=None, threads=None):
        # OpenMP workers must sleep (not spin) between kernels, or they starve the network/event threads
        os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")
        if threads:
            os.environ["OMP_NUM_THREADS"] = str(threads)
        src = open(KERNEL_PATH, "rb").read()
        key = hashlib.sha1(src).hexdigest()[:12]
        build_dir = build_dir or os.path.join(HERE, "build")
        os.makedirs(build_dir, exist_ok=True)
        so = os.path.join(build_dir, f"ss_kernel_{key}.so")
        if not os.path.exists(so):
            cmd = ["g++", "-O3", "-march=native", "-ffast-math", "-fopenmp", "-shared", "-fPIC", "-DSS_CPU",
                   "-x", "c++", KERNEL_PATH, "-o", so]
            subprocess.check_call(cmd)
        self.lib = ctypes.CDLL(so)
        vp = ctypes.c_void_p
        self.lib.ss_render.argtypes = [vp, vp, vp, vp, vp, vp, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
        self.lib.ss_conn.argtypes = [vp, vp, vp, ctypes.c_int, ctypes.c_int]
        self.lib.ss_brick.argtypes = [vp, vp, vp, ctypes.c_int]
        self.lib.ss_fill.argtypes = [vp, vp, vp, ctypes.c_int, ctypes.c_int]
        self.lib.ss_sdf.argtypes = [ctypes.c_float] * 3
        self.lib.ss_sdf.restype = ctypes.c_float
        self.device_name = "CPU (%s threads)" % (os.environ.get("OMP_NUM_THREADS") or os.cpu_count())

    @staticmethod
    def _p(a):
        return None if a is None else a.ctypes.data_as(ctypes.c_void_p)

    def alloc(self, shape, dtype):
        return np.empty(shape, dtype)

    def render(self, P, W, H, mode, rgb=None, dcode=None, geo=None, pre_geo=None, pre_code=None, rows=None):
        P = np.ascontiguousarray(P, np.float32)
        if mode & MODE_COLOR and rgb is None:
            rgb = np.empty((H, W, 3), np.uint8)
        if mode & MODE_GEO and dcode is None:
            dcode = np.empty((H, W), np.uint16)
            geo = np.empty((H, W, 4), np.float32)
        y0, y1 = rows or (0, H)
        self.lib.ss_render(self._p(P), self._p(rgb), self._p(dcode), self._p(geo), self._p(pre_geo),
                           self._p(pre_code), W, H, mode, y0, y1)
        return rgb, dcode, geo

    def conn(self, P, geo, W, H):
        bits = np.empty((H, W), np.uint8)
        self.lib.ss_conn(self._p(np.ascontiguousarray(P, np.float32)), self._p(geo), self._p(bits), W, H)
        return bits

    def fill(self, rgb, code, W, H, tag=None):
        out = np.empty_like(rgb)
        self.lib.ss_fill(self._p(rgb), self._p(out), self._p(code), W, H)
        return out

    def brick(self, P, B, n):
        out = np.empty(n, np.int8)
        self.lib.ss_brick(self._p(np.ascontiguousarray(P, np.float32)), self._p(np.ascontiguousarray(B, np.float32)),
                          self._p(out), n)
        return out

    def sdf(self, x, y, z):
        return float(self.lib.ss_sdf(x, y, z))

    # host transfer helpers (no-ops on CPU)
    def to_host(self, a):
        return a

    def sync(self):
        pass


class CudaBackend:
    """kernel.cu compiled by NVRTC through CuPy, bound to one GPU with its own stream."""
    name = "cuda"

    def __init__(self, device_id=0, block=(16, 8)):
        import cupy as cp
        self.cp = cp
        self.device_id = device_id
        self.block = block
        src = open(KERNEL_PATH).read()
        with cp.cuda.Device(device_id):
            self.stream = cp.cuda.Stream(non_blocking=True)
            self.mod = cp.RawModule(code=src, options=("-use_fast_math", "-std=c++14"))
            self.k_render = self.mod.get_function("ss_render")
            self.k_conn = self.mod.get_function("ss_conn")
            self.k_brick = self.mod.get_function("ss_brick")
            self.k_fill = self.mod.get_function("ss_fill")
            self.P = cp.zeros(P_TOTAL, cp.float32)
            self.B = cp.zeros(8, cp.float32)
            props = cp.cuda.runtime.getDeviceProperties(device_id)
            self.device_name = props["name"].decode() if isinstance(props["name"], bytes) else str(props["name"])
        self._bufs = {}

    def _buf(self, key, shape, dtype):
        cp = self.cp
        b = self._bufs.get(key)
        if b is None or b.shape != tuple(shape) or b.dtype != dtype:
            with cp.cuda.Device(self.device_id):
                b = cp.empty(shape, dtype)
            self._bufs[key] = b
        return b

    def render(self, P, W, H, mode, rgb=None, dcode=None, geo=None, pre_geo=None, pre_code=None, rows=None, tag="x"):
        cp = self.cp
        with cp.cuda.Device(self.device_id), self.stream:
            Pd = self._buf(("P", tag), (P_TOTAL,), cp.float32)
            Pd.set(np.ascontiguousarray(P, np.float32), stream=self.stream)
            if mode & MODE_COLOR and rgb is None:
                rgb = self._buf(("rgb", tag), (H, W, 3), cp.uint8)
            if mode & MODE_GEO and dcode is None:
                dcode = self._buf(("dc", tag), (H, W), cp.uint16)
                geo = self._buf(("geo", tag), (H, W, 4), cp.float32)
            y0, y1 = rows or (0, H)
            bx, by = self.block
            grid = ((W + bx - 1) // bx, (y1 - y0 + by - 1) // by)
            null = cp.uint64(0)
            args = (Pd, rgb if rgb is not None else null, dcode if dcode is not None else null,
                    geo if geo is not None else null, pre_geo if pre_geo is not None else null,
                    pre_code if pre_code is not None else null,
                    np.int32(W), np.int32(H), np.int32(mode), np.int32(y0), np.int32(y1))
            self.k_render(grid, (bx, by), args)
        return rgb, dcode, geo

    def conn(self, P, geo, W, H, tag="x"):
        cp = self.cp
        with cp.cuda.Device(self.device_id), self.stream:
            Pd = self._buf(("Pc", tag), (P_TOTAL,), cp.float32)
            Pd.set(np.ascontiguousarray(P, np.float32), stream=self.stream)
            bits = self._buf(("bits", tag), (H, W), cp.uint8)
            grid = ((W + 15) // 16, (H + 7) // 8)
            self.k_conn(grid, (16, 8), (Pd, geo, bits, np.int32(W), np.int32(H)))
        return bits

    def fill(self, rgb, code, W, H, tag="x"):
        cp = self.cp
        with cp.cuda.Device(self.device_id), self.stream:
            out = self._buf(("fill", tag), (H, W, 3), cp.uint8)
            self.k_fill(((W + 15) // 16, (H + 7) // 8), (16, 8), (rgb, out, code, np.int32(W), np.int32(H)))
        return out

    def brick(self, P, B, n):
        cp = self.cp
        with cp.cuda.Device(self.device_id), self.stream:
            Pd = self._buf(("Pb",), (P_TOTAL,), cp.float32)
            Pd.set(np.ascontiguousarray(P, np.float32), stream=self.stream)
            self.B.set(np.ascontiguousarray(B, np.float32), stream=self.stream)
            out = self._buf(("brick",), (n,), cp.int8)
            self.k_brick(((n + 255) // 256,), (256,), (Pd, self.B, out, np.int32(n)))
        return out

    def to_host(self, a):
        with self.cp.cuda.Device(self.device_id):
            return self.cp.asnumpy(a, stream=self.stream)

    def sync(self):
        self.stream.synchronize()


def cuda_device_count():
    try:
        import cupy as cp
        return cp.cuda.runtime.getDeviceCount()
    except Exception:
        return 0


# ====================================================================== codecs
class JpegEncoder:
    """GPU nvJPEG (torchvision.io.encode_jpeg on CUDA tensors) when available, else CPU."""

    def __init__(self, quality=85, prefer_gpu=True):
        self.quality = quality
        self.gpu_ok = False
        self.cpu_impl = None
        if prefer_gpu:
            try:
                import torch, torchvision  # noqa: F401
                from torchvision.io import encode_jpeg
                if torch.cuda.is_available():
                    x = torch.zeros((3, 16, 16), dtype=torch.uint8, device="cuda:0")
                    encode_jpeg(x, quality=quality)
                    self.gpu_ok = True
            except Exception as e:  # pragma: no cover - depends on the platform
                self.gpu_error = repr(e)
        try:
            import simplejpeg
            self.cpu_impl = ("simplejpeg", simplejpeg)
        except Exception:
            try:
                import cv2
                self.cpu_impl = ("cv2", cv2)
            except Exception:
                from PIL import Image
                self.cpu_impl = ("pil", Image)

    def encode_host(self, rgb: np.ndarray, quality=None) -> bytes:
        q = quality or self.quality
        kind, mod = self.cpu_impl
        rgb = np.ascontiguousarray(rgb)
        if kind == "simplejpeg":
            return mod.encode_jpeg(rgb, quality=q, colorspace="RGB", colorsubsampling="420", fastdct=True)
        if kind == "cv2":
            ok, buf = mod.imencode(".jpg", rgb[:, :, ::-1], [mod.IMWRITE_JPEG_QUALITY, q])
            return buf.tobytes()
        import io
        b = io.BytesIO()
        mod.fromarray(rgb).save(b, format="JPEG", quality=q)
        return b.getvalue()

    def encode_device(self, rgb_dev, device_id: int, quality=None) -> bytes:
        """rgb_dev: CuPy (H,W,3) uint8 array on `device_id`."""
        q = quality or self.quality
        if self.gpu_ok:
            try:
                import torch
                from torchvision.io import encode_jpeg
                with torch.cuda.device(device_id):
                    t = torch.from_dlpack(rgb_dev)
                    t = t.permute(2, 0, 1).contiguous()
                    out = encode_jpeg(t, quality=q)
                    return out.cpu().numpy().tobytes()
            except Exception as e:  # fall back permanently
                self.gpu_ok = False
                self.gpu_error = repr(e)
        import cupy as cp
        with cp.cuda.Device(device_id):
            return self.encode_host(cp.asnumpy(rgb_dev), q)


def zigzag16(r):
    r = r.astype(np.int16).astype(np.int32)
    return ((r << 1) ^ (r >> 31)).astype(np.uint16)


def _med_neighbours(a):
    L = np.zeros_like(a); L[:, 1:] = a[:, :-1]
    U = np.zeros_like(a); U[1:, :] = a[:-1, :]
    UL = np.zeros_like(a); UL[1:, 1:] = a[:-1, :-1]
    return L, U, UL


def _med(L, U, UL):
    mx, mn = np.maximum(L, U), np.minimum(L, U)
    return np.where(UL >= mx, mn, np.where(UL <= mn, mx, L + U - UL))


DEPTH_LEVEL = 6


def encode_depth(code: np.ndarray, level=None) -> bytes:
    """Lossless 16-bit inverse-depth coding: JPEG-LS median edge detector (MED) prediction, zig-zag residuals,
    low/high byte planes, deflate.  (Chosen over 1st/2nd-order and planar predictors by bench/codec_explore.py.)"""
    a = code.astype(np.int32)
    r = (a - _med(*_med_neighbours(a))) & 0xFFFF
    zz = zigzag16(r.astype(np.uint16).view(np.int16))
    planes = np.concatenate([(zz & 0xFF).astype(np.uint8).ravel(), (zz >> 8).astype(np.uint8).ravel()])
    return zlib.compress(planes.tobytes(), DEPTH_LEVEL if level is None else level)


def decode_depth(buf: bytes, h: int, w: int) -> np.ndarray:
    """Reference decoder (vectorised along anti-diagonals: every texel depends on its left/up/up-left)."""
    planes = np.frombuffer(zlib.decompress(buf), np.uint8)
    n = h * w
    zz = (planes[:n].astype(np.int64) | (planes[n:].astype(np.int64) << 8)).reshape(h, w)
    r = (zz >> 1) ^ -(zz & 1)
    a = np.zeros((h + 1, w + 1), np.int64)              # 1-texel zero border = the encoder's padding
    for dg in range(h + w - 1):
        y = np.arange(max(0, dg - w + 1), min(h, dg + 1))
        x = dg - y
        L, U, UL = a[y + 1, x], a[y, x + 1], a[y, x]
        mx, mn = np.maximum(L, U), np.minimum(L, U)
        p = np.where(UL >= mx, mn, np.where(UL <= mn, mx, L + U - UL))
        a[y + 1, x + 1] = (r[y, x] + p) & 0xFFFF
    return a[1:, 1:].astype(np.uint16)


def encode_bytes(a: np.ndarray, level=1) -> bytes:
    return zlib.compress(np.ascontiguousarray(a).tobytes(), level)


# ====================================================================== shell construction
import json
from concurrent.futures import ThreadPoolExecutor


def _round16(x, lo=64):
    return max(lo, int(round(x / 16.0)) * 16)


class ShellBuilder:
    """Turns the client's reported state into one 'shell' message.

    Work is expressed as tasks on 1..N backends.  With two GPUs:
        GPU0 : top stripe of the focus layer (colour)
        GPU1 : bottom stripe + focus geometry/topology + background layer + omni cube + collision brick
    The stripe split is re-balanced every frame from measured per-GPU times (split-frame rendering).
    """

    DEFAULTS = dict(
        focus_budget=1.0e6,     # max colour pixels of the focus layer
        omni_R=256,             # cube face size (px)
        ds=2,                   # colour px per geometry texel
        quality="high",
        spp=2,                  # anti-aliasing of the focus colour (rotated grid); shells get resampled, so pre-filter
        omni_spp=1,
        jpeg_q=85,
        omni_q=80,
        back=True,
        omni=True,
        brick=True,
        base_margin_deg=(7.0, 6.0),
        max_lookahead=0.40,
    )

    def __init__(self, backends, jpeg: JpegEncoder | None = None, **cfg):
        self.be = list(backends)
        self.cfg = dict(self.DEFAULTS); self.cfg.update(cfg)
        self.jpeg = jpeg or JpegEncoder(self.cfg["jpeg_q"], prefer_gpu=self.be[0].name == "cuda")
        self.split = 0.5
        self.pool = ThreadPoolExecutor(max(4, len(self.be) + 2))
        self.pipe_ms = 30.0
        self.lock = threading.Lock()

    # ------------------------------------------------------------------ planning
    def plan(self, st: dict) -> dict:
        c = self.cfg
        mode = st.get("mode", "shell")
        fov = math.radians(float(st.get("fov", 90.0)))
        aspect = float(st.get("aspect", 16 / 9))
        vw = float(st.get("vw", 1280))
        fovy = 2 * math.atan(math.tan(fov / 2) / aspect)
        pos = np.array(st.get("pos", (0, 1.7, 24)), np.float64)
        vel = np.array(st.get("vel", (0, 0, 0)), np.float64)
        yaw, pitch = float(st.get("yaw", 0.0)), float(st.get("pitch", 0.0))
        ppt = vw / (2 * math.tan(fov / 2))                    # client pixels per tan unit
        if mode == "classic":
            center, yc, pc, mx, my, L = pos, yaw, pitch, 0.0, 0.0, 0.0
            tx, ty = math.tan(fov / 2), math.tan(fovy / 2)
        else:
            rtt = float(st.get("rtt", 50.0))
            interval = float(st.get("interval", 33.0))
            L = (rtt * 0.5 + self.pipe_ms + 0.5 * interval) / 1000.0
            L = min(max(L, 0.0), c["max_lookahead"])
            sp = np.linalg.norm(vel)
            if sp > 15: vel = vel * (15 / sp)
            center = pos + vel * L
            yr, pr = float(st.get("yawRate", 0.0)), float(st.get("pitchRate", 0.0))
            dy = max(-1.0, min(1.0, yr * L * 0.8))
            dp = max(-0.6, min(0.6, pr * L * 0.8))
            yc = yaw + dy
            pc = max(-1.45, min(1.45, pitch + dp))
            mx = math.radians(c["base_margin_deg"][0]) + abs(dy) + abs(yr) * L * 0.5
            my = math.radians(c["base_margin_deg"][1]) + abs(dp) + abs(pr) * L * 0.5
            mx, my = min(mx, math.radians(50)), min(my, math.radians(40))
            tx = math.tan(min(fov / 2 + mx, math.radians(76)))
            ty = math.tan(min(fovy / 2 + my, math.radians(72)))
        Wm, Hm = 2 * tx * ppt, 2 * ty * ppt
        s = min(1.0, math.sqrt(c["focus_budget"] / (Wm * Hm)))
        W, H = _round16(Wm * s), _round16(Hm * s)
        if W % (2 * c["ds"]) or H % (2 * c["ds"]):
            raise ValueError("bad size")
        r, u, f = basis_from_yaw_pitch(yc, pc)
        front = make_view(center, r, u, f, -tx, tx, -ty, ty, (0, 0, W, H))
        vlen = float(np.linalg.norm(vel))
        # disocclusion band: unpredicted translation the shell must survive (direction changes, jumps)
        band = min(1.5, 0.5 + 0.6 * vlen * max(L, 0.05))
        return dict(mode=mode, center=center, yaw=yc, pitch=pc, margins=(mx, my), L=L, W=W, H=H,
                    front=front, band=band, lights=st.get("lights", []), t=float(st.get("time", time.time() % 1000)))

    # ------------------------------------------------------------------ execution
    def _sheet(self, name, role, W, H, ds, views):
        return dict(name=name, role=role, W=W, H=H, ds=ds, views=views, tiles=[], depth=None, conn=None)

    def build(self, st: dict, frame_id: int = 0):
        t_start = time.perf_counter()
        c = self.cfg
        pl = self.plan(st)
        W, H, ds = pl["W"], pl["H"], c["ds"]
        lights = [((l[0], l[1], l[2]), (l[3], l[4], l[5]), l[6]) for l in pl["lights"][: NL_MAX - len(STATIC_LIGHTS)]]
        q, t = c["quality"], pl["t"]
        shell_mode = pl["mode"] != "classic"
        front_views = [pl["front"]]
        Pf = pack_params(front_views, lights, t, q, spp=c["spp"])
        Pfg = pack_params(scale_views(front_views, ds), lights, t, q, band_delta=pl["band"])
        Wg, Hg = W // ds, H // ds
        R = c["omni_R"]
        omni_views = cube_views(pl["center"], R, ds) if (shell_mode and c["omni"]) else None
        do_back = shell_mode and c["back"]
        nb = len(self.be)

        # stripe split of the focus colour between backends 0 and 1
        if nb >= 2:
            s_rows = int(round(self.split * H / 16)) * 16
            s_rows = max(16, min(H - 16, s_rows))
            stripes = [(0, (0, s_rows)), (1, (s_rows, H))]
        else:
            stripes = [(0, (0, H))]
        geo_dev = nb - 1                       # backend that owns geometry / background / omni / brick

        results = {"tiles": {}, "host": {}, "times": [0.0] * nb, "kern": {}}

        def run_backend(bi):
            be = self.be[bi]
            tb = time.perf_counter()
            out = {}
            # focus colour stripe(s)
            for sb, rows in stripes:
                if sb != bi:
                    continue
                k0 = time.perf_counter()
                rgb, _, _ = be.render(Pf, W, H, MODE_COLOR, rows=rows, **({"tag": "front"} if be.name == "cuda" else {}))
                out[("front_rgb", rows)] = rgb
                results["kern"][f"front_rows_{rows[0]}"] = time.perf_counter() - k0
            if bi == geo_dev:
                kw = {"tag": "fg"} if be.name == "cuda" else {}
                _, fdc, fgeo = be.render(Pfg, Wg, Hg, MODE_GEO | MODE_GEOONLY, **kw)
                out["front_dc"] = fdc
                out["front_conn"] = be.conn(Pfg, fgeo, Wg, Hg, **({"tag": "f"} if be.name == "cuda" else {}))
                if do_back:
                    kw = {"tag": "back"} if be.name == "cuda" else {}
                    brgb, bdc, bgeo = be.render(Pfg, Wg, Hg, MODE_COLOR | MODE_GEO | MODE_BACK, pre_geo=fgeo, pre_code=fdc, **kw)
                    out["back_rgb"], out["back_dc"] = be.fill(brgb, bdc, Wg, Hg), bdc
                    out["back_conn"] = be.conn(Pfg, bgeo, Wg, Hg, **({"tag": "b"} if be.name == "cuda" else {}))
                if omni_views is not None:
                    Po = pack_params(omni_views, lights, t, q, spp=c["omni_spp"])
                    Pog = pack_params(scale_views(omni_views, ds), lights, t, q)
                    kw = {"tag": "omni"} if be.name == "cuda" else {}
                    orgb, _, _ = be.render(Po, 3 * R, 2 * R, MODE_COLOR, **kw)
                    kw = {"tag": "og"} if be.name == "cuda" else {}
                    _, odc, ogeo = be.render(Pog, 3 * R // ds, 2 * R // ds, MODE_GEO | MODE_GEOONLY, **kw)
                    out["omni_rgb"], out["omni_dc"] = orgb, odc
                    out["omni_conn"] = be.conn(Pog, ogeo, 3 * R // ds, 2 * R // ds, **({"tag": "o"} if be.name == "cuda" else {}))
                if c["brick"]:
                    cell = 0.25
                    nx, ny, nz = 48, 18, 48
                    feet = pl["center"] - np.array([0, 1.7, 0])
                    o = np.floor((feet - np.array([nx, 4, nz]) * cell / np.array([2, 1, 2])) / cell) * cell
                    o[1] = math.floor((feet[1] - 1.0) / cell) * cell
                    B = np.array([o[0], o[1], o[2], cell, nx, ny, nz, 0], np.float32)
                    out["brick"] = be.brick(Pf, B, nx * ny * nz)
                    out["brick_meta"] = dict(o=[float(x) for x in o], cell=cell, n=[nx, ny, nz])
            be.sync()
            t_gpu = time.perf_counter() - tb
            # encode colour on the device that rendered it, pull small arrays to the host
            enc = {}
            for key, val in out.items():
                if isinstance(key, tuple) and key[0] == "front_rgb":
                    y0, y1 = key[1]
                    enc[key] = self._jpeg(be, bi, val[y0:y1], c["jpeg_q"])
                elif key in ("back_rgb",):
                    enc[key] = self._jpeg(be, bi, val, c["jpeg_q"])
                elif key in ("omni_rgb",):
                    enc[key] = self._jpeg(be, bi, val, c["omni_q"])
                elif key == "brick_meta":
                    enc[key] = val
                else:
                    enc[key] = be.to_host(val)
            results["times"][bi] = t_gpu
            results["enc_ms_%d" % bi] = (time.perf_counter() - tb - t_gpu) * 1000
            return enc

        if nb == 1:
            encs = [run_backend(0)]
        else:
            futs = [self.pool.submit(run_backend, bi) for bi in range(nb)]
            encs = [f.result() for f in futs]
        t_gpu_done = time.perf_counter()
        merged = {}
        for e in encs:
            merged.update(e)

        # host-side lossless coding (zlib releases the GIL -> parallel)
        jobs = {}
        for k in ("front", "back", "omni"):
            if f"{k}_dc" in merged:
                jobs[f"{k}_dc"] = self.pool.submit(encode_depth, merged[f"{k}_dc"])
                jobs[f"{k}_conn"] = self.pool.submit(encode_bytes, merged[f"{k}_conn"])
        if "brick" in merged:
            jobs["brick"] = self.pool.submit(encode_bytes, merged["brick"])
        blobs = {k: f.result() for k, f in jobs.items()}

        # rebalance the split so both GPUs finish together
        if nb >= 2:
            t0, t1 = results["times"][0], results["times"][1]
            rows0 = stripes[0][1][1]
            per_row = t0 / max(rows0, 1)
            if per_row > 0:
                target = rows0 + (t1 - t0) / (2 * per_row)
                self.split = 0.7 * self.split + 0.3 * min(0.95, max(0.05, target / H))

        # ---------------------------------------------------------- message
        payload = []
        off = [0]

        def put(b):
            o = off[0]; payload.append(b); off[0] += len(b)
            return [o, len(b)]

        def vjson(v, s=1):
            x0, y0, w, h = v["rect"]
            return dict(rect=[x0 // s, y0 // s, w // s, h // s], o=v["o"].tolist(), r=v["r"].tolist(),
                        u=v["u"].tolist(), f=v["f"].tolist(), tan=list(v["tan"]))

        sheets = []
        fr = dict(name="front", role="front" if shell_mode else "classic", W=W, H=H, ds=ds,
                  views=[vjson(pl["front"], ds)], tiles=[])
        for sb, (y0, y1) in stripes:
            jp = merged[("front_rgb", (y0, y1))]
            fr["tiles"].append(dict(data=put(jp), x=0, y=y0, w=W, h=y1 - y0))
        fr["depth"] = dict(data=put(blobs["front_dc"]), w=Wg, h=Hg)
        fr["conn"] = dict(data=put(blobs["front_conn"]))
        if "back_dc" in merged:
            bk = dict(name="back", role="back", W=Wg, H=Hg, ds=1, views=[vjson(pl["front"], ds)], tiles=[])
            bk["tiles"].append(dict(data=put(merged["back_rgb"]), x=0, y=0, w=Wg, h=Hg))
            bk["depth"] = dict(data=put(blobs["back_dc"]), w=Wg, h=Hg)
            bk["conn"] = dict(data=put(blobs["back_conn"]))
            sheets.append(bk)
        if "omni_dc" in merged:
            om = dict(name="omni", role="omni", W=3 * R, H=2 * R, ds=ds, views=[vjson(v, ds) for v in omni_views], tiles=[])
            om["tiles"].append(dict(data=put(merged["omni_rgb"]), x=0, y=0, w=3 * R, h=2 * R))
            om["depth"] = dict(data=put(blobs["omni_dc"]), w=3 * R // ds, h=2 * R // ds)
            om["conn"] = dict(data=put(blobs["omni_conn"]))
            sheets.insert(0, om)
        sheets.append(fr)
        brick = None
        if "brick" in blobs:
            brick = dict(merged["brick_meta"]); brick["data"] = put(blobs["brick"])
        t_end = time.perf_counter()
        build_ms = (t_end - t_start) * 1000
        self.pipe_ms = 0.8 * self.pipe_ms + 0.2 * build_ms
        stats = dict(build_ms=round(build_ms, 2), gpu_ms=[round(x * 1000, 2) for x in results["times"]],
                     host_ms=round((t_end - t_gpu_done) * 1000, 2), split=round(self.split, 3),
                     bytes=off[0], W=W, H=H, L_ms=round(pl["L"] * 1000, 1),
                     margins_deg=[round(math.degrees(m), 1) for m in pl["margins"]], band=round(pl["band"], 2),
                     enc_ms=[round(results.get("enc_ms_%d" % i, 0), 2) for i in range(nb)])
        hdr = dict(type="frame", id=frame_id, mode=pl["mode"], in_seq=st.get("seq", 0), in_t=st.get("t", 0),
                   center=pl["center"].tolist(), zn=ZNEAR, sheets=sheets, brick=brick, stats=stats)
        hb = json.dumps(hdr, separators=(",", ":")).encode()
        msg = b"".join([len(hb).to_bytes(4, "little"), hb] + payload)
        return msg, stats, pl

    def _jpeg(self, be, bi, arr, q):
        if be.name == "cuda":
            return self.jpeg.encode_device(arr, be.device_id, q)
        return self.jpeg.encode_host(arr, q)

    # ------------------------------------------------------------------ world info
    def spawn_points(self, n=160, seed=7):
        be = self.be[0]
        step = 2.0
        nx = nz = 151
        o = np.array([-150.0, 1.1, -150.0], np.float32)
        B = np.array([o[0], o[1], o[2], step, nx, 1, nz, 0], np.float32)
        d = be.to_host(be.brick(pack_params([]), B, nx * nz)).reshape(nz, nx).astype(np.float32) / 100.0
        be.sync()
        zz, xx = np.nonzero(d > 1.05)   # at y=1.1 the floor bounds d by 1.1, so >1.05 means open street
        rng = np.random.default_rng(seed)
        pts = np.stack([o[0] + xx * step, np.full(len(xx), 1.2), o[2] + zz * step], 1)
        # prefer points not too far from the plaza
        rad = np.hypot(pts[:, 0], pts[:, 2]).astype(np.float64)
        w = np.exp(-rad / 60.0); w /= w.sum()
        idx = rng.choice(len(pts), size=min(n, len(pts)), replace=False, p=w)
        return pts[idx].round(2).tolist()
