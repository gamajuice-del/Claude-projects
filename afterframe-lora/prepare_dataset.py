#!/usr/bin/env python3
"""
prepare_dataset.py — turn an extraction folder (from extract_afterframe.py) into a training dataset.

  afterframe_data/                        (input; never modified)
    state/catalog.jsonl, prompts.jsonl, downloads.jsonl
    raw/shard_XXX/<post_id>.mp4           <- the ORIGINAL dataset; left untouched

  dataset/                                (output)
    dataset_manifest.jsonl                one JSON record per eligible video (first line is a header)
    shard_XXX/videos/<post_id>.mp4        hard link (or copy) of the original file, bytes unchanged
    shard_XXX/captions/<post_id>.txt      UTF-8: "Sora 2 video, prompt: <backend prompt>" (no trailing newline)
    shard_XXX/manifest.jsonl              the manifest rows of that shard (each shard is self-contained,
                                          so it can be uploaded or loaded as its own Kaggle dataset)
    splits/train.txt, splits/val.txt      post ids
    report.json                           counts, exclusions, provenance flags, duplicate groups

Training clips (resized, cropped, frame-resampled) are made later, in the notebook, as cached latents.
They never overwrite these files.

Rules this script enforces:
  * Only posts whose backend prompt is a non-empty string after whitespace stripping are included.
    The prompt is copied byte for byte; nothing is generated, inferred, summarised or rewritten.
  * The caption is exactly CAPTION_PREFIX + backend prompt.
  * Exact duplicates (same sha256 or same Sora generation id) and near-duplicates (perceptual hash of
    sampled frames) are grouped; one representative per group is kept (--keep-near-duplicates
    keeps them all), and every group sits wholly in train or wholly in val.
  * Provenance is assessed per video and flagged; it is never silently upgraded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_afterframe import (BASE_URL, HIDE_AT_REPORTS, PermissionPolicy, eligibility, load_catalog,  # noqa: E402
                                load_prompts, provenance_assessment, read_jsonl, sora_generation_id)

CAPTION_PREFIX = "Sora 2 video, prompt: "
MANIFEST_VERSION = 1


def make_caption(backend_prompt: str) -> str:
    if not isinstance(backend_prompt, str) or not backend_prompt.strip():
        raise ValueError("refusing to build a caption without a non-empty backend prompt")
    caption = CAPTION_PREFIX + backend_prompt
    assert caption.startswith(CAPTION_PREFIX) and caption[len(CAPTION_PREFIX):] == backend_prompt
    return caption


# --------------------------------------------------------------------------------------------
# perceptual signature for near-duplicate detection
# --------------------------------------------------------------------------------------------
SIG_FPS = 4          # signature frames per second of video
SIG_MAX_FRAMES = 64
SIG_DARK_MIN = 4     # quality flag: at least this many dark sampled frames *and* half of them


def _dhash_bits(img32: np.ndarray) -> int:
    rows8 = img32.reshape(8, 4, 32).mean(1)                              # 8 x 32
    xs = np.linspace(0, 31, 9)
    grid = np.stack([np.interp(xs, np.arange(32), r) for r in rows8])   # 8 x 9
    bits = (grid[:, 1:] > grid[:, :-1]).flatten()                      # 64 horizontal-gradient bits
    return int("".join("1" if b else "0" for b in bits), 2)


def frame_signature(path: Path, duration: float) -> dict | None:
    """One decode pass: frames sampled at SIG_FPS (capped), grayscale 32x32 -> 64-bit dHash per frame,
    plus motion / brightness statistics for quality flags. None if decoding fails."""
    fps = min(SIG_FPS, SIG_MAX_FRAMES / max(duration, 0.25))
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v:0",
           "-vf", f"fps={fps:.5f},scale=32:32:flags=area,format=gray", "-f", "rawvideo", "-"]
    proc = subprocess.run(cmd, capture_output=True, timeout=600)
    n = len(proc.stdout) // 1024
    if proc.returncode != 0 or n == 0:
        return None
    thumbs = np.frombuffer(proc.stdout[: n * 1024], np.uint8).reshape(n, 32, 32).astype(np.float32)
    motion = float(np.abs(np.diff(thumbs, axis=0)).mean()) * fps if n > 1 else 0.0  # per second
    dark = int((thumbs.mean((1, 2)) < 12).sum())
    return {"dhash": [f"{_dhash_bits(t):016x}" for t in thumbs], "fps": round(fps, 5),
            "motion": round(motion, 3), "brightness": round(float(thumbs.mean()), 2),
            "dark_fraction": round(dark / n, 3)}


def popcount64(x: np.ndarray) -> np.ndarray:
    """Per-element popcount of a uint64 array (numpy>=2 has np.bitwise_count; older numpy uses unpackbits)."""
    if hasattr(np, "bitwise_count"):
        return np.bitwise_count(x)
    x = np.ascontiguousarray(x, dtype=np.uint64)
    return np.unpackbits(x.view(np.uint8).reshape(*x.shape, 8), axis=-1).sum(-1)


def near_duplicate_pairs(ids: list[str], sigs: dict[str, dict], frame_bits: int = 10,
                         min_match_fraction: float = 0.6) -> list[tuple[str, str, float]]:
    """Pairs of near-identical videos, tolerant of re-encoding, rescaling, trimming and time offsets.

    A frame of A "matches" B when some frame of B is within `frame_bits` (of 64) Hamming distance.
    A and B are near-identical when at least `min_match_fraction` of the frames of either one match
    the other (so a clip cut from a longer video counts). Candidate pairs come from 4 x 16-bit band
    hashing of the frames; any pair of frames within 3 bits is guaranteed to share a band, which is
    enough because near-identical videos have many such frames.
    Returns (a, b, match_fraction)."""
    usable = [i for i in ids if sigs.get(i) and sigs[i]["dhash"]]
    hashes = {i: np.array([int(h, 16) for h in sigs[i]["dhash"]], dtype=np.uint64) for i in usable}
    buckets: dict[tuple[int, int], set[int]] = defaultdict(set)
    for idx, vid in enumerate(usable):
        for h in hashes[vid].tolist():
            for band in range(4):
                buckets[(band, (h >> (16 * band)) & 0xFFFF)].add(idx)
    cand: Counter = Counter()
    for members in buckets.values():
        if 1 < len(members) <= 200:            # skip degenerate buckets (e.g. all-black frames)
            ml = sorted(members)
            for x in range(len(ml)):
                for y in range(x + 1, len(ml)):
                    cand[(ml[x], ml[y])] += 1
    pairs = []
    for (x, y), hits in cand.items():
        if hits < 2:
            continue
        A, B = hashes[usable[x]], hashes[usable[y]]
        ham = popcount64(A[:, None] ^ B[None, :])
        frac = max(float((ham.min(1) <= frame_bits).mean()), float((ham.min(0) <= frame_bits).mean()))
        if frac >= min_match_fraction and min(len(A), len(B)) >= 3:
            pairs.append((usable[x], usable[y], frac))
    return pairs


class UnionFind:
    def __init__(self):
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


# --------------------------------------------------------------------------------------------
def place_file(src: Path, dst: Path, mode: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        if dst.stat().st_size == src.stat().st_size:
            return
        dst.unlink()
    if mode == "hardlink":
        try:
            os.link(src, dst)
            return
        except OSError:
            pass  # different filesystem: fall back to a copy
    if mode == "symlink":
        dst.symlink_to(src.resolve())
        return
    shutil.copy2(src, dst)


def quality_flags(rec: dict, sig: dict | None, min_short_side: int, min_seconds: float) -> list[str]:
    flags = []
    if min(rec["width"], rec["height"]) < min_short_side:
        flags.append("low_resolution")
    if rec["duration"] < min_seconds:
        flags.append("too_short")
    if rec["fps"] and not (14 <= rec["fps"] <= 61):
        flags.append("unusual_fps")
    if sig:
        if sig["motion"] < 2.0:
            flags.append("nearly_static")
        if sig["dark_fraction"] >= 0.5:
            flags.append("mostly_dark")
    else:
        flags.append("signature_failed")
    return flags


def split_of(group_id: str, val_fraction: float, seed: str) -> str:
    h = int(hashlib.sha256((seed + group_id).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "val" if h < val_fraction else "train"


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=Path("afterframe_data"), help="extract_afterframe.py --out folder")
    ap.add_argument("--out", type=Path, default=Path("dataset"))
    ap.add_argument("--permission-policy", choices=["owner-uploads", "allowlist", "all-attested", "pending"], required=True,
                    help="'pending' admits nothing: writes a status-only manifest while permissions are undecided")
    ap.add_argument("--uploader-id", action="append")
    ap.add_argument("--uploaders-file")
    ap.add_argument("--workers", type=int, default=max(1, os.cpu_count() or 2))
    ap.add_argument("--link-mode", choices=["hardlink", "copy", "symlink"], default="hardlink")
    ap.add_argument("--val-fraction", type=float, default=0.02)
    ap.add_argument("--split-seed", default="afterframe-v1")
    ap.add_argument("--near-dup-frame-bits", type=int, default=10,
                    help="dHash distance (0-64) at or below which two sampled frames count as the same")
    ap.add_argument("--near-dup-fraction", type=float, default=0.6,
                    help="share of one video's frames that must match the other to call them near-identical")
    ap.add_argument("--keep-near-duplicates", action="store_true",
                    help="keep every member of a near-duplicate group (still kept in the same split)")
    ap.add_argument("--group-identical-prompts", action=argparse.BooleanOptionalAction, default=True,
                    help="put videos with byte-identical prompts in one split group (prevents prompt leakage)")
    ap.add_argument("--min-short-side", type=int, default=360)
    ap.add_argument("--min-seconds", type=float, default=2.0)
    ap.add_argument("--exclude-flags", default="low_resolution,too_short,signature_failed",
                    help="comma list of quality flags that exclude a video; others are only recorded")
    ap.add_argument("--exclude-provenance", default="other_model_by_backend",
                    help="comma list of provenance labels to exclude (e.g. add provenance_uncertain)")
    args = ap.parse_args(argv)

    catalog, prompts = load_catalog(args.data), load_prompts(args.data)
    downloads = {r["id"]: r for r in read_jsonl(args.data / "state" / "downloads.jsonl")}
    policy = PermissionPolicy.from_args(args, None)
    excl_flags = {f for f in args.exclude_flags.split(",") if f}
    excl_prov = {f for f in args.exclude_provenance.split(",") if f}
    report: dict = {"generated_at": int(time.time() * 1000), "catalog_posts": len(catalog),
                    "prompt_lookups": len(prompts), "excluded": Counter(), "provenance": Counter(),
                    "quality_flags": Counter()}

    # 1. eligibility + presence of a verified download
    candidates: list[dict] = []
    for pid, post in catalog.items():
        ok, why = eligibility(post, prompts.get(pid), policy)
        if not ok:
            report["excluded"][why] += 1
            continue
        dl = downloads.get(pid)
        if not dl or dl.get("status") != "ok" or not Path(dl["path"]).exists():
            report["excluded"]["not_downloaded" if not dl else "download_" + str(dl.get("status"))] += 1
            continue
        candidates.append({"post": post, "prompt": prompts[pid], "dl": dl})
    print(f"{len(candidates)} eligible, downloaded videos; exclusions so far: {dict(report['excluded'])}")

    # 2. signatures
    sig_cache_path = args.out / ".signatures.json"
    sig_cache = json.loads(sig_cache_path.read_text()) if sig_cache_path.exists() else {}
    args.out.mkdir(parents=True, exist_ok=True)
    todo = {c["dl"]["sha256"]: c for c in candidates if c["dl"]["sha256"] not in sig_cache}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:   # ffmpeg runs out of process
        futs = {pool.submit(frame_signature, Path(c["dl"]["path"]), c["dl"]["probe"]["duration"]): k
                for k, c in todo.items()}
        for n, fut in enumerate(as_completed(futs), 1):
            sig_cache[futs[fut]] = fut.result()
            if n % 200 == 0 or n == len(futs):
                print(f"  signatures {n}/{len(futs)}")
                sig_cache_path.write_text(json.dumps(sig_cache))
    sigs: dict[str, dict | None] = {c["post"]["id"]: sig_cache.get(c["dl"]["sha256"]) for c in candidates}

    # 3. duplicate groups (exact sha, same Sora generation id, near-identical frames, same prompt)
    uf = UnionFind()
    by_sha, by_gen, by_prompt = defaultdict(list), defaultdict(list), defaultdict(list)
    for c in candidates:
        pid = c["post"]["id"]
        uf.find(pid)
        by_sha[c["dl"]["sha256"]].append(pid)
        gen = sora_generation_id(c["post"]["data"].get("name"))
        if gen:
            by_gen[gen].append(pid)
        by_prompt[c["prompt"]["prompt"]].append(pid)
    hard_dup = UnionFind()  # groups whose members are the same video (deduplicated)
    for members in list(by_sha.values()) + list(by_gen.values()):
        for m in members[1:]:
            uf.union(members[0], m)
            hard_dup.union(members[0], m)
    near = near_duplicate_pairs([c["post"]["id"] for c in candidates], sigs, args.near_dup_frame_bits,
                                args.near_dup_fraction)
    for a, b, _ in near:
        uf.union(a, b)
        if not args.keep_near_duplicates:
            hard_dup.union(a, b)
    if args.group_identical_prompts:
        for members in by_prompt.values():
            for m in members[1:]:
                uf.union(members[0], m)
    report["near_duplicate_pairs"] = len(near)

    # keep one representative per hard-duplicate group: highest resolution, then has C2PA, then oldest
    def rank(c):
        p = c["dl"]["probe"]
        return (-(p["width"] * p["height"]), not c["dl"].get("c2pa", {}).get("present"), -p["duration"],
                c["post"]["data"].get("created", 0))
    reps: dict[str, dict] = {}
    for c in sorted(candidates, key=rank):
        root = hard_dup.find(c["post"]["id"])
        if root in reps:
            report["excluded"]["duplicate"] += 1
            continue
        reps[root] = c

    # 4. records
    rows = []
    for c in reps.values():
        post, data, dl, pr = c["post"], c["post"]["data"], c["dl"], c["prompt"]
        pid, probe = post["id"], dl["probe"]
        prov = provenance_assessment(data, probe, dl.get("c2pa"), pr)
        if prov["label"] in excl_prov:
            report["excluded"]["provenance_" + prov["label"]] += 1
            continue
        rec = {"width": probe["width"], "height": probe["height"], "fps": probe["fps"],
               "duration": probe["duration"]}
        flags = quality_flags(rec, sigs.get(pid), args.min_short_side, args.min_seconds)
        if prov["label"] != "sora2_likely" and prov["label"] != "sora2_confirmed_by_backend":
            flags.append("provenance_" + prov["label"])
        bad = sorted(set(flags) & excl_flags)
        if bad:
            report["excluded"]["quality_" + "+".join(bad)] += 1
            continue
        for f in flags:
            report["quality_flags"][f] += 1
        report["provenance"][prov["label"]] += 1
        shard = Path(dl["path"]).parent.name  # shard_XXX, as assigned at download time
        group = uf.find(pid)
        caption = make_caption(pr["prompt"])
        ext = Path(dl["path"]).suffix
        rows.append({
            "id": pid,
            "shard": shard,
            "video_path": f"{shard}/videos/{pid}{ext}",
            "caption_path": f"{shard}/captions/{pid}.txt",
            "backend_prompt": pr["prompt"],
            "caption_prefix": CAPTION_PREFIX,
            "training_caption": caption,
            "width": probe["width"], "height": probe["height"],
            "aspect_ratio": round(probe["width"] / probe["height"], 4),
            "fps": probe["fps"], "duration": round(probe["duration"], 4), "num_frames": probe["nb_frames"],
            "has_audio": probe["has_audio"], "video_codec": probe["vcodec"], "pix_fmt": probe["pix_fmt"],
            "bytes": dl["bytes"], "sha256": dl["sha256"],
            "sora_generation_id": sora_generation_id(data.get("name")),
            "provenance": prov,
            "quality_flags": sorted(flags),
            "motion_score": (sigs.get(pid) or {}).get("motion"),
            "dup_group": group,
            "split": split_of(group, args.val_fraction, args.split_seed),
            "source": {
                "site": BASE_URL, "post_id": pid, "asset_id": data.get("asset"),
                "media_url": f"{BASE_URL}/media/{data.get('asset')}",
                "original_filename": data.get("name"), "uploader_id": data.get("by"),
                "uploaded_at_ms": data.get("created"), "catalog_fetched_at_ms": post.get("fetched_at"),
                "prompt_fetched_at_ms": pr.get("fetched_at"), "downloaded_at_ms": dl.get("downloaded_at"),
                "permission_policy": policy.mode, "c2pa": dl.get("c2pa"),
            },
        })

    # 5. write files
    rows.sort(key=lambda r: (r["shard"], r["id"]))
    per_shard = defaultdict(list)
    for r in rows:
        src = Path(downloads[r["id"]]["path"])
        place_file(src, args.out / r["video_path"], args.link_mode)
        cap = args.out / r["caption_path"]
        cap.parent.mkdir(parents=True, exist_ok=True)
        cap.write_bytes(r["training_caption"].encode("utf-8"))
        per_shard[r["shard"]].append(r)
    header = {"_type": "manifest_header", "manifest_version": MANIFEST_VERSION, "caption_prefix": CAPTION_PREFIX,
              "records": len(rows), "generated_at_ms": report["generated_at"], "source": BASE_URL,
              "permission_policy": policy.mode, "catalog_posts": len(catalog), "prompt_lookups": len(prompts),
              "excluded": dict(report["excluded"]),
              "prompt_access": (json.loads((args.data / "state" / "prompt_access.json").read_text())
                                if (args.data / "state" / "prompt_access.json").exists() else None),
              "note": ("Records follow; each one has an authentic backend prompt. Lines with _type are metadata." if rows else
                       "No eligible records: see 'excluded' for the reason each catalog post was left out.")}
    with (args.out / "dataset_manifest.jsonl").open("w", encoding="utf-8") as fh:
        fh.write(json.dumps(header, ensure_ascii=False) + "\n")
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    for shard, srows in per_shard.items():
        with (args.out / shard / "manifest.jsonl").open("w", encoding="utf-8") as fh:
            for r in srows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    (args.out / "splits").mkdir(exist_ok=True)
    for split in ("train", "val"):
        (args.out / "splits" / f"{split}.txt").write_text("".join(r["id"] + "\n" for r in rows if r["split"] == split))

    # leakage check: no group may appear in both splits
    group_splits = defaultdict(set)
    for r in rows:
        group_splits[r["dup_group"]].add(r["split"])
    leaks = [g for g, s in group_splits.items() if len(s) > 1]
    assert not leaks, f"split leakage in groups {leaks[:5]}"

    report.update({"records": len(rows), "train": sum(r["split"] == "train" for r in rows),
                   "val": sum(r["split"] == "val" for r in rows), "groups": len(group_splits),
                   "shards": {s: len(v) for s, v in sorted(per_shard.items())},
                   "total_hours": round(sum(r["duration"] for r in rows) / 3600, 3),
                   "total_gb": round(sum(r["bytes"] for r in rows) / 1e9, 3)})
    for k in ("excluded", "provenance", "quality_flags"):
        report[k] = dict(report[k])
    (args.out / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("records", "train", "val", "excluded", "provenance", "total_gb")}, indent=2))


if __name__ == "__main__":
    main()
