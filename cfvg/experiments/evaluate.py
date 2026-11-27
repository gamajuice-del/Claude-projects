"""Evaluate trained CFVG variants on worlds they have never seen.

For every test case we know the true world, so three reference videos are built
alongside the generated ones:
  real  - the instructed events rendered in the true world (the ceiling)
  wrong - the instructed events rendered in a *different* random world (floor
          for context fidelity)
  copy  - reference clip 0 returned unchanged (what pure replication looks like)

Metrics (all read by the frozen probe):
  context_err  per-attribute error against the reference world, plus a
               composite normalised so that real = ~0 and wrong-world = 1
  instr_acc    fraction of caption slots (x0, y0, vx, vy bins) the video obeys
  copy_rate    fraction of videos whose events are closer to a reference clip's
               events than to the instructed events
  giant        override precision on cases whose caption says "gigantic"
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
import torch
from PIL import Image

from engine import (CONTENT_RANGES, GIANT, Content, content_bins, bin_centers, make_text,
                    render, sample_content, sample_contexts)
from model import CFVG, sample
from probe import Probe

K_MAX_TEST = 8
COLOR = ["bg_r", "bg_g", "bg_b", "fg_r", "fg_g", "fg_b"]
CONT_ATTRS = ["color", "size", "gravity", "wind", "ghost", "noise"]
CAT_ATTRS = ["shape", "hold"]
SPAN = np.array([r[1] - r[0] for r in CONTENT_RANGES.values()], np.float32)


def build_cases(split, n, seed):
    rng = np.random.default_rng(seed)
    ctx = sample_contexts(rng, n, split)
    refs, ref_c = [], []
    for j in range(K_MAX_TEST):
        c = sample_content(rng, n)
        ref_c.append(c.vector())
        refs.append(render(ctx, c, rng=rng))
    refs = np.stack(refs, 1)
    ref_bins = [content_bins(Content(*rc.T)) for rc in ref_c]
    # instructed events differ from every reference caption in >= 2 slots
    c = sample_content(rng, n)
    for _ in range(50):
        b = content_bins(c)
        bad = np.zeros(n, bool)
        for rb in ref_bins[:3]:
            bad |= (b != rb).sum(1) < 2
        if not bad.any():
            break
        c2 = sample_content(rng, bad.sum())
        for f in ("x0", "y0", "vx", "vy"):
            getattr(c, f)[bad] = getattr(c2, f)
    giant = rng.random(n) < 0.25
    other = sample_contexts(rng, n, "train")   # floor: a typical training world
    return dict(ctx=ctx, other=other, refs=refs, ref_c=np.stack(ref_c, 1), content=c, giant=giant,
                text=make_text(c, giant), bins=content_bins(c),
                real=render(ctx, c, giant, rng), wrong=render(other, c, giant, rng))


def read_metrics(probe, videos, case, k_used=3):
    d = probe.read(torch.as_tensor(videos))
    ctx, giant = case["ctx"], case["giant"]
    exp_size = ctx.size * np.where(giant, GIANT, 1.0)
    err = {
        "color": np.mean([np.abs(d[n] - ctx.vector()[:, i]) for i, n in enumerate(COLOR)], 0),
        "size": np.abs(d["size"] - exp_size),
        "gravity": np.abs(d["gravity"] - ctx.gravity),
        "wind": np.abs(d["wind"] - ctx.wind),
        "ghost": np.abs(d["ghost"] - ctx.ghost),
        "noise": np.abs(d["noise"] - ctx.noise),
        "shape": (d["shape"] != ctx.shape).astype(float),
        "hold": (d["hold"] != ctx.hold).astype(float),
    }
    read_c = np.stack([d[n] for n in CONTENT_RANGES], 1)
    read_bins = content_bins(Content(*read_c.T))
    instr = (read_bins == case["bins"]).mean(1)
    # events: distance (normalised) to instructed bin centre vs to each reference
    centre = bin_centers(case["bins"])
    d_instr = np.abs((read_c - centre) / SPAN).sum(1)
    d_refs = np.abs((read_c[:, None] - case["ref_c"][:, :k_used]) / SPAN).sum(2).min(1)
    copy = (d_refs < d_instr).astype(float)
    return err, instr, copy, d["size"], d["gravity"] - ctx.gravity


def summarise(err, instr, copy, size_read, grav_signed, case, floor=None):
    giant = case["giant"]
    out = {f"err_{k}": float(v.mean()) for k, v in err.items()}
    out["instr_acc"] = float(instr.mean())
    out["copy_rate"] = float(copy.mean())
    ratio = size_read / case["ctx"].size
    out["giant_ratio_on"] = float(ratio[giant].mean())       # want ~2.2
    out["giant_ratio_off"] = float(ratio[~giant].mean())     # want ~1.0
    out["gravity_bias"] = float(grav_signed.mean())   # < 0: weaker gravity than the reference
    if floor is not None:
        out["context_score"] = float(np.mean([err[k].mean() / floor[k] for k in err]))
    return out


def save_grid(path, case, gen, n=4):
    rows = []
    for b in range(n):
        for clip in [case["refs"][b, 0], case["refs"][b, 1], case["refs"][b, 2], gen[b], case["real"][b]]:
            rows.append(np.concatenate(list(clip.transpose(0, 2, 3, 1)), 1))
        rows.append(np.ones((3, rows[-1].shape[1], 3)))
    img = ((np.concatenate(rows[:-1], 0) + 1) / 2 * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(img).resize((img.shape[1] * 3, img.shape[0] * 3), Image.NEAREST).save(path)


def load_model(run):
    a = json.load(open(f"runs/{run}/args.json"))
    m = CFVG(depth=a["depth"], enc_depth=a["enc_depth"], bottleneck=a["bottleneck"],
             text_len=7 if a["leaky"] else 5)
    m.load_state_dict(torch.load(f"runs/{run}/ckpt.pt", weights_only=False)["ema"])
    return m.eval(), a


def generate(model, case, k, text=None, text_scale=1.0, bs=96):
    text = case["text"] if text is None else text
    n = len(text)
    out = []
    for i in range(0, n, bs):
        refs = torch.from_numpy(case["refs"][i:i + bs, :k])
        mask = torch.ones(refs.shape[:2], dtype=torch.bool)
        with torch.autocast("cpu", dtype=torch.bfloat16):
            v = sample(model, refs, mask, torch.from_numpy(text[i:i + bs]), text_scale=text_scale,
                       seed=i)
        out.append(v.float().numpy())
    return np.concatenate(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--n", type=int, default=192)
    ap.add_argument("--sweeps", action="store_true", help="K and guidance sweeps")
    ap.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    os.makedirs("results", exist_ok=True)

    probe = Probe()
    probe.load_state_dict(torch.load("runs/probe.pt"))
    probe.eval()

    cases = {"id": build_cases("train", a.n, 2024), "ood": build_cases("ood", a.n, 2025)}
    base = {}
    for split, case in cases.items():
        fl = read_metrics(probe, case["wrong"], case)
        floor = {k: v.mean() for k, v in fl[0].items()}
        base[split] = floor
        videos = {"real": case["real"], "wrong": case["wrong"], "copy": case["refs"][:, 0]}
        res = {name: summarise(*read_metrics(probe, v, case), case, floor) for name, v in videos.items()}
        # "snap" baseline: a model that never leaves the training range of gravity
        snap = np.clip(case["ctx"].gravity, 0, 0.35)
        res["snap_gravity_err"] = float(np.abs(snap - case["ctx"].gravity).mean())
        json.dump(res, open(f"results/baselines_{split}.json", "w"), indent=1)
        print(split, json.dumps(res, default=lambda x: round(x, 3)))

    for run in a.runs:
        model, args = load_model(run)
        res = {}
        for split, case in cases.items():
            text = case["text"]
            if args["leaky"]:   # an honest caption from the reference world
                text = make_text(case["content"], case["giant"], case["ctx"])
            gen = generate(model, case, 3, text)
            res[split] = summarise(*read_metrics(probe, gen, case), case, base[split])
            save_grid(f"results/{run}_{split}.png", case, gen)
            if args["leaky"]:   # caption names a *different* world's gravity and shape
                conf = make_text(case["content"], case["giant"], case["other"])
                g2 = generate(model, case, 3, conf)
                d = probe.read(torch.from_numpy(g2))
                res[split + "_conflict"] = {
                    "shape_follows_reference": float((d["shape"] == case["ctx"].shape).mean()),
                    "shape_follows_text": float((d["shape"] == case["other"].shape).mean()),
                    "gravity_err_vs_reference": float(np.abs(d["gravity"] - case["ctx"].gravity).mean()),
                    "gravity_err_vs_text": float(np.abs(d["gravity"] - case["other"].gravity).mean()),
                }
            print(run, split, json.dumps({k: round(v, 3) for k, v in res[split].items()}), flush=True)

        if a.sweeps:
            case = cases["id"]
            res["k_sweep"] = {}
            for k in (1, 2, 3, 5, 8):
                gen = generate(model, case, k)
                res["k_sweep"][k] = summarise(*read_metrics(probe, gen, case, k_used=k), case, base["id"])
                print(run, "K", k, round(res["k_sweep"][k]["context_score"], 3), flush=True)
            res["guidance"] = {}
            for s in (1.0, 2.0, 3.5):
                gen = generate(model, case, 3, text_scale=s)
                res["guidance"][s] = summarise(*read_metrics(probe, gen, case), case, base["id"])
                print(run, "cfg", s, round(res["guidance"][s]["instr_acc"], 3),
                      round(res["guidance"][s]["context_score"], 3), flush=True)
        json.dump(res, open(f"results/{run}.json", "w"), indent=1)


if __name__ == "__main__":
    main()
