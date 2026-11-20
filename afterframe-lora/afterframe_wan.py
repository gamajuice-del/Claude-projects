#!/usr/bin/env python3
"""
afterframe_wan.py — LoRA fine-tuning of Wan text-to-video models on Afterframe, built for Kaggle's 2 x T4.

Subcommands (all rank-aware; launch with `torchrun --nproc_per_node=2 afterframe_wan.py <cmd> ...`):

  cache    decode clips -> VAE latents, captions -> umT5 embeddings, written per stage and per shard
  train    DDP LoRA training on cached tensors (fp16 autocast + GradScaler, gradient checkpointing,
           gradient accumulation, 8-bit AdamW, resumable, time-budgeted)
  export   turn a checkpoint into a portable .safetensors LoRA (diffusers and ComfyUI key layouts)
  infer    generate videos with / without the LoRA from the same prompt and seed
  presets  print the preset table

Hardware notes (Tesla T4 = Turing, sm_75):
  * no bf16 compute: everything runs fp16 autocast, with LoRA weights and optimizer state in fp32 and a
    dynamic loss scaler; modules diffusers marks _keep_in_fp32_modules stay fp32;
  * no FlashAttention 2: PyTorch SDPA is restricted to its memory-efficient and math kernels, both of
    which support sm_75;
  * the two GPUs are separate 16 GB devices: training is DistributedDataParallel, so every GPU holds its own
    copy of the frozen base model and its own activations; only LoRA gradients are all-reduced.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import glob
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.distributed as dist
import torch.nn.functional as F

CAPTION_PREFIX = "Sora 2 video, prompt: "
DEFAULT_NEGATIVE = ("Bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, "
                    "static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, "
                    "extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, "
                    "fused fingers, still picture, messy background, three legs, many people in the background, "
                    "walking backwards")
DEFAULT_VAL_PROMPTS = [
    CAPTION_PREFIX + "A realistic handheld recording of an abandoned shopping mall at night.",
    CAPTION_PREFIX + "A slow dolly shot through a sunlit greenhouse as mist drifts between hanging ferns.",
    CAPTION_PREFIX + "A street musician plays violin on a rainy Paris bridge while pedestrians hurry past with umbrellas.",
]

# ------------------------------------------------------------------------------------------------
# model registry and presets
# ------------------------------------------------------------------------------------------------
MODELS = {
    "wan21_1.3b": {"repo": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers", "spatial": 16, "fps": 16, "flow_shift": 3.0,
                   "expand_timesteps": False},
    "wan22_5b": {"repo": "Wan-AI/Wan2.2-TI2V-5B-Diffusers", "spatial": 32, "fps": 24, "flow_shift": 5.0,
                 "expand_timesteps": True},
}

TARGETS = {
    # diffusers WanTransformer3DModel module names (regex, full match)
    "self_attn": r"blocks\.\d+\.attn1\.(to_q|to_k|to_v|to_out\.0)",
    "attn": r"blocks\.\d+\.(attn1|attn2)\.(to_q|to_k|to_v|to_out\.0)",
    "attn_ffn": r"blocks\.\d+\.((attn1|attn2)\.(to_q|to_k|to_v|to_out\.0)|ffn\.net\.0\.proj|ffn\.net\.2)",
}


def _buckets(w: int, h: int, sq: int) -> list[list[int]]:
    return [[w, h], [h, w], [sq, sq]]


PRESETS: dict[str, dict] = {
    # tiny end-to-end check on the real model: minutes, not hours
    "smoke": dict(model="wan21_1.3b", rank=8, alpha=8, targets="attn", lr=1e-4, accum=1, batch=1,
                  clips_per_video=1, stages=[dict(name="smoke_192p", buckets=_buckets(320, 192, 256), frames=[17])]),
    # fits comfortably in 16 GB, quickest per sample
    "low_memory": dict(model="wan21_1.3b", rank=16, alpha=16, targets="self_attn", lr=1e-4, accum=4, batch=1,
                       clips_per_video=2,
                       stages=[dict(name="s1_288p_33f", buckets=_buckets(512, 288, 384), frames=[33])]),
    # recommended: progressive 288p -> 352p, attention + cross-attention
    "balanced": dict(model="wan21_1.3b", rank=32, alpha=32, targets="attn", lr=1e-4, accum=4, batch=1,
                     clips_per_video=2,
                     stages=[dict(name="s1_288p_33f", buckets=_buckets(512, 288, 384), frames=[33], shard_fraction=0.5),
                             dict(name="s2_352p_49f", buckets=_buckets(640, 352, 480), frames=[49], shard_fraction=1.0)]),
    # native Wan2.1 480p, 81 frames, attention + FFN; slowest, highest fidelity
    "max_quality": dict(model="wan21_1.3b", rank=64, alpha=64, targets="attn_ffn", lr=5e-5, accum=8, batch=1,
                        clips_per_video=2,
                        stages=[dict(name="s1_288p_33f", buckets=_buckets(512, 288, 384), frames=[33], shard_fraction=0.25),
                                dict(name="s2_352p_49f", buckets=_buckets(640, 352, 480), frames=[49], shard_fraction=1.0),
                                dict(name="s3_480p_81f", buckets=_buckets(832, 480, 624), frames=[81], shard_fraction=0.15)]),
    # Wan2.2 TI2V-5B: stronger base, but 10 GB of fp16 weights per T4. Experimental: smoke-test first.
    "wan22_5b_experimental": dict(model="wan22_5b", rank=32, alpha=32, targets="attn", lr=5e-5, accum=4, batch=1,
                                  clips_per_video=2,
                                  stages=[dict(name="s1_352p_49f", buckets=_buckets(640, 352, 480), frames=[49], shard_fraction=1.0),
                                          dict(name="s2_480p_73f", buckets=_buckets(832, 480, 640), frames=[73], shard_fraction=0.3)]),
}


# ------------------------------------------------------------------------------------------------
# distributed helpers
# ------------------------------------------------------------------------------------------------
@dataclass
class Dist:
    rank: int = 0
    world: int = 1
    local_rank: int = 0
    device: torch.device = field(default_factory=lambda: torch.device("cpu"))

    @property
    def main(self) -> bool:
        return self.rank == 0


def init_dist() -> Dist:
    world = int(os.environ.get("WORLD_SIZE", "1"))
    rank = int(os.environ.get("RANK", "0"))
    local = int(os.environ.get("LOCAL_RANK", "0"))
    cuda = torch.cuda.is_available()
    if cuda:
        torch.cuda.set_device(local)
        device = torch.device("cuda", local)
    else:
        device = torch.device("cpu")
    if world > 1 and not dist.is_initialized():
        # Kaggle's T4 pair talks over PCIe; P2P is disabled by default for robustness (LoRA all-reduce is small).
        os.environ.setdefault("NCCL_P2P_DISABLE", "1")
        dist.init_process_group(backend="nccl" if cuda else "gloo", timeout=dt.timedelta(minutes=90),
                                **({"device_id": device} if cuda else {}))
    return Dist(rank, world, local, device)


def barrier(d: Dist) -> None:
    if d.world > 1:
        dist.barrier()


def all_mean(d: Dist, value: float) -> float:
    if d.world == 1:
        return value
    t = torch.tensor([value], dtype=torch.float64, device=d.device)
    dist.all_reduce(t)
    return float(t.item()) / d.world


def all_sum(d: Dist, values: list[float]) -> list[float]:
    if d.world == 1:
        return values
    t = torch.tensor(values, dtype=torch.float64, device=d.device)
    dist.all_reduce(t)
    return t.tolist()


def gather_obj(d: Dist, obj):
    if d.world == 1:
        return [obj]
    out = [None] * d.world
    dist.all_gather_object(out, obj)
    return out


def log(d: Dist | None, msg: str, all_ranks: bool = False) -> None:
    if d is None or d.main or all_ranks:
        tag = f"[rank{d.rank}]" if d is not None and d.world > 1 else ""
        print(time.strftime("[%H:%M:%S]") + tag + " " + msg, flush=True)


def configure_hardware(d: Dist) -> dict:
    info = {"device": str(d.device), "cuda": torch.cuda.is_available()}
    if torch.cuda.is_available():
        cap = torch.cuda.get_device_capability(d.device)
        info.update(name=torch.cuda.get_device_name(d.device), capability=f"{cap[0]}.{cap[1]}",
                    total_gb=round(torch.cuda.get_device_properties(d.device).total_memory / 2**30, 2))
        if cap < (8, 0):
            # Turing: FlashAttention kernels need sm_80+. Keep SDPA on mem-efficient (xFormers-style) + math.
            torch.backends.cuda.enable_flash_sdp(False)
            torch.backends.cuda.enable_mem_efficient_sdp(True)
            torch.backends.cuda.enable_math_sdp(True)
            info["attention"] = "sdpa: mem_efficient + math (flash disabled, sm<80)"
        info["bf16_native"] = cap >= (8, 0)
    return info


def amp_ctx(d: Dist, enabled: bool):
    if enabled and d.device.type == "cuda":
        return torch.autocast("cuda", dtype=torch.float16)
    return contextlib.nullcontext()


# ------------------------------------------------------------------------------------------------
# config
# ------------------------------------------------------------------------------------------------
def resolve_config(args) -> dict:
    preset = json.loads(json.dumps(PRESETS[args.preset]))
    for key in ("model", "rank", "alpha", "lr", "accum", "batch", "targets", "clips_per_video"):
        val = getattr(args, key, None)
        if val is not None:
            preset[key] = val
    model = MODELS[preset["model"]]
    preset["model_info"] = model
    preset["model_path"] = getattr(args, "model_path", None) or model["repo"]
    preset["fps"] = getattr(args, "target_fps", None) or model["fps"]
    for st in preset["stages"]:
        for w, h in st["buckets"]:
            assert w % model["spatial"] == 0 and h % model["spatial"] == 0, f"bucket {w}x{h} not /{model['spatial']}"
        for f in st["frames"]:
            assert (f - 1) % 4 == 0, f"frame count {f} must be 4k+1"
    preset["preset"] = args.preset
    return preset


def stage_cfg(cfg: dict, stage: int) -> dict:
    if not 0 <= stage < len(cfg["stages"]):
        raise SystemExit(f"preset {cfg['preset']} has stages 0..{len(cfg['stages']) - 1}")
    return cfg["stages"][stage]


# ------------------------------------------------------------------------------------------------
# dataset discovery (output of prepare_dataset.py, possibly split over several Kaggle input datasets)
# ------------------------------------------------------------------------------------------------
def discover_shards(roots: list[str]) -> dict[str, Path]:
    """Map shard name -> folder holding manifest.jsonl, videos/, captions/."""
    found: dict[str, Path] = {}
    for root in roots:
        for m in sorted(glob.glob(os.path.join(root, "**", "shard_*", "manifest.jsonl"), recursive=True)):
            p = Path(m).parent
            found.setdefault(p.name, p)
    return found


def read_manifest(shard_dir: Path) -> list[dict]:
    rows = []
    with (shard_dir / "manifest.jsonl").open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get("_type"):
                continue
            caption = (shard_dir / "captions" / (r["id"] + ".txt")).read_text(encoding="utf-8")
            # the caption file is the source of truth for training text; it must equal prefix + backend prompt
            if caption != CAPTION_PREFIX + r["backend_prompt"] or caption != r["training_caption"]:
                raise ValueError(f"caption mismatch for {r['id']} in {shard_dir}")
            r["_caption"] = caption
            r["_video"] = str(shard_dir / "videos" / Path(r["video_path"]).name)
            rows.append(r)
    return rows


# ------------------------------------------------------------------------------------------------
# video decoding, bucketing and clip planning
# ------------------------------------------------------------------------------------------------
def nearest_bucket(w: int, h: int, buckets: list[list[int]]) -> tuple[int, int]:
    ar = math.log(w / h)
    bw, bh = min(buckets, key=lambda b: abs(math.log(b[0] / b[1]) - ar))
    return int(bw), int(bh)


def plan_clips(duration: float, frames_options: list[int], fps: float, max_clips: int) -> list[tuple[float, int]]:
    """Non-overlapping windows (start_seconds, frames). Uses the longest frame bucket that fits, spreads the
    windows evenly, and adds one shorter window from the leftover tail when a smaller bucket fits."""
    opts = sorted(frames_options, reverse=True)
    usable = duration - 0.05
    longest = next((f for f in opts if f / fps <= usable), None)
    if longest is None:
        return []
    span = longest / fps
    n = max(1, min(max_clips, int(usable // span)))
    gap = (usable - n * span) / (n + 1)
    clips = [(gap + i * (span + gap), longest) for i in range(n)]
    left = usable - n * span
    if len(clips) < max_clips:
        tail = next((f for f in opts if f / fps <= left and f < longest), None)
        if tail:
            clips = [(i * span, longest) for i in range(n)] + [(n * span, tail)]
    return clips


def decode_clip(path: str, start: float, frames: int, fps: float, w: int, h: int) -> np.ndarray | None:
    """ffmpeg: seek, resample to `fps`, cover-resize + centre-crop to w x h. Returns uint8 F x H x W x 3."""
    vf = f"fps={fps},scale={w}:{h}:force_original_aspect_ratio=increase:flags=bicubic,crop={w}:{h},setsar=1"
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{start:.3f}", "-i", path, "-map", "0:v:0",
           "-t", f"{frames / fps + 1.0:.3f}", "-vf", vf, "-frames:v", str(frames), "-pix_fmt", "rgb24",
           "-f", "rawvideo", "-"]
    proc = subprocess.run(cmd, capture_output=True, timeout=600)
    need = frames * w * h * 3
    if proc.returncode != 0 or len(proc.stdout) < need:
        return None
    return np.frombuffer(proc.stdout[:need], np.uint8).reshape(frames, h, w, 3)


def write_mp4(frames: np.ndarray, path: str | Path, fps: float) -> None:
    """frames: F x H x W x 3, uint8 or float in [0, 1]."""
    if frames.dtype != np.uint8:
        frames = (np.clip(frames, 0, 1) * 255).round().astype(np.uint8)
    f, h, w, _ = frames.shape
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps),
           "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium",
           "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", str(path)]
    subprocess.run(cmd, input=np.ascontiguousarray(frames).tobytes(), check=True)


# ------------------------------------------------------------------------------------------------
# loading model components
# ------------------------------------------------------------------------------------------------
def _from_pretrained(cls, path, dtype, device: torch.device | None = None, **kw):
    """Load straight onto the GPU when possible, so a process never holds a full CPU copy of the weights
    (two ranks x 11 GB of umT5 would not fit in Kaggle's ~30 GB of RAM)."""
    attempts = []
    if device is not None and device.type == "cuda":
        attempts.append({"device_map": {"": str(device)}})
    attempts.append({})
    last = None
    for extra in attempts:
        for dkey in ("torch_dtype", "dtype"):
            try:
                model = cls.from_pretrained(path, **{dkey: dtype}, **extra, **kw)
                return model.to(device) if device is not None else model
            except TypeError as exc:   # older/newer libraries name the dtype argument differently
                last = exc
            except (ValueError, NotImplementedError) as exc:
                last = exc
                break                  # this loader cannot take device_map: try the plain load
    raise last


def ensure_model(cfg: dict, d: Dist, parts: tuple[str, ...]) -> str:
    """Return a local folder for the model, downloading only the requested sub-folders (rank 0 first)."""
    path = cfg["model_path"]
    if os.path.isdir(path):
        return path
    from huggingface_hub import snapshot_download
    patterns = ["model_index.json", "*.txt"] + [f"{p}/*" for p in parts]
    if d.main:
        snapshot_download(path, allow_patterns=patterns)
    barrier(d)
    return snapshot_download(path, allow_patterns=patterns)


def load_text_encoder(path: str, device: torch.device, dtype=torch.float16):
    from transformers import AutoTokenizer, UMT5EncoderModel
    tok = AutoTokenizer.from_pretrained(path, subfolder="tokenizer")
    te = _from_pretrained(UMT5EncoderModel, path, dtype, device, subfolder="text_encoder").eval()
    te.requires_grad_(False)
    return tok, te


def load_vae(path: str, device: torch.device, dtype=torch.float32):
    from diffusers import AutoencoderKLWan
    vae = _from_pretrained(AutoencoderKLWan, path, dtype, device, subfolder="vae").eval()
    vae.requires_grad_(False)
    return vae


def load_transformer(path: str, device: torch.device, dtype=torch.float16):
    from diffusers import WanTransformer3DModel
    tr = _from_pretrained(WanTransformer3DModel, path, dtype, device, subfolder="transformer")
    tr.requires_grad_(False)
    return tr


def latent_stats(vae, device) -> tuple[torch.Tensor, torch.Tensor]:
    z = vae.config.z_dim
    mean = torch.tensor(vae.config.latents_mean, dtype=torch.float32, device=device).view(1, z, 1, 1, 1)
    std = torch.tensor(vae.config.latents_std, dtype=torch.float32, device=device).view(1, z, 1, 1, 1)
    return mean, std


@torch.no_grad()
def encode_prompts(tok, te, prompts: list[str], max_len: int = 512) -> list[dict]:
    """Same text processing as diffusers' WanPipeline._get_t5_prompt_embeds (prompt_clean, pad to max_len,
    attention mask, trim to the real length) so training and inference see identical embeddings.
    Also verifies the caption prefix survives tokenisation intact."""
    try:
        from diffusers.pipelines.wan.pipeline_wan import prompt_clean
    except Exception:  # pragma: no cover
        prompt_clean = lambda s: " ".join(s.split())  # noqa: E731
    device = next(te.parameters()).device
    cleaned = [prompt_clean(p) for p in prompts]
    enc = tok(cleaned, padding="max_length", max_length=max_len, truncation=True, add_special_tokens=True,
              return_attention_mask=True, return_tensors="pt")
    full = tok(cleaned, add_special_tokens=True, truncation=False)["input_ids"]
    prefix_ids = tok(CAPTION_PREFIX.rstrip(), add_special_tokens=False)["input_ids"]
    hidden = te(enc.input_ids.to(device), enc.attention_mask.to(device)).last_hidden_state
    out = []
    for i, p in enumerate(prompts):
        n = int(enc.attention_mask[i].sum())
        emb = hidden[i, :n].float()
        ids = enc.input_ids[i, :n].tolist()
        out.append({
            "embeds": emb.to(torch.float16).cpu(),
            "finite": bool(torch.isfinite(emb).all()),
            "tokens": n, "untruncated_tokens": len(full[i]), "truncated": len(full[i]) > max_len,
            "prefix_tokens_intact": (not p.startswith(CAPTION_PREFIX)) or ids[: len(prefix_ids)] == prefix_ids,
            "cleaned_text": cleaned[i],
        })
    return out


def pad_text(emb: torch.Tensor, max_len: int = 512) -> torch.Tensor:
    if emb.shape[0] >= max_len:
        return emb[:max_len]
    return torch.cat([emb, emb.new_zeros(max_len - emb.shape[0], emb.shape[1])], 0)


# ------------------------------------------------------------------------------------------------
# safetensors I/O
# ------------------------------------------------------------------------------------------------
def save_st(tensors: dict, path: Path, meta: dict | None = None) -> None:
    from safetensors.torch import save_file
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    save_file({k: v.contiguous() for k, v in tensors.items()}, str(tmp),
              metadata={k: (v if isinstance(v, str) else json.dumps(v)) for k, v in (meta or {}).items()})
    tmp.replace(path)


def load_st(path: Path) -> tuple[dict, dict]:
    from safetensors import safe_open
    with safe_open(str(path), framework="pt") as fh:
        meta = fh.metadata() or {}
        return {k: fh.get_tensor(k) for k in fh.keys()}, meta


# ------------------------------------------------------------------------------------------------
# CACHE
# ------------------------------------------------------------------------------------------------
def text_key(caption: str) -> str:
    return hashlib.sha256(caption.encode("utf-8")).hexdigest()[:32]


def cmd_cache(args) -> None:
    d = init_dist()
    hw = configure_hardware(d)
    cfg = resolve_config(args)
    st = stage_cfg(cfg, args.stage)
    cache = Path(args.cache_dir)
    shards = discover_shards(args.dataset)
    wanted = sorted(shards) if not args.shards else [s for s in args.shards.split(",") if s]
    missing = [s for s in wanted if s not in shards]
    if missing:
        raise SystemExit(f"shards not found under {args.dataset}: {missing}")
    log(d, f"hardware {hw}; stage {st['name']}; shards {wanted}")
    rows = []
    for s in wanted:
        for r in read_manifest(shards[s]):
            if args.max_videos_per_shard and sum(x["shard"] == s for x in rows) >= args.max_videos_per_shard:
                break
            rows.append(r)
    model_dir = ensure_model(cfg, d, ("tokenizer", "text_encoder", "vae", "scheduler"))
    stats = {"text": 0, "text_s": 0.0, "clips": 0, "clip_s": 0.0, "failed": 0, "truncated": 0}

    # ---- text: one embedding per unique caption, plus negative + validation prompts ------------------
    if "text" in args.what:
        tdir = cache / "text"
        texts = {text_key(r["_caption"]): r["_caption"] for r in rows}
        extras = {"_negative": args.negative_prompt, "_empty": ""}
        for i, p in enumerate(load_val_prompts(args.val_prompts)):
            extras[f"_val{i:02d}"] = p
        todo = [(k, t) for k, t in sorted(texts.items()) + sorted(extras.items()) if not (tdir / f"{k}.safetensors").exists()]
        mine = todo[d.rank::d.world]
        for r in range(d.world):           # ranks load one after another to bound peak CPU RAM
            if r == d.rank and mine:
                tok, te = load_text_encoder(model_dir, d.device)
            barrier(d)
        if mine:
            t0 = time.time()
            for i in range(0, len(mine), args.text_batch):
                chunk = mine[i:i + args.text_batch]
                res = encode_prompts(tok, te, [t for _, t in chunk])
                for (k, t), r in zip(chunk, res):
                    if not r["finite"]:
                        raise SystemExit("umT5 produced non-finite fp16 embeddings; rerun cache with --text-fp32-cpu")
                    if not r["prefix_tokens_intact"]:
                        raise SystemExit(f"caption prefix was altered by tokenisation for: {t[:80]!r}")
                    stats["truncated"] += r["truncated"]
                    save_st({"embeds": r["embeds"]}, tdir / f"{k}.safetensors",
                            {"text": t, "tokens": str(r["tokens"]), "untruncated_tokens": str(r["untruncated_tokens"]),
                             "truncated": str(r["truncated"])})
                stats["text"] += len(chunk)
                if (i // args.text_batch) % 20 == 0:
                    log(d, f"text {stats['text']}/{len(mine)} on this rank", all_ranks=True)
            stats["text_s"] = time.time() - t0
            del te
            torch.cuda.empty_cache() if torch.cuda.is_available() else None
        barrier(d)

    # ---- latents -------------------------------------------------------------------------------------
    if "latents" in args.what:
        vae = load_vae(model_dir, d.device, torch.float32)
        if hasattr(vae, "enable_tiling") and args.vae_tiling:
            vae.enable_tiling()
        mean, std = latent_stats(vae, d.device)
        vae16 = None
        vae_dtype = {"fp32": torch.float32, "fp16": torch.float16}.get(args.vae_dtype)
        jobs = []
        for r in rows:
            bw, bh = nearest_bucket(r["width"], r["height"], st["buckets"])
            for ci, (start, nf) in enumerate(plan_clips(r["duration"], st["frames"], cfg["fps"], cfg["clips_per_video"])):
                key = f"{r['id']}_c{ci}_{bw}x{bh}x{nf}"
                # val clips live in one shared folder so deleting a trained shard's cache keeps them
                group = "val" if r["split"] == "val" else r["shard"]
                out = cache / st["name"] / group / "latents" / f"{key}.safetensors"
                jobs.append((r, key, start, nf, bw, bh, out))
        todo = [j for j in jobs if not j[-1].exists()]
        mine = todo[d.rank::d.world]
        log(d, f"{len(jobs)} clips planned, {len(todo)} to encode ({len(mine)} on rank {d.rank})", all_ranks=True)

        def encode(x, dtype):
            model = vae if dtype == torch.float32 else vae16
            z = model.encode(x.to(dtype)).latent_dist.mode().float()
            return (z - mean) / std

        # prefetch decoding on a CPU thread while the GPU encodes
        from concurrent.futures import ThreadPoolExecutor
        pool = ThreadPoolExecutor(max_workers=args.decode_workers)
        futs = [pool.submit(decode_clip, j[0]["_video"], j[2], j[3], cfg["fps"], j[4], j[5]) for j in mine[:args.decode_workers * 2]]
        nxt = len(futs)
        t0 = time.time()
        for idx, job in enumerate(mine):
            r, key, start, nf, bw, bh, out = job
            frames = futs[idx].result()
            futs[idx] = None
            if nxt < len(mine):
                j = mine[nxt]
                futs.append(pool.submit(decode_clip, j[0]["_video"], j[2], j[3], cfg["fps"], j[4], j[5]))
                nxt += 1
            if frames is None:
                stats["failed"] += 1
                log(d, f"decode failed: {key}", all_ranks=True)
                continue
            x = torch.from_numpy(frames).to(d.device).permute(3, 0, 1, 2).unsqueeze(0).float().div_(127.5).sub_(1)
            with torch.no_grad():
                if vae_dtype is None:   # "auto": test fp16 against fp32 once, then commit
                    ref = encode(x, torch.float32)
                    vae16 = load_vae(model_dir, d.device, torch.float16)
                    if hasattr(vae16, "enable_tiling") and args.vae_tiling:
                        vae16.enable_tiling()
                    t16 = encode(x, torch.float16)
                    err = float((t16 - ref).abs().mean() / ref.abs().mean())
                    ok = bool(torch.isfinite(t16).all()) and err < args.vae_fp16_tolerance
                    vae_dtype = torch.float16 if ok else torch.float32
                    log(d, f"VAE fp16 vs fp32 relative error {err:.4f} -> using {'fp16' if ok else 'fp32'}", all_ranks=True)
                    if not ok:
                        del vae16
                        vae16 = None
                    z = ref
                else:
                    if vae_dtype == torch.float16 and vae16 is None:
                        vae16 = load_vae(model_dir, d.device, torch.float16)
                        if hasattr(vae16, "enable_tiling") and args.vae_tiling:
                            vae16.enable_tiling()
                    z = encode(x, vae_dtype)
            if not torch.isfinite(z).all():
                stats["failed"] += 1
                log(d, f"non-finite latents: {key}", all_ranks=True)
                continue
            save_st({"latents": z[0].to(torch.float16).cpu()}, out,
                    {"post_id": r["id"], "shard": r["shard"], "split": r["split"], "text_key": text_key(r["_caption"]),
                     "start": f"{start:.3f}", "frames": str(nf), "width": str(bw), "height": str(bh),
                     "fps": str(cfg["fps"]), "model": cfg["model"], "dup_group": r["dup_group"]})
            stats["clips"] += 1
            if idx % 25 == 0:
                el = time.time() - t0
                log(d, f"latents {idx + 1}/{len(mine)}  {el / (idx + 1):.2f}s/clip", all_ranks=True)
        pool.shutdown()
        stats["clip_s"] = time.time() - t0
        barrier(d)
        if d.main:
            write_index(cache / st["name"], wanted + ["val"])

    allstats = gather_obj(d, stats)
    if d.main:
        bench = {"kind": "cache", "time": time.time(), "preset": cfg["preset"], "stage": st["name"], "hardware": hw,
                 "world": d.world, "per_rank": allstats,
                 "sec_per_clip": [s["clip_s"] / s["clips"] for s in allstats if s["clips"]],
                 "sec_per_text": [s["text_s"] / s["text"] for s in allstats if s["text"]]}
        with (cache / "benchmarks.jsonl").open("a") as fh:
            fh.write(json.dumps(bench) + "\n")
        log(d, f"cache done: {bench['per_rank']}")
    barrier(d)


def write_index(stage_dir: Path, shards: list[str]) -> None:
    """index.jsonl per shard lists every cached clip (read from safetensors headers)."""
    from safetensors import safe_open
    for s in shards:
        if not (stage_dir / s / "latents").exists():
            continue
        rows = []
        for p in sorted((stage_dir / s / "latents").glob("*.safetensors")):
            with safe_open(str(p), framework="pt") as fh:
                meta = fh.metadata()
                shape = list(fh.get_slice("latents").get_shape())
            rows.append({"key": p.stem, "path": str(p.relative_to(stage_dir)), "shape": shape, **meta})
        (stage_dir / s).mkdir(parents=True, exist_ok=True)
        with (stage_dir / s / "index.jsonl").open("w") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")


def load_val_prompts(path: str | None) -> list[str]:
    if not path:
        return list(DEFAULT_VAL_PROMPTS)
    return [ln.rstrip("\n") for ln in Path(path).read_text(encoding="utf-8").splitlines() if ln.strip()]


# ------------------------------------------------------------------------------------------------
# TRAIN
# ------------------------------------------------------------------------------------------------
class ClipSet(torch.utils.data.Dataset):
    def __init__(self, entries: list[dict], stage_dir: Path, text_dir: Path):
        self.entries, self.stage_dir, self.text_dir = entries, stage_dir, text_dir

    def __len__(self):
        return len(self.entries)

    def __getitem__(self, i):
        e = self.entries[i]
        lat, _ = load_st(self.stage_dir / e["path"])
        txt, _ = load_st(self.text_dir / f"{e['text_key']}.safetensors")
        return {"latents": lat["latents"], "text": pad_text(txt["embeds"]), "key": e["key"]}


def collate(items):
    return {"latents": torch.stack([i["latents"] for i in items]), "text": torch.stack([i["text"] for i in items]),
            "keys": [i["key"] for i in items]}


def load_entries(stage_dir: Path, shards: list[str], split: str, required: bool = True) -> list[dict]:
    out = []
    for s in shards:
        idx = stage_dir / s / "index.jsonl"
        if not idx.exists():
            if not required:
                continue
            raise SystemExit(f"no cache index for {s} in {stage_dir}; run `cache` first")
        for line in idx.read_text().splitlines():
            e = json.loads(line)
            if e["split"] == split:
                out.append(e)
    return out


def make_batches(entries: list[dict], batch: int, seed: int) -> list[list[int]]:
    """Group by bucket (identical tensor shapes), chunk into batches, shuffle batches."""
    rng = random.Random(seed)
    groups: dict[str, list[int]] = {}
    for i, e in enumerate(entries):
        groups.setdefault(json.dumps(e["shape"]), []).append(i)
    batches = []
    for idxs in groups.values():
        rng.shuffle(idxs)
        batches += [idxs[j:j + batch] for j in range(0, len(idxs) - batch + 1, batch)]
    rng.shuffle(batches)
    return batches


def lr_lambda_factory(warmup: int, total: int, min_ratio: float, kind: str):
    def f(step):
        if step < warmup:
            return (step + 1) / max(1, warmup)
        if kind == "constant":
            return 1.0
        prog = min(1.0, (step - warmup) / max(1, total - warmup))
        return min_ratio + (1 - min_ratio) * 0.5 * (1 + math.cos(math.pi * prog))
    return f


def sample_sigmas(n: int, shift: float, mode: str, gen: torch.Generator, device) -> torch.Tensor:
    if mode == "logit_normal":
        u = torch.sigmoid(torch.randn(n, generator=gen))
    else:
        u = torch.rand(n, generator=gen)
    u = u.clamp(1e-3, 1 - 1e-3)
    return (shift * u / (1 + (shift - 1) * u)).to(device)


def flow_inputs(x0: torch.Tensor, sigma: torch.Tensor, noise: torch.Tensor, expand: bool):
    s = sigma.view(-1, 1, 1, 1, 1)
    xt = (1 - s) * x0 + s * noise
    target = noise - x0
    t = sigma * 1000.0
    if expand:   # Wan2.2 TI2V: one timestep per latent token (all equal for text-to-video)
        b, _, f, h, w = x0.shape
        t = t.view(b, 1).expand(b, f * (h // 2) * (w // 2))
    return xt, target, t


def find_checkpoints(roots: list[str]) -> list[Path]:
    found = []
    for root in roots:
        for p in glob.glob(os.path.join(root, "**", "step_*", "training_state.pt"), recursive=True):
            found.append(Path(p).parent)
    return sorted(set(found), key=lambda p: int(re.search(r"step_(\d+)", p.name).group(1)))


def lora_state(model) -> dict[str, torch.Tensor]:
    from peft.utils import get_peft_model_state_dict
    return {k: v.detach().float().cpu() for k, v in get_peft_model_state_dict(model).items()}


def save_checkpoint(out_dir: Path, step: int, model, optimizer, scaler, sched, state: dict, cfg: dict,
                    keep: int, d: Dist, hub=None) -> Path:
    ckdir = out_dir / f"step_{step:07d}"
    if d.main:
        tmp = out_dir / f".tmp_step_{step:07d}"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        save_st(lora_state(model), tmp / "lora_peft.safetensors",
                {"rank": str(cfg["rank"]), "alpha": str(cfg["alpha"]), "targets": cfg["targets"], "step": str(step)})
        torch.save({"optimizer": optimizer.state_dict(), "scaler": scaler.state_dict(), "sched": sched.state_dict(),
                    "state": state, "rng": {"python": random.getstate(), "torch": torch.get_rng_state(),
                                            "numpy": np.random.get_state()}}, tmp / "training_state.pt")
        (tmp / "config.json").write_text(json.dumps(cfg, indent=1))
        shutil.rmtree(ckdir, ignore_errors=True)
        tmp.rename(ckdir)
        (out_dir / "latest.txt").write_text(ckdir.name)
        for old in find_checkpoints([str(out_dir)])[:-keep]:
            shutil.rmtree(old, ignore_errors=True)
        if hub:
            hub(ckdir)
    barrier(d)
    return ckdir


def make_hub_uploader(repo: str | None):
    if not repo:
        return None
    from huggingface_hub import HfApi
    api = HfApi()
    api.create_repo(repo, private=True, exist_ok=True)
    lock = threading.Lock()

    def upload(ckdir: Path):
        def run():
            with lock:
                try:
                    api.upload_folder(repo_id=repo, folder_path=str(ckdir), path_in_repo=f"checkpoints/{ckdir.name}")
                    print(f"[hub] uploaded {ckdir.name} to {repo}", flush=True)
                except Exception as exc:  # never kill training over an upload
                    print(f"[hub] upload failed: {exc}", flush=True)
        threading.Thread(target=run, daemon=True).start()
    return upload


def build_optimizer(params, name: str, lr: float, wd: float):
    if name == "adamw8bit":
        try:
            import bitsandbytes as bnb
            return bnb.optim.AdamW8bit(params, lr=lr, betas=(0.9, 0.999), weight_decay=wd), "adamw8bit"
        except Exception as exc:
            print(f"bitsandbytes unavailable ({exc}); falling back to torch AdamW", flush=True)
    return torch.optim.AdamW(params, lr=lr, betas=(0.9, 0.999), weight_decay=wd), "adamw"


def cmd_train(args) -> None:
    d = init_dist()
    hw = configure_hardware(d)
    if args.mixed_precision == "bf16":
        raise SystemExit("bf16 is not supported on T4 (sm_75); use fp16")
    use_amp = args.mixed_precision == "fp16" and d.device.type == "cuda"
    cfg = resolve_config(args)
    st = stage_cfg(cfg, args.stage)
    cache, out = Path(args.cache_dir), Path(args.output_dir)
    stage_dir, text_dir = cache / st["name"], cache / "text"
    shards = sorted(s for s in args.shards.split(",") if s) if args.shards else \
        sorted(p.name for p in stage_dir.glob("shard_*") if (p / "index.jsonl").exists())
    uncached = [s for s in shards if not (stage_dir / s / "index.jsonl").exists()]
    if uncached:
        raise SystemExit(f"shards {uncached} are not cached for stage {st['name']} in {stage_dir}")
    if not shards:
        raise SystemExit(f"no cached shards in {stage_dir}")
    random.seed(args.seed + d.rank)
    torch.manual_seed(args.seed + d.rank)
    np.random.seed(args.seed + d.rank)

    # ---- model + LoRA ----------------------------------------------------------------------------
    from peft import LoraConfig
    from peft.utils import set_peft_model_state_dict
    model_dir = ensure_model(cfg, d, ("transformer", "vae", "scheduler") if args.val_every else ("transformer",))
    for r in range(d.world):
        if r == d.rank:
            transformer = load_transformer(model_dir, d.device, torch.float16 if d.device.type == "cuda" else torch.float32)
        barrier(d)
    if args.gradient_checkpointing:
        transformer.enable_gradient_checkpointing()
    lcfg = LoraConfig(r=cfg["rank"], lora_alpha=cfg["alpha"], lora_dropout=args.lora_dropout,
                      init_lora_weights=True, target_modules=TARGETS[cfg["targets"]])
    transformer.add_adapter(lcfg)
    trainable = [p for n, p in transformer.named_parameters() if "lora_" in n]
    for p in trainable:
        p.data = p.data.float()       # fp32 master weights for the adapter (required by GradScaler)
        p.requires_grad_(True)
    n_train = sum(p.numel() for p in trainable)
    log(d, f"hardware {hw}")
    log(d, f"LoRA rank {cfg['rank']} alpha {cfg['alpha']} on '{cfg['targets']}': {n_train / 1e6:.2f}M trainable params")

    optimizer, opt_name = build_optimizer(trainable, args.optimizer, cfg["lr"], args.weight_decay)
    total = args.total_steps
    sched = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda_factory(args.warmup_steps, total, args.min_lr_ratio,
                                                                           args.lr_scheduler))
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp, init_scale=2.0 ** 14)

    # ---- resume ------------------------------------------------------------------------------------
    state = {"global_step": 0, "stage_steps": {}, "chunk": None, "pass": 0, "pos": 0, "completed": [],
             "samples": 0, "skipped_nonfinite": 0}
    roots = [str(out / "checkpoints")] + (args.resume_from or [])
    cks = find_checkpoints(roots) if args.resume else []
    if cks:
        ck = cks[-1]
        lora, _ = load_st(ck / "lora_peft.safetensors")
        res = set_peft_model_state_dict(transformer, {k: v.to(d.device) for k, v in lora.items()})
        unexpected = getattr(res, "unexpected_keys", [])
        if unexpected:
            raise SystemExit(f"checkpoint does not match this LoRA config: {unexpected[:3]}")
        for p in trainable:
            p.data = p.data.float()
        blob = torch.load(ck / "training_state.pt", map_location="cpu", weights_only=False)
        optimizer.load_state_dict(blob["optimizer"])
        scaler.load_state_dict(blob["scaler"])
        sched.load_state_dict(blob["sched"])
        state.update(blob["state"])
        log(d, f"resumed from {ck} at global step {state['global_step']}")
    else:
        log(d, "starting from the base model (no checkpoint found)" if args.resume else "fresh run (--no-resume)")

    model = transformer
    if d.world > 1:
        model = torch.nn.parallel.DistributedDataParallel(transformer, device_ids=[d.local_rank] if d.device.type == "cuda" else None,
                                                          gradient_as_bucket_view=True, find_unused_parameters=False)

    # ---- data ------------------------------------------------------------------------------------------
    chunk = ",".join(shards)
    if state["chunk"] != chunk:
        if state["chunk"] and state["pos"]:
            log(d, f"note: previous chunk {state['chunk']} stopped at batch {state['pos']}; starting chunk {chunk}")
        state.update(chunk=chunk, pos=0)
        state["pass"] = 0
    train_entries = load_entries(stage_dir, shards, "train")
    if args.max_clips:
        train_entries = train_entries[: args.max_clips]
    # fixed validation subset: ordered by a hash of the clip key, so it only grows as shards are cached
    val_entries = sorted(load_entries(stage_dir, ["val"], "val", required=False), key=lambda e: hash_str(e["key"]))
    val_entries = val_entries[: args.val_clips]
    trainset, valset = ClipSet(train_entries, stage_dir, text_dir), ClipSet(val_entries, stage_dir, text_dir)
    log(d, f"stage {st['name']}: {len(train_entries)} train clips in {shards}; {len(val_entries)} val clips")
    if not train_entries:
        raise SystemExit("no training clips")

    expand = cfg["model_info"]["expand_timesteps"]
    shift = args.timestep_shift or cfg["model_info"]["flow_shift"]
    log_path = out / "logs" / "train_log.jsonl"
    if d.main:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        (out / "run_config.json").write_text(json.dumps({"cfg": cfg, "args": vars(args), "hardware": hw,
                                                        "optimizer": opt_name, "world": d.world}, indent=1, default=str))
    hub = make_hub_uploader(args.hub_repo) if d.main else None
    t_start = time.time()
    deadline = t_start + args.max_train_minutes * 60 if args.max_train_minutes else None
    stop_reason = None
    accum = cfg["accum"]
    micro_bs = cfg["batch"]
    gen_noise = torch.Generator().manual_seed(args.seed * 1000 + d.rank + state["global_step"])
    step_t0, window_samples = time.time(), 0
    validator = Validator(args, cfg, st, model_dir, d, text_dir, valset, expand, shift) if args.val_every or args.val_loss_every else None

    while stop_reason is None:
        batches = make_batches(train_entries, micro_bs, args.seed + 7919 * state["pass"] + hash_str(chunk))
        per_rank = len(batches) // d.world
        n_opt = per_rank // accum
        usable = n_opt * accum * d.world              # identical on every rank
        if n_opt == 0:
            raise SystemExit(f"too few clips ({len(batches)} batches) for world {d.world} x accum {accum}")
        loader_order = batches[:usable]
        pos = state["pos"]
        # each optimizer step consumes world*accum batches; rank r takes every world-th batch
        mine = [loader_order[i] for i in range(pos + d.rank, usable, d.world)]
        dl = torch.utils.data.DataLoader(torch.utils.data.Subset(trainset, [i for b in mine for i in b]),
                                         batch_size=micro_bs, shuffle=False, num_workers=args.num_workers,
                                         collate_fn=collate, pin_memory=d.device.type == "cuda",
                                         persistent_workers=False, prefetch_factor=2 if args.num_workers else None)
        model.train()
        optimizer.zero_grad(set_to_none=True)
        micro = 0
        loss_acc, n_acc = 0.0, 0
        for batch in dl:
            micro += 1
            last = micro % accum == 0
            x0 = batch["latents"].to(d.device, non_blocking=True).float()
            text = batch["text"].to(d.device, non_blocking=True)
            noise = torch.randn(x0.shape, generator=gen_noise).to(d.device)
            sigma = sample_sigmas(x0.shape[0], shift, args.timestep_sampling, gen_noise, d.device)
            xt, target, t = flow_inputs(x0, sigma, noise, expand)
            sync = contextlib.nullcontext() if (last or d.world == 1) else model.no_sync()
            with sync:
                with amp_ctx(d, use_amp):
                    pred = model(hidden_states=xt.to(torch.float16 if use_amp else torch.float32),
                                 timestep=t, encoder_hidden_states=text.to(torch.float16 if use_amp else torch.float32),
                                 return_dict=False)[0]
                loss = F.mse_loss(pred.float(), target.float())
                # a non-finite loss is still back-propagated: the all-reduced gradients become non-finite on
                # every rank, and the step below is skipped everywhere (GradScaler also lowers its scale)
                scaler.scale(loss / accum).backward()
            loss_acc += float(loss.detach())
            n_acc += 1
            window_samples += x0.shape[0] * d.world
            if not last:
                continue
            scaler.unscale_(optimizer)
            gnorm = float(torch.nn.utils.clip_grad_norm_(trainable, args.max_grad_norm))
            if math.isfinite(gnorm):
                scaler.step(optimizer)
                sched.step()
            else:
                state["skipped_nonfinite"] += 1
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
            state["global_step"] += 1
            state["stage_steps"][st["name"]] = state["stage_steps"].get(st["name"], 0) + 1
            state["pos"] += accum * d.world
            state["samples"] += accum * d.world * micro_bs
            gs = state["global_step"]

            if gs % args.log_every == 0 or gs == 1:
                mean_loss = all_mean(d, loss_acc / max(1, n_acc))
                mem = gather_obj(d, round(torch.cuda.max_memory_allocated(d.device) / 2**30, 2)
                                 if d.device.type == "cuda" else 0.0)
                el = time.time() - step_t0
                rec = {"step": gs, "stage": st["name"], "loss": mean_loss, "lr": sched.get_last_lr()[0],
                       "grad_norm": gnorm, "loss_scale": scaler.get_scale() if use_amp else 1.0,
                       "samples_per_s": window_samples / el if el else None,
                       "sec_per_opt_step": el / max(1, (gs % args.log_every) or args.log_every) if gs > 1 else el,
                       "peak_mem_gb": mem, "elapsed_min": (time.time() - t_start) / 60,
                       "pass": state["pass"], "pos": state["pos"], "of": usable, "nonfinite": state["skipped_nonfinite"]}
                if d.main:
                    with log_path.open("a") as fh:
                        fh.write(json.dumps(rec) + "\n")
                    log(d, f"step {gs} loss {mean_loss:.4f} lr {rec['lr']:.2e} gnorm {gnorm:.3f} "
                           f"{rec['samples_per_s'] or 0:.2f} samples/s mem {mem} GB  [{state['pos']}/{usable}]")
                step_t0, window_samples = time.time(), 0
            loss_acc, n_acc = 0.0, 0

            if validator and args.val_loss_every and gs % args.val_loss_every == 0:
                validator.val_loss(model, gs, out)
            if validator and args.val_every and gs % args.val_every == 0:
                validator.generate(transformer, gs, out)
            if gs % args.save_every == 0:
                save_checkpoint(out / "checkpoints", gs, transformer, optimizer, scaler, sched, state, cfg,
                                args.keep_checkpoints, d, hub)
            if args.max_steps and gs >= args.max_steps:
                stop_reason = "max_steps"
            elif deadline and time.time() > deadline:
                stop_reason = "time_budget"
            if stop_reason:
                break
        if stop_reason:
            break
        # finished a pass over the chunk
        state["pass"] += 1
        state["pos"] = 0
        if state["pass"] >= args.passes:
            state["completed"].append({"chunk": chunk, "stage": st["name"], "passes": state["pass"],
                                       "at_step": state["global_step"]})
            stop_reason = "chunk_done"

    log(d, f"stopping: {stop_reason} at step {state['global_step']}")
    sums = gather_obj(d, float(sum(p.detach().double().sum() for p in trainable)))
    in_sync = max(sums) - min(sums) <= 1e-6 * max(1.0, abs(sums[0]))
    log(d, f"LoRA checksum per rank {sums}: {'ranks in sync' if in_sync else 'WARNING: ranks diverged'}")
    if validator and args.val_loss_every and state["global_step"] % args.val_loss_every:
        validator.val_loss(model, state["global_step"], out)
    ck = save_checkpoint(out / "checkpoints", state["global_step"], transformer, optimizer, scaler, sched, state, cfg,
                         args.keep_checkpoints, d, hub)
    if d.main:
        export_lora(ck, out / "afterframe_sora2_lora.safetensors", cfg)
        (out / "last_stop.json").write_text(json.dumps({"reason": stop_reason, "step": state["global_step"],
                                                       "checkpoint": str(ck), "state": state}, indent=1))
    if validator and args.val_every and stop_reason != "time_budget":
        validator.generate(transformer, state["global_step"], out)
    barrier(d)
    if d.world > 1:
        dist.destroy_process_group()


def hash_str(s: str) -> int:
    return int(hashlib.sha1(s.encode()).hexdigest()[:8], 16)


class Validator:
    """Held-out flow-matching loss (fixed noise and timesteps) and sample videos from unseen prompts."""

    SIGMAS = (0.1, 0.3, 0.5, 0.7, 0.9)

    def __init__(self, args, cfg, st, model_dir, d, text_dir, valset, expand, shift):
        self.args, self.cfg, self.st, self.model_dir, self.d = args, cfg, st, model_dir, d
        self.text_dir, self.valset, self.expand, self.shift = text_dir, valset, expand, shift
        self.vae = None

    @torch.no_grad()
    def val_loss(self, model, step: int, out: Path) -> None:
        d = self.d
        if not len(self.valset):
            return
        model.eval()
        tot, cnt = 0.0, 0
        for i in range(d.rank, len(self.valset), d.world):
            item = self.valset[i]
            x0 = item["latents"].unsqueeze(0).to(d.device).float()
            text = item["text"].unsqueeze(0).to(d.device)
            g = torch.Generator().manual_seed(1234 + i)
            noise = torch.randn(x0.shape, generator=g).to(d.device)
            for s in self.SIGMAS:
                sigma = torch.tensor([s], device=d.device)
                xt, target, t = flow_inputs(x0, sigma, noise, self.expand)
                with amp_ctx(d, d.device.type == "cuda"):
                    inner = model.module if hasattr(model, "module") else model
                    dt_ = torch.float16 if d.device.type == "cuda" else torch.float32
                    pred = inner(hidden_states=xt.to(dt_), timestep=t, encoder_hidden_states=text.to(dt_),
                                 return_dict=False)[0]
                tot += float(F.mse_loss(pred.float(), target))
                cnt += 1
        tot, cnt = all_sum(d, [tot, cnt])
        model.train()
        if d.main and cnt:
            with (out / "logs" / "val_log.jsonl").open("a") as fh:
                fh.write(json.dumps({"step": step, "val_loss": tot / cnt, "clips": len(self.valset),
                                     "sigmas": self.SIGMAS}) + "\n")
            log(d, f"validation loss @ {step}: {tot / cnt:.4f}")

    @torch.no_grad()
    def generate(self, transformer, step: int, out: Path) -> None:
        d = self.d
        if d.main:
            try:
                from diffusers import UniPCMultistepScheduler, WanPipeline
                if self.vae is None:
                    self.vae = load_vae(self.model_dir, d.device, torch.float32)
                    if hasattr(self.vae, "enable_tiling"):
                        self.vae.enable_tiling()
                sched = UniPCMultistepScheduler.from_pretrained(self.model_dir, subfolder="scheduler")
                sched = UniPCMultistepScheduler.from_config(sched.config, flow_shift=self.shift)
                pipe = WanPipeline(tokenizer=None, text_encoder=None, vae=self.vae, scheduler=sched,
                                   transformer=transformer, expand_timesteps=self.expand)
                pipe.set_progress_bar_config(disable=True)
                neg, _ = load_st(self.text_dir / "_negative.safetensors")
                transformer.eval()
                w, h = self.st["buckets"][0]
                frames = self.args.val_frames or self.st["frames"][0]
                for k in range(len(load_val_prompts(self.args.val_prompts))):
                    path = self.text_dir / f"_val{k:02d}.safetensors"
                    if not path.exists():
                        continue
                    emb, meta = load_st(path)
                    dt_ = torch.float16 if d.device.type == "cuda" else torch.float32
                    with amp_ctx(d, d.device.type == "cuda"):
                        video = pipe(prompt_embeds=pad_text(emb["embeds"]).unsqueeze(0).to(d.device, dt_),
                                     negative_prompt_embeds=pad_text(neg["embeds"]).unsqueeze(0).to(d.device, dt_),
                                     height=h, width=w, num_frames=frames, num_inference_steps=self.args.val_steps,
                                     guidance_scale=self.args.val_guidance,
                                     generator=torch.Generator(d.device).manual_seed(42 + k), output_type="np").frames[0]
                    dst = out / "validation" / f"step_{step:07d}" / f"prompt{k:02d}.mp4"
                    write_mp4(video, dst, self.cfg["fps"])
                    (dst.with_suffix(".txt")).write_text(meta.get("text", ""), encoding="utf-8")
                    log(d, f"validation video -> {dst}")
                del pipe
            except Exception as exc:   # a failed preview must not end a long run
                log(d, f"validation generation failed: {type(exc).__name__}: {exc}")
            finally:
                transformer.train()
                if d.device.type == "cuda":
                    torch.cuda.empty_cache()
        barrier(d)


# ------------------------------------------------------------------------------------------------
# EXPORT
# ------------------------------------------------------------------------------------------------
_COMFY_MAP = [(r"\.attn1\.to_q\.", ".self_attn.q."), (r"\.attn1\.to_k\.", ".self_attn.k."),
              (r"\.attn1\.to_v\.", ".self_attn.v."), (r"\.attn1\.to_out\.0\.", ".self_attn.o."),
              (r"\.attn2\.to_q\.", ".cross_attn.q."), (r"\.attn2\.to_k\.", ".cross_attn.k."),
              (r"\.attn2\.to_v\.", ".cross_attn.v."), (r"\.attn2\.to_out\.0\.", ".cross_attn.o."),
              (r"\.ffn\.net\.0\.proj\.", ".ffn.0."), (r"\.ffn\.net\.2\.", ".ffn.2.")]


def export_lora(ckpt: Path, dst: Path, cfg: dict | None = None, dtype=torch.float16) -> dict:
    """Write portable LoRA files. The alpha/rank scale is folded into lora_B, so any loader that applies
    the LoRA at scale 1.0 (diffusers' default when no alpha is stored) reproduces training exactly."""
    lora, meta = load_st(ckpt / "lora_peft.safetensors")
    rank, alpha = int(meta["rank"]), float(meta["alpha"])
    scale = alpha / rank
    diff = {}
    for k, v in lora.items():
        v = v.float() * (scale if ".lora_B." in k else 1.0)
        diff["transformer." + k] = v.to(dtype)
    info = {"format": "diffusers-peft", "base_model": (cfg or {}).get("model_path", ""), "rank": str(rank),
            "alpha_folded": str(alpha), "trigger": CAPTION_PREFIX.strip(), "step": meta.get("step", ""),
            "targets": meta.get("targets", ""), "note": "alpha/rank folded into lora_B; load at strength 1.0"}
    save_st(diff, dst, info)
    comfy = {}
    for k, v in diff.items():
        ck = "diffusion_model." + k[len("transformer."):]
        for pat, rep in _COMFY_MAP:
            ck = re.sub(pat, rep, ck)
        comfy[ck] = v
    save_st(comfy, dst.with_name(dst.stem + "_comfyui.safetensors"), {**info, "format": "comfyui-wan"})
    return info


def cmd_export(args) -> None:
    roots = args.checkpoint_roots or ["outputs/checkpoints"]
    cks = [Path(args.checkpoint)] if args.checkpoint else find_checkpoints(roots)
    if not cks:
        raise SystemExit("no checkpoint found")
    cfg = json.loads((cks[-1] / "config.json").read_text()) if (cks[-1] / "config.json").exists() else None
    info = export_lora(cks[-1], Path(args.out), cfg)
    print(json.dumps({"checkpoint": str(cks[-1]), "out": args.out, **info}, indent=1))


# ------------------------------------------------------------------------------------------------
# INFERENCE
# ------------------------------------------------------------------------------------------------
class Generator:
    """Transformer + VAE on one GPU, umT5 on the other (fp16 umT5 alone is ~11 GB)."""

    def __init__(self, model: str = "wan21_1.3b", model_path: str | None = None, lora: str | None = None,
                 main_device: str = "cuda:0", text_device: str | None = None, vae_dtype=torch.float32):
        from diffusers import UniPCMultistepScheduler, WanPipeline
        info = MODELS[model]
        self.info = info
        path = model_path or info["repo"]
        if not os.path.isdir(path):
            from huggingface_hub import snapshot_download
            path = snapshot_download(path, allow_patterns=["model_index.json", "tokenizer/*", "text_encoder/*",
                                                           "vae/*", "transformer/*", "scheduler/*"])
        cuda = torch.cuda.is_available()
        self.main = torch.device(main_device if cuda else "cpu")
        text_device = text_device or ("cuda:1" if cuda and torch.cuda.device_count() > 1 else main_device)
        self.text_dev = torch.device(text_device if cuda else "cpu")
        self.dtype = torch.float16 if cuda else torch.float32
        if cuda:
            configure_hardware(Dist(device=self.main))
        self.tok, self.te = load_text_encoder(path, self.text_dev, self.dtype)
        vae = load_vae(path, self.main, vae_dtype if cuda else torch.float32)
        if hasattr(vae, "enable_tiling"):
            vae.enable_tiling()
        tr = load_transformer(path, self.main, self.dtype)
        sched = UniPCMultistepScheduler.from_pretrained(path, subfolder="scheduler")
        self.pipe = WanPipeline(tokenizer=None, text_encoder=None, vae=vae, transformer=tr,
                                scheduler=UniPCMultistepScheduler.from_config(sched.config, flow_shift=info["flow_shift"]),
                                expand_timesteps=info["expand_timesteps"])
        self.lora_loaded = False
        if lora:
            self.load_lora(lora)

    def load_lora(self, path: str, name: str = "afterframe") -> None:
        self.pipe.load_lora_weights(path, adapter_name=name)
        self.lora_name, self.lora_loaded = name, True

    def set_flow_shift(self, shift: float) -> None:
        from diffusers import UniPCMultistepScheduler
        self.pipe.scheduler = UniPCMultistepScheduler.from_config(self.pipe.scheduler.config, flow_shift=shift)

    @torch.no_grad()
    def __call__(self, prompt: str, negative_prompt: str = DEFAULT_NEGATIVE, seed: int = 0, width: int = 832,
                 height: int = 480, num_frames: int = 81, steps: int = 30, guidance: float = 5.0,
                 lora_strength: float | None = 1.0) -> np.ndarray:
        emb = encode_prompts(self.tok, self.te, [prompt, negative_prompt])
        if emb[0]["truncated"]:
            print("warning: prompt longer than 512 tokens; the end is truncated", flush=True)
        if self.lora_loaded:
            if lora_strength is None or lora_strength == 0:
                self.pipe.disable_lora()
            else:
                self.pipe.enable_lora()
                self.pipe.set_adapters([self.lora_name], [lora_strength])
        p = pad_text(emb[0]["embeds"]).unsqueeze(0).to(self.main, self.dtype)
        n = pad_text(emb[1]["embeds"]).unsqueeze(0).to(self.main, self.dtype)
        ctx = torch.autocast("cuda", dtype=torch.float16) if self.main.type == "cuda" else contextlib.nullcontext()
        with ctx:
            out = self.pipe(prompt_embeds=p, negative_prompt_embeds=n, height=height, width=width,
                            num_frames=num_frames, num_inference_steps=steps, guidance_scale=guidance,
                            generator=torch.Generator(self.main).manual_seed(seed), output_type="np")
        return out.frames[0]


def side_by_side(a: str, b: str, dst: str, labels=("base", "LoRA")) -> None:
    vf = (f"[0:v]drawtext=text='{labels[0]}':x=10:y=10:fontcolor=white:fontsize=20:box=1:boxcolor=black@0.5[a];"
          f"[1:v]drawtext=text='{labels[1]}':x=10:y=10:fontcolor=white:fontsize=20:box=1:boxcolor=black@0.5[b];"
          f"[a][b]hstack=inputs=2")
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a, "-i", b, "-filter_complex", vf, "-c:v", "libx264",
                        "-crf", "18", "-pix_fmt", "yuv420p", dst], capture_output=True)
    if r.returncode != 0:   # drawtext needs fontconfig; fall back to an unlabeled stack
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a, "-i", b, "-filter_complex", "hstack=inputs=2",
                        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", dst], check=True)


