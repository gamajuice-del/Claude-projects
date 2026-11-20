#!/usr/bin/env python3
"""
extract_afterframe.py — resumable, rate-limited extractor for the Afterframe archive.

What the site exposes (found by reading /afterframe-sites.js and the inline app script, then
checking each endpoint by hand on 2026-11-20):

  POST /api/session                      -> {"id", "admin", "reviewRequired", ...}; sets the visitor cookie
  GET  /api/post-count                   -> {"posts": N}
  GET  /api/docs/posts?details=1&sort=created&direction=desc&limit<=1000[&after=<id>&afterCreated=<ms>]
                                         -> {"rows": [{"id", "data": {...}}], "cursor": {"id", "created"} | null}
  GET  /api/docs/posts/<id>?details=1    -> {"row": {...}}
  GET  /api/post-prompt/<id>             -> {"prompt": str | null}   ** OWNER ONLY **: 403 {"code":"not_granted"} for visitors
  GET  /media/<asset-uuid>               -> original uploaded bytes (video/mp4), supports HTTP Range

Every request carries the `X-Afterframe: 1` header the web client sends. All calls are GET, except
POST /api/session, which the site's own page makes on every load to create a visitor session. Nothing
is written to the site.

Stages (each one is resumable; state lives in --out/state):

  scan      page through the whole catalog -> state/catalog.jsonl
  prompts   fetch the stored generation prompt per post (needs the owner's signed-in cookie)
            -> state/prompts.jsonl
  download  download eligible posts at their original bytes, with range-resume, retries, sha256 and
            ffprobe validation -> raw/shard_XXX/<post_id>.<ext>, state/downloads.jsonl
  status    print counts

A post is ELIGIBLE for download/training only if ALL of these hold:
  * the backend returned a prompt string that is non-empty after whitespace stripping
    (it is never generated, inferred or rewritten);
  * the post passes the permission policy you chose (--permission-policy);
  * it is not hidden by moderation (reportCount below the site's hide threshold) and has a media asset.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator

import requests

try:
    from tqdm import tqdm
except ImportError:  # progress bars are optional
    tqdm = None

BASE_URL = "https://afterframe.marcelalia2.chatgpt.site"
USER_AGENT = "afterframe-dataset-extractor/1.0 (+owner-authorised archive export)"
PAGE_LIMIT = 1000          # the site's own client never asks for more than 1000 rows per page
HIDE_AT_REPORTS = 3        # posts with this many reports are hidden from visitors in the web client
SORA_LAUNCH_SORA2_MS = 1759190400000  # 2025-09-30T00:00:00Z — Sora 2 public launch
SORA2_DIMS = {(1280, 704), (704, 1280), (1792, 1024), (1024, 1792), (1280, 720), (720, 1280),
              (1024, 1024), (704, 704)}


# --------------------------------------------------------------------------------------------
# small utilities
# --------------------------------------------------------------------------------------------
def log(msg: str) -> None:
    print(time.strftime("[%H:%M:%S] ") + msg, file=sys.stderr, flush=True)


def make_bar(**kw):
    """tqdm progress bar; in non-interactive logs it redraws at most every 30 s."""
    if tqdm is None:
        return None
    return tqdm(mininterval=0.5 if sys.stderr.isatty() else 30, **kw)


def read_jsonl(path: Path) -> Iterator[dict]:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                # a crash mid-write can leave one truncated final line; ignore it, it will be redone
                log(f"warning: skipping unreadable line {line_no} in {path.name}")


class JsonlAppender:
    """Thread-safe append-only JSONL writer (fsync'd so a killed session loses at most one line)."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = path.open("a", encoding="utf-8")
        self.lock = threading.Lock()

    def write(self, obj: dict) -> None:
        line = json.dumps(obj, ensure_ascii=False, sort_keys=True)
        with self.lock:
            self.fh.write(line + "\n")
            self.fh.flush()
            os.fsync(self.fh.fileno())

    def close(self) -> None:
        self.fh.close()


class RateLimiter:
    """Token bucket shared by all threads: at most `rate` requests per second, burst `burst`."""

    def __init__(self, rate: float, burst: int = 2):
        self.rate, self.capacity = rate, float(burst)
        self.tokens, self.last = float(burst), time.monotonic()
        self.lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
                self.last = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                wait = (1 - self.tokens) / self.rate
            time.sleep(wait)


def crockford_ulid_ms(ulid: str) -> int | None:
    """Decode the 48-bit millisecond timestamp at the start of a ULID (Sora generation ids are ULIDs)."""
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    head = ulid[:10].upper()
    if len(head) != 10 or any(c not in alphabet for c in head) or head[0] > "7":
        return None
    value = 0
    for c in head:
        value = value * 32 + alphabet.index(c)
    # 2023-01-01 .. 2030-01-01: anything outside is not a real generation timestamp
    return value if 1672531200000 <= value <= 1893456000000 else None


def sora_generation_id(name: str | None) -> str | None:
    m = re.search(r"(gen_[0-9a-z]{26})", name or "", re.I)
    return m.group(1).lower() if m else None


def shard_of(post_id: str, num_shards: int) -> int:
    return int(hashlib.sha1(post_id.encode()).hexdigest(), 16) % num_shards


# --------------------------------------------------------------------------------------------
# HTTP client
# --------------------------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, status: int, payload: Any):
        super().__init__(f"HTTP {status}: {payload}")
        self.status, self.payload = status, payload

    @property
    def code(self) -> str | None:
        return self.payload.get("code") if isinstance(self.payload, dict) else None


class AfterframeClient:
    RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524}

    def __init__(self, base_url: str = BASE_URL, cookie: str | None = None, rate: float = 3.0,
                 max_retries: int = 6, timeout: float = 60.0):
        self.base = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "X-Afterframe": "1", "Accept": "application/json"})
        if cookie:
            # the owner's browser cookie (copied from devtools); sent verbatim, never logged
            self.session.headers["Cookie"] = cookie.strip()
        self.limiter = RateLimiter(rate, burst=max(1, int(rate)))
        self.max_retries, self.timeout = max_retries, timeout
        self.session_info: dict | None = None

    def _request(self, method: str, path: str, *, stream: bool = False, headers: dict | None = None,
                 accept_status: Iterable[int] = (200,)) -> requests.Response:
        url = self.base + path
        accept_status = set(accept_status)
        for attempt in range(self.max_retries + 1):
            self.limiter.acquire()
            try:
                resp = self.session.request(method, url, stream=stream, timeout=self.timeout, headers=headers)
            except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError) as exc:
                if attempt == self.max_retries:
                    raise
                delay = min(60, 2 ** attempt) + random.random()
                log(f"network error on {method} {path} ({type(exc).__name__}); retry {attempt + 1} in {delay:.1f}s")
                time.sleep(delay)
                continue
            if resp.status_code in accept_status:
                return resp
            if resp.status_code in self.RETRY_STATUS and attempt < self.max_retries:
                retry_after = resp.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else min(120, 2 ** attempt) + random.random()
                log(f"HTTP {resp.status_code} on {method} {path}; retry {attempt + 1} in {delay:.1f}s")
                resp.close()
                time.sleep(delay)
                continue
            try:
                payload = resp.json()
            except ValueError:
                payload = resp.text[:300]
            raise ApiError(resp.status_code, payload)
        raise RuntimeError("unreachable")

    def api(self, method: str, path: str) -> Any:
        return self._request(method, "/api/" + path.lstrip("/")).json()

    # ---- endpoints -----------------------------------------------------------------------
    def start_session(self) -> dict:
        self.session_info = self.api("POST", "session")
        return self.session_info

    def post_count(self) -> int:
        return int(self.api("GET", "post-count")["posts"])

    def posts_page(self, cursor: dict | None, limit: int = PAGE_LIMIT) -> dict:
        params = {"details": "1", "sort": "created", "direction": "desc", "limit": str(limit)}
        if cursor:
            params.update({"after": cursor["id"], "afterCreated": str(cursor["created"])})
        return self.api("GET", "docs/posts?" + requests.compat.urlencode(params))

    def post_prompt(self, post_id: str) -> dict:
        return self.api("GET", "post-prompt/" + requests.utils.quote(post_id, safe=""))

    def media(self, asset_id: str, start: int = 0) -> requests.Response:
        headers = {"Accept": "*/*"}
        if start:
            headers["Range"] = f"bytes={start}-"
        return self._request("GET", "/media/" + requests.utils.quote(asset_id, safe=""), stream=True,
                             headers=headers, accept_status=(200, 206))


