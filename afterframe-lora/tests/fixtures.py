"""Test fixtures: a local mock of the Afterframe API, synthetic videos, and a tiny random Wan model.

Nothing here is real Afterframe data. Prompts are labelled "TEST FIXTURE" so they can never be mistaken
for backend prompts, and the fixture videos are ffmpeg test patterns.
"""
from __future__ import annotations

import json
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

OWNER_COOKIE = "af_owner=letmein"


def make_video(path: Path, seconds: float = 3.0, size: str = "1280x704", fps: int = 30, pattern: str = "testsrc2",
               audio: bool = True, seed: int = 0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    src = {"testsrc2": f"testsrc2=size={size}:rate={fps}",
           "mandel": f"mandelbrot=size={size}:rate={fps}",
           "life": f"life=size={size}:rate={fps}:seed={seed}:mold=10:ratio=0.3",
           "cells": f"cellauto=size={size}:rate={fps}:rule={18 + seed}",
           "gradient": f"gradients=size={size}:rate={fps}:seed={seed}:speed=0.05"}[pattern]
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", src]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency={300 + 50 * seed}:sample_rate=48000"]
    cmd += ["-t", str(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast"]
    cmd += (["-c:a", "aac", "-shortest"] if audio else [])
    cmd += [str(path)]
    subprocess.run(cmd, check=True)
    return path


class MockAfterframe:
    """Implements the endpoints extract_afterframe.py uses, with the same pagination, owner gating and
    Range behaviour as the real site, plus optional injected 503s."""

    def __init__(self, posts: list[dict], media: dict[str, bytes], prompts: dict[str, str | None],
                 page_size: int = 50, fail_every: int = 0):
        self.posts = sorted(posts, key=lambda p: (-p["data"]["created"], p["id"]))
        self.media, self.prompts = media, prompts
        self.page_size, self.fail_every = page_size, fail_every
        self.hits = 0
        self.lock = threading.Lock()
        self.writes = 0
        mock = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _json(self, code, obj):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _flaky(self):
                with mock.lock:
                    mock.hits += 1
                    return mock.fail_every and mock.hits % mock.fail_every == 0

            def do_POST(self):
                if self.path == "/api/session":
                    owner = OWNER_COOKIE in (self.headers.get("Cookie") or "")
                    return self._json(200, {"id": "a" * 64 if owner else "b" * 64, "admin": owner})
                mock.writes += 1
                self._json(405, {"code": "read_only_mock"})

            def do_PUT(self):
                mock.writes += 1
                self._json(405, {})

            do_DELETE = do_PATCH = do_PUT

            def do_GET(self):
                if self._flaky():
                    return self._json(503, {"code": "unavailable"})
                u = urlparse(self.path)
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                if u.path == "/api/post-count":
                    return self._json(200, {"posts": len(mock.posts)})
                if u.path == "/api/docs/posts":
                    rows = mock.posts
                    if "after" in q:
                        key = (-int(q["afterCreated"]), q["after"])
                        rows = [p for p in rows if (-p["data"]["created"], p["id"]) > key]
                    n = min(int(q.get("limit", 30)), mock.page_size)
                    page = rows[:n]
                    cursor = {"id": page[-1]["id"], "created": page[-1]["data"]["created"]} if len(rows) > n else None
                    return self._json(200, {"rows": page, "cursor": cursor})
                if u.path.startswith("/api/post-prompt/"):
                    if OWNER_COOKIE not in (self.headers.get("Cookie") or ""):
                        return self._json(403, {"code": "not_granted", "message": "Access denied"})
                    pid = u.path.rsplit("/", 1)[1]
                    if pid not in mock.prompts:
                        return self._json(404, {"code": "not_found"})
                    return self._json(200, {"prompt": mock.prompts[pid]})
                if u.path.startswith("/media/"):
                    data = mock.media.get(u.path.rsplit("/", 1)[1])
                    if data is None:
                        return self._json(404, {"code": "not_found"})
                    start = 0
                    rng = self.headers.get("Range")
                    if rng and rng.startswith("bytes="):
                        start = int(rng[6:].split("-")[0])
                    body = data[start:]
                    self.send_response(206 if start else 200)
                    self.send_header("Content-Type", "video/mp4")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Length", str(len(body)))
                    if start:
                        self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self._json(404, {"code": "not_found"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()


def make_tiny_wan(dst: Path) -> Path:
    """Random-weight Wan2.1-shaped pipeline (2 layers, dim 32) saved in diffusers layout."""
    import torch
    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanPipeline, WanTransformer3DModel
    from tokenizers import Tokenizer, models, pre_tokenizers, processors
    from transformers import PreTrainedTokenizerFast, UMT5Config, UMT5EncoderModel

    torch.manual_seed(0)
    words = ["<pad>", "</s>", "<unk>", "Sora", "2", "video", ",", "prompt", ":", "TEST", "FIXTURE", "a", "A", "of",
             "the", "at", "night", ".", "realistic", "handheld", "recording", "abandoned", "shopping", "mall"]
    tk = Tokenizer(models.WordLevel({w: i for i, w in enumerate(words)}, unk_token="<unk>"))
    tk.pre_tokenizer = pre_tokenizers.Whitespace()
    tk.post_processor = processors.TemplateProcessing(single="$A </s>", special_tokens=[("</s>", 1)])
    tok = PreTrainedTokenizerFast(tokenizer_object=tk, pad_token="<pad>", eos_token="</s>", unk_token="<unk>")
    te = UMT5EncoderModel(UMT5Config(vocab_size=len(words), d_model=32, d_kv=8, d_ff=64, num_layers=2, num_heads=4,
                                     relative_attention_num_buckets=8))
    vae = AutoencoderKLWan(base_dim=8, z_dim=16, dim_mult=[1, 2, 2, 2], num_res_blocks=1,
                           temperal_downsample=[False, True, True])
    tr = WanTransformer3DModel(patch_size=(1, 2, 2), num_attention_heads=2, attention_head_dim=16, in_channels=16,
                               out_channels=16, text_dim=32, freq_dim=32, ffn_dim=64, num_layers=2,
                               rope_max_seq_len=256)
    sched = UniPCMultistepScheduler(prediction_type="flow_prediction", use_flow_sigmas=True, flow_shift=3.0)
    WanPipeline(tokenizer=tok, text_encoder=te, vae=vae, transformer=tr, scheduler=sched).save_pretrained(str(dst))
    return dst
