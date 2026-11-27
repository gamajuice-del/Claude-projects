# CFVG experiments: synthetic worlds, CPU scale

This directory tests the core claims of [the CFVG design](../README.md) on a small, fully controlled
problem. Everything here was trained on a 4-core CPU with no GPU. The numbers come from
[`results/summary.md`](results/summary.md), which `report.py` regenerates from `results/*.json`.

## Setup

**Worlds.** `engine.py` renders 8-frame, 16×16 clips of one object moving through a world. A *world*
(the context) fixes 11 attributes:

| appearance | behaviour | recording |
|---|---|---|
| background colour, object colour, shape (3), size | gravity, wind | animation on 1s/2s/3s ("hold"), frame blending ("ghost"), sensor noise |

The *events*, meaning start position and velocity, are drawn independently for every clip. The caption
describes only the events as binned tokens, plus an optional `gigantic` override that scales the object ×2.2.

**Training groups.** Each training example is up to 3 reference clips plus a target clip, all from one
world, with independently drawn events. The target's caption never matches the references' events, so
copying a reference never lowers the loss. The `paired` baseline instead uses the conventional setup,
where the target *is* reference 0.

**Model** (`model.py`, 3.1M parameters). A set-invariant context encoder turns each reference clip
into tokens. A Perceiver resampler compresses them to 16 context tokens (the "bottleneck"; `cfvg_direct`
skips it). A 5-block DiT generator, conditioned on those tokens and on the caption, is trained with
rectified flow using x-prediction. An optional group-contrastive loss ties the encoding of the
references to the encoding of the held-out target clip, with "sibling" worlds as hard negatives. Sibling
worlds share background and noise but differ in object, physics and animation.

**Measurement** (`probe.py`, `evaluate.py`). A 3-D CNN probe is trained once on ground-truth clips to
read all 11 attributes plus the events, and then frozen; it plays the role FVD's network plays.
For every test case the generator gets 3 references and a caption that differs from them in at least 2
event bins:

