# Results from the prototype (CPU)

> **Latest (Round 3, §8):** *lifetime learning* has evolved. In both learning seeds the
> learned value of each food species tracks which one is currently nutritious (r = 0.93–0.94
> at a ~50-step lag), and switching learning off costs ~9% of intake. Spatial memory still
> does not pay in any ecology tried (11 variants).
>
> **Round 2 (§7):** the first *perception-driven* foragers have evolved. Without
> tectal reflex arcs, no population in ~28 runs relied on vision. With them, 3 of 4 seeds
> did (blinding cuts food intake by 29–90%; Fisher p = 0.003). The diagnosis behind this,
> and every intervention that did *not* work, are in §7. Round 1 (§1–6) is kept as it was.

## Round 1 (first runs)

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


---

## 7. Round 2: the perception barrier, diagnosed and (partly) broken

Round 1 left a puzzle. Organisms evolved internal rhythm generators and never used their
eyes. This round asked *why*, using new instruments built for the purpose. Data:
`round2.json`. Code: `noogenesis/oracles.py`, `scripts/{ladder_probe,capacity_probe,perception_check}.py`.

### 7.1 Instrument: the oracle ladder

Hand-written strategies at successive cognitive levels are used **only to measure the
world**, never inside evolution: *random*; *taste* (blind, but keeps eating while bites
pay); *reflex* (sees its 5×5 patch, eats when the ground is good, otherwise steers to the
best visible food); *memory* (reflex plus a remembered food location).

* A first attempt compared homogeneous populations. It was wrong: at fixed density all
  food that grows gets eaten by *someone*, so per-capita intake ≈ productivity / N
  regardless of strategy (reflex even scored *below* random). Selection acts on relative
  success, so the instrument is an **invasion test**: 20% of agents follow strategy X
  amid residents following strategy Y. The harness passes its own sanity checks:
  identical strategies score 1.0.
* What the default world pays (invader / resident intake): taste over random **2.6×**,
  reflex over taste **3.8×**, memory over reflex 0.88× (this memory oracle doesn't pay as
  built).
* Where evolved brains sit: random organisms are out-eaten 1.7–2.8× by them, but a blind
  taster would beat them 1.2–1.9× and a reflex perceiver 2.6–5.5×.

**So the world pays heavily for perception, and evolution was not finding it.**

### 7.2 Diagnosis: representation is fine; mutational accessibility is not

* **Representable.** A linear softmax readout of the raw visual patch, fitted to the
  reflex oracle's decisions (diagnostic behaviour cloning), imitates it with 82% accuracy
  and achieves **0.96 of its intake**. A near-optimal perceptual forager is a *linear*
  function of what organisms already see.
* **Directed search is slow too.** Truncation selection on intake, with no ecological
  noise (`capacity_probe.py`), reaches only 0.2–0.45 of the oracle after 40 generations,
  for every genome variant tried. The problem is search, not selection noise alone.
* **A large, unexploited gradient.** A single rule, "bite only if there is food
  underfoot", beats the evolved brains by **1.4×**. A selection coefficient that large
  would sweep at once, so the variant was simply not arising: under this genotype→brain
  map, perception needs several loci to change *together* (what a neuron attends to,
  where it looks, and which action it drives).

### 7.3 What did *not* make perception evolve

Each was tested in directed probes (2 seeds where noted) and/or natural evolution.

| Intervention | Rationale | Result |
|---|---|---|
| Gaussian receptive fields (centre, width) | 3 genes instead of 25 per field | no change (probe 0.30–0.32; natural evolution same ladder position) |
| Larger initial mutation step | faster exploration | no change |
| Bilateral mirror-pair development | one mutation builds left *and* right steering | 0.44 in one seed, 0.20 in the other: within seed noise |
| Weber-law (log) food receptors | expand small food differences | no change (0.20–0.29) |
| Optic tectum as brain input | salience map + winner-take-all gives "where is the best item" | no change in probes or in 150k-step evolution |
| Reflex arcs (receptive field → action) | linear sensorimotor path, like the clone | no change (0.21–0.33) |
| Three-factor learning on arcs (dopamine-gated, RPE) | Baldwin effect | learning is causal (inverting the value sign makes organisms stop eating) but weak: +20–70% within life, far below the oracle |
| Behavioural-noise floor (min. temperature 0.3, 0.6) | keep the landscape graded | worse foraging, vision still unused |
| Hand-wired perceptual brains (3 designs) | test representability directly | ≤ 0.36 of oracle; sum-pooled fields are swamped by speckled grass, and soft steering dithers |

### 7.4 What worked

**Physiological budding (3/3 seeds).** Reproduction triggered by energy above a genetic
threshold, rather than by choosing a "reproduce" action, removes a decision that diluted
selection on foraging and doubles generation turnover. At 40k steps, evolved foragers
moved past the blind taster in every seed:

