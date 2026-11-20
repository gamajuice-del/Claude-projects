#!/usr/bin/env python3
"""Builds afterframe_lora_training.ipynb. The notebook embeds the exact, tested source of
afterframe_wan.py, extract_afterframe.py and prepare_dataset.py via %%writefile cells."""
from pathlib import Path

import nbformat as nbf

HERE = Path(__file__).resolve().parent
nb = nbf.v4.new_notebook()
cells = []


def md(text):
    cells.append(nbf.v4.new_markdown_cell(text.strip()))


def code(text):
    cells.append(nbf.v4.new_code_cell(text.strip()))


def writefile(name):
    src = (HERE / name).read_text(encoding="utf-8")
    cells.append(nbf.v4.new_code_cell(f"%%writefile {name}\n" + src))


md("""
# Afterframe → Wan LoRA: "Sora 2 video, prompt:" fine-tuning on Kaggle 2 × T4

This notebook runs the whole training side of the Afterframe pipeline on Kaggle's free **2 × Tesla T4**:

1. checks the hardware and installs dependencies
2. *(optional)* extracts Afterframe shards inside Kaggle, a few GB at a time
3. downloads the base model (**Wan2.1-T2V-1.3B**; the experimental **Wan2.2-TI2V-5B** preset is optional)
4. caches umT5 text embeddings and VAE latents, with aspect-ratio and frame-count buckets, split across both GPUs
5. runs a **smoke test** end to end (cache, train, resume, export, inference) before the long run
6. benchmarks the chosen preset on these GPUs and estimates the GPU hours the full plan needs
7. trains the LoRA with **DistributedDataParallel** over both GPUs, shard by shard, within a time budget,
   resuming from the last checkpoint in later sessions
8. plots loss, validation loss and GPU memory, and shows validation videos
9. exports the LoRA as `.safetensors` (diffusers layout plus a ComfyUI-keyed copy)
10. **inference**: generates from unseen prompts and compares base vs. LoRA at the same seed

**Precision and attention on T4 (sm_75):** fp16 autocast with a dynamic loss scaler, fp32 LoRA weights, and
no bf16. Attention runs on PyTorch SDPA's memory-efficient and math kernels; FlashAttention is disabled
because it needs sm_80 or newer.

**Two GPUs:** every rank holds a full frozen copy of the base model and its own activations, and only the
LoRA gradients are all-reduced. The pair does not act as one 32 GB device.

**Every training caption is** `Sora 2 video, prompt: <original backend prompt>`. The prefix is included in
the cached text embeddings, and the cache step checks that it survives tokenisation.

Settings: *Accelerator → GPU T4 x2*, *Internet → On*. Optional Kaggle Secrets: `HF_TOKEN` (mirror checkpoints
to a private Hugging Face repo) and `AFTERFRAME_COOKIE` (needed only for extraction inside Kaggle).
""")

md("## 0 · Configuration")
code(r'''
import os, time
NOTEBOOK_START = time.time()

PRESET = "balanced"          # smoke | low_memory | balanced | max_quality | wan22_5b_experimental
SESSION_HOURS = 11.5         # Kaggle stops GPU sessions at 12 h; leave margin for export and inference
SAFETY_MINUTES = 25          # reserved at the end of the session

DATASET_ROOTS = ["/kaggle/input"]                # searched for shard_*/manifest.jsonl (prepare_dataset.py output)
WORK = "/kaggle/working"
OUTPUT_DIR = f"{WORK}/afterframe_run"            # checkpoints, logs, LoRA: saved with the notebook version
CACHE_DIR = "/tmp/afterframe_cache"              # latents/embeddings: large and temporary; NOT under /kaggle/working
SHARDS_PER_CHUNK = 1                             # shards cached + trained together (more = better mixing, more disk)
DELETE_CACHE_AFTER_TRAINING = True               # free disk once a chunk has been trained
STAGE_SHARD_FRACTION = None                      # None = the preset's per-stage shard_fraction; e.g. [0.25, 1.0]
TOTAL_STEPS = None                               # cosine horizon; None = computed from the dataset below

HF_REPO = None                                   # e.g. "your-name/afterframe-lora-ckpts" (private) to mirror checkpoints
RUN_SMOKE_TEST = True
RUN_BENCHMARK = True
os.makedirs(OUTPUT_DIR, exist_ok=True)
''')