- **context score.** Mean per-attribute error between the generated clip and the true world,
  normalised so that **1.0 = a random wrong world**. Real footage from the right world scores
  **0.24** (the probe's own error), which is the best achievable score.
- **instruction accuracy.** The fraction of caption bins the generated events land in (real footage: 0.88).
- **copy rate.** How often the generated events sit closer to a reference clip than to the caption.
- **giant ratio.** Object size with `gigantic` relative to without it. The target is 2.2.

Two test splits:

- **unseen worlds.** New worlds drawn from the training distribution.
- **OOD.** Gravity stronger than any training world (0.19–0.25, while training stops at 0.175), and
  object hues from a band never used in training.

## Runs

| run | what changes | steps |
|---|---|---|
| `cfvg` | main model | 4k |
| `cfvg_long` | main model, continued | 12k |
| `cfvg_nocontrast` | no group-contrastive loss | 4k |
| `paired` | replication training: target = reference 0 | 4k |
| `cfvg_direct` | no bottleneck: the generator attends to every reference token | 4k |
| `pool30`, `pool300` | only 30 / 300 distinct worlds in training (the default is a fresh world every sample) | 4k |
| `leaky` | captions also name gravity and shape | 4k |

Each run uses one seed. Treat differences of a few hundredths in context score as noise.

## Findings

### 1. Training on groups is what makes the reference usable, and it is what makes overrides work

| unseen worlds | context score | size error | giant ratio | instruction acc |
|---|---|---|---|---|
| `cfvg` (independent targets) | 0.93 | 0.40 | **2.4×** | 0.57 |
| `paired` (target = reference) | **1.05** (= wrong world) | 0.88 | **0.75×** | 0.59 |

Both models follow the caption equally well. The replication-trained model, however, learned that the
reference already contains the answer. When the caption asks for something the reference does not show
(`gigantic`), it ignores the caption and loses the world as well. This is the failure mode the design
predicts for paired training, and it holds on the OOD split too (1.01 vs 0.90).

### 2. Appearance and recording transfer; behaviour does not yet

At 12k steps the generated clips have nearly the right colours (error 0.035, against 0.024 real and
0.32 wrong world) and nearly the right sensor noise (0.012 vs 0.004 real, 0.043 wrong). They are
partway there on size (0.23 vs 0.08 real, 0.56 wrong).

Gravity, wind, shape, animation hold and frame blending all stay at the wrong-world level in **every**
run. The encoder does capture them: the contrastive head separates sibling worlds, which differ only in
object, physics and animation, about 100% of the time. The generator's objects, though, are still soft
and smeared (see `results/cfvg_long_id.png`, where the fourth row of each block is generated). That
puts shape and frame timing below what the probe can read; it reads them almost perfectly on real
footage (shape accuracy 0.93, hold accuracy 0.996).

**The design doc's "physics recovery" test (§10) is therefore not yet passed.** At this scale the
bottleneck is rendering quality, not the training signal. That is consistent with finding 3.

### 3. Training longer is the biggest lever, and it has not converged

| steps | context score (unseen) | context score (OOD) | instruction acc | copy rate |
|---|---|---|---|---|
| 1.5k | 0.96 | 0.93 | 0.41 | 0.40 |
| 4k | 0.93 | 0.90 | 0.57 | 0.21 |
| 12k | **0.79** | **0.76** | **0.71** | **0.11** |

Going from 4k to 12k steps closed 28% of the gap between the wrong world and real footage. Every metric
improved together: fidelity to the reference went up while copying went down. Fidelity and
originality did not trade off.

### 4. No extrapolation in physics; interpolation in appearance is fine

On the OOD split, the unseen colour band transfers as well as in-distribution colours (error 0.033).
Gravity stronger than anything in training does not:

- Every model's gravity error (0.13–0.14) matches the wrong-world level (0.12).
- Every model under-shoots by about 0.13 on average.
- An oracle that knows the true gravity but clips it to the training range would score 0.045.

The models fall back to typical training gravity instead of reading it from the references. Zero-shot
generalisation to unseen *regions* of world space, as opposed to unseen worlds within the training
distribution, remains open.

### 5. World diversity matters up to a point

| distinct worlds in training | context score (unseen) | context score (OOD) |
|---|---|---|
| 30 | 1.00 | 0.98 |
| 300 | 0.91 | 0.87 |
| unlimited | 0.93 | 0.90 |

With 30 worlds the model memorises them and transfers nothing to new worlds; colour and size errors
roughly double. Instruction following is unaffected (0.59). At this model size and training budget,
the gain saturates somewhere between 30 and 300 worlds.

### 6. The anti-copying machinery is mostly unnecessary when the objective already forbids copying

- **Bottleneck.** Removing it (`cfvg_direct`) did *not* increase copying (0.19 vs 0.21), and it scored
  slightly better on context (0.90 vs 0.93). It took about 1.3× as long to train (81 vs 63 minutes).
- **Group-contrastive loss.** Removing it (`cfvg_nocontrast`) changed nothing measurable (0.94 vs 0.93).

The independent-target objective does the work. The design doc's bottleneck and contrastive
pretraining (§3.2, §4.3) may matter for real footage, where copying is easier and the reference carries
far more detail. They are not needed here.

### 7. Inference-time knobs

**Number of references** (main model; trained with 1–3 references).

| K | 1 | 2 | 3 | 5 | 8 |
|---|---|---|---|---|---|
| context score, 4k steps | 0.93 | 0.93 | 0.93 | 0.93 | 0.93 |
| copy rate, 4k steps | 0.08 | 0.17 | 0.21 | 0.31 | 0.37 |
| context score, 12k steps | 0.80 | 0.79 | 0.79 | 0.79 | 0.79 |
| copy rate, 12k steps | 0.06 | 0.09 | 0.11 | 0.15 | 0.19 |

More references do not improve fidelity. They only give the model more events to drift toward.
Longer training halves this effect.

**Text guidance (CFG).** At 4k steps, guidance traded context for instruction following: scale 3.5
gave instruction accuracy 0.68 but context score 1.02. At 12k steps the trade disappears. Scale 3.5
gives instruction accuracy **0.85** (real footage: 0.88) with context score 0.78 and copy rate 0.05.

### 8. Leaky captions: inconclusive

With captions that also name gravity and shape, the overall metrics did not change (context score
0.92). The conflict test gave the references gravity and shape that disagree with the caption, then
checked which one the output follows. Shape followed each one 33% of the time, which is chance for 3
shapes. Gravity followed whichever value lay inside the training range. Because no model renders shape or gravity legibly
(finding 2), this test cannot yet say whether the reference or the text wins.

## What this means for the proposal

Supported:

- Training on independently recorded groups is necessary. Replication training learns to lean on the
  reference and breaks text overrides.
- Fidelity and originality improve together, rather than trading off, as training proceeds.
- Text overrides (`gigantic`) work on top of an inferred world, including OOD.
- Zero-shot transfer requires many distinct training worlds.

Not yet supported:

- Recovering *behaviour* (physics, animation timing) from references. This is blocked by rendering
  quality at this scale.
- Extrapolating to worlds outside the training range.

Not needed at this scale:

- The context bottleneck and the contrastive encoder loss.

## Next experiments

1. **Scale compute first.** The learning curve is still dropping steeply. A GPU run of `cfvg_direct`
   at 50k+ steps, wider and deeper, at 32×32 or larger, would show whether behaviour transfer appears
   once objects render sharply.
2. **Seeds.** Rerun the core comparisons (`cfvg`, `paired`, `cfvg_direct`, `pool300`) with 3 seeds each
   to put error bars on the small differences.
3. **Extrapolation.** Train with a gravity gap rather than a cut-off, to separate interpolation from
   extrapolation, and test whether conditioning on more varied references widens the range.
4. **Rerun the conflict test** once shape and hold are legible in generated clips.

## Reproducing

```bash
pip install torch numpy pillow matplotlib
python3 probe.py                      # or reuse the committed runs/probe.pt
mkdir -p logs; ./run_all.sh > logs/queue.log &   # all training runs, ~10 h on 4 CPU cores
./eval_watcher.sh                     # evaluates each run as the queue finishes it
python3 report.py                     # results/summary.md + charts
```

`train.py` resumes from `runs/NAME/ckpt.pt` if a run is interrupted. Checkpoints and live logs are
git-ignored; finished training curves are kept in `results/logs/`. The 1.5k-step point of the
learning curve (`cfvg_at1500`) was evaluated from an intermediate checkpoint of `cfvg` saved by hand.