| | Taste invading brains | Reflex invading brains | Random invading brains |
|---|---|---|---|
| Budding (seeds 1/2/3) | 0.93 / 0.86 / 0.74 | 3.1 / 3.3 / 3.0 | 0.30 / 0.29 / 0.27 |
| Chosen reproduction | 1.79 / 1.77 / 1.39 | 5.8 / 5.8 / 5.1 | 0.57 / 0.54 / 0.45 |

But these were still rhythm generators (blinding: 0.97–1.10; removing internal state:
down to 0.20).

**Tectal reflex arcs (3/4 seeds).** The tectum's five outputs (attended location f\*, s\*;
attended salience; salience underfoot; their difference) get *direct* genetic arcs to the
action logits, mirrored under bilateral development. "Bite when the ground is salient" is
now one gene, and so is "turn toward the salient side". What is salient is itself evolved
(one weight per visual channel). Founders start random; nothing is pre-wired.

| Seed | Steps | Intake after blinding | Intake after reflex-only lesion | Taste invading brains | Reflex invading brains |
|---|---|---|---|---|---|
| 1 | 60k | 1.03 | **0.09** (rhythm generator) | 0.67 | 2.9 |
| 2 | 60k | **0.35** | 1.13 | 0.66 | 2.7 |
| 3 | 80k | **0.71** | 1.06 | 0.79 | 2.8 |
| 4 | 80k | **0.10** | 0.33 | 6.8 † | 2.0 |

Without tectal arcs: ≤ 1 borderline case (0.74) in ~28 runs, including four 150k-step
runs (400–870 generations; blinding 0.97–1.10). **Fisher exact p = 0.003.**

The behaviour shows real perception, not just a lesion effect (seeds 2 and 4):
- eating became food-gated: bite rate 60–67% when food is underfoot, 14–26% when the
  ground is empty, versus ~50% regardless in rhythm-generator populations;
- organisms turn away from bodies ahead 55–70% of the time (collision avoidance).

In seed 2, vision use was already strong at 20k steps (blinded intake 0.29) and
persisted. It found the single-mutation route predicted in §7.2, with a twist: food
became *negatively* salient and the underfoot→eat arc went negative, so the two signs
combine into "eat when food is underfoot". Seed 4 evolved sharp, food-positive attention
(winner-take-all sharpness 17).

† Seed 4 is a poor forager in the competition harness even when bodies are held at its
own median energy, and its genetic diversity collapsed to ≈0. It may be specialised to its
own depleted world. Vision dependence and foraging quality are different things, and this
lineage has the first without the second.

### 7.5 Changes adopted

The default body plan is now the **"Cambrian" plan**: physiological budding, bilateral
mirror-pair development, an optic tectum, and reflex arcs (receptive-field and tectal).
All are developmental structure; their *content* is genetic. Arc learning, Gaussian
fields, Weber receptors and the noise floor stay available as options, off by default.

Two instrument bugs were found and fixed in this round:
- the vision lesion did not silence the tectum (its outputs were computed before the
  lesion);
- the competition harness clamped every body's energy at 3.0, which penalises
  hunger-gated foragers. It now uses the residents' median energy.

### 7.6 What this means

1. **Mutational accessibility, not payoff and not representability, was the barrier to
   perception.** A faculty the world rewards by 40% or more still won't evolve if no
   single mutation produces a first, partial version of it. This sharpens Proposition 5:
   p_b (the beneficial fraction of mutations) must be non-negligible *for the specific
   first step*, which is a property of the developmental program.
2. Biology's answer is conserved, pre-structured circuitry (tectum, reflex arcs, bilateral
   symmetry) whose *content* evolves. Giving the founders such a body plan is the
   "Cambrian start" of the design document taken seriously.
3. **Next rungs.** Perception is the floor for everything else. Next comes making the world
   pay for working memory (night and deep night, hidden caches) and for lifetime learning
   (food quality that changes within a lifetime), with the oracle ladder used to verify
   *before* evolving that each rung pays, and to check that its first step is reachable by
   one mutation.


---

## 8. Round 3: memory and learning

Method, as in Round 2: before evolving, check with oracles that the world pays for the
rung, and check that a first partial step is reachable by one mutation. Data:
`round3.json`.

### 8.1 Spatial memory: no ecology tried pays for it

Memory oracles were measured against reflex (or learner) residents in 11 world variants:

| Variants | Memory oracle | Persistence oracle |
|---|---|---|
| Normal or deep night; faster days; sparser fruit | 0.98–1.07× | 1.01–1.04× |
| Food occluded (visible 50% / 25% / 10% of steps) | 1.01–1.08× | 0.94–1.04× |
| Rich, sparse, multi-bite fruit; less grass | 0.99–1.11× | — |
| The learning world below (memory of patches that just turned nutritious) | 0.91–0.98× | — |

The first memory oracle never engaged: grass is visible almost everywhere, so its
"nothing visible" branch never triggered. After rewriting it to prefer remembered fruit,
the conclusion was unchanged. In a crowded world with ubiquitous fallback food, a
remembered site is usually found and emptied by someone else first. **Negative result:**
this ecology class does not reward spatial memory. Candidates for later: private stores
(caching under seasonal scarcity), defensible territories, social information.