def cmd_infer(args) -> None:
    g = Generator(args.model, args.model_path, args.lora, args.device, args.text_device)
    prompts = [args.prompt] if args.prompt else load_val_prompts(args.prompts_file)
    out = Path(args.out_dir)
    for i, prompt in enumerate(prompts):
        common = dict(seed=args.seed + i, width=args.width, height=args.height, num_frames=args.frames,
                      steps=args.steps, guidance=args.guidance, negative_prompt=args.negative_prompt)
        stem = f"{i:02d}_seed{args.seed + i}"
        made = {}
        if args.compare_base or not args.lora:
            t0 = time.time()
            write_mp4(g(prompt, lora_strength=0 if args.lora else None, **common), out / f"{stem}_base.mp4", g.info["fps"])
            made["base"] = time.time() - t0
        if args.lora:
            t0 = time.time()
            write_mp4(g(prompt, lora_strength=args.lora_strength, **common), out / f"{stem}_lora.mp4", g.info["fps"])
            made["lora"] = time.time() - t0
        if len(made) == 2:
            side_by_side(str(out / f"{stem}_base.mp4"), str(out / f"{stem}_lora.mp4"), str(out / f"{stem}_compare.mp4"))
        (out / f"{stem}.json").write_text(json.dumps({"prompt": prompt, **common, "lora": args.lora,
                                                      "lora_strength": args.lora_strength, "seconds": made}, indent=1))
        print(f"[{i}] {prompt[:70]}...  {made}", flush=True)