# --------------------------------------------------------------------------------------------
# stage 1: catalog scan
# --------------------------------------------------------------------------------------------
def stage_scan(client: AfterframeClient, out: Path, limit: int, max_pages: int | None) -> None:
    state_dir = out / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    catalog_path, scan_state_path = state_dir / "catalog.jsonl", state_dir / "scan_state.json"
    seen = {row["id"] for row in read_jsonl(catalog_path)}
    state = json.loads(scan_state_path.read_text()) if scan_state_path.exists() else {}
    if state.get("complete"):
        # A finished scan is refreshed from the top: new posts appear first in created-desc order,
        # so we stop as soon as a whole page is already known.
        log(f"catalog already complete ({len(seen)} posts); checking for new posts")
        state = {"cursor": None, "complete": False, "refresh": True}
    cursor = state.get("cursor")
    expected = client.post_count()
    log(f"server reports {expected} posts; {len(seen)} already in catalog; resuming from cursor {cursor}")
    writer = JsonlAppender(catalog_path)
    pages = 0
    bar = make_bar(total=expected, initial=len(seen), unit="post", desc="scan")
    try:
        while True:
            page = client.posts_page(cursor, limit)
            rows = page.get("rows") or []
            new = 0
            fetched_at = int(time.time() * 1000)
            for row in rows:
                if row["id"] in seen:
                    continue
                seen.add(row["id"])
                new += 1
                writer.write({"id": row["id"], "data": row.get("data") or {}, "fetched_at": fetched_at})
            if bar:
                bar.update(new)
            pages += 1
            cursor = page.get("cursor")
            done = not cursor or not rows or (state.get("refresh") and new == 0)
            state = {"cursor": cursor, "complete": bool(done), "pages_this_run": pages,
                     "posts": len(seen), "server_count": expected, "updated": fetched_at,
                     "refresh": state.get("refresh", False)}
            tmp = scan_state_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(state, indent=1))
            tmp.replace(scan_state_path)
            if done or (max_pages and pages >= max_pages):
                break
    finally:
        writer.close()
        if bar:
            bar.close()
    log(f"scan {'complete' if state['complete'] else 'paused'}: {len(seen)} posts in catalog "
        f"(server count {expected}; the count includes posts hidden from visitors, so they can differ)")


