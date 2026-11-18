"""Assemble ShellStream.ipynb from the sources in this directory (single source of truth).

    python build_notebook.py            -> ../ShellStream.ipynb
"""
import json
import os

import nbformat as nbf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "ShellStream.ipynb")


def src(rel):
    return open(os.path.join(HERE, rel)).read()


def load(name, default=None):
    p = os.path.join(HERE, "results", name)
    return json.load(open(p)) if os.path.exists(p) else default


def md(s):
    return nbf.v4.new_markdown_cell(s.strip("\n"))


def code(s):
    return nbf.v4.new_code_cell(s.strip("\n"))


def writefile(path, rel):
    return code(f"%%writefile {path}\n" + src(rel))


def dev_results_literal():
    keep = {}
    q = load("quality.json")
    if q:
        keep["quality"] = q
    lat = load("latency.json")
    if lat:
        keep["latency"] = {"steps": [{k: v for k, v in r.items() if not k.startswith("raw")} for r in lat["steps"]],
                           "stall": {m: {k: v for k, v in d.items()} for m, d in lat["stall"].items()}}
    bw = load("bandwidth.json")
    if bw:
        keep["bandwidth"] = bw
    cm = load("cost_model.json")
    if cm:
        keep["cost_model"] = {"map_instructions": cm["map_instructions"], "passes": cm["passes"], "t4_ms": cm["t4_ms"]}
    d = load("disocclusion.json")
    if d:
        keep["disocclusion"] = d
    hj = load("host.json")
    if hj:
        keep["host"] = hj
    for k in ("video", "codec_explore"):
        v = load(f"{k}.json")
        if v:
            keep[k] = v if k != "codec_explore" else {"texels": v["texels"], "rows": v["rows"]}
    cc = load("cuda_check.json")
    if cc:
        keep["cuda_check"] = {k: v for k, v in cc.items() if k.startswith("ss_")}
    return json.dumps(keep, separators=(",", ":"))