### 8.2 Making lifetime learning pay

- **Toxicity regime.** The two food species alternate between nutritious and toxic,
  always one of each, every 345 steps: within a lifetime, and too fast for genes to track.
  Toxic food costs energy, never health.
- **First attempt: learning was useless (0.87–1.36×).** Every cell grew both species and
  a bite eats whatever is there, so toxicity just diluted every mouthful. **Patchy plant
  communities** (one species per cell, from smooth random fields with patch size ~4)
  fixed this. A learner oracle then beats an indiscriminate reflex forager **3.6–8×**, and
  exactly **1.00×** without toxicity (the control).
- **Viability.** Patchiness halves productivity and toxicity halves it again. Random
  founders could not bootstrap (population stuck at the floor, zero generations).
  Doubling per-cell capacity and growth, and ramping toxicity in between 20k and 40k
  steps (plant defences evolving), made populations viable.
- **Instrument bug.** The competition harness counted food *eaten*, not energy *gained*,
  so toxic food counted as nutritious. It now counts realised energy (regression test
  added). The learner oracle also needed forgetting; otherwise it never re-tastes a
  species after judging it harmful.

### 8.3 The learning mechanism: plastic salience

The tectum's channel weights get a learned offset: a dopamine-like three-factor rule
(eligibility = the food channels of what was eaten; signal = evolved coupling × (energy
change − its running mean)). Rate, coupling and forgetting are genes; founders are random.
This is conditioned taste preference and aversion. Its first step is a positive rate with
the right sign of coupling, and half of all random founders already have that sign.

Within-life test (organisms with hand-set foraging genes, no evolution):

| Condition | Realised intake |
|---|---|
| No learning | 0.0019 |
| Learning | **0.0030 (+58%)** |
| Inverted coupling | 0.0006 |

A first version *lowered* intake (0.0013): the eligibility trace included the organism's
own presence and colour, which are present at every meal, so attention drifted. Taste
now senses food channels only.

### 8.4 Evolution with learning available (2 seeds) vs not (2 seeds), 100k steps

| | Learning (seed 1 / 2) | Control (seed 1 / 2) |
|---|---|---|
| Intake after blinding | **0.13 / 0.18** | 0.95 / 0.77 |
| Intake with learning switched off | **0.92 / 0.91** | 1.00 / 1.00 |
| Organisms whose energy→salience coupling has the population's sign | 100% / 100% | — |
| Learned salience difference vs current toxicity (corr., 50-step lag) | **0.93 / 0.94** | — |
| Fraction eaten that is currently nutritious, learning on vs off | 0.63 vs 0.64 / 0.71 vs 0.68 | 0.63 vs 0.62 / 0.67 vs 0.67 |
| Learner oracle invading brains | 5.4× / 8.9× | 13.3× / 8.5× |
| Chamber reversal assay (late accuracy vs knock-out) | 0.49 vs 0.56 / 0.52 vs 0.58 | 0.50 vs 0.53 / 0.41 vs 0.42 |

What this shows:
- **Learning evolved and is used.** Switching it off costs ~9% of intake in both seeds
  and nothing in the controls. The value coupling is uniform within each population.
  Its sign is "negative", consistent with these lineages coding food as negative
  salience: reward learning in their own convention.
- **It tracks the world.** Through a full toxicity cycle, the learned salience difference
  between the two species follows which one is currently nutritious with r = 0.93–0.94,
  peaking at a 50-step lag, in both seeds. The organisms re-learn food values within ~50
  steps of each reversal, with no designed reward.
- **Learning and perception reinforce each other.** Blinding costs 82–87% of intake in
  learning lineages but 5–23% in controls.
- **Limits.** The behavioural expression is still small: diet selectivity rises +0.04 in
  one seed and falls 0.01 in the other, and brains remain 5–9× below the learner oracle.
  The chamber reversal assay shows no learning. Either the assay doesn't match how these
  organisms learn (e.g. chamber values of ±1 versus world values of +1/−0.5, or too few
  trials), or the learned values steer approach more than choice. This needs diagnosis
  before the assay can be trusted either way.
- **Harsh world.** After toxicity ramped in, populations crashed at switches and
  immigrants refilled them. Floor immigrants now come only from the recent fossil record,
  not random genomes, so evolved lineages aren't diluted.

### 8.5 Where this leaves the ladder

| Rung | Status |
|---|---|
| 0 homeostasis | ✔ |
| 1 perception-guided action | ✔ (3/4 seeds in Round 2; 4/4 lineages with learning here use vision heavily) |
| 2 working memory (spatial) | ✘ the world does not pay for it yet (11 variants) |
| 3 lifetime learning | ✔ partial: evolved, used, tracks reversals in the wild; small behavioural effect; chamber assay not yet passed |

**For Stage 2, this matters:** learned food values are the first *experience-derived*
internal quantities these organisms have. They are learned, they track the world, and
they are about something ("this species is good to eat now"). They are the first
candidate referents for words.