def load_catalog(out: Path) -> dict[str, dict]:
    catalog: dict[str, dict] = {}
    for row in read_jsonl(out / "state" / "catalog.jsonl"):
        catalog[row["id"]] = row  # later lines win
    return catalog


# --------------------------------------------------------------------------------------------
# stage 2: prompts (owner only)
# --------------------------------------------------------------------------------------------
def require_owner(client: AfterframeClient, out: Path | None = None, probe_id: str | None = None) -> None:
    info = client.start_session()
    if out is not None:
        rec = {"checked_at": int(time.time() * 1000), "session_admin": bool(info.get("admin"))}
        if not info.get("admin") and probe_id:
            try:
                client.post_prompt(probe_id)
                rec["probe"] = {"post": probe_id, "http": 200}
            except ApiError as exc:
                rec["probe"] = {"post": probe_id, "http": exc.status, "code": exc.code}
        (out / "state").mkdir(parents=True, exist_ok=True)
        (out / "state" / "prompt_access.json").write_text(json.dumps(rec, indent=1))
    if not info.get("admin"):
        raise SystemExit(
            "The prompt endpoint (/api/post-prompt/<id>) is owner-only and this session is not the owner "
            "(session.admin is false).\n"
            "Sign in as the owner in a browser (Afterframe > Settings > Owner sign-in), copy the request "
            "'Cookie' header for afterframe.marcelalia2.chatgpt.site from devtools, and pass it with "
            "--cookie-file or the AFTERFRAME_COOKIE environment variable. The extractor will not try to "
            "get prompts any other way.")
    log("owner session confirmed (session.admin is true)")