# ------------------------------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--preset", default="balanced", choices=sorted(PRESETS))
        p.add_argument("--stage", type=int, default=0, help="index into the preset's progressive stages")
        p.add_argument("--model", choices=sorted(MODELS), help="override the preset's base model (e.g. smoke-test wan22_5b)")
        p.add_argument("--model-path", help="local diffusers folder or HF repo for that model")
        p.add_argument("--cache-dir", default="/kaggle/temp/afterframe_cache")
        p.add_argument("--target-fps", type=float)
        p.add_argument("--clips-per-video", type=int)
        p.add_argument("--val-prompts", help="file with one validation prompt per line")

    c = sub.add_parser("cache")
    common(c)
    c.add_argument("--dataset", nargs="+", required=True, help="folders searched for shard_*/manifest.jsonl")
    c.add_argument("--shards", help="comma list (default: all found)")
    c.add_argument("--what", default="text,latents")
    c.add_argument("--max-videos-per-shard", type=int)
    c.add_argument("--text-batch", type=int, default=8)
    c.add_argument("--vae-dtype", choices=["auto", "fp16", "fp32"], default="auto")
    c.add_argument("--vae-fp16-tolerance", type=float, default=0.02)
    c.add_argument("--vae-tiling", action=argparse.BooleanOptionalAction, default=True)
    c.add_argument("--decode-workers", type=int, default=3)
    c.add_argument("--negative-prompt", default=DEFAULT_NEGATIVE)

    t = sub.add_parser("train")
    common(t)
    t.add_argument("--output-dir", default="/kaggle/working/afterframe_run")
    t.add_argument("--shards", help="comma list of cached shards to train on (default: all cached for the stage)")
    t.add_argument("--passes", type=int, default=1, help="passes over this chunk of shards before stopping")
    t.add_argument("--rank", type=int)
    t.add_argument("--alpha", type=float)
    t.add_argument("--targets", choices=sorted(TARGETS))
    t.add_argument("--lr", type=float)
    t.add_argument("--accum", type=int)
    t.add_argument("--batch", type=int)
    t.add_argument("--lora-dropout", type=float, default=0.0)
    t.add_argument("--optimizer", choices=["adamw8bit", "adamw"], default="adamw8bit")
    t.add_argument("--weight-decay", type=float, default=1e-4)
    t.add_argument("--lr-scheduler", choices=["cosine", "constant"], default="cosine")
    t.add_argument("--warmup-steps", type=int, default=50)
    t.add_argument("--total-steps", type=int, default=3000, help="horizon of the cosine schedule, across all sessions")
    t.add_argument("--min-lr-ratio", type=float, default=0.1)
    t.add_argument("--max-grad-norm", type=float, default=1.0)
    t.add_argument("--mixed-precision", choices=["fp16", "no", "bf16"], default="fp16")
    t.add_argument("--gradient-checkpointing", action=argparse.BooleanOptionalAction, default=True)
    t.add_argument("--timestep-sampling", choices=["logit_normal", "uniform"], default="logit_normal")
    t.add_argument("--timestep-shift", type=float)
    t.add_argument("--seed", type=int, default=42)
    t.add_argument("--max-steps", type=int, help="stop at this global step")
    t.add_argument("--max-clips", type=int, help="use only the first N training clips (smoke tests)")
    t.add_argument("--max-train-minutes", type=float, help="stop and checkpoint after this many minutes")
    t.add_argument("--save-every", type=int, default=100)
    t.add_argument("--keep-checkpoints", type=int, default=3)
    t.add_argument("--resume", action=argparse.BooleanOptionalAction, default=True)
    t.add_argument("--resume-from", nargs="*", help="extra folders searched for step_*/ checkpoints")
    t.add_argument("--hub-repo", help="optional private HF repo to mirror checkpoints to (needs HF_TOKEN)")
    t.add_argument("--log-every", type=int, default=5)
    t.add_argument("--val-loss-every", type=int, default=100)
    t.add_argument("--val-clips", type=int, default=24)
    t.add_argument("--val-every", type=int, default=300, help="sample videos every N steps (0 = off)")
    t.add_argument("--val-steps", type=int, default=20)
    t.add_argument("--val-frames", type=int)
    t.add_argument("--val-guidance", type=float, default=5.0)
    t.add_argument("--num-workers", type=int, default=2)

    e = sub.add_parser("export")
    e.add_argument("--checkpoint")
    e.add_argument("--checkpoint-roots", nargs="*")
    e.add_argument("--out", default="afterframe_sora2_lora.safetensors")

    i = sub.add_parser("infer")
    i.add_argument("--model", default="wan21_1.3b", choices=sorted(MODELS))
    i.add_argument("--model-path")
    i.add_argument("--lora")
    i.add_argument("--lora-strength", type=float, default=1.0)
    i.add_argument("--compare-base", action="store_true")
    i.add_argument("--prompt")
    i.add_argument("--prompts-file")
    i.add_argument("--negative-prompt", default=DEFAULT_NEGATIVE)
    i.add_argument("--seed", type=int, default=0)
    i.add_argument("--width", type=int, default=832)
    i.add_argument("--height", type=int, default=480)
    i.add_argument("--frames", type=int, default=49)
    i.add_argument("--steps", type=int, default=30)
    i.add_argument("--guidance", type=float, default=5.0)
    i.add_argument("--device", default="cuda:0")
    i.add_argument("--text-device")
    i.add_argument("--out-dir", default="/kaggle/working/inference")

    sub.add_parser("presets")
    return ap


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    if args.cmd == "cache":
        args.what = set(args.what.split(","))
        cmd_cache(args)
    elif args.cmd == "train":
        cmd_train(args)
    elif args.cmd == "export":
        cmd_export(args)
    elif args.cmd == "infer":
        cmd_infer(args)
    elif args.cmd == "presets":
        print(json.dumps(PRESETS, indent=1))


if __name__ == "__main__":
    main()