md("## 1 · Hardware check")
code(r'''
!nvidia-smi --query-gpu=index,name,memory.total,compute_cap,driver_version --format=csv
!df -h /kaggle/working /tmp | sed 's/^/  /'
!free -g | head -2
import torch
NUM_GPUS = torch.cuda.device_count()
print("torch", torch.__version__, "CUDA", torch.version.cuda, "GPUs:", NUM_GPUS)
for i in range(NUM_GPUS):
    p = torch.cuda.get_device_properties(i)
    print(f"  cuda:{i} {p.name} {p.total_memory/2**30:.1f} GB sm_{p.major}{p.minor}  bf16-native: {(p.major, p.minor) >= (8, 0)}")
assert NUM_GPUS >= 1, "enable a GPU accelerator"
if NUM_GPUS < 2:
    print("WARNING: only one GPU visible; training will run single-process (Accelerator should be 'GPU T4 x2')")
''')

md("## 2 · Dependencies\nKaggle's preinstalled PyTorch is kept. Only the libraries below are installed or upgraded.")
code(r'''
!pip install -q "diffusers>=0.35.0" "transformers>=4.51.0,<6" "peft>=0.17.0" "accelerate>=1.0" "safetensors>=0.4.3" "huggingface_hub>=0.30" "bitsandbytes>=0.45" ftfy sentencepiece "numpy>=1.26" requests tqdm
!which ffmpeg && ffmpeg -version | head -1
import importlib
for m in ["diffusers", "transformers", "peft", "bitsandbytes", "safetensors"]:
    mod = importlib.import_module(m); print(f"{m:14s}", getattr(mod, "__version__", "?"))
''')

md("## 3 · Pipeline code\nThese cells write the same files that are tested in the repository.")
writefile("afterframe_wan.py")
writefile("extract_afterframe.py")
writefile("prepare_dataset.py")

code(r'''
import importlib, json, sys, subprocess, glob, shutil
sys.path.insert(0, WORK)
import afterframe_wan as aw
importlib.reload(aw)

def run(cmd, check=True):
    """Run a command, streaming its output into the notebook."""
    print("$", " ".join(map(str, cmd)), flush=True)
    p = subprocess.Popen(list(map(str, cmd)), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in p.stdout:
        print(line, end="", flush=True)
    p.wait()
    if check and p.returncode != 0:
        raise RuntimeError(f"command failed with exit code {p.returncode}")
    return p.returncode

def wan(*args, gpus=None):
    gpus = NUM_GPUS if gpus is None else gpus
    base = [sys.executable, f"{WORK}/afterframe_wan.py"] if gpus <= 1 else \
           ["torchrun", "--standalone", f"--nproc_per_node={gpus}", f"{WORK}/afterframe_wan.py"]
    return run(base + list(args))

def remaining_minutes():
    return (SESSION_HOURS * 3600 - (time.time() - NOTEBOOK_START)) / 60 - SAFETY_MINUTES

if HF_REPO:
    from kaggle_secrets import UserSecretsClient
    os.environ["HF_TOKEN"] = UserSecretsClient().get_secret("HF_TOKEN")
print(json.dumps({k: {kk: v[kk] for kk in ("model", "rank", "alpha", "targets", "lr", "accum")} | {"stages": [s["name"] for s in v["stages"]]}
                  for k, v in aw.PRESETS.items()}, indent=1))
''')