def stage_prompts(client: AfterframeClient, out: Path, workers: int, refetch_errors: bool) -> None:
    catalog = load_catalog(out)
    require_owner(client, out, next(iter(catalog), None))
    prompts_path = out / "state" / "prompts.jsonl"
    done: dict[str, dict] = {r["id"]: r for r in read_jsonl(prompts_path)}
    todo = [pid for pid in catalog
            if pid not in done or (refetch_errors and done[pid].get("status") == "error")]
    log(f"{len(catalog)} catalog posts; {len(done)} prompt lookups recorded; {len(todo)} to fetch")
    writer = JsonlAppender(prompts_path)

    def fetch(pid: str) -> dict:
        try:
            payload = client.post_prompt(pid)
        except ApiError as exc:
            if exc.code == "not_granted":
                raise SystemExit("owner access was lost mid-run (403 not_granted); refresh the cookie and rerun")
            status = "missing" if exc.status == 404 else "error"
            return {"id": pid, "status": status, "http": exc.status, "error": str(exc.payload)[:300]}
        prompt = payload.get("prompt") if isinstance(payload, dict) else None
        has = isinstance(prompt, str) and prompt.strip() != ""
        rec = {"id": pid, "status": "ok" if has else "empty", "prompt": prompt if isinstance(prompt, str) else None,
               "fetched_at": int(time.time() * 1000)}
        extra = {k: v for k, v in (payload.items() if isinstance(payload, dict) else []) if k != "prompt"}
        if extra:
            rec["extra"] = extra  # keep any other fields the backend returns (e.g. model) verbatim
        return rec

    bar = make_bar(total=len(todo), unit="post", desc="prompts")
    counts: dict[str, int] = {}
    try:
        with cf.ThreadPoolExecutor(max_workers=workers) as pool:
            for rec in pool.map(fetch, todo):
                writer.write(rec)
                counts[rec["status"]] = counts.get(rec["status"], 0) + 1
                if bar:
                    bar.update(1)
                    bar.set_postfix(counts)
    finally:
        writer.close()
        if bar:
            bar.close()
    log(f"prompt fetch finished: {counts}")


def load_prompts(out: Path) -> dict[str, dict]:
    return {r["id"]: r for r in read_jsonl(out / "state" / "prompts.jsonl")}


# --------------------------------------------------------------------------------------------
# permission policy
# --------------------------------------------------------------------------------------------
@dataclass
class PermissionPolicy:
    mode: str                         # "allowlist" | "owner-uploads" | "all-attested" | "pending"
    uploaders: set[str]

    @classmethod
    def from_args(cls, args, client: AfterframeClient | None) -> "PermissionPolicy":
        mode = args.permission_policy
        if mode is None:
            raise SystemExit(
                "Choose which posts you have permission to train on with --permission-policy:\n"
                "  owner-uploads  only posts uploaded by the owner's own visitor profile(s) (--uploader-id)\n"
                "  allowlist      only uploader ids listed in --uploaders-file (one 64-hex id per line)\n"
                "  all-attested   every post; you attest you hold training rights for all of them\n"
                "Afterframe accepts uploads from any visitor, so posts are not all yours by default.")
        if mode == "pending":            # permissions not decided yet: nothing is eligible
            return cls(mode, set())
        ids: set[str] = set(args.uploader_id or [])
        if mode == "allowlist":
            if not args.uploaders_file:
                raise SystemExit("--permission-policy allowlist needs --uploaders-file")
            ids |= {ln.strip().lower() for ln in Path(args.uploaders_file).read_text().splitlines()
                    if re.fullmatch(r"[0-9a-fA-F]{64}", ln.strip())}
        if mode == "owner-uploads" and not ids:
            if client is None or client.session_info is None:
                raise SystemExit("owner-uploads needs --uploader-id or an owner session")
            ids.add(client.session_info["id"])
        if mode in ("allowlist", "owner-uploads") and not ids:
            raise SystemExit("the permission policy resolved to an empty uploader list")
        return cls(mode, {i.lower() for i in ids})

    def allows(self, data: dict) -> bool:
        if self.mode == "pending":
            return False
        return self.mode == "all-attested" or str(data.get("by", "")).lower() in self.uploaders


def eligibility(post: dict, prompt_rec: dict | None, policy: PermissionPolicy | None) -> tuple[bool, str]:
    data = post.get("data") or {}
    if not data.get("asset"):
        return False, "no_media_asset"
    if (data.get("reportCount") or 0) >= HIDE_AT_REPORTS:
        return False, "hidden_by_moderation"
    if prompt_rec is None:
        return False, "prompt_not_fetched"   # see state/prompt_access.json for whether access was denied
    if prompt_rec.get("status") != "ok":
        return False, "prompt_" + str(prompt_rec.get("status"))
    if policy is not None and not policy.allows(data):
        return False, "no_permission"
    return True, "eligible"