def build():
    nb = nbf.v4.new_notebook()
    nb.metadata = {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
        "kaggle": {"accelerator": "nvidiaTeslaT4", "isGpuEnabled": True, "isInternetEnabled": True},
    }
    summary = open(os.path.join(HERE, "results", "SUMMARY.md")).read() if os.path.exists(os.path.join(HERE, "results", "SUMMARY.md")) else ""
    C = []
    hero = os.path.join(HERE, "results", "hero.png")
    hero_md = ""
    attach = None
    if os.path.exists(hero):
        import base64, io
        from PIL import Image
        b = io.BytesIO(); Image.open(hero).convert("RGB").save(b, format="JPEG", quality=88)
        attach = {"hero.jpg": {"image/jpeg": base64.b64encode(b.getvalue()).decode()}}
        hero_md = "![ShellStream client: the browser re-projects a cloud-rendered shell; the glowing orbs are drawn locally, their light is rendered by the T4s](attachment:hero.jpg)\n"
    C.append(md(f"""
# ShellStream: latency-inverted cloud rendering on Kaggle T4 x2

{hero_md}
**Conventional cloud gaming ships finished frames.** Every mouse movement waits for a full network round trip,
a render, an encode and a decode before it becomes visible, so responsiveness can never be better than
the network.

**ShellStream inverts the pipeline.** The two T4s don't render *your frame*. They render a **shell**: a
wide-field, depth-carrying, topology-annotated, two-layer representation of the world around your
*predicted* position, valid for a whole neighbourhood of future viewpoints. The browser owns the camera,
the game logic and the final image. On every display refresh it re-projects the newest shell with the
camera pose sampled microseconds earlier. Looking, moving, jumping and picking things up become **local**
operations (about one display frame of latency, whatever the RTT). The network only decides how *fresh*
lighting and distant content are, and the human visual system is far more tolerant of that.

This notebook is the complete, runnable proof of concept:

| Part | What it is |
|---|---|
| `kernel.cu` | one source, two targets: an NVRTC/CUDA sphere-tracing renderer for the T4s, and the same code built with g++/OpenMP as a CPU fallback and test oracle |
| `engine.py` | shell planning (pose prediction, adaptive guard band, resolution budget), dual-GPU split-frame scheduling, nvJPEG / lossless geometry codecs |
| `server.py` | Tornado WebSocket server, ack-based flow control, event-driven updates, built-in network emulation |
| `client/` | WebGL2 browser client: topology-aware mesh warp, background layer, omni fallback, client-authoritative physics, local dynamic objects |

{summary}

**How to use it:** run the cells top to bottom. Sections 1 to 3 (bring-up, T4 benchmarks, analysis) need no
network exposure. Section 5 (playing it in your own browser) is **opt-in**: read the policy note first.
"""))
    if attach:
        C[0]["attachments"] = attach
    C.append(md("""
## 0. Kaggle usage and policy note

Kaggle's GPUs are provided for data-science and machine-learning work under Kaggle's Terms of Use and
Acceptable Use Policy. Secondary sources quote these as limiting use to *"internal, personal, non-commercial
use, and not on behalf of or for the benefit of any third party"* and as listing *"server farming"* and
*"activity unrelated to ML data science"* among prohibited uses. Kaggle has also blocked SSH or
remote-desktop tunnelling into kernels in the past. **Read [kaggle.com/terms](https://www.kaggle.com/terms)
yourself before section 5.** This notebook was designed accordingly:

* **Default mode (sections 1 to 4) is a self-contained benchmark.** It renders, encodes and measures on the
  T4s and reports numbers. No ports are exposed and no third party is served.
* **Interactive play (section 5) is off by default.** It needs a public tunnel, because Kaggle kernels
  accept no inbound connections. Turning it on means exposing a web endpoint from the kernel, which may
  conflict with the terms above. If you enable it at all, keep it for your own short personal sessions,
  never share the URL, and stop it when you're done.
* **The same code runs unchanged on any CUDA machine with T4s** (for example a cloud VM with 2x T4:
  `python shellstream/server.py --address 0.0.0.0`). That is the right home for anything beyond a personal
  experiment.
"""))
    C.append(code("""
# ---- settings -----------------------------------------------------------------------------
RUN_BENCHMARKS      = True    # section 2: per-pass and end-to-end timings on the T4s
RUN_SHOWCASE        = True    # section 1: render and visualise one shell
START_LOCAL_SERVER  = False   # section 5: start the WebSocket server inside this kernel (localhost only)
OPEN_PUBLIC_TUNNEL  = False   # section 5: expose it through a Cloudflare quick tunnel (read section 0 first)
REPRODUCE_BROWSER_EXPERIMENTS = False   # section 4: installs Chromium + Playwright and re-runs the client experiments

import os, sys, json, time, math, subprocess, platform
WORK = '/kaggle/working' if os.path.isdir('/kaggle/working') else os.getcwd()
ROOT = os.path.join(WORK, 'shellstream')
os.makedirs(os.path.join(ROOT, 'client'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'bench'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'results'), exist_ok=True)
print('working directory:', ROOT)
"""))
    C.append(code("""
# ---- environment probe (installs only what is missing) --------------------------------------
def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()

print(platform.platform(), '| python', platform.python_version(), '| cpus', os.cpu_count())
print(sh('nvidia-smi --query-gpu=index,name,memory.total,clocks.max.sm,power.limit --format=csv,noheader') or 'no NVIDIA GPU visible')

def ensure(mod, pipname):
    try:
        __import__(mod); return True
    except Exception:
        print('installing', pipname, '...'); print(sh(f'{sys.executable} -m pip install -q {pipname}')[-300:])
        try:
            __import__(mod); return True
        except Exception as e:
            print('  unavailable:', e); return False

HAS_GPU = 'NVIDIA' in sh('nvidia-smi -L') or 'Tesla' in sh('nvidia-smi -L')
if HAS_GPU:
    ensure('cupy', 'cupy-cuda12x')
ensure('tornado', 'tornado')
for mod, pipname in [('simplejpeg', 'simplejpeg')]:
    ensure(mod, pipname)
try:
    import torch, torchvision
    print('torch', torch.__version__, '| torchvision', torchvision.__version__, '| cuda devices', torch.cuda.device_count())
except Exception as e:
    print('torch/torchvision not available (CPU JPEG path will be used):', e)
"""))
    C.append(md("""
## 1. The system

```
   T4 #0 ──────────────┐                        browser (any GPU, even a phone)
   focus colour, top   │                         every display refresh (60-240 Hz):
                       │  ┌────────────────┐       1. sample mouse/keys (late-latched)
   T4 #1 ──────────────┼─▶│ shell message  │──WS──▶ 2. simulate locally (collision vs streamed SDF brick)
   focus colour, bottom│  │ jpeg + inverse │       3. re-project newest shell with *current* camera:
   focus geometry+topo │  │ depth + topo + │          omni (fallback) -> background band -> focus
   background band     │  │ SDF brick      │       4. draw local dynamic objects (orbs) with depth test
   omni cube (6 faces) │  └────────────────┘       5. send pose, velocity, angular rate, light list
   collision brick ────┘         ▲                          │
                                 └── predicted pose, guard band, lights ◀──┘
```

* **Focus layer.** A perspective view centred on the *predicted* view direction. Its field of view is
  widened by a guard band that grows with angular velocity x latency, inside a fixed pixel budget, so
  resolution concentrates where the eye will be and drops during fast turns, when motion blur hides it.
* **Geometry and topology.** Per geometry texel: 16-bit inverse view-z (affine in screen space for planes,
  so 2nd-order prediction makes planes cost ~0 bits), and 3 *connectivity bits* computed on the GPU from
  exact hit positions and normals. The client's mesh tears exactly at true occlusion boundaries, never
  across creases or grazing planes.
* **Background band (2-layer LDI).** For texels within a *motion-predicted* distance of an occlusion edge,
  T4 #1 traces through the occluder to the surface behind it. Disocclusions get real pixels, not smears,
  and the band costs a small fraction of a full second layer.
* **Omni cube.** A low-resolution 360-degree layer with depth, so even a 180-degree flick never shows a hole.
* **Client-authoritative play.** The client simulates movement and collision against a streamed signed-distance
  brick, and owns dynamic objects. Their *light* goes back to the server (a latency-tolerant channel); the
  objects themselves are drawn locally (latency-critical).
"""))
    C.append(code("os.makedirs(os.path.join(ROOT, 'client'), exist_ok=True)"))
    C.append(writefile("{ROOT}/kernel.cu".replace("{ROOT}", "$ROOT_PLACEHOLDER"), "kernel.cu"))
    C.append(writefile("$ROOT_PLACEHOLDER/engine.py", "engine.py"))
    C.append(writefile("$ROOT_PLACEHOLDER/server.py", "server.py"))
    C.append(writefile("$ROOT_PLACEHOLDER/client/index.html", "client/index.html"))
    C.append(writefile("$ROOT_PLACEHOLDER/client/client.js", "client/client.js"))
    C.append(writefile("$ROOT_PLACEHOLDER/client/host.js", "client/host.js"))
    C.append(writefile("$ROOT_PLACEHOLDER/host.py", "host.py"))
    C.append(md("## 2. Bring up the renderers"))
    C.append(code("""
sys.path.insert(0, ROOT)
import importlib, numpy as np
import engine as E; importlib.reload(E)
import server as S; importlib.reload(S)

NGPU = E.cuda_device_count() if HAS_GPU else 0
t0 = time.time()
if NGPU:
    BACKENDS = [E.CudaBackend(i) for i in range(min(NGPU, 2))]
else:
    BACKENDS = [E.CpuBackend()]
print(f'{len(BACKENDS)} backend(s) ready in {time.time()-t0:.1f}s:', [b.device_name for b in BACKENDS])
if NGPU:
    for b in BACKENDS:
        a = b.k_render.attributes
        print(f'  GPU{b.device_id} ss_render: {a.get("num_regs")} registers, {a.get("local_size_bytes")} B local, max threads/block {a.get("max_threads_per_block")}')
JPEG = E.JpegEncoder(85, prefer_gpu=bool(NGPU))
print('JPEG encoder:', 'nvJPEG on GPU (torchvision)' if JPEG.gpu_ok else f'CPU ({JPEG.cpu_impl[0]})')
# fast settings when no GPU is present so the notebook still runs end to end
FULL = bool(NGPU)
"""))
    C.append(code("""
if RUN_SHOWCASE:
    import matplotlib.pyplot as plt
    b = E.ShellBuilder(BACKENDS, jpeg=JPEG, focus_budget=1.0e6 if FULL else 0.12e6, omni_R=256 if FULL else 128)
    st = dict(pos=(4.0, 1.7, 26.0), yaw=0.15, pitch=0.0, fov=90, aspect=16/9, vw=1920 if FULL else 640,
              rtt=60, vel=(0.0, 0, -3.0), yawRate=0.6, mode='shell', time=0.0)
    msg, stats, plan = b.build(st, 0)   # warm-up (NVRTC compile, allocations)
    msg, stats, plan = b.build(st, 1)
    print('shell stats:', stats)
    hlen = int.from_bytes(msg[:4], 'little'); hdr = json.loads(msg[4:4+hlen]); base = 4 + hlen
    import io
    from PIL import Image
    def part(d): return msg[base + d[0]: base + d[0] + d[1]]
    sheets = {s['name']: s for s in hdr['sheets']}
    def color(s):
        img = Image.new('RGB', (s['W'], s['H']))
        for t in s['tiles']: img.paste(Image.open(io.BytesIO(part(t['data']))), (t['x'], t['y']))
        return np.asarray(img)
    def depth(s):
        d = E.decode_depth(part(s['depth']['data']), s['depth']['h'], s['depth']['w']).astype(np.float32)
        return np.where(d < 2, 0, np.clip((d - 2) / 65533 * 30, 0, 1))
    def topo(s):
        import zlib
        bits = np.frombuffer(zlib.decompress(part(s['conn']['data'])), np.uint8).reshape(s['depth']['h'], s['depth']['w'])
        return (bits & 7) != 7
    fig, ax = plt.subplots(2, 3, figsize=(18, 8.5))
    ax[0,0].imshow(color(sheets['front'])); ax[0,0].set_title(f"focus colour {sheets['front']['W']}x{sheets['front']['H']} (incl. guard band)")
    ax[0,1].imshow(depth(sheets['front']), cmap='gray'); ax[0,1].set_title('focus inverse depth (16 bit, lossless)')
    ax[0,2].imshow(topo(sheets['front']), cmap='gray_r'); ax[0,2].set_title('topology: torn edges (exact normals)')
    ax[1,0].imshow(color(sheets['back'])); ax[1,0].set_title('background band: surfaces *behind* occluders')
    ax[1,1].imshow(color(sheets['omni'])); ax[1,1].set_title('omni cube (6 faces, fallback for any direction)')
    ax[1,2].axis('off')
    ax[1,2].text(0, 0.5, '\\n'.join(f'{k}: {v}' for k, v in stats.items()), family='monospace', fontsize=10, va='center')
    for a in ax.ravel()[:5]: a.axis('off')
    plt.tight_layout(); plt.show()
"""))
    cm = load("cost_model.json")
    model = {}
    if cm:
        mid = cm["t4_ms"][sorted(cm["t4_ms"])[1]]
        P_ = cm["passes"]
        model = {"focus colour": mid["front_color"] / (P_["front_color"]["pixels"] / 1e6),
                 "focus geometry": mid["front_geometry"] / (P_["front_geometry"]["pixels"] / 1e6),
                 "background band": None,
                 "omni colour": mid["omni_color"] / (P_["omni_color"]["pixels"] / 1e6),
                 "omni geometry": mid["omni_geometry"] / (P_["omni_geometry"]["pixels"] / 1e6),
                 "classic": mid["classic_1080p"] / (P_["classic_1080p"]["pixels"] / 1e6)}
        model = {k: round(v, 3) for k, v in model.items() if v}
    C.append(md("""
## 3. Benchmarks on the T4s

Every pass is timed separately (median of repeated runs, synchronised), then the full shell pipeline is
run over a scripted 200-frame walk-and-turn path, with one GPU and with both GPUs (split-frame focus
rendering, re-balanced every frame). The same scripted path is used for a **classic** server that renders
a 1080p frame of exactly the client's view, the baseline whose output the user would see one RTT late.
"""))
    C.append(code("""
def timeit(fn, reps):
    fn(); [b.sync() for b in BACKENDS]
    ts = []
    for _ in range(reps):
        t = time.perf_counter(); fn(); [b.sync() for b in BACKENDS]; ts.append((time.perf_counter() - t) * 1000)
    return float(np.median(ts)), float(np.percentile(ts, 90))

PASS_RESULTS = {}
if RUN_BENCHMARKS:
    be = BACKENDS[0]
    reps = 20 if FULL else 2
    pos, yaw = (4.0, 1.7, 26.0), 0.15
    r, u, f = E.basis_from_yaw_pitch(yaw, 0.0)
    kw = (lambda tag: {'tag': tag}) if be.name == 'cuda' else (lambda tag: {})
    for budget in ([0.5e6, 1.0e6, 1.5e6, 2.0e6] if FULL else [0.05e6]):
        W = int(round(math.sqrt(budget * 16 / 9) / 16) * 16); H = int(round(W * 9 / 16 / 16) * 16)
        tx = math.tan(math.radians(52)); ty = tx * H / W
        v = E.make_view(pos, r, u, f, -tx, tx, -ty, ty, (0, 0, W, H))
        P = E.pack_params([v], spp=2); Pg = E.pack_params(E.scale_views([v], 2), band_delta=0.5)
        PASS_RESULTS[f'focus colour {W}x{H}, 2 spp'] = timeit(lambda: be.render(P, W, H, E.MODE_COLOR, **kw('a')), reps)
        if abs(budget - (1.0e6 if FULL else 0.05e6)) < 1:
            PASS_RESULTS[f'focus geometry {W//2}x{H//2}'] = timeit(lambda: be.render(Pg, W//2, H//2, E.MODE_GEO | E.MODE_GEOONLY, **kw('g')), reps)
            _, dc, geo = be.render(Pg, W//2, H//2, E.MODE_GEO | E.MODE_GEOONLY, **kw('g')); be.sync()
            PASS_RESULTS['topology map'] = timeit(lambda: be.conn(Pg, geo, W//2, H//2, **kw('c')), reps)
            PASS_RESULTS['background band'] = timeit(lambda: be.render(Pg, W//2, H//2, E.MODE_COLOR | E.MODE_GEO | E.MODE_BACK, pre_geo=geo, pre_code=dc, **kw('b')), reps)
    for R in ([192, 256, 384] if FULL else [64]):
        cv = E.cube_views(np.array(pos), R, 2); Po = E.pack_params(cv); Pog = E.pack_params(E.scale_views(cv, 2))
        PASS_RESULTS[f'omni colour 6x{R}^2'] = timeit(lambda: be.render(Po, 3*R, 2*R, E.MODE_COLOR, **kw('o')), reps)
        PASS_RESULTS[f'omni geometry 6x{R//2}^2'] = timeit(lambda: be.render(Pog, 3*R//2, R, E.MODE_GEO | E.MODE_GEOONLY, **kw('og')), reps)
    B = np.array([pos[0]-6, -0.75, pos[2]-6, 0.25, 48, 18, 48, 0], np.float32)
    PASS_RESULTS['collision brick 48x18x48'] = timeit(lambda: be.brick(E.pack_params([]), B, 48*18*48), reps)
    vc = E.make_view(pos, r, u, f, -1, 1, -9/16, 9/16, (0, 0, 1920, 1080))
    if FULL:
        Pc = E.pack_params([vc], spp=2)
        PASS_RESULTS['CLASSIC 1920x1080 frame, 2 spp'] = timeit(lambda: be.render(Pc, 1920, 1080, E.MODE_COLOR, **kw('cl')), reps)
    # the development run's cost model (mid estimate), scaled by pixel count, for a direct check of the model
    MODEL_MS_PER_MPIX = MODEL_PLACEHOLDER
    def model_for(name):
        import re
        mo = re.search(r'6x(\\d+)\\^2', name)
        mr = re.search(r'(\\d+)x(\\d+)', name)
        px = 6 * int(mo.group(1)) ** 2 / 1e6 if mo else (int(mr.group(1)) * int(mr.group(2)) / 1e6 if mr else None)
        for key, per in MODEL_MS_PER_MPIX.items():
            if name.lower().startswith(key) and px:
                return per * px
        return None
    print(f'{"pass":38s} {"median ms":>10s} {"p90 ms":>8s} {"model ms":>9s}   on', be.device_name)
    for k, (m, p) in PASS_RESULTS.items():
        mm = model_for(k) if FULL else None
        print(f'{k:38s} {m:10.2f} {p:8.2f} {("%9.2f" % mm) if mm else "        -"}')
"""))
    C.append(code("""
def scripted_path(n):
    states = []
    for i in range(n):
        t = i / 30.0
        yaw = 0.15 + 0.9 * math.sin(t * 0.7)
        yr = 0.9 * 0.7 * math.cos(t * 0.7)
        fwd = np.array([-math.sin(yaw), 0, -math.cos(yaw)])
        pos = np.array([4.0, 1.7, 26.0]) + fwd * (2.0 * t % 12)
        states.append(dict(pos=pos.tolist(), yaw=yaw, pitch=0.05 * math.sin(t), fov=90, aspect=16/9,
                           vw=1920 if FULL else 640, rtt=60, vel=(fwd * 4).tolist(), yawRate=yr, seq=i, t=t * 1000,
                           mode='shell', time=t))
    return states

PIPE = {}
if RUN_BENCHMARKS:
    n = 200 if FULL else 6
    path = scripted_path(n)
    configs = [('1 GPU', BACKENDS[:1], {})]
    if len(BACKENDS) > 1:
        configs += [('2 GPUs, one shell split', BACKENDS[:2], dict(strategy='split')),
                    ('2 GPUs, two shells', BACKENDS[:2], dict(strategy='dual')),
                    ('2 GPUs, two shells + governor', BACKENDS[:2], dict(strategy='dual', governor=True, duty=0.85,
                                                                         **({} if FULL else dict(min_budget=0.03e6))))]
    for name, bes, extra in configs:
        b = E.ShellBuilder(bes, jpeg=JPEG, focus_budget=1.0e6 if FULL else 0.1e6, omni_R=256 if FULL else 96, **extra)
        b.build(path[0], 0); b.build(path[1], 1)
        rows = []
        for i, st in enumerate(path):
            t = time.perf_counter(); msg, stats, _ = b.build(st, i); rows.append(dict(stats, wall_ms=(time.perf_counter()-t)*1000))
        PIPE[name] = rows
        w = np.array([r['wall_ms'] for r in rows]); by = np.array([r['bytes'] for r in rows])
        busy = np.median([r['gpu_ms'] for r in rows[-50:]], axis=0) / (1000 / 30) * 100     # % of a 30 shells/s interval
        print(f'{name:30s} build p50 {np.median(w):6.1f} ms p99 {np.percentile(w,99):6.1f} ms -> {1000/np.median(w):5.1f}/s | '
              f'GPU busy at 30/s: {", ".join(f"{x:.0f}%" for x in busy)} | budget {rows[-1].get("budget", int(b.cfg["focus_budget"]))/1e6:.2f} MP | '
              f'{np.median(by)/1024:5.0f} KiB')
    # classic baseline: one 1080p frame of the exact client view + JPEG
    cl = []
    be = BACKENDS[0]
    for st in path[: (60 if FULL else 3)]:
        r_, u_, f_ = E.basis_from_yaw_pitch(st['yaw'], st['pitch'])
        Wc, Hc = (1920, 1080) if FULL else (640, 360)
        v = E.make_view(st['pos'], r_, u_, f_, -1, 1, -Hc/Wc, Hc/Wc, (0, 0, Wc, Hc))
        t = time.perf_counter()
        rgb, _, _ = be.render(E.pack_params([v], t=st['time']), Wc, Hc, E.MODE_COLOR, **({'tag': 'classic'} if be.name == 'cuda' else {}))
        be.sync()
        jb = JPEG.encode_device(rgb, be.device_id) if be.name == 'cuda' else JPEG.encode_host(rgb)
        cl.append(((time.perf_counter() - t) * 1000, len(jb)))
    cl = np.array(cl)
    print(f'{"classic %dx%d frame" % (Wc, Hc):22s} render+jpeg: p50 {np.median(cl[:,0]):6.1f} ms, size p50 {np.median(cl[:,1])/1024:6.0f} KiB')
"""))
    C.append(code("""
if RUN_BENCHMARKS and PIPE:
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 2, figsize=(15, 4.2))
    colors = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100']
    for (name, rows), c in zip(PIPE.items(), colors):
        ax[0].plot([r['wall_ms'] for r in rows], lw=1.5, color=c, label=name)
        ax[1].plot([r['bytes'] / 1024 for r in rows], lw=1.5, color=c, label=name)
    ax[0].set_title('shell build time per frame (ms)'); ax[0].set_xlabel('frame'); ax[0].legend(frameon=False)
    ax[1].set_title('shell size per frame (KiB)'); ax[1].set_xlabel('frame'); ax[1].legend(frameon=False)
    for a in ax:
        a.grid(alpha=.25); a.spines[['top', 'right']].set_visible(False)
    plt.tight_layout(); plt.show()
    if '2 GPUs, one shell split' in PIPE:
        print('split strategy: converged row split between the GPUs:', PIPE['2 GPUs, one shell split'][-1].get('split'))
    json.dump(dict(passes=PASS_RESULTS, pipeline={k: v for k, v in PIPE.items()}), open(os.path.join(ROOT, 'results', 'kaggle_t4_benchmark.json'), 'w'))
"""))
    C.append(md("""
### 3b. Using both T4s fully

* **Two shells instead of one split shell.** Each T4 renders a complete shell from its own centre: T4 #0 at
  the predicted pose, T4 #1 at a *hedge* (where the player most likely is instead: the current position
  when moving, alternating left/right offsets when standing). The browser composites every shell it holds,
  nearest centre first. The extra GPU becomes image quality under motion, the weakest point of a single
  shell (report, section 12).
* **GPU and host stages overlap.** `stage1` (both GPUs render and encode) of shell *n+1* runs while `finish`
  (deflate + packing on the CPU cores) of shell *n* completes.
* **Governor.** It scales the focus pixel budget so the busier GPU is busy 85 % of each shell interval.
  Idle frames go to progressive refinement (more samples per pixel when nothing moves).
* **NVENC.** Each T4 has its own hardware H.264 encoder; the game host streams through them.
"""))
    C.append(code("""
if RUN_BENCHMARKS and len(BACKENDS) > 1:
    from concurrent.futures import ThreadPoolExecutor
    b = E.ShellBuilder(BACKENDS[:2], jpeg=JPEG, focus_budget=1.0e6 if FULL else 0.1e6, omni_R=256 if FULL else 96, strategy='dual')
    path2 = scripted_path(120 if FULL else 6)
    b.build(path2[0], 0)
    t = time.perf_counter()
    for i, st in enumerate(path2): b.build(st, i)
    seq_rate = len(path2) / (time.perf_counter() - t)
    pool = ThreadPoolExecutor(1); prev = None
    t = time.perf_counter()
    for i, st in enumerate(path2):
        ctx = b.stage1(st, i)                    # GPUs: shell i
        if prev is not None: prev.result()       # host: shell i-1 finished meanwhile
        prev = pool.submit(b.finish, ctx)
    prev.result()
    pipe_rate = len(path2) / (time.perf_counter() - t)
    print(f'two-shell updates per second: sequential {seq_rate:.1f}/s, GPU and host stages overlapped {pipe_rate:.1f}/s')
"""))
    C.append(code("""
NVENC = {}
if RUN_BENCHMARKS and NGPU:
    if ensure('av', 'av'):
        import av, threading, io
        from PIL import Image
        def nvenc_bench(gpu, w, h, n=180):
            cc = av.CodecContext.create('h264_nvenc', 'w'); cc.width, cc.height, cc.pix_fmt = w, h, 'yuv420p'
            cc.framerate = 60; cc.bit_rate = 10_000_000; cc.gop_size = 600
            cc.options = {'preset': 'p1', 'tune': 'ull', 'zerolatency': '1', 'delay': '0', 'bf': '0', 'rc': 'cbr', 'gpu': str(gpu)}
            cc.open()
            # game-like content: a rendered shell view panning, not noise
            try:
                base = np.asarray(Image.open(io.BytesIO(part(sheets['front']['tiles'][0]['data']))).convert('RGB').resize((w + 64, h)))
            except Exception:       # showcase disabled: smooth synthetic content instead
                yy, xx = np.mgrid[0:h, 0:w + 64]
                base = (127 + 120 * np.stack([np.sin(xx / 37.0), np.cos(yy / 23.0), np.sin((xx + yy) / 51.0)], -1)).astype(np.uint8)
            frames = [av.VideoFrame.from_ndarray(np.ascontiguousarray(base[:, k:k + w]), format='rgb24').reformat(format='yuv420p') for k in range(0, 64, 4)]
            t = time.perf_counter(); size = 0
            for i in range(n):
                f = frames[i % len(frames)]; f.pts = i
                size += sum(p.size for p in cc.encode(f))
            return round((time.perf_counter() - t) / n * 1000, 2), round(size / n / 1024, 1)
        for g in range(NGPU):
            for (w, h) in ((1920, 1080), (1280, 720)):
                try:
                    NVENC[f'T4 #{g} {w}x{h}'] = nvenc_bench(g, w, h)
                except Exception as e:
                    NVENC[f'T4 #{g} {w}x{h}'] = f'unavailable: {e!r}'[:160]
        if NGPU >= 2 and all(isinstance(v, tuple) for v in NVENC.values()):
            out = {}
            ths = [threading.Thread(target=lambda g=g: out.__setitem__(g, nvenc_bench(g, 1920, 1080))) for g in range(2)]
            t = time.perf_counter(); [x.start() for x in ths]; [x.join() for x in ths]
            NVENC['both T4 NVENCs at once, 1080p'] = (round((time.perf_counter() - t) / 180 * 1000, 2), 'ms per frame pair')
        for k, v in NVENC.items():
            print(f'{k:34s}', f'{v[0]} ms/frame, {v[1]} KiB/frame' if isinstance(v, tuple) and isinstance(v[1], float) else v)
"""))
    C.append(md("""
## 4. Client-side results from the development run

The client-side experiments run the real browser client (headless Chromium, WebGL2) against this server
with emulated network conditions. They were run in the development container with the CPU build of the
same kernel (no GPU there). Image-quality numbers are independent of the hardware; latency numbers are
dominated by the client's frame interval in ShellStream mode and by RTT plus server time in classic mode.
The cell below plots the recorded results. Set `REPRODUCE_BROWSER_EXPERIMENTS = True` to re-run them here.
"""))
    C.append(code("DEV_RESULTS = json.loads(r'''" + dev_results_literal() + "''')\nprint('loaded dev-run results:', list(DEV_RESULTS))"))
    C.append(code(src("bench/notebook_plots.py")))
    C.append(writefile("$ROOT_PLACEHOLDER/bench/common.py", "bench/common.py"))
    C.append(writefile("$ROOT_PLACEHOLDER/bench/quality.py", "bench/quality.py"))
    C.append(writefile("$ROOT_PLACEHOLDER/bench/latency.py", "bench/latency.py"))
    C.append(code("""
if REPRODUCE_BROWSER_EXPERIMENTS:
    print(sh(f'{sys.executable} -m pip install -q playwright scikit-image && {sys.executable} -m playwright install --with-deps chromium')[-500:])
    for script in ['quality.py', 'latency.py']:
        print('running', script, '...')
        print(sh(f'cd {ROOT}/bench && {sys.executable} {script}')[-3000:])
"""))
    C.append(md(open(os.path.join(HERE, "results", "NOTEBOOK_ANYGAME.md")).read() if os.path.exists(os.path.join(HERE, "results", "NOTEBOOK_ANYGAME.md")) else "## Any game"))
    C.append(md("""
## 5. Play it (opt-in, personal use only, read section 0)

1. Set `START_LOCAL_SERVER = True` and run the next cell. It starts the server inside this kernel,
   bound to `127.0.0.1` only.
2. Kaggle kernels accept no inbound connections, so a browser outside Kaggle can only reach the server
   through a tunnel. `OPEN_PUBLIC_TUNNEL = True` starts a Cloudflare *quick tunnel* (random, unlisted
   `*.trycloudflare.com` URL, no account). This exposes a web endpoint from the kernel. Do it only if you
   have concluded it is acceptable for your own personal use under Kaggle's terms.
3. Open the printed URL in a desktop browser, click, and play. Keys `1` to `4` switch between ShellStream,
   classic streaming, rotation-only warp and ShellStream without the background layer, so you can feel the
   difference at the same network conditions.
"""))
    C.append(code("""
SERVER = None
if START_LOCAL_SERVER:
    builder = E.ShellBuilder(BACKENDS, jpeg=JPEG, focus_budget=1.0e6 if FULL else 0.15e6, omni_R=256 if FULL else 128,
                             quality='high' if FULL else 'medium')
    SERVER = S.ShellServer(builder, port=8765, max_rate=45 if FULL else 8, address='127.0.0.1').start()
    print('server listening on 127.0.0.1:8765 with', [b.device_name for b in BACKENDS])
"""))
    C.append(code("""
TUNNEL = None
if SERVER and OPEN_PUBLIC_TUNNEL:
    import re, threading
    exe = os.path.join(WORK, 'cloudflared')
    if not os.path.exists(exe):
        print(sh(f'curl -sL -o {exe} https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x {exe}'))
    TUNNEL = subprocess.Popen([exe, 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8765'],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    url = None; t0 = time.time()
    while time.time() - t0 < 40 and url is None:
        line = TUNNEL.stdout.readline()
        m = re.search(r'https://[a-z0-9-]+\\.trycloudflare\\.com', line or '')
        if m: url = m.group(0)
    threading.Thread(target=lambda: [None for _ in TUNNEL.stdout], daemon=True).start()
    print('open this in your browser (personal use only, do not share):', url)
"""))
    C.append(code("""
# live server statistics (re-run while playing)
if SERVER and SERVER.session:
    import matplotlib.pyplot as plt
    log = list(SERVER.session.log)[-300:]
    fig, ax = plt.subplots(1, 3, figsize=(16, 3.6))
    ax[0].plot([r['build_ms'] for r in log], color='#2a78d6', lw=1.5); ax[0].set_title('server shell build (ms)')
    ax[1].plot([r['bytes'] / 1024 for r in log], color='#2a78d6', lw=1.5); ax[1].set_title('shell size (KiB)')
    ax[2].plot([max(r['margins_deg']) for r in log], color='#2a78d6', lw=1.5); ax[2].set_title('guard band (deg)')
    for a in ax: a.grid(alpha=.25); a.spines[['top', 'right']].set_visible(False)
    plt.tight_layout(); plt.show()
else:
    print('no active session')
"""))
    C.append(code("""
# stop everything
if TUNNEL: TUNNEL.terminate(); TUNNEL = None
if SERVER: SERVER.stop(); SERVER = None
print('stopped')
"""))
    C.append(md(open(os.path.join(HERE, "results", "NOTEBOOK_TAIL.md")).read() if os.path.exists(os.path.join(HERE, "results", "NOTEBOOK_TAIL.md")) else "## Notes"))
    # resolve the ROOT placeholder used in %%writefile lines (IPython expands {ROOT})
    for c in C:
        if c.cell_type == "code" and "MODEL_PLACEHOLDER" in c.source:
            c.source = c.source.replace("MODEL_PLACEHOLDER", repr(model))
        if c.cell_type == "code" and c.source.startswith("%%writefile $ROOT_PLACEHOLDER"):
            c.source = c.source.replace("%%writefile $ROOT_PLACEHOLDER", "%%writefile {ROOT}", 1)
    nb.cells = C
    nbf.write(nb, OUT)
    print("wrote", OUT, len(C), "cells")


if __name__ == "__main__":
    build()