md("""
## 4 · (Optional) Extract Afterframe shards inside Kaggle

Skip this if the shards are already attached as Kaggle datasets (the output of `prepare_dataset.py`, one
`shard_XXX/` folder each). Otherwise this downloads a few shards at a time, so the whole archive never has
to fit in Kaggle's temporary storage. Prompts are owner-only on Afterframe: put the owner's signed-in
`Cookie` header in the Kaggle Secret `AFTERFRAME_COOKIE`. Choose the permission policy deliberately.
""")
code(r'''
EXTRACT_IN_KAGGLE = False
EXTRACT_SHARDS = "0,1"            # of 16 hash shards; each is ~1/16 of the archive
PERMISSION_ARGS = ["--permission-policy", "owner-uploads"]   # or: allowlist --uploaders-file ..., all-attested
if EXTRACT_IN_KAGGLE:
    from kaggle_secrets import UserSecretsClient
    os.environ["AFTERFRAME_COOKIE"] = UserSecretsClient().get_secret("AFTERFRAME_COOKIE")
    data = "/tmp/afterframe_data"
    run([sys.executable, f"{WORK}/extract_afterframe.py", "scan", "--out", data])
    run([sys.executable, f"{WORK}/extract_afterframe.py", "prompts", "--out", data])
    run([sys.executable, f"{WORK}/extract_afterframe.py", "download", "--out", data, "--shards", EXTRACT_SHARDS,
         "--num-shards", "16", "--deep-verify", *PERMISSION_ARGS])
    run([sys.executable, f"{WORK}/prepare_dataset.py", "--data", data, "--out", "/tmp/afterframe_dataset", *PERMISSION_ARGS])
    DATASET_ROOTS = ["/tmp/afterframe_dataset"] + DATASET_ROOTS
''')

md("## 5 · Dataset discovery and plan")
code(r'''
shards = aw.discover_shards(DATASET_ROOTS)
assert shards, f"no shard_*/manifest.jsonl under {DATASET_ROOTS}"
cfg = aw.PRESETS[PRESET]; model_info = aw.MODELS[cfg["model"]]
fps = model_info["fps"]
summary, n_train_clips = {}, {i: 0 for i in range(len(cfg["stages"]))}
for name, path in sorted(shards.items()):
    rows = aw.read_manifest(path)           # also verifies every caption == prefix + backend prompt
    tr = [r for r in rows if r["split"] == "train"]
    summary[name] = {"videos": len(rows), "train": len(tr), "val": len(rows) - len(tr),
                     "hours": round(sum(r["duration"] for r in rows) / 3600, 2)}
    for i, st in enumerate(cfg["stages"]):
        n_train_clips[i] += sum(len(aw.plan_clips(r["duration"], st["frames"], fps, cfg["clips_per_video"])) for r in tr)
print(json.dumps(summary, indent=1))
ex = aw.read_manifest(next(iter(shards.values())))[0]
print("example caption:", ex["_caption"][:160])
assert ex["_caption"].startswith(aw.CAPTION_PREFIX)

fractions = STAGE_SHARD_FRACTION or [st.get("shard_fraction", 1.0) for st in cfg["stages"]]
world = max(1, NUM_GPUS)
steps_per_stage = [int(n_train_clips[i] * fractions[i] // (world * cfg["batch"] * cfg["accum"])) for i in n_train_clips]
TOTAL_STEPS = TOTAL_STEPS or max(100, sum(steps_per_stage))
print("train clips per stage:", n_train_clips, " optimizer steps per stage:", steps_per_stage, " cosine horizon:", TOTAL_STEPS)
''')

md("## 6 · Base model download")
code(r'''
from huggingface_hub import snapshot_download
MODEL_DIR = snapshot_download(model_info["repo"], allow_patterns=["model_index.json", "tokenizer/*", "text_encoder/*",
                                                                  "vae/*", "transformer/*", "scheduler/*"])
!du -sh {MODEL_DIR}/* | sort -h
''')

