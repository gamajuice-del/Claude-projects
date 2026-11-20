# Results from the prototype (CPU, first runs)

**Bottom line.** The engine is correct and fast enough to support real evolution on a
laptop-class CPU. In ~400 generations it reliably produced *progressive* adaptation and
*stateful, increasingly integrated controllers*. Universes whose physics unfolded built
larger, more integrated brains and signalled more than static ones, in 3 of 3 paired seeds.
It did **not** yet produce perception-guided foraging, working memory for world content,
reversal learning, symbol learning, or used communication. Two of the proposed mechanisms
failed their own checks as configured: the stagnation-triggered unfolding ladder was used
up within ~60k steps, and invasion-fitness screening did not replicate. Every claim below
says how many seeds it rests on.

All numbers come from files in this directory (`figures/results_summary.json`,
`replicates.json`, `ecology_lesion.json`, `iff_validation.json`, `stage2_addendum.json`,
`benchmark_cpu.jsonl`) and can be regenerated with the scripts in `scripts/`.

---

## 1. Engine correctness and throughput

| Check | Result |
|---|---|
| Energy conservation (ledger vs stores, all physics unfolded) | relative error < 2×10⁻⁴ (test bound); ~3×10⁻⁵ observed over 4,000 steps; ~6×10⁻⁵ over 200k steps (float32 rounding) |
| Physics unfolding is conservative | bit-identical actions and logits on the step after 1–4 unfoldings (`test_unfolding_is_conservative`) |
| Clone determinism | clones step identically (`test_clone_is_deterministic`) |
| Invasion-screen pairing | with mutation off, every paired estimate is exactly 0 (`test_invasion_screen_pairing_is_exact`) |
| Test suite | 17 tests pass (incl. cross-island migration and bandit allocation) |

**Throughput** (`benchmark_cpu.jsonl`; one core of a 2.1 GHz Xeon, single-threaded BLAS):

| World | Mean population | Steps/s | Agent-steps/s |
|---|---|---|---|
| 64×64 | 547 | 119 | 6.5×10⁴ |
| 96×96 | 1,092 | 68 | 7.4×10⁴ |
| 128×128 | 2,179 | 30 | 6.6×10⁴ |

A 200k-step run (~400 generations, ~1.2×10⁸ agent-steps) took ~25 minutes on one core.
The GPU path has not been run (no GPU was available).

## 2. The main experiment: unfolding vs static physics

Design: runs **A** (stagnation-triggered unfolding), **B** (static physics) and **C**
(unfolding + invasion screening) share seed 1. A and B are bit-identical until A's first
unfolding at t = 21,900. 200k steps each, 96×96 world. Two more A/B pairs (seeds 2 and 3,
100k steps) replicate the comparison. Figures: `figures/trajectories.png`,
`figures/cognition_over_time.png`.

### 2.1 Evolution is progressive, not drift (3 runs)

Head-to-head competition of final vs early (t = 35k) genomes, 200 of each in a fresh world
with no immigration, 1,500 steps: final genomes left **684 vs 0** (A), **753 vs 0** (B) and
**697 vs 0** (C) descendants. Selection rate ≈ 4.8 per 1,000 steps in all three.

### 2.2 Unfolding universes evolve bigger, more stateful, more integrated, more vocal brains (3 seed pairs)

Measured on the living final populations (`replicates.json`). The "reflex lesion" clone
replaces recurrent state with a pure reflex (h, F reset each step, α = 1) and runs with the
same random numbers. An intake ratio of 1.0 means the faculty is not used.

| | Unfolding (seeds 1 / 2 / 3) | Static (seeds 1 / 2 / 3) | Same direction in pairs |
|---|---|---|---|
| Mean neurons per brain | 11.8 / 13.1 / 12.1 | 9.0 / 7.5 / 6.1 | 3 / 3 |
| Intake after reflex lesion | **0.32** / 0.68 / 0.55 | 0.95 / 1.05 / 0.68 | 3 / 3 |
| Intake after blinding | 0.99 / 0.99 / 0.98 | 1.00 / 1.02 / 0.98 | — (no effect in either) |
| Multi-information of neural dynamics (nats) | 16.6 / 10.5 / 15.0 | 2.7 / 4.1 / 10.6 | 3 / 3 |
| … per neuron | 1.74 / 1.13 / 2.21 | 0.52 / 0.55 / 1.78 | 3 / 3 |
| Signal information about sender context (bits above permutation null) | 0.044 / 0.144 / 0.022 | 0.014 / 0.016 / 0.006 | 3 / 3 |
| Fraction of organisms vocalising | 0.88 / 0.89 / 1.00 | 0.19 / 0.18 / 0.66 | 3 / 3 |