# --------------------------------------------------------------------------------------------
# provenance
# --------------------------------------------------------------------------------------------
def c2pa_scan(path: Path, max_bytes: int = 4 << 20) -> dict:
    """Look for an embedded C2PA manifest and pull out its claims without validating signatures.

    Sora exports carry a JUMBF/C2PA manifest in a top-level `uuid` box before `moov`. We record the
    softwareAgent, digitalSourceType and signer organisation strings. This is evidence, not
    cryptographic verification: run `c2patool <file>` for a validated report.
    """
    with path.open("rb") as fh:
        head = fh.read(max_bytes)
    res: dict[str, Any] = {"present": b"jumdc2pa" in head or b"c2pa.claim" in head}
    if not res["present"]:
        return res
    m = re.search(rb"softwareAgent.{1,4}dname.([A-Za-z0-9 ._\-]{1,40})", head, re.S)
    if m:
        res["software_agent"] = m.group(1).decode("latin1").strip()
    m = re.search(rb"digitalsourcetype/(compositeWithTrainedAlgorithmicMedia|trainedAlgorithmicMedia|"
                  rb"compositeSynthetic|algorithmicMedia|digitalCapture|composite|minorHumanEdits|humanEdits)", head)
    if m:
        res["digital_source_type"] = m.group(1).decode()
    orgs = sorted({o.decode("latin1") for o in re.findall(rb"\x06\x03U\x04\n\x0c.(OpenAI)", head, re.S)})
    if orgs:
        res["signer_org"] = orgs[0]
    m = re.search(rb"\x06\x03U\x04\x03\x0c.([ -~]{4,64}?)0", head, re.S)
    if m and b"Sora" in m.group(1):
        res["signer_cn"] = m.group(1).decode("latin1")
    return res


def provenance_assessment(data: dict, probe: dict | None, c2pa: dict | None, prompt_rec: dict | None) -> dict:
    """Combine every signal we have about which model made the video. Never upgrades to 'confirmed'
    unless the backend itself names Sora 2."""
    signals: dict[str, Any] = {}
    gen_id = sora_generation_id(data.get("name"))
    signals["sora_generation_id"] = gen_id
    ts = crockford_ulid_ms(gen_id[4:]) if gen_id else None
    signals["generation_time_ms"] = ts
    signals["after_sora2_launch"] = None if ts is None else ts >= SORA_LAUNCH_SORA2_MS
    if c2pa:
        signals["c2pa_present"] = c2pa.get("present", False)
        signals["c2pa_software_agent"] = c2pa.get("software_agent")
        signals["c2pa_signer_org"] = c2pa.get("signer_org")
        signals["c2pa_source_type"] = c2pa.get("digital_source_type")
    if probe:
        signals["has_audio"] = probe.get("has_audio")
        signals["sora2_resolution"] = (probe.get("width"), probe.get("height")) in SORA2_DIMS
    backend_model = None
    if prompt_rec and isinstance(prompt_rec.get("extra"), dict):
        for key in ("model", "generationModel", "generator"):
            if prompt_rec["extra"].get(key):
                backend_model = str(prompt_rec["extra"][key])
    signals["backend_model"] = backend_model

    if backend_model:
        label = "sora2_confirmed_by_backend" if re.search(r"sora[\s_-]*2", backend_model, re.I) else "other_model_by_backend"
    else:
        is_sora = signals.get("c2pa_software_agent") == "Sora" and signals.get("c2pa_signer_org") == "OpenAI"
        strong = [signals.get("after_sora2_launch") is True, signals.get("has_audio") is True,
                  signals.get("sora2_resolution") is True]
        if is_sora and all(strong):
            label = "sora2_likely"          # made by Sora (C2PA), with every Sora-2-only trait present
        elif is_sora:
            label = "sora_version_uncertain"
        elif c2pa is None and probe is None:
            label = "unverified_not_downloaded"
        else:
            label = "provenance_uncertain"  # no OpenAI/Sora C2PA claim found
    return {"label": label, "signals": signals}