md("""
## 7 · Smoke test (real model, a few clips, both GPUs)

This covers caching (with the VAE fp16-versus-fp32 check and the umT5 fp16 finiteness check), then 4 DDP
optimizer steps with a checkpoint, a resume to step 6, a validation video, the LoRA export, and loading
that export for inference. It runs in a separate cache and output folder, on the base model of the chosen
`PRESET`. With `PRESET = "wan22_5b_experimental"` this is the go/no-go test for the 5B model on T4: check the
printed peak memory and that no step reports a non-finite loss.
""")
code(r'''
if RUN_SMOKE_TEST:
    smoke_cache, smoke_out = "/tmp/afterframe_smoke_cache", f"{WORK}/smoke_run"
    shutil.rmtree(smoke_out, ignore_errors=True)
    first = sorted(shards)[:1]
    # the smoke preset, run on the base model of the chosen PRESET (so wan22_5b_experimental is smoke-tested too)
    common = ["--preset", "smoke", "--model", cfg["model"], "--model-path", MODEL_DIR, "--cache-dir", smoke_cache]
    wan("cache", *common, "--dataset", *DATASET_ROOTS, "--shards", ",".join(first), "--max-videos-per-shard", "8")
    train = ["train", *common, "--output-dir", smoke_out, "--shards", ",".join(first), "--save-every", "4",
             "--log-every", "1", "--val-loss-every", "2", "--val-every", "4", "--val-steps", "8", "--passes", "100",
             "--total-steps", "6", "--warmup-steps", "1"]
    wan(*train, "--max-steps", "4")
    wan(*train, "--max-steps", "6")                       # must print "resumed from ... step_0000004"
    log = [json.loads(l) for l in open(f"{smoke_out}/logs/train_log.jsonl")]
    assert log[-1]["step"] == 6 and all(map(lambda r: r["loss"] == r["loss"], log)), "NaN loss in smoke test"
    print("peak GPU memory per rank (GB):", log[-1]["peak_mem_gb"])
    g = aw.Generator(cfg["model"], MODEL_DIR, lora=f"{smoke_out}/afterframe_sora2_lora.safetensors")
    v = g(aw.DEFAULT_VAL_PROMPTS[0], width=320, height=192, num_frames=17, steps=8, seed=0)
    aw.write_mp4(v, f"{smoke_out}/smoke_infer.mp4", model_info["fps"])
    del g; import gc; gc.collect(); torch.cuda.empty_cache()
    print("SMOKE TEST PASSED")
''')

md("""
## 8 · Benchmark on these GPUs

The cell below measures the chosen preset on this hardware: latent caching time per clip, optimizer-step
time and peak memory, using the first shard and stage 0. It then estimates the GPU hours the whole plan
needs. All the figures come from this run.
""")
code(r'''
def bench_plan():
    bdir = f"{WORK}/bench_run"
    shutil.rmtree(bdir, ignore_errors=True)
    first = sorted(shards)[:1]
    est = {}
    for i, st in enumerate(cfg["stages"]):
        wan("cache", "--preset", PRESET, "--stage", str(i), "--model-path", MODEL_DIR, "--cache-dir", CACHE_DIR,
            "--dataset", *DATASET_ROOTS, "--shards", ",".join(first), "--max-videos-per-shard", str(4 * world))
        wan("train", "--preset", PRESET, "--stage", str(i), "--model-path", MODEL_DIR, "--cache-dir", CACHE_DIR,
            "--output-dir", f"{bdir}/s{i}", "--shards", ",".join(first), "--no-resume", "--max-steps", "6",
            "--log-every", "1", "--val-every", "0", "--val-loss-every", "0", "--save-every", "100000", "--passes", "100")
        log = [json.loads(l) for l in open(f"{bdir}/s{i}/logs/train_log.jsonl")]
        sec = sorted(r["sec_per_opt_step"] for r in log[2:])[len(log[2:]) // 2]   # median, after warm-up
        cache_b = [json.loads(l) for l in open(f"{CACHE_DIR}/benchmarks.jsonl")][-1]
        spc = cache_b["sec_per_clip"]
        est[st["name"]] = {"sec_per_opt_step": round(sec, 2), "peak_mem_gb": log[-1]["peak_mem_gb"],
                           "cache_sec_per_clip_per_gpu": [round(x, 2) for x in spc],
                           "planned_steps": steps_per_stage[i],
                           "train_gpu_hours_est": round(steps_per_stage[i] * sec * world / 3600, 1),
                           "cache_gpu_hours_est": round(n_train_clips[i] * fractions[i] * (sum(spc) / max(1, len(spc))) / 3600, 1)}
        shutil.rmtree(f"{CACHE_DIR}/{st['name']}", ignore_errors=True)   # benchmark clips are re-cached properly later
    json.dump(est, open(f"{OUTPUT_DIR}/benchmark_estimates.json", "w"), indent=1)
    return est

if RUN_BENCHMARK:
    est = bench_plan()
    print(json.dumps(est, indent=1))
    tot = sum(v["train_gpu_hours_est"] + v["cache_gpu_hours_est"] for v in est.values())
    print(f"whole plan: ~{tot:.0f} GPU-hours = ~{tot / world:.0f} wall-clock hours on {world} GPUs "
          f"(~{tot / world / SESSION_HOURS:.1f} Kaggle sessions)")
''')

