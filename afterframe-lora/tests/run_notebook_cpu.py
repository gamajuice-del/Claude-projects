#!/usr/bin/env python3
"""Execute afterframe_lora_training.ipynb on CPU with a tiny random Wan model and synthetic data.

This runs the notebook's own orchestration code (dataset discovery, smoke test, benchmark, resumable
shard-by-shard training loop through torchrun with 2 gloo ranks, plots, export, inference) with only these
overrides: paths, PRESET="smoke", MODEL_DIR=<tiny model>, tiny inference sizes, and skipped pip/nvidia-smi.
It shows the notebook logic is wired correctly; it says nothing about speed or quality on T4s.

    python tests/run_notebook_cpu.py /path/to/workdir
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))


def build_fixture_dataset(work: Path) -> Path:
    import extract_afterframe as ex
    import prepare_dataset as prep
    from fixtures import OWNER_COOKIE, MockAfterframe, make_video
    pats = ["testsrc2", "mandel", "life", "cells", "gradient"]
    posts, media, prompts = [], {}, {}
    for i in range(14):
        size = "1280x704" if i % 3 else "704x1280"
        v = make_video(work / "src" / f"v{i}.mp4", 2.6, size, pattern=pats[i % 5], seed=i)
        pid = f"p{i:02d}"
        media[f"a{i}"] = v.read_bytes()
        prompts[pid] = f"TEST FIXTURE prompt number {i}"
        posts.append({"id": pid, "data": {"by": "a" * 64, "created": 1795000000000 + i, "asset": f"a{i}", "type": "video/mp4",
                                          "w": 1280, "h": 704, "dur": 2.6, "name": f"gen_01k9{i:022d}.mp4", "reportCount": 0}})
    mock = MockAfterframe(posts, media, prompts, page_size=5)
    data = work / "data"
    os.environ["AFTERFRAME_COOKIE"] = OWNER_COOKIE
    for stage in (["scan"], ["prompts"], ["download", "--num-shards", "2", "--permission-policy", "all-attested"]):
        ex.main([stage[0], "--out", str(data), "--base-url", mock.url, "--rate", "500", *stage[1:]])
    mock.close()
    out = work / "dataset"
    # patterns from the same ffmpeg source look alike to dHash; keep them all for this wiring test
    prep.main(["--data", str(data), "--out", str(out), "--permission-policy", "all-attested", "--val-fraction", "0.15",
               "--keep-near-duplicates", "--no-group-identical-prompts", "--min-seconds", "1"])
    return out


def main(work: Path) -> None:
    from fixtures import make_tiny_wan
    work.mkdir(parents=True, exist_ok=True)
    dataset = build_fixture_dataset(work)
    tiny = make_tiny_wan(work / "tiny_wan")
    kaggle = work / "kaggle_working"
    kaggle.mkdir(exist_ok=True)
    import nbformat
    nb = nbformat.read(str(ROOT / "afterframe_lora_training.ipynb"), 4)
    overrides = {
        "PRESET": '"smoke"', "SESSION_HOURS": "1.0", "SAFETY_MINUTES": "1",
        "DATASET_ROOTS": repr([str(dataset)]), "WORK": repr(str(kaggle)),
        "CACHE_DIR": repr(str(work / "cache")),
    }
    g: dict = {"__name__": "__main__"}
    os.chdir(kaggle)
    for idx, cell in enumerate(nb.cells):
        if cell.cell_type != "code":
            continue
        src = cell.source
        if src.startswith("%%writefile"):
            name, body = src.split("\n", 1)
            (kaggle / Path(name.split()[1]).name).write_text(body, encoding="utf-8")   # /kaggle/working -> work dir
            continue
        if "pip install" in src:
            continue
        if "nvidia-smi --query-gpu=index" in src:          # hardware cell -> pretend 2 devices (gloo ranks)
            src = "import torch\nNUM_GPUS = 2\n"
        if "snapshot_download(model_info" in src:
            src = f"MODEL_DIR = {str(tiny)!r}\n"
        for k, v in overrides.items():
            src = re.sub(rf"^{k} = .*$", f"{k} = {v}", src, flags=re.M)
        src = src.replace("WIDTH, HEIGHT = 832, 480", "WIDTH, HEIGHT = 64, 64").replace("NUM_FRAMES = 49", "NUM_FRAMES = 5")
        src = src.replace("STEPS = 30", "STEPS = 2").replace("num_frames=33", "num_frames=5")
        src = src.replace('"nvidia-smi", "--query-gpu', '"echo", "--query-gpu')   # no GPU monitor on CPU
        lines = []
        for line in src.split("\n"):
            if line.strip().startswith("!"):
                ind = line[: len(line) - len(line.lstrip())]
                cmd = line.strip()[1:]
                lines.append(f"{ind}__import__('subprocess').run({cmd!r}.format(**globals()), shell=True)")
            else:
                lines.append(line)
        print(f"\n===== cell {idx} =====", flush=True)
        exec(compile("\n".join(lines), f"<cell {idx}>", "exec"), g)
    out = Path(g["OUTPUT_DIR"])
    assert (out / "afterframe_sora2_lora.safetensors").exists()
    assert (out / "training_curves.png").exists()
    assert list((kaggle / "inference").glob("*_compare.mp4"))
    print("\nNOTEBOOK CPU RUN OK: plan", (out / "plan_state.json").read_text())


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