# --------------------------------------------------------------------------------------------
# stage 3: download
# --------------------------------------------------------------------------------------------
def ffprobe(path: Path) -> dict:
    cmd = ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        return {"ok": False, "error": proc.stderr.strip()[:300]}
    info = json.loads(proc.stdout or "{}")
    vids = [s for s in info.get("streams", []) if s.get("codec_type") == "video"]
    auds = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if not vids:
        return {"ok": False, "error": "no video stream"}
    v = vids[0]

    def rate(txt: str | None) -> float | None:
        if not txt or txt in ("0/0",):
            return None
        num, _, den = txt.partition("/")
        return float(num) / float(den or 1) if float(den or 1) else None

    width, height = int(v.get("width") or 0), int(v.get("height") or 0)
    rot = 0
    for sd in v.get("side_data_list") or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        width, height = height, width
    duration = float(v.get("duration") or info.get("format", {}).get("duration") or 0)
    fps = rate(v.get("avg_frame_rate")) or rate(v.get("r_frame_rate"))
    nb = int(v["nb_frames"]) if str(v.get("nb_frames", "")).isdigit() else (round(duration * fps) if fps else None)
    ok = width > 0 and height > 0 and duration > 0 and bool(fps)
    return {"ok": ok, "error": None if ok else "bad stream parameters", "width": width, "height": height,
            "fps": fps, "r_frame_rate": v.get("r_frame_rate"), "avg_frame_rate": v.get("avg_frame_rate"),
            "duration": duration, "nb_frames": nb, "vcodec": v.get("codec_name"), "pix_fmt": v.get("pix_fmt"),
            "rotation": rot, "has_audio": bool(auds), "acodec": auds[0].get("codec_name") if auds else None,
            "container": info.get("format", {}).get("format_name"),
            "bit_rate": int(info.get("format", {}).get("bit_rate") or 0)}


def deep_decode_ok(path: Path) -> tuple[bool, str]:
    """Decode every video frame; catches truncated or corrupt streams that ffprobe accepts."""
    proc = subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-i", str(path), "-map", "0:v:0", "-f", "null", "-"],
                          capture_output=True, text=True, timeout=600)
    return proc.returncode == 0 and not proc.stderr.strip(), proc.stderr.strip()[:300]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download_one(client: AfterframeClient, post: dict, dest_dir: Path, deep_verify: bool) -> dict:
    pid, data = post["id"], post["data"]
    ext = ".mov" if "quicktime" in str(data.get("type", "")) else ".mp4"
    final = dest_dir / f"{pid}{ext}"
    part = final.with_suffix(final.suffix + ".part")
    dest_dir.mkdir(parents=True, exist_ok=True)
    total = None
    for attempt in range(4):
        start = part.stat().st_size if part.exists() else 0
        try:
            resp = client.media(data["asset"], start)
        except ApiError as exc:
            return {"id": pid, "status": "http_error", "http": exc.status, "error": str(exc.payload)[:200]}
        with resp:
            if start and resp.status_code == 200:      # server ignored Range: start over
                start = 0
            cr = resp.headers.get("Content-Range")
            if cr and "/" in cr:
                total = int(cr.rsplit("/", 1)[1])
            elif resp.headers.get("Content-Length"):
                total = start + int(resp.headers["Content-Length"])
            try:
                with part.open("ab" if start else "wb") as fh:
                    for chunk in resp.iter_content(1 << 20):
                        fh.write(chunk)
            except (requests.ConnectionError, requests.exceptions.ChunkedEncodingError, requests.Timeout):
                time.sleep(2 ** attempt)
                continue                                # resume from the partial file
        size = part.stat().st_size
        if total is not None and size != total:
            if size > total:
                part.unlink()
            continue
        break
    else:
        return {"id": pid, "status": "incomplete", "bytes": part.stat().st_size if part.exists() else 0, "expected": total}

    probe = ffprobe(part)
    if not probe["ok"]:
        bad = dest_dir.parent.parent / "quarantine" / part.name.replace(".part", "")
        bad.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(part), bad)
        return {"id": pid, "status": "corrupt", "error": probe["error"], "quarantined": str(bad)}
    if deep_verify:
        ok, err = deep_decode_ok(part)
        if not ok:
            bad = dest_dir.parent.parent / "quarantine" / part.name.replace(".part", "")
            bad.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(part), bad)
            return {"id": pid, "status": "corrupt", "error": "decode: " + err, "quarantined": str(bad)}
    digest = sha256_file(part)
    c2pa = c2pa_scan(part)
    part.replace(final)
    return {"id": pid, "status": "ok", "path": str(final), "bytes": final.stat().st_size, "sha256": digest,
            "probe": probe, "c2pa": c2pa, "asset": data["asset"], "downloaded_at": int(time.time() * 1000)}