md("""
## 9 · Resume state from earlier sessions

To continue a run, attach the previous notebook version's output as an input dataset. This cell copies its
`afterframe_run/` back into `/kaggle/working` when it is further along. If `HF_REPO` is set, checkpoints are
also mirrored there during training.
""")
code(r'''
def run_step(path):
    try:
        return json.load(open(f"{path}/plan_state.json"))["global_step"]
    except Exception:
        return -1

candidates = [os.path.dirname(p) for p in glob.glob("/kaggle/input/**/afterframe_run/plan_state.json", recursive=True)]
best = max(candidates, key=run_step, default=None)
if best and run_step(best) > run_step(OUTPUT_DIR):
    print("restoring", best, "step", run_step(best))
    shutil.copytree(best, OUTPUT_DIR, dirs_exist_ok=True)
plan_path = f"{OUTPUT_DIR}/plan_state.json"
plan = json.load(open(plan_path)) if os.path.exists(plan_path) else {"preset": PRESET, "trained": {}, "global_step": 0}
assert plan["preset"] == PRESET, f"this run was started with preset {plan['preset']}"
print(json.dumps(plan, indent=1)[:1500])
''')

md("""
## 10 · Training: progressive stages × shard chunks, time-budgeted

For each stage, and each chunk of `SHARDS_PER_CHUNK` shards not yet trained in that stage, the loop:
1. caches the chunk's latents and embeddings on both GPUs;
2. trains on it under DDP until the chunk is done or the session budget runs out;
3. records progress in `plan_state.json` and frees the chunk's cache.

When the session ends mid-chunk, the next session resumes at the same batch. Run *Save Version* (or keep
`HF_REPO` set) so `/kaggle/working/afterframe_run` survives.
""")
code(r'''
gpu_log = open(f"{OUTPUT_DIR}/gpu_monitor.csv", "a")
monitor = subprocess.Popen(["nvidia-smi", "--query-gpu=timestamp,index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
                            "--format=csv,noheader", "-l", "30"], stdout=gpu_log)
names = sorted(shards)
chunks = [names[i:i + SHARDS_PER_CHUNK] for i in range(0, len(names), SHARDS_PER_CHUNK)]
extra = ["--hub-repo", HF_REPO] if HF_REPO else []
try:
    for si, st in enumerate(cfg["stages"]):
        stage_chunks = chunks[: max(1, round(len(chunks) * fractions[si]))]
        done = set(plan["trained"].get(st["name"], []))
        for chunk in stage_chunks:
            key = ",".join(chunk)
            if key in done:
                continue
            if remaining_minutes() < 30:
                raise StopIteration
            wan("cache", "--preset", PRESET, "--stage", str(si), "--model-path", MODEL_DIR, "--cache-dir", CACHE_DIR,
                "--dataset", *DATASET_ROOTS, "--shards", key)
            wan("train", "--preset", PRESET, "--stage", str(si), "--model-path", MODEL_DIR, "--cache-dir", CACHE_DIR,
                "--output-dir", OUTPUT_DIR, "--shards", key, "--total-steps", str(TOTAL_STEPS),
                "--max-train-minutes", str(int(remaining_minutes())), *extra)
            stop = json.load(open(f"{OUTPUT_DIR}/last_stop.json"))
            plan["global_step"] = stop["step"]
            if stop["reason"] == "chunk_done":
                plan["trained"].setdefault(st["name"], []).append(key)
                if DELETE_CACHE_AFTER_TRAINING:
                    for s in chunk:
                        shutil.rmtree(f"{CACHE_DIR}/{st['name']}/{s}", ignore_errors=True)
            json.dump(plan, open(plan_path, "w"), indent=1)
            if stop["reason"] != "chunk_done":
                raise StopIteration
    print("ALL STAGES AND SHARDS TRAINED")
except StopIteration:
    print(f"session budget reached at step {plan['global_step']}; save this version and continue next session")
finally:
    monitor.terminate(); gpu_log.close()
    json.dump(plan, open(plan_path, "w"), indent=1)
''')

