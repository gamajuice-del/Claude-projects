"""End-to-end tests that run on CPU (no GPU, no network, no real Afterframe data).

    pytest -q tests/test_pipeline.py

The training tests use a 2-layer random Wan model, so they check the machinery (caching, LoRA injection,
flow-matching step, DDP, checkpoint/resume, export, LoRA loading, inference), not output quality.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))

import extract_afterframe as ex  # noqa: E402
import prepare_dataset as prep  # noqa: E402
from fixtures import OWNER_COOKIE, MockAfterframe, make_tiny_wan, make_video  # noqa: E402

PREFIX = "Sora 2 video, prompt: "


@pytest.fixture(scope="module")
def work(tmp_path_factory):
    return tmp_path_factory.mktemp("af")


@pytest.fixture(scope="module")
def site(work):
    vids = work / "src"
    files = {
        "v1": make_video(vids / "v1.mp4", 3.2, "1280x704", pattern="testsrc2", seed=1),
        "v2": make_video(vids / "v2.mp4", 3.2, "704x1280", pattern="mandel", seed=2),
        "v3": make_video(vids / "v3.mp4", 3.2, "1280x704", pattern="life", seed=3),
        "v4": make_video(vids / "v4.mp4", 3.2, "704x1280", pattern="cells", seed=4),
        "v5": make_video(vids / "v5.mp4", 3.2, "1280x704", pattern="gradient", seed=5),
        "v6": make_video(vids / "v6.mp4", 3.2, "1280x704", pattern="life", seed=6),
        "v7": make_video(vids / "v7.mp4", 3.2, "704x1280", pattern="mandel", seed=7, audio=False),
    }
    # near-duplicate of v3: rescaled + re-encoded, uploaded as a different post
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(files["v3"]), "-vf", "scale=640:352", "-c:v", "libx264",
                    "-crf", "30", str(vids / "v3_reencode.mp4")], check=True)
    files["v3b"] = vids / "v3_reencode.mp4"
    media = {f"asset-{k}": p.read_bytes() for k, p in files.items()}
    media["asset-v1copy"] = files["v1"].read_bytes()                # byte-identical re-upload of v1
    media["asset-corrupt"] = os.urandom(200_000)                    # not a video
    prompts = {
        "p1": "TEST FIXTURE a realistic handheld recording of the mall at night.",
        "p2": "TEST FIXTURE prompt two",
        "p3": "TEST FIXTURE prompt three",
        "p3b": "TEST FIXTURE prompt three, re-upload",
        "p4": "  TEST FIXTURE prompt four with outer spaces  ",
        "p5": "TEST FIXTURE prompt five",
        "p6": "",            # empty -> excluded
        "p7": "   ",         # whitespace -> excluded
        "p1copy": "TEST FIXTURE duplicate bytes of one",
        "pbad": "TEST FIXTURE corrupt file",
        # "p8" deliberately has no prompt record at all (404)
    }
    uploader = {k: ("a" * 64 if k not in ("p5",) else "c" * 64) for k in list(prompts) + ["p8"]}
    posts = []
    order = [("p1", "v1"), ("p2", "v2"), ("p3", "v3"), ("p3b", "v3b"), ("p4", "v4"), ("p5", "v5"), ("p6", "v6"),
             ("p7", "v7"), ("p1copy", "v1copy"), ("pbad", "corrupt"), ("p8", "v6")]
    for i, (pid, asset) in enumerate(order):
        posts.append({"id": pid, "data": {"by": uploader[pid], "created": 1795000000000 + i * 1000,
                                          "asset": f"asset-{asset}", "type": "video/mp4", "w": 1280, "h": 704,
                                          "dur": 3.2, "name": f"gen_01k9{i:022d}.mp4", "reportCount": 0}})
    # posts p8 and p6 share the same stored asset name? no: p8 references v6's asset id -> duplicate asset ref
    mock = MockAfterframe(posts, media, prompts, page_size=3, fail_every=9)
    yield mock
    mock.close()


def run_ex(*argv):
    ex.main([str(a) for a in argv])


def test_extract(site, work):
    out = work / "data"
    run_ex("scan", "--out", out, "--base-url", site.url, "--rate", "200")
    cat = ex.load_catalog(out)
    assert len(cat) == 11
    # visitor session: prompt stage must refuse, not try other routes
    with pytest.raises(SystemExit) as e:
        run_ex("prompts", "--out", out, "--base-url", site.url, "--rate", "200")
    assert "owner-only" in str(e.value)
    os.environ["AFTERFRAME_COOKIE"] = OWNER_COOKIE
    try:
        run_ex("prompts", "--out", out, "--base-url", site.url, "--rate", "200")
        pr = ex.load_prompts(out)
        assert pr["p1"]["status"] == "ok" and pr["p6"]["status"] == "empty" and pr["p7"]["status"] == "empty"
        assert pr["p8"]["status"] == "missing"
        assert pr["p4"]["prompt"] == "  TEST FIXTURE prompt four with outer spaces  "   # verbatim
        # download needs an explicit permission policy
        with pytest.raises(SystemExit):
            run_ex("download", "--out", out, "--base-url", site.url)
        # simulate an interrupted earlier download of p2: half the bytes already on disk
        shard = ex.shard_of("p2", 2)
        part = out / "raw" / f"shard_{shard:03d}" / "p2.mp4.part"
        part.parent.mkdir(parents=True, exist_ok=True)
        part.write_bytes(site.media["asset-v2"][:50_000])
        run_ex("download", "--out", out, "--base-url", site.url, "--rate", "200", "--num-shards", "2",
               "--permission-policy", "owner-uploads", "--uploader-id", "a" * 64, "--deep-verify")
    finally:
        os.environ.pop("AFTERFRAME_COOKIE", None)
    dl = {r["id"]: r for r in ex.read_jsonl(out / "state" / "downloads.jsonl")}
    assert "p5" not in dl                                     # other uploader: no permission
    assert "p6" not in dl and "p7" not in dl and "p8" not in dl  # no usable prompt
    assert dl["p2"]["status"] == "ok" and dl["p2"]["sha256"] == __import__("hashlib").sha256(site.media["asset-v2"]).hexdigest()
    assert dl["pbad"]["status"] == "corrupt" and Path(dl["pbad"]["quarantined"]).exists()
    dup = [r for r in dl.values() if r["status"] == "duplicate"]
    assert len(dup) == 1 and {dup[0]["id"], dup[0]["duplicate_of"]} == {"p1", "p1copy"}
    assert dl["p1"]["probe"]["fps"] == 30 and dl["p1"]["probe"]["width"] == 1280 and dl["p1"]["probe"]["has_audio"]
    assert site.writes == 0                                   # nothing but GETs and the session POST
    # second run is a no-op (resumable)
    lines_before = (out / "state" / "downloads.jsonl").read_text().count("\n")
    os.environ["AFTERFRAME_COOKIE"] = OWNER_COOKIE
    try:
        run_ex("download", "--out", out, "--base-url", site.url, "--rate", "200", "--num-shards", "2",
               "--permission-policy", "owner-uploads", "--uploader-id", "a" * 64)
    finally:
        os.environ.pop("AFTERFRAME_COOKIE", None)
    assert (out / "state" / "downloads.jsonl").read_text().count("\n") == lines_before


def test_prepare(work):
    out = work / "dataset"
    access = json.loads((work / "data" / "state" / "prompt_access.json").read_text())
    assert access["owner_visitor_id"] == "a" * 64          # recorded by the prompts stage
    prep.main(["--data", str(work / "data"), "--out", str(out), "--permission-policy", "owner-uploads",
               "--val-fraction", "0.34", "--no-group-identical-prompts",
               "--exclude-flags", "low_resolution,signature_failed", "--min-seconds", "1"])
    lines = (out / "dataset_manifest.jsonl").read_text(encoding="utf-8").splitlines()
    header, rows = json.loads(lines[0]), [json.loads(l) for l in lines[1:]]
    assert header["_type"] == "manifest_header" and header["records"] == len(rows)
    ids = {r["id"] for r in rows}
    assert {"p1", "p2", "p4"} <= ids and not ids & {"p5", "p6", "p7", "p8", "pbad", "p1copy"}
    assert len(ids & {"p3", "p3b"}) == 1                    # near-duplicate pair collapsed to one
    for r in rows:
        cap = (out / r["caption_path"]).read_bytes().decode("utf-8")
        assert cap == PREFIX + r["backend_prompt"] == r["training_caption"]
        assert (out / r["video_path"]).stat().st_size == r["bytes"]
        assert r["provenance"]["label"] in ("provenance_uncertain", "sora_version_uncertain")  # fixtures have no C2PA
        assert r["split"] in ("train", "val")
    p4 = next(r for r in rows if r["id"] == "p4")
    assert p4["training_caption"] == PREFIX + "  TEST FIXTURE prompt four with outer spaces  "
    rep = json.loads((out / "report.json").read_text())
    assert rep["excluded"]["duplicate"] >= 1 and rep["near_duplicate_pairs"] >= 1
    # every shard folder is self-contained
    for shard in {r["shard"] for r in rows}:
        assert (out / shard / "manifest.jsonl").exists()


def test_clip_planning():
    from afterframe_wan import nearest_bucket, plan_clips
    assert nearest_bucket(1280, 704, [[640, 352], [352, 640], [480, 480]]) == (640, 352)
    assert nearest_bucket(704, 1280, [[640, 352], [352, 640], [480, 480]]) == (352, 640)
    clips = plan_clips(10.1, [49], 16, 2)
    assert len(clips) == 2 and all(f == 49 for _, f in clips)
    assert clips[0][0] >= 0 and clips[1][0] + 49 / 16 <= 10.1
    clips = plan_clips(15.1, [81, 33], 16, 3)
    assert [f for _, f in clips] == [81, 81, 33] or [f for _, f in clips] == [81, 81]
    assert plan_clips(1.0, [33], 16, 2) == []


def _wan(*argv, nproc=1, env=None):
    cmd = [sys.executable, str(ROOT / "afterframe_wan.py"), *map(str, argv)]
    if nproc > 1:
        cmd = [sys.executable, "-m", "torch.distributed.run", f"--nproc_per_node={nproc}", "--master_port=29517",
               str(ROOT / "afterframe_wan.py"), *map(str, argv)]
    e = {**os.environ, "OMP_NUM_THREADS": "2", **(env or {})}
    r = subprocess.run(cmd, capture_output=True, text=True, env=e, timeout=1800)
    if r.returncode != 0:
        print(r.stdout[-4000:], r.stderr[-6000:])
    assert r.returncode == 0
    return r.stdout + r.stderr


@pytest.fixture(scope="module")
def tiny(work):
    return make_tiny_wan(work / "tiny_wan")


def test_cache_train_resume_export_infer(work, tiny):
    cache, run = work / "cache", work / "run"
    common = ["--preset", "smoke", "--model-path", tiny, "--cache-dir", cache]
    out = _wan("cache", *common, "--dataset", work / "dataset", "--vae-dtype", "fp32", "--decode-workers", "2")
    stage = cache / "smoke_192p"
    idx = [json.loads(l) for p in stage.glob("*/index.jsonl") for l in p.read_text().splitlines()]
    assert idx and all(e["shape"][0] == 16 for e in idx)
    assert all((cache / "text" / f"{e['text_key']}.safetensors").exists() for e in idx)
    assert (cache / "text" / "_negative.safetensors").exists() and (cache / "text" / "_val00.safetensors").exists()
    # text cache holds the prefixed caption, untouched
    from afterframe_wan import load_st
    _, meta = load_st(next(p for p in (cache / "text").glob("*.safetensors") if not p.name.startswith("_")))
    assert meta["text"].startswith(PREFIX)

    train = ["train", *common, "--output-dir", run, "--mixed-precision", "no", "--optimizer", "adamw",
             "--log-every", "1", "--save-every", "2", "--val-loss-every", "2", "--val-every", "2", "--val-steps", "2",
             "--val-frames", "5", "--num-workers", "0", "--total-steps", "10", "--warmup-steps", "1", "--passes", "50"]
    _wan(*train, "--max-steps", "2")
    assert (run / "checkpoints" / "step_0000002" / "lora_peft.safetensors").exists()
    assert list((run / "validation" / "step_0000002").glob("*.mp4"))
    log1 = [json.loads(l) for l in (run / "logs" / "train_log.jsonl").read_text().splitlines()]
    assert log1[-1]["step"] == 2
    out = _wan(*train, "--max-steps", "4")
    assert "resumed from" in out and "step_0000002" in out
    log2 = [json.loads(l) for l in (run / "logs" / "train_log.jsonl").read_text().splitlines()]
    assert [r["step"] for r in log2][-2:] == [3, 4]
    assert (run / "logs" / "val_log.jsonl").exists()

    lora = run / "afterframe_sora2_lora.safetensors"
    assert lora.exists() and lora.with_name(lora.stem + "_comfyui.safetensors").exists()
    tensors, meta = load_st(lora)
    assert all(k.startswith("transformer.blocks.") for k in tensors) and meta["trigger"] == "Sora 2 video, prompt:"

    # the exported file loads in diffusers and changes the output; strength 0 reproduces the base model
    import numpy as np
    import torch
    from afterframe_wan import Generator
    g = Generator(model_path=str(tiny), lora=None)
    kw = dict(seed=3, width=64, height=64, num_frames=5, steps=2, guidance=1.0)
    base = g(PREFIX + "A realistic handheld recording of an abandoned shopping mall at night.", **kw)
    g.load_lora(str(lora))
    # make the effect visible: the random tiny model was barely trained, so scale the adapter up
    on = g(PREFIX + "A realistic handheld recording of an abandoned shopping mall at night.", lora_strength=50.0, **kw)
    off = g(PREFIX + "A realistic handheld recording of an abandoned shopping mall at night.", lora_strength=0, **kw)
    assert np.allclose(base, off, atol=1e-5)
    assert not np.allclose(base, on, atol=1e-4)


def test_ddp_two_processes(work, tiny):
    """2-rank DistributedDataParallel (gloo, CPU): same code path as the 2 x T4 run."""
    run = work / "run_ddp"
    out = _wan("train", "--preset", "smoke", "--model-path", tiny, "--cache-dir", work / "cache", "--output-dir", run,
               "--mixed-precision", "no", "--optimizer", "adamw", "--log-every", "1", "--save-every", "2",
               "--val-loss-every", "2", "--val-every", "0", "--num-workers", "0", "--max-steps", "2", "--passes", "50",
               nproc=2)
    assert "ranks in sync" in out and "LoRA checksum per rank [" in out
    assert (run / "checkpoints" / "step_0000002" / "training_state.pt").exists()
    cfg = json.loads((run / "run_config.json").read_text())
    assert cfg["world"] == 2


def test_lora_learns(work, tiny):
    """Overfit sanity check: on the tiny fixture set the LoRA must reduce train and held-out loss."""
    import numpy as np
    run = work / "run_learn"
    _wan("train", "--preset", "smoke", "--model-path", tiny, "--cache-dir", work / "cache", "--output-dir", run,
         "--mixed-precision", "no", "--optimizer", "adamw", "--lr", "3e-3", "--log-every", "1", "--save-every", "1000",
         "--val-loss-every", "50", "--val-every", "0", "--num-workers", "0", "--max-steps", "150", "--passes", "1000",
         "--warmup-steps", "5", "--total-steps", "150", "--timestep-sampling", "uniform", "--no-resume")
    loss = [json.loads(l)["loss"] for l in (run / "logs" / "train_log.jsonl").read_text().splitlines()]
    val = [json.loads(l)["val_loss"] for l in (run / "logs" / "val_log.jsonl").read_text().splitlines()]
    assert np.mean(loss[-20:]) < 0.9 * np.mean(loss[:20])
    assert val[-1] < val[0]