def stage_download(client: AfterframeClient, out: Path, args) -> None:
    catalog, prompts = load_catalog(out), load_prompts(out)
    if args.test_sample:
        # Pipeline test mode: downloads a few posts regardless of prompt so the downloader, ffprobe,
        # dedup and provenance code can be exercised. They go to test_sample/, never into raw/, and
        # prepare_dataset.py never reads that folder.
        policy = None
        posts = [p for p in catalog.values() if p["data"].get("asset")]
        random.Random(0).shuffle(posts)
        selected = posts[: args.test_sample]
        root = out / "test_sample"
        dl_path = out / "state" / "test_sample_downloads.jsonl"
    else:
        if client.session_info is None:
            client.start_session()
        policy = PermissionPolicy.from_args(args, client)
        selected, reasons = [], {}
        for pid, post in catalog.items():
            ok, why = eligibility(post, prompts.get(pid), policy)
            reasons[why] = reasons.get(why, 0) + 1
            if ok:
                selected.append(post)
        log(f"eligibility over {len(catalog)} catalog posts: {reasons}")
        root = out / "raw"
        dl_path = out / "state" / "downloads.jsonl"

    if args.num_shards > 1:
        wanted = set(range(args.num_shards)) if args.shards is None else {int(s) for s in args.shards.split(",")}
        selected = [p for p in selected if shard_of(p["id"], args.num_shards) in wanted]

    done = {r["id"]: r for r in read_jsonl(dl_path)}
    ok_ids = {pid for pid, r in done.items() if r.get("status") == "ok" and Path(r["path"]).exists()}
    seen_assets = {done[pid]["asset"] for pid in ok_ids if done[pid].get("asset")}
    seen_hashes = {done[pid]["sha256"]: pid for pid in ok_ids}
    queue, dup_assets = [], 0
    for post in sorted(selected, key=lambda p: p["data"].get("created", 0)):
        if post["id"] in ok_ids or done.get(post["id"], {}).get("status") in ("corrupt", "duplicate"):
            continue
        if post["data"]["asset"] in seen_assets:      # same stored file referenced twice
            dup_assets += 1
            continue
        seen_assets.add(post["data"]["asset"])
        queue.append(post)
    budget = int(args.max_gb * 1e9) if args.max_gb else None
    log(f"{len(selected)} selected, {len(ok_ids)} already downloaded, {dup_assets} duplicate asset refs skipped, "
        f"{len(queue)} queued" + (f", budget {args.max_gb} GB" if budget else ""))
    if args.limit:
        queue = queue[: args.limit]

    writer = JsonlAppender(dl_path)
    done_paths = {pid: done[pid]["path"] for pid in ok_ids}
    created = lambda pid: (catalog[pid]["data"].get("created", 0), pid)  # noqa: E731
    used = 0
    lock = threading.Lock()
    stop = threading.Event()
    counts: dict[str, int] = {}
    bar = make_bar(total=len(queue), unit="video", desc="download")

    def work(post: dict) -> dict | None:
        if stop.is_set():
            return None
        shard = shard_of(post["id"], max(1, args.num_shards))
        return download_one(client, post, root / f"shard_{shard:03d}", args.deep_verify)

    try:
        with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(work, p) for p in queue]
            for fut in cf.as_completed(futures):
                rec = fut.result()
                if rec is None:
                    continue
                if rec["status"] == "ok":
                    with lock:
                        prior = seen_hashes.get(rec["sha256"])
                        if prior and prior != rec["id"]:
                            # byte-identical re-upload: keep the earliest upload, whichever finished first
                            if created(rec["id"]) < created(prior):
                                Path(done_paths[prior]).unlink(missing_ok=True)
                                writer.write({"id": prior, "status": "duplicate", "duplicate_of": rec["id"],
                                              "sha256": rec["sha256"]})
                                counts["duplicate"] = counts.get("duplicate", 0) + 1
                                counts["ok"] -= 1
                                seen_hashes[rec["sha256"]] = rec["id"]
                                done_paths[rec["id"]] = rec["path"]
                            else:
                                Path(rec["path"]).unlink(missing_ok=True)
                                rec = {"id": rec["id"], "status": "duplicate", "duplicate_of": prior,
                                       "sha256": rec["sha256"]}
                        else:
                            seen_hashes[rec["sha256"]] = rec["id"]
                            done_paths[rec["id"]] = rec["path"]
                            used += rec["bytes"]
                            if budget and used >= budget:
                                stop.set()
                writer.write(rec)
                counts[rec["status"]] = counts.get(rec["status"], 0) + 1
                if bar:
                    bar.update(1)
                    bar.set_postfix(counts)
    finally:
        writer.close()
        if bar:
            bar.close()
    log(f"download finished: {counts}; {used / 1e9:.2f} GB this run" + (" (budget reached)" if stop.is_set() else ""))