md("## 11 · Loss, validation loss and GPU memory")
code(r'''
import matplotlib.pyplot as plt, numpy as np, csv
def jl(p): return [json.loads(l) for l in open(p)] if os.path.exists(p) else []
tl, vl = jl(f"{OUTPUT_DIR}/logs/train_log.jsonl"), jl(f"{OUTPUT_DIR}/logs/val_log.jsonl")
fig, ax = plt.subplots(1, 3, figsize=(18, 4))
if tl:
    s, l = np.array([r["step"] for r in tl]), np.array([r["loss"] for r in tl])
    ax[0].plot(s, l, alpha=.3, label="train (per log)")
    k = max(1, len(l) // 50); ax[0].plot(s[k - 1:], np.convolve(l, np.ones(k) / k, "valid"), label=f"train (avg {k})")
    for st in sorted({r["stage"] for r in tl}):
        first = next(r["step"] for r in tl if r["stage"] == st); ax[0].axvline(first, ls=":", c="gray")
    ax[1].plot(s, [r["lr"] for r in tl]); ax[1].set_title("learning rate")
    mem = np.array([r["peak_mem_gb"] for r in tl])
    for g in range(mem.shape[1]): ax[2].plot(s, mem[:, g], label=f"rank {g} peak allocated")
if vl:
    ax[0].plot([r["step"] for r in vl], [r["val_loss"] for r in vl], "o-", label="held-out (fixed noise)")
ax[0].set_title("flow-matching loss"); ax[0].legend(); ax[2].set_title("GPU memory (GB)")
if os.path.exists(f"{OUTPUT_DIR}/gpu_monitor.csv"):
    per_gpu = {}
    for r in csv.reader(open(f"{OUTPUT_DIR}/gpu_monitor.csv")):
        try:
            per_gpu.setdefault(r[1].strip(), []).append(float(r[3].split()[0]) / 1024)   # "1234 MiB" -> GB
        except (IndexError, ValueError):
            continue
    for g, used in sorted(per_gpu.items()):
        ax[2].plot(np.linspace(s.min() if tl else 0, s.max() if tl else 1, len(used)), used, ls="--", label=f"nvidia-smi GPU {g} (all processes)")
ax[2].axhline(15.0, c="r", ls=":"); ax[2].legend()
plt.tight_layout(); plt.savefig(f"{OUTPUT_DIR}/training_curves.png", dpi=110); plt.show()
if tl:
    print({k: tl[-1][k] for k in ("step", "loss", "samples_per_s", "sec_per_opt_step", "peak_mem_gb", "nonfinite")})
''')

md("## 12 · Validation videos written during training")
code(r'''
from IPython.display import HTML, display
import base64
vids = sorted(glob.glob(f"{OUTPUT_DIR}/validation/step_*/prompt*.mp4"))
for p in vids[-6:]:
    txt = open(p.replace(".mp4", ".txt")).read()
    b64 = base64.b64encode(open(p, "rb").read()).decode()
    display(HTML(f"<p><b>{p.split('/')[-2]}</b> — {txt}</p><video src='data:video/mp4;base64,{b64}' controls loop width=480></video>"))
''')