With three pairs, the smallest attainable two-sided permutation p is 0.10, and every 3/3
comparison reaches it. **Suggestive, not established.** The trajectory in run A is the
clearest evidence (common-garden reflex-lesion ratio over evolutionary time):

| t (steps) | 5k | 35k | 70k | 105k | 135k | 165k | 200k |
|---|---|---|---|---|---|---|---|
| A (unfolding) | 0.89 | 0.96 | 0.42 | 0.42 | 0.39 | 0.31 | 0.28 |
| B (static) | 0.89 | 0.95 | 0.94 | 0.94 | 0.92 | 0.95 | 0.97 |
| C (unfold + IFS) | 0.91 | 0.79 | 0.60 | 0.54 | 0.55 | 0.63 | 0.70 |

**Interpretation and confounds.** The drop in A coincides with the late rungs of the ladder,
which ends with "deep night" (no vision at night, about a third of the time). Partial
observability raises the value of internal state, as Proposition 1 predicts. But these
universes also gained two extra sound dimensions (81 possible symbols instead of 9, more
capacity for signal information), more food species and building. These runs cannot say
*which* rung caused the shift. Single-rung ablation universes are the next experiment.

**What the controllers are.** Participation ratios of neural dynamics are ≈1.0–1.9: one or
two dominant modes. Hidden states encode world concepts only weakly (§4.1). Blinding never
mattered, yet removing internal state removed up to 72% of food intake. The most consistent
reading is an **internal pattern generator** (a CPG-like forager whose rhythm of
moving and eating is generated internally) rather than perception-guided foraging. This is the "stateful
before perceptual" local optimum that §13.2 of the design document anticipated.

### 2.3 Other evolutionary observations (single runs unless stated)

* **Gene-module duplication was used**: active neuron types rose from 3.4 to ~6.9 (A) and
  ~6.4 (B); in C they stayed at 2–4.
* **Evolution selected against Lamarckian inheritance**: the epigenetic-transfer gene ρ fell
  from 0.05 to 0.015 (A) and 0.024 (B).
* **Plasticity rates diverged by universe**: mean η rose to 0.023 in static B and fell to
  0.013 (A) and 0.004 (C). Forward-model learning rates fell in all runs (0.014 → 0.007–0.011).
* **Niche construction after building unfolded** (A, and similarly C): an exploratory burst
  (newborns express the new action via developmental noise), with building at 3.7% of
  actions and walls covering ~25% of cells. The population dipped ~30%. Then selective
  pruning took building to 0.3% and wall cover to ~5%. Whether the residual building is
  adaptive has not been tested.
* **Ecology**: deaths are ~93% starvation, 1–5% predation; sexual reproduction is ~0.1% of
  births (effectively asexual); herbivory deepened (meat efficiency fell).
* **Welfare monitor**: status stayed `OK` in all runs. Mean deprivation fraction was 9–10%
  (max 16%), and the mean pain signal was < 0.005.

## 3. Does the world pay for cognition? Dense vs two-tier ecology (6 seeds each)

`scripts/ecology_lesion.py`, 12k steps per run (`ecology_lesion.json`):

| | Dense meadow | Two-tier (grass + fruit sites) | Permutation p |
|---|---|---|---|
| Neurons per brain | 7.3 ± 2.2 | 10.9 ± 3.3 | 0.054 |
| Intake after blinding | 0.94 ± 0.10 | 0.94 ± 0.10 | 0.92 |
| Intake after reflex lesion | 0.71 ± 0.32 | 0.72 ± 0.24 | 0.96 |
| Generations reached | 49 ± 13 | 33 ± 6 | 0.028 |

The two-tier ecology grows larger brains, despite fewer generations. At 10⁴ steps,
lesion dependence does not differ. **Correction**: an earlier single run in the dense
ecology showed lesion ratios of 1.0 and brains shrinking to 3.7 neurons. I first read this
as confirming Propositions 1 and 3; the 6-seed replication does not support that reading.

## 4. Stage 2 instruments on the final worlds

### 4.1 Representation atlas (balanced accuracy of linear probes, held-out individuals)

| | Concepts now, from h | Now, from raw input x | 5 steps ago, from h | 5 steps ago, from current x |
|---|---|---|---|---|
| A | 0.57 | 0.87 | 0.56 | 0.81 |
| B | 0.62 | 0.88 | 0.60 | 0.82 |
| C | 0.53 | 0.87 | 0.51 | 0.79 |