# --------------------------------------------------------------------------------------------
# status
# --------------------------------------------------------------------------------------------
def stage_status(out: Path) -> None:
    catalog, prompts = load_catalog(out), load_prompts(out)
    downloads = {r["id"]: r for r in read_jsonl(out / "state" / "downloads.jsonl")}
    scan = json.loads((out / "state" / "scan_state.json").read_text()) if (out / "state" / "scan_state.json").exists() else {}
    reasons: dict[str, int] = {}
    for pid, post in catalog.items():
        _, why = eligibility(post, prompts.get(pid), None)
        reasons[why] = reasons.get(why, 0) + 1
    dl: dict[str, int] = {}
    for r in downloads.values():
        dl[r["status"]] = dl.get(r["status"], 0) + 1
    print(json.dumps({"catalog_posts": len(catalog), "scan": scan,
                      "prompt_lookups": len(prompts), "eligibility_before_permission_policy": reasons,
                      "downloads": dl}, indent=2))


# --------------------------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["scan", "prompts", "download", "all", "status"])
    ap.add_argument("--out", type=Path, default=Path("afterframe_data"))
    ap.add_argument("--base-url", default=BASE_URL)
    ap.add_argument("--cookie-file", type=Path, help="file holding the owner's Cookie header (or set AFTERFRAME_COOKIE)")
    ap.add_argument("--rate", type=float, default=3.0, help="max HTTP requests per second, all threads together")
    ap.add_argument("--workers", type=int, default=4, help="concurrent prompt/download workers")
    ap.add_argument("--page-limit", type=int, default=PAGE_LIMIT)
    ap.add_argument("--max-pages", type=int, help="stop the scan after N pages (it resumes next run)")
    ap.add_argument("--refetch-errors", action="store_true")
    ap.add_argument("--permission-policy", choices=["owner-uploads", "allowlist", "all-attested", "pending"])
    ap.add_argument("--uploader-id", action="append", help="64-hex visitor id whose uploads you may use (repeatable)")
    ap.add_argument("--uploaders-file", help="file with one permitted 64-hex uploader id per line")
    ap.add_argument("--num-shards", type=int, default=16, help="posts are hashed into this many shards")
    ap.add_argument("--shards", help="comma-separated shard indexes to download this run (default all)")
    ap.add_argument("--max-gb", type=float, help="stop downloading after this many GB (incremental runs)")
    ap.add_argument("--limit", type=int, help="download at most N videos this run")
    ap.add_argument("--deep-verify", action="store_true", help="decode every frame to catch corruption")
    ap.add_argument("--test-sample", type=int, help="download N random posts to test_sample/ for pipeline tests only")
    args = ap.parse_args(argv)

    cookie = os.environ.get("AFTERFRAME_COOKIE")
    if args.cookie_file:
        cookie = args.cookie_file.read_text().strip()
    client = AfterframeClient(args.base_url, cookie=cookie, rate=args.rate)
    args.out.mkdir(parents=True, exist_ok=True)

    if args.stage in ("scan", "all"):
        client.start_session()
        stage_scan(client, args.out, args.page_limit, args.max_pages)
    if args.stage in ("prompts", "all"):
        stage_prompts(client, args.out, args.workers, args.refetch_errors)
    if args.stage in ("download", "all"):
        stage_download(client, args.out, args)
    if args.stage == "status":
        stage_status(args.out)


if __name__ == "__main__":
    main()