md("## 13 · Export the final LoRA (.safetensors)")
code(r'''
LORA_PATH = f"{OUTPUT_DIR}/afterframe_sora2_lora.safetensors"
run([sys.executable, f"{WORK}/afterframe_wan.py", "export", "--checkpoint-roots", f"{OUTPUT_DIR}/checkpoints", "--out", LORA_PATH])
!ls -la {OUTPUT_DIR}/*.safetensors
if HF_REPO:
    from huggingface_hub import HfApi
    for f in [LORA_PATH, LORA_PATH.replace(".safetensors", "_comfyui.safetensors")]:
        HfApi().upload_file(path_or_fileobj=f, path_in_repo=os.path.basename(f), repo_id=HF_REPO)
''')

md("""
## 14 · Inference: unseen prompts, base vs. fine-tuned

The transformer and VAE go on `cuda:0` and umT5 on `cuda:1`. Each prompt is generated twice with the same
seed: once with the LoRA disabled (base Wan) and once at `LORA_STRENGTH`.
""")
code(r'''
PROMPTS = [
    "Sora 2 video, prompt: A realistic handheld recording of an abandoned shopping mall at night.",
    "Sora 2 video, prompt: A golden retriever shakes off water after jumping out of a lake at sunset, slow motion.",
]
LORA_STRENGTH = 1.0
SEED = 1234
WIDTH, HEIGHT = 832, 480       # Wan2.1-1.3B native; multiples of 16 (32 for Wan2.2-5B)
NUM_FRAMES = 49                # 4k+1; 81 = 5 s at 16 fps
GUIDANCE = 5.0
STEPS = 30
COMPARE_WITH_BASE = True

gen = aw.Generator(cfg["model"], MODEL_DIR, lora=LORA_PATH)
os.makedirs(f"{WORK}/inference", exist_ok=True)
for i, prompt in enumerate(PROMPTS):
    kw = dict(seed=SEED + i, width=WIDTH, height=HEIGHT, num_frames=NUM_FRAMES, steps=STEPS, guidance=GUIDANCE)
    stem = f"{WORK}/inference/{i:02d}"
    t0 = time.time(); aw.write_mp4(gen(prompt, lora_strength=LORA_STRENGTH, **kw), f"{stem}_lora.mp4", model_info["fps"])
    print(f"[{i}] LoRA {time.time() - t0:.0f}s", end="  ")
    if COMPARE_WITH_BASE:
        t0 = time.time(); aw.write_mp4(gen(prompt, lora_strength=0, **kw), f"{stem}_base.mp4", model_info["fps"])
        print(f"base {time.time() - t0:.0f}s", end="")
        aw.side_by_side(f"{stem}_base.mp4", f"{stem}_lora.mp4", f"{stem}_compare.mp4")
    print()
    show = f"{stem}_compare.mp4" if COMPARE_WITH_BASE else f"{stem}_lora.mp4"
    b64 = base64.b64encode(open(show, "rb").read()).decode()
    display(HTML(f"<p>{prompt}<br>left: base Wan · right: LoRA ×{LORA_STRENGTH} · seed {SEED + i}</p>"
                 f"<video src='data:video/mp4;base64,{b64}' controls loop width=960></video>"))
''')

md("""
### LoRA strength sweep (same prompt and seed)
""")
code(r'''
for s in [0.0, 0.5, 1.0, 1.25]:
    aw.write_mp4(gen(PROMPTS[0], lora_strength=s, seed=SEED, width=WIDTH, height=HEIGHT, num_frames=33, steps=STEPS,
                     guidance=GUIDANCE), f"{WORK}/inference/sweep_{s:.2f}.mp4", model_info["fps"])
print(sorted(glob.glob(f"{WORK}/inference/sweep_*.mp4")))
''')

nb["cells"] = cells
nb["metadata"] = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python"},
    "kaggle": {"accelerator": "nvidiaTeslaT4", "isInternetEnabled": True, "isGpuEnabled": True},
}
out = HERE / "afterframe_lora_training.ipynb"
nbf.write(nb, str(out))
print("wrote", out, len(cells), "cells")