Hidden state is a poor carrier of world concepts (food ahead, conspecific in view, hunger,
carrying, hurt, night). Even past concepts are better predicted from the current input,
because the world is autocorrelated, than from memory. **There is not yet a rich set of
internal referents to attach words to.** By the programme's own L0 criterion, Stage 2
should not start on these populations.

### 4.2 First lesson: word-cued foraging (100 subjects × 40 trials per condition)

| | Informative words (late accuracy) | Uninformative words | Plasticity knock-out | p (informative vs uninformative) |
|---|---|---|---|---|
| A | 0.459 (n = 122) | 0.461 | 0.448 | 0.98 |
| B | 0.496 (n = 117) | 0.534 | 0.535 | 0.56 |
| C | 0.484 (n = 124) | 0.476 | 0.438 | 0.90 |

**No symbol learning.** Only ~10% of subject-trials reach either target, so these
organisms barely engage with the task. (An earlier analysis with 49 subjects showed
+0.099 "symbol learning" for A; it did not replicate at 100 subjects.)

### 4.3 Communication

Signals carry information about the sender's context, 0.006–0.14 bits above a
permutation null in every run (null 95th percentile ≤ 0.003). Receivers ignore them: the
counterfactual policy change when heard sound is swapped between organisms is
JSD ≤ 0.005. In the language of Lowe et al. (2019), this is positive signalling without
positive listening, which is **not yet communication**.

### 4.4 Cognitive assays across evolutionary time (49 subjects per epoch)

Evolved organisms engage with test chambers 6–25× more than random genomes: they eat
visible food 2–7% of the time vs 0.3%, and make a choice in 5–14% of reversal trials vs 0.8%.
Delayed-response accuracy is at chance at every delay (e.g. A final: 0.51 / 0.46 / 0.52 at
delays 0 / 3 / 8 vs no-cue 0.51, n ≈ 170 each). Reversal-learning accuracy is at or below
chance. The "plasticity gain" (intact minus knock-out) fluctuates around the random-genome
baseline (+0.08), so it is not evidence of learning.

## 5. Accelerator and open-endedness checks

### 5.1 Invasion-fitness screening does not replicate (as configured)

Same mutants, two independent replicates, each with treatment and control sharing random
numbers (`iff_validation.json`, final world of run A, 120 mutants per horizon):

| Horizon | Replicate correlation of ŝ | Sign agreement (\|ŝ₁\| > 0.1) | Pass s > 0.1 in both |
|---|---|---|---|
| 100 | −0.02 | 0.52 | 2.5% |
| 300 | 0.02 | 0.37 | 9.2% |

The paired clones decorrelate within tens of steps, so single-mutation effects stay below
ecological noise. In run C the screen wrote 914 mutants into germlines over 66 rounds, at
13% compute overhead; 546 of 234k births carried one. That run also used an earlier,
upward-biased estimator, (M_T − M_C)/(M_C + 1), since replaced by a symmetric one.
**IFS has not been shown to accelerate anything.** Paths forward: many more replicates per
mutant; screening mutation *directions* with many probes (an evolution-strategies-style
gradient estimate); horizons spanning several generations.

### 5.2 The unfolding ladder was used up too fast, and activity still collapsed

The stagnation detector fired as soon as its refractory period allowed. All six rungs had
unfolded by t ≈ 56k (A) and 64k (C). New evolutionary activity fell to ~0 after ~50k steps
in **all** runs, with or without unfolding, and A's genetic diversity collapsed to
≈0.05 nats by 200k steps (a selective sweep). The prototype does **not** demonstrate
open-ended evolution. Needed: a stricter detector (longer windows; a neutral-shadow
baseline), a much longer ladder (ideally generated combinatorially rather than hand-listed),
and stronger diversity maintenance (larger worlds; archipelago migration).

## 6. What this means for the programme

1. The **cognitive niche window is the bottleneck, not compute.** 400 generations in
   25 CPU-minutes already show selection reshaping brains, but towards internal rhythm
   generators, because this world rewards rhythm more than perception. Ecology design
   (§3, §13 of the design document) must come before scaling.
2. **Partial observability and added physics shift evolution towards internal state** (3/3
   pairs). That's the first lever with evidence behind it. Next: single-rung ablation
   universes and larger populations on GPUs.
3. **Stage 2 must wait.** By its own L0 criterion there are no rich internal referents yet.
4. **Two mechanisms need redesign** (IFS, the unfolding trigger). Their failures were
   caught by checks built for the purpose: replicate correlation and activity statistics.
5. **Welfare load is low** at this stage, and nothing approaching the sentience-indicator
   thresholds has appeared.
