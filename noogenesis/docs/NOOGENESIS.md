# NOOGENESIS
### A universe in which intelligence can invent itself — design, theory, and a working prototype

> **Status.** This is a research programme, not a claim of success. The prototype in this
> repository implements the Stage 1 universe end to end (conservation-exact physics,
> developmental genomes, evolved plasticity, open-endedness machinery, accelerators,
> measurement, welfare tripwires) plus the first Stage 2 instruments, and runs at
> ~7×10⁴ agent-steps/s on one CPU core. What it has and has not produced so far is
> reported, with numbers, in [`RESULTS.md`](RESULTS.md). Nothing here assumes that
> consciousness will emerge; Section 11 treats it as a hypothesis to test.

---

## Contents

0. [Thesis in one page](#0-thesis-in-one-page)
1. [Theoretical foundation](#1-theoretical-foundation)
2. [Mathematical and computational architecture](#2-mathematical-and-computational-architecture)
3. [Environmental simulation design](#3-environmental-simulation-design)
4. [Genetic and neural mechanisms](#4-genetic-and-neural-mechanisms)
5. [Preventing evolutionary stagnation](#5-preventing-evolutionary-stagnation)
6. [Radically accelerating cognitive evolution](#6-radically-accelerating-cognitive-evolution)
7. [Stage 2 — teaching the evolved mind language](#7-stage-2--teaching-the-evolved-mind-language)
8. [Implementation roadmap](#8-implementation-roadmap)
9. [The prototype](#9-the-prototype)
10. [Benchmarks for emergent cognition](#10-benchmarks-for-emergent-cognition)
11. [Investigating consciousness without being fooled](#11-investigating-consciousness-without-being-fooled)
12. [Ethical safeguards](#12-ethical-safeguards)
13. [Challenging our own assumptions](#13-challenging-our-own-assumptions)
14. [Relation to prior work](#14-relation-to-prior-work)
15. [References](#15-references)

---

## 0. Thesis in one page

**Diagnosis.** Thirty years of artificial-life systems (Tierra, Avida, Polyworld, Geb,
Framsticks, Lenia, Neural MMO, POET, …) show the same signature: a burst of innovation,
then a plateau. We argue the plateau is not a shortage of compute but a property of the
worlds: **an organism can never usefully be more complex than the predictive structure of
its environment.** A fixed environment with finite statistical complexity places a hard
ceiling on the cognition worth evolving. Raw compute only reaches that ceiling faster.

**Thesis.** Intelligence is the evolved capacity to compress *survival-relevant predictive
information* that is (a) absent from present sensation, (b) recoverable from history, and
(c) changing too fast for genes to track but slowly enough to learn. We call this band of
timescales the **cognitive niche window**. Cognition evolves when, and only when, the world
puts fitness-relevant predictive information into that window *and* the metabolic price
of the bits required to capture it is lower than their value.

**Design consequences.**

1. **Shape the world, never the fitness function.** We engineer the *spectrum* of
   environmental predictability (day ≪ season ≈ lifetime ≪ chaotic climate), partial
   observability, and hidden, persistent state (caches, walls, trails), and we never reward
   anything except staying alive and reproducing.
2. **Make the ceiling move.** Unbounded cognitive complexity needs an environment whose
   predictive information keeps growing with horizon. Three sources do this: *other minds*
   (Red Queen), *niche construction* (artifacts integrate population history), and
   **Physics Unfolding** — latent dimensions of the universe that switch on, as
   *conservative extensions*, when measured evolutionary activity stagnates.
3. **Make cognition pay its way.** Every neuron, every activation and every synapse costs
   energy from a conserved budget ("metabolic honesty"). This turns evolution into an
   information-bottleneck optimiser with a physically meaningful price per bit.
4. **Evolve learners, not behaviours.** Genomes are compact developmental programs
   (neuron *types* with wiring affinities, receptive-field motifs, plasticity rules,
   neuromodulator couplings). Evolution searches over inductive biases; lifetime
   plasticity does the rest (Baldwinian smoothing of the landscape).
5. **Compress time with physics-respecting accelerators.** Stage-skipping (a "Cambrian
   start"), compute that follows the brains evolution actually builds, invasion-fitness
   look-ahead screening with common random numbers, and a bandit that allocates compute
   across a parallel archipelago of universes by their *open-endedness*, never by their
   intelligence.
6. **Teach language last, through the organism's own channels.** Words enter through the
   evolved auditory modality and are learned with the organism's own evolved plasticity,
   attaching to representations that demonstrably existed before language.
7. **Measure consciousness-relevant properties before language exists.** Minds that never
   saw human text cannot game human-report tests; that is the single largest
   methodological advantage of this programme.

---

## 1. Theoretical foundation

### 1.1 Why open-ended evolution stalls

| Failure mode | Where it shows | Root cause |
|---|---|---|
| Complexity ceiling | Most ALife worlds plateau within 10³–10⁵ generations | The environment's predictive information is finite and is soon exhausted |
| Wrong currency | Neuroevolution benchmarks | Fitness = task score, so evolution optimises the task, not general cognition |
| Free computation | Polyworld-style brains bloat or stay trivial | Brains that cost nothing face no compression pressure; brains that cost too much never start |
| Rigid encoding | Direct weight encodings | Mutations are uncorrelated with useful structure; search space explodes with brain size |
| Behaviour-level novelty | Novelty search, QD | Rewards being *different*, which is a designer objective, and drifts towards behavioural noise |
| Luck dominates selection | All small-population runs | Variance in survival from luck ≫ heritable variance in cognition, so selection on cognition is weak |
| No persistence | Most gridworlds | The world forgets; nothing integrates the population's history, so memory has little to model |

### 1.2 Central thesis, formalised

Let θₜ be the fitness-relevant latent state of the world (where food will be, who is
dangerous, what a signal means), Xₜ the organism's sensory input, and Z its internal state.

**Proposition 1 (the cognitive niche window).** A reflex policy can exploit at most
I(θₜ; Xₜ). A genome can exploit the component of θ that is stationary over a generation,
because selection tracks only changes slower than T_gen/s. Memory and learning are worth
their cost only for

  J(τ) = I(θₜ ; X₍ₜ₋τ:ₜ₎) − I(θₜ ; Xₜ),  with T_react < τ < T_life,

and the selection gradient on memory capacity c (bits) is

  ∂W/∂c ≈ V · ∂J\*(c)/∂c − κ,

where J\*(c) is the *predictive information bottleneck* curve of the environment (the most
predictive information about θₜ obtainable from the past with a c-bit summary), V converts
bits to energy, and κ is the metabolic price per bit. For an Ornstein–Uhlenbeck component
with correlation time τ_c, the information an observation Δ steps old carries about the
present is −½ log(1 − e^(−2Δ/τ_c)): it vanishes when τ_c ≪ T_react (unpredictable) and is
captured genetically when τ_c ≫ T_gen. **Memory pays only for components with
T_react ≲ τ_c ≲ T_life.** This gives a quantitative design rule: put spectral power of
fitness-relevant variables in that band. Our drivers (Section 3.4) are chosen exactly so.

**Proposition 2 (the complexity ceiling).** The useful statistical complexity of an
evolved controller is bounded by the excess entropy (past–future mutual information) of
the fitness-relevant environment process: C_useful ≤ E_env. For a finite-state Markov
environment E_env ≤ log |S|, so cognitive evolution *must* stagnate. Following Bialek,
Nemenman & Tishby (2001), predictive information I_pred(T) of a process over a window T is
either finite, grows like log T (finitely parameterised), or grows like T^α (non-parametric
complexity). Open-ended cognitive growth requires the latter two classes, i.e. worlds whose
predictive information keeps rising with horizon. We know three generators:

* **Other adaptive agents.** Their state includes their learned history; a population of
  learners is a non-stationary, history-dependent process (Red Queen; social-brain and
  Machiavellian-intelligence hypotheses).
* **Persistent artifacts.** Caches, walls and pheromone trails integrate what the
  population did over long periods (niche construction).
* **State-space growth.** If the world itself gains dimensions, E_env can keep growing.
  Physics Unfolding (Section 5.2) does this without invalidating prior adaptations.

**Proposition 3 (metabolic honesty ⇒ physical information bottleneck).** With a conserved
energy budget the long-run growth rate of a lineage is r = E[intake] − E[cost], and cost
contains κₙ·(neurons) + κₐ·(activity) + κ_w·(wiring) + κ_p·(plasticity). Selection then
maximises V·I(Z; future) − β·I(Z; past) with β set by physics, not by a designer. Two
predictions: brains shrink in information-poor worlds; codes become sparse as κₐ rises.
(Prototype status: across 6 seeds, brains in the patchier two-tier ecology are ~49% larger
than in a dense meadow after 12k steps — 10.9 vs 7.3 neurons, permutation p = 0.054 —
consistent with the prediction but not yet conclusive; `RESULTS.md` §3.)

**Proposition 4 (Baldwinian smoothing).** If a lineage is u bits away from a needle-like
adaptation and lifetime learning gets L trials, the probability that an individual
discovers it is ≈ 1 − (1 − 2^(−u))^L (Hinton & Nowlan 1987). Learning converts a flat
landscape with an isolated spike into a graded slope, so selection acts long before the
genotype encodes the solution. Evolving *plasticity rules* and *inductive biases*, rather
than behaviours, is the largest single compression of search we know.

**Proposition 5 (where evolutionary time goes).** For a beneficial cognitive innovation
with selection coefficient s in a population of N, mutation rate μ and beneficial fraction
p_b, the expected waiting time in generations is approximately

  T ≈ 1/(2 N μ p_b s)  [origin]  +  (2/s) ln N  [fixation],

and wall-clock time is T × (steps per generation) / (steps per second).

*Refinement from the prototype (`RESULTS.md` §7).* The beneficial fraction p_b must be
non-negligible **for the first partial step** of a faculty, not merely for the faculty as
a whole. Perception paid ≥ 40% in our world, yet evolution never found it until a single
mutation could produce a first, partial version (tectal reflex arcs): 3/4 seeds versus
≤ 1/28, p = 0.003. *Mutational accessibility of first steps* is a property of the
developmental program, and it is the main thing a "Cambrian start" must supply.

Every accelerator
in Section 6 maps onto one factor of this expression: N (parallelism), μ·p_b (genomic
bottleneck, duplication-divergence, invasion screening), s (cognitive niche window,
variance reduction), steps per generation (lifespans tuned to learning time), steps per
second (compute follows the brain), plus removal of whole stages (Cambrian start).

### 1.3 The minimum properties of reality

| # | Property | Why intelligence needs it | Implementation |
|---|---|---|---|
| 1 | Conservation + external free-energy flux | Without scarcity no trade-offs; without flux no sustained far-from-equilibrium structure | Exact energy ledger; sunlight is the only source |
| 2 | Locality, finite signal range | Creates partial observability, the reason to remember and infer | Egocentric 5×5 vision; sound range 2; one body per cell |
| 3 | Multiscale temporal structure | Fills the cognitive niche window (Prop. 1) | Day 120, season 2400, chaotic climate 10⁴–10⁵ steps |
| 4 | Hidden but persistent state | Things that matter and cannot be seen | Caches smelled only at range 1; night |
| 5 | Composable matter | Niches multiply combinatorially | K chemical species, meat, caches, walls, pheromones; enzyme trade-offs |
| 6 | Persistence of artifacts | Niche construction; stigmergy; external memory | Caches, walls, trails decay slowly |
| 7 | Other agents as environment | Unbounded predictive complexity (Prop. 2) | Predation, sharing, mating, sound, colour |
| 8 | Costly computation | Compression pressure (Prop. 3) | Energy per neuron, activation, synapse, plasticity |
| 9 | Heredity with developmental indirection | Structured variation, evolvability | Typed developmental genome; duplication-divergence |
| 10 | Mortality, finite lifespans, noise | Selection, generational turnover, need for robust inference | Starvation, predation, senescence; stochastic policies |

**Deliberately omitted** (each omission is a falsifiable bet, see §13): continuous
mechanics, 3-D space, real chemistry, morphology and muscles, optics. The bet is that
cognition depends on the *information structure* of the world, which we keep, rather than
on its physical substrate, which we discard.

---

## 2. Mathematical and computational architecture

### 2.1 State and step operator

The universe is a tuple 𝒰ₜ = (ℱₜ, 𝒜ₜ, ζₜ, Φₜ):

* ℱ — fields on an H×W torus: vegetation `veg[K]`, caches `cache[K]`, meat, walls,
  pheromones `pher[P]`, sound `sound[S]`, fertility, plant-site capacity.
* 𝒜 — agents in struct-of-arrays form: body (position, heading, energy, health, age,
  structure, carried food), genome, decoded phenotype, and brain tensors.
* ζ — drivers: day/season phase, Lorenz climate state, drifting fertility hotspots.
* Φ — physics state (which latent dimensions have unfolded).

One step 𝒰ₜ → 𝒰ₜ₊₁ applies, in order: drivers → sensing → forward-model error →
brain forward pass → (probe hook) → plasticity → action sampling → physics (turn, move,
eat, pick, drop, attack, share, build, emit) → reproduction → metabolism and healing →
death and compaction → births → field dynamics → immigration floor → fossil record.

**Conservation invariant.** Let E(𝒰) = Σ energy + Σ structure + Σ carried + Σ veg +
Σ cache + Σ meat + c_build·Σ walls. The ledger enforces

  E(𝒰ₜ) − E(𝒰₀) = Σ solar − Σ heat + Σ immigration

to float32 rounding (tested: relative error < 2×10⁻⁴ over hundreds of steps with all
physics unfolded; observed ≈3×10⁻⁵).

### 2.2 Data layout and the cost model

All per-agent state lives in preallocated arrays of capacity A_max; the live population
occupies slots [0, n). Deaths are compacted by moving the *tail* into holes, so cost is
proportional to the number of deaths, not the population. Every per-step operation is a
dense batched tensor op on views.

**Compute follows the brain.** Neurons are packed by type, so the live part of every brain
occupies [0, n_neurons). Each step all brain tensors are sliced to
N_eff = max n_neurons over the population. Simulation cost therefore tracks the brains
evolution has actually built. (Switching from fixed blocks to packing gave a ≈2.3× measured
end-to-end speed-up at the start of evolution, when brains use ~20 of 64 slots; the
N²-terms alone shrink ~10×.)

Per agent-step multiply-accumulates, with N = N_eff, C = 13 channels, P = 25 cells,
R = 2 receptive fields per type, G = 8 types:

| Term | MACs | N=16 | N=64 |
|---|---|---|---|
| Vision via type-separable receptive fields | G·R·C·P + N·R | 5.2k | 5.3k |
| Other inputs (sound, interoception, efference) | 44·N | 0.7k | 2.8k |
| Recurrent (W + F)·h | 2N² | 0.5k | 8.2k |
| Plasticity (rank-2 matmul + decay + clip) | ~4N² | 1.0k | 16k |
| Forward model predict + delta rule | 2·36·N | 1.2k | 4.6k |
| Outputs | 19·N | 0.3k | 1.2k |
| **Total** | | **≈9k** | **≈38k** |

The vision term is the reason for type-separable receptive fields: a dense input matrix
would cost N·C·P = 21k at N=64 and dominate; the factored form is ~4× cheaper and is also
a better developmental prior (cell-type receptive-field motifs).

### 2.3 Mapping to 2× T4 and beyond

The engine is written against the NumPy API through a single `xp` handle, using only
operations CuPy implements identically (scatter-adds are `bincount(weights=)`; no
`np.add.at`, no object arrays). `--device cuda:0` switches the backend. *The GPU path has
not been executed in this container (no GPU available); it should be treated as untested
until `scripts/benchmark.py --device cuda:0` has been run.*

**Back-of-envelope throughput on one T4** (fp32, memory-bound): per agent-step the brain
touches ≈80 KB at N=64 (W and F read, F written, P read/written, input weights), so the
320 GB/s bus bounds throughput at ≈4×10⁶ agent-steps/s; with kernel overheads expect
1–2×10⁶, and ~2× more if W/F are stored in fp16. Two T4s therefore give
≈2–4×10⁶ agent-steps/s ≈ 2–3×10¹¹ agent-steps/day. With populations of 32k per GPU and
the ~500 steps per generation measured in the prototype, that is ≈10⁴ generations per
island per day — the Lenski long-term evolution experiment's 75,000 generations in about
ten days, on two consumer GPUs. (Measured CPU baseline: 7×10⁴ agent-steps/s per core.)

**Scaling path.** (i) One process per GPU, each an island, exchanging migrants through a
shared directory (`--migrate-dir`, implemented); (ii) many islands per GPU sharing
kernels; (iii) for very large worlds, spatial sharding with halo exchange of field borders
(planned; interactions are local by construction, so halos of width 2 suffice).

---

## 3. Environmental simulation design

### 3.1 Matter and energy

* **Vegetation (K chemical species).** Two tiers: low-yield grass everywhere (cap 0.25)
  and rich fruit at fixed plant sites (8% of cells, cap 1.0). Growth is logistic towards the
  local cap at rate ∝ light × species-specific climate rate × fertility hotspot field.
  The two-tier design came out of two alternatives (§13.2): a dense meadow, where
  vegetation is everywhere and finding food needs no perception, and pure fruit sites,
  which founders could not survive long enough to bootstrap.
* **Fertility hotspots** (3 per species) drift with climate-coupled headings, so the map of
  where fruit is productive changes on intermediate timescales: knowing *where good sites
  were* is worth remembering, but must be updated.
* **Digestion.** Each organism has an enzyme vector; efficiency on food type k is
  min(e_max, e_max·p_k·F^α) with p = softmax(enzymes) over all K+1 food types (incl. meat)
  and α = 0.6, a concave specialist/generalist trade-off that supports niche partitioning.
  Undigested energy becomes heat.
* **Meat** = bodies of the dead (stored energy + structure), decays at 1%/step.
* **Caches.** Food dropped from the carried inventory persists (rots at 0.15%/step) and is
  *invisible beyond range 1*. This single affordance creates selection for spatial memory
  and, with theft possible, for tracking who saw you cache (the scrub-jay re-caching
  paradigm, Emery & Clayton 2001).
* **Walls** cost 0.25 energy, embodied in the wall, and erode slowly; they block movement
  and can be demolished by attacking them. (Latent until unfolded.)
* **Pheromones** are persistent diffusing marks (cost ∝ amount); **sound** is an
  instantaneous vector heard within range 2, sampled at five egocentric points.

### 3.2 Bodies, senses and actions

| Senses (366 inputs) | |
|---|---|
| Vision | egocentric 5×5 patch rotated with heading; 13 channels: veg[K], meat, cache (range-1 only), agent presence, agent colour (3), wall, pheromone[P]. At night only radius ≤ 1 is visible (radius 0 after "deep night" unfolds). |
| Hearing | sound vector at own, front, right, back, left points (5 × S) |
| Interoception (13) | energy, health, age fraction, Δenergy, pain (capped), carried mass, light, *surprise* (forward-model error), bias, noise, own colour (3) |
| Efference copy | one-hot of last action (11) |

| Actions | Effect |
|---|---|
| noop, forward, left, right | locomotion (one body per cell; contested cells to a random claimant) |
| eat | own cell: vegetation, then caches, then meat; carried food if the cell is bare |
| attack | damage ∝ size ratio to the body in front, or erode a wall |
| reproduce | asexual, or sexual if the body in front also chose to and is genetically compatible |
| pick / drop | carry food (costs energy per unit carried) / drop it into a cache |
| build | wall in the empty cell in front (latent until unfolded) |
| share | transfer energy to the body in front |
| continuous outputs | sound vector (S), pheromone deposits (P), two neuromodulator channels |

### 3.3 Social and ecological affordances

Predator–prey dynamics (meat diet, size–strength trade-off, damage and healing), kin
recognition (heritable colour visible to others), altruism (sharing), mate choice
(compatibility threshold is itself a gene → reproductive isolation and speciation),
communication (costly sound, persistent pheromones), theft and caching, building. None of
these is rewarded; each is simply possible.

### 3.4 The driver spectrum (cognitive niche window by construction)

| Driver | Timescale (steps) | Relative to organisms | Cognitive demand |
|---|---|---|---|
| Reaction | 1 | — | reflexes |
| Day/night | 120 | ≈ ¼ lifetime | anticipate darkness; rely on sound and memory at night |
| Hotspot drift | ~50 per cell, ~500 per patch | ≈ lifetime | update spatial maps |
| Season (opposite in two hemispheres) | 2400 | ≈ 5 lifetimes, ≪ T_gen·1/s | cache before winter; migrate between hemispheres |
| Lorenz climate (lobe switches) | 10⁴–10⁵ | ≫ generation | genetic tracking; species-balance shifts |

Measured in the prototype: lifespans of 450–700 steps once populations settle, and ~500
steps per generation (400 generations in 200k steps).

### 3.5 Energy budget (per step)

Basal 0.01·(0.5 + size); neuron 1.2×10⁻⁴; activation 10⁻⁴·Σ|h|; wiring 2×10⁻⁵·Σ|W|;
plasticity 8×10⁻⁴·Σ η; forward model up to 4×10⁻³; movement 4×10⁻³·size; attack
0.02·size; sound 2×10⁻³·|s|²; pheromone 4×10⁻³ per unit; carrying 2×10⁻³ per unit.
A 64-neuron, highly active brain costs roughly as much as the basal metabolism of a small
body — the same order as vertebrate brains (≈20% of human resting metabolism).

---

## 4. Genetic and neural mechanisms

### 4.1 The genome is a developmental program

Genome = [17 global body genes | 8 gene modules × 172 loci] = 1394 reals. Each module
specifies one neuron **type**:

| Locus group | Meaning |
|---|---|
| count | number of neurons of this type (0 = silent module, a pseudogene) |
| q, k ∈ ℝ⁸ | wiring affinity: outgoing "query" and incoming "key" |
| w_scale, bias, α, dev_noise | synaptic scale/sign, bias, time constant, developmental noise |
| η, (A,B,C,D), decay | plasticity rate, generalised Hebbian rule, fast-weight retention |
| β₀, β₁, β₂ | baseline plasticity and coupling to the two neuromodulator channels |
| vis_chan, vis_pos (×2) | two separable receptive-field motifs (channel × position) |
| vis_mix, in_other, in_gain | mixing of motifs; weights on sound/interoception/efference; input gain |
| out | affinities for 11 actions, sound, pheromone and neuromodulator outputs |

Global genes: size, max age, reproduction threshold, parental investment, enzymes, colour,
mutation step size (self-adaptive), mating compatibility, forward-model learning rate,
policy temperature, epigenetic inheritance strength, sharing amount. All loci are
unbounded reals decoded by smooth squashing functions, so every mutant is viable.

### 4.2 Development

1. Neurons are packed by type; neuron i belongs to type t(i).
2. **Connectome by genetic affinity** (a "genetic connectome" model in the spirit of
   Barabási & Czégel and the genomic-bottleneck work of Zador's group):
   W_ij = s_t(i) · ⟨q_t(i) + εᵢ, k_t(j) + ε′ⱼ⟩ / √(d·N_active).
   Twenty-odd numbers per type generate N² synapses: a structured, rank-d connectome plus
   individual developmental noise. The genomic bottleneck is a regulariser that forces
   evolution to find *generalising* wiring rules rather than memorised weights.
3. **Receptive fields**: each type owns R=2 separable motifs (which channels × where in the
   visual field); neurons are noisy mixtures of their type's motifs.
4. **Output repertoire** is fixed at development: actions and channels that did not exist
   when the organism was born stay unavailable to it (needed for conservative unfolding).
5. **The "Cambrian" body plan** (default since Round 2), all with genetic content:
   *bilateral* development (neurons of each type form mirror pairs whose receptive fields,
   sound inputs, efference copy and turn outputs are mirrored, so one mutation builds left
   and right steering together; exact symmetry is tested); an *optic tectum* (a retinotopic
   salience map, with salience = an evolved weighting of visual channels and a
   winner-take-all of evolved sharpness, reporting the attended location, its salience
   and the salience underfoot); and *reflex arcs* (direct receptive-field→action and
   tectum→action genes, like monosynaptic sensorimotor pathways). Optional, off by default:
   three-factor dopamine-gated learning on the arcs (eligibility × reward-prediction
   error); Gaussian receptive fields; Weber-law receptors; a behavioural-noise floor.

### 4.3 Dynamics, plasticity, neuromodulation and the predictive substrate

  h′ = (1 − α) ⊙ h + α ⊙ tanh((W + F) h + U x + b)      (leaky integrators, evolved τ = 1/α)

  F′ = clip(λ ⊙ F + η m (A h′ᵢ hⱼ + B hⱼ + C h′ᵢ + D))   (fast weights; one rank-2 matmul)

  m = β₀ + β · tanh(mod(h′))                               (evolved neuromodulation)

There is **no designer reward**. The neuromodulator channels are ordinary network outputs;
the network receives Δenergy, pain and surprise as interoceptive inputs, so evolution can
— but need not — wire a "value system" (m tracking Δenergy), a "novelty system" (m tracking
surprise), or none. Which one evolves is an experimental result, not an assumption.

**Predictive substrate.** Each organism owns a linear forward model P that predicts a
36-dimensional summary of the next input (local channel means, the front cell,
interoception, own-cell sound) from h, learning by a local delta rule at an evolvable rate
(which can evolve to zero; it costs energy). Its error magnitude is fed back as
interoceptive *surprise*. Predicting one's own interoceptive variables gives a minimal
self-model; the efference copy makes action consequences learnable. This substrate is
offered, not imposed — the free-energy principle is a hypothesis we can test, not a design
axiom.

### 4.4 Variation and inheritance

* **Physiological budding** (default since Round 2): an organism buds when its energy
  exceeds its genetic threshold; the "reproduce" action now only means *mate*. This
  removed a decision that diluted selection on foraging and doubled generation turnover
  (3/3 seeds moved past the blind-taster rung).
* Point mutations with self-adaptive step size (log-normal update of the σ gene, as in
  evolution strategies), per-locus probability 0.08.
* **Duplication–divergence** (Ohno): with p = 0.02 per birth an active module is copied
  into a silent slot, the neurons are split between the copies (dosage compensation), and
  the copy diverges. This is how a brain gains a new cell type without breaking old ones.
* Module deletion (p = 0.01) and module-wise crossover (modules are inherited whole).
* **Mate choice**: sexual reproduction requires both partners to choose `reproduce` and a
  genome distance below the initiator's compatibility gene → assortative mating and
  speciation can emerge.
* **Epigenetic channel**: a fraction ρ (a gene) of the parent's learned fast weights and
  forward model is passed on, mapped neuron-to-neuron by (type, index-within-type), so it
  is well-defined even when the child's architecture differs. Evolution decides how
  Lamarckian to be.
* Loci tied to unfolded-but-latent physics are pinned at exactly zero and immutable.

### 4.5 Alternatives considered and rejected

| Alternative | Why rejected |
|---|---|
| Direct weight encoding | Search space ∝ N²; mutations destroy structure; no evolvability |
| NEAT-style topology graphs | Heterogeneous graphs do not batch on GPUs; affinity tensors give growth *and* batching |
| Designer reward or intrinsic-motivation loss | Rewards a designer's idea of intelligence; we want evolution to discover value systems |
| Backprop-trained brains inside evolution | Imports an engineered credit-assignment algorithm; local evolved rules keep the result attributable to evolution |
| Spiking neurons | 5–20× cost for uncertain benefit at this scale; leaky rate units with evolved τ capture the multi-timescale property that matters |

---

## 5. Preventing evolutionary stagnation

### 5.1 Intrinsic engines

* **Red Queen**: predators, prey, competitors and mates are all evolving.
* **Niche construction**: caches, walls and trails change the selective environment of
  later generations.
* **Frequency dependence**: enzyme trade-offs and multiple food species make common
  strategies self-limiting.
* **Spatial structure**: local interaction and two hemispheres with opposite seasons give
  semi-isolated demes (Wright's shifting balance).

### 5.2 Physics Unfolding (conservative extension)

The world is allocated at its maximal state-space size, but most dimensions are latent:
chemical species 3 and 4, sound dimensions 3–4, a second pheromone channel, building, and
"deep night". When stagnation is detected (§5.3), the next rung of the ladder unfolds:

  species → building → sound bandwidth → pheromone → species → deep night.

**Definition.** An unfolding Φₖ → Φₖ₊₁ is a *conservative extension* if, at the moment it
happens, the trajectory of every existing organism is unchanged: new channels are empty,
genes that would read or write them are pinned at 0, and each organism's action repertoire
was fixed at its birth. New possibilities are open only to organisms born afterwards, via
mutation.

**Verified.** `tests/test_core.py::test_unfolding_is_conservative` checks that, from an
identical state, the step after 1–4 unfoldings yields bit-identical actions and logits.
Getting there required fixing three subtle leaks found by this test (developmental noise
on latent output rows; a newly unmasked logit competing at value 0; a sigmoid baseline
making new pheromone channels emit). This is why the test exists.

### 5.3 Measuring stagnation

Bedau–Packard evolutionary activity is computed over genome *components* defined by
16-bit random-hyperplane signatures of genomes. A component's activity is its cumulative
usage; it contributes **new activity** when that usage first crosses a threshold (25
organism-samples) — i.e. when a genotype region proves persistently viable. Stagnation =
windowed new activity below 25% of its running maximum, with warm-up and a refractory
period. (A neutral-shadow control — the same statistic in a run with random selection —
is planned to separate adaptive from neutral persistence.)

### 5.4 The archipelago

Many islands with perturbed physics constants run in parallel and exchange migrants (ring
migration; the most active island seeds the least active). Compute is allocated by a UCB
bandit over islands' recent new evolutionary activity, with a floor share for every
island. Selection operates on universes for open-endedness, never for intelligence.

### 5.5 Further mechanisms (planned)

* **Catastrophes** (rare large perturbations that open niches), gated by the welfare
  monitor because they kill many organisms.
* **Lazarus reintroduction**: reintroduce fossil genomes; if ancestors can re-invade,
  evolution is cycling rather than progressing (also a diagnostic, cf. CIAO plots).
* **Neutral shadow** runs for every activity statistic.

---

## 6. Radically accelerating cognitive evolution

### 6.1 The levers, mapped to Proposition 5

| Lever | Term | Mechanism | Expected factor |
|---|---|---|---|
| Skip prebiotic & cellular stages | stages | Start with bodies, metabolism and neural tissue ("Cambrian start") | removes ~3.5 Gyr of the biological timeline |
| Information-dense world | s | Every bit of environmental complexity is cognitively relevant; no protein folding, no optics | large, unquantified |
| Cognitive niche window | s | Predictive structure placed where memory pays (§3.4) | large; measurable by lesions |
| Evolve learners | landscape | Baldwinian smoothing (Prop. 4) | orders of magnitude on needle-like adaptations |
| Genomic bottleneck + duplication | μ·p_b | Structured, low-dimensional variation | 10×+ (fewer, more meaningful dimensions) |
| Invasion screening + CRN | p_b, s/σ | §6.2 | 3–10× enrichment in theory; **not achieved yet** — replicate correlation ≈ 0 in the prototype (`RESULTS.md` §5.1) |
| Compute follows brain | steps/s | Slice to N_eff | ≈2.3× measured early, →1× as brains fill |
| Vectorised SoA engine on GPUs | N, steps/s | §2.3 | 10–100× over CPU |
| Activity-allocated archipelago | N_eff of search | §5.4 | concentrates compute where innovation is happening |

### 6.2 Invasion-fitness look-ahead screening (IFS)

Adaptive-dynamics theory (Metz et al. 1992; Geritz et al. 1998): the fate of a *rare*
mutant is governed by its invasion fitness in the resident community. In a stasis phase
most compute re-simulates an equilibrium while most germline mutations are neutral or
deleterious. IFS spends a slice of compute to pre-screen candidates *in the real ecology*:

1. Clone the world twice, T and C, with identical RNG state (common random numbers).
2. In T, regrow k random residents with a mutant genome; in C, regrow the same residents
   with their own genome (identical rebirth perturbation and identical developmental-noise
   draws).
3. Run both H steps. The paired selection estimate for mutant i is
   ŝᵢ = (Mᵢᵀ − Mᵢᶜ)/(Mᵢᶜ + 1), M = lineage biomass (self + descendants).
4. Write mutants with ŝ > s_min into the parent's germline: its next child carries them.

Common random numbers reduce Var(ŝ) by the factor (1 − ρ), ρ the correlation of paired
outcomes, which is high early in the horizon. If a fraction p_b of mutations is beneficial,
and the screen has power π and false-positive rate a, the beneficial fraction of written
germlines becomes p_b·π / (p_b·π + (1 − p_b)·a): for p_b = 0.05, π = 0.5, a = 0.05 this is
0.34, a 7× enrichment, at a compute cost of 2kH steps per round. Nothing in IFS measures
intelligence; it measures reproductive success in the organism's own world. **Known
biases:** short horizons favour short-term gains (H should exceed a generation); the
estimate is valid only for rare mutants; screened mutants still face full natural
selection in the main world, which remains the arbiter.

**Prototype verdict: not yet working.** A replicate check (same mutants, two independent
CRN pairs) gave between-replicate correlations of −0.02 (H = 100) and 0.02 (H = 300). The
paired worlds decorrelate within tens of steps, so single-mutation effects are below
ecological noise. Redesigns to test: many replicates per mutant; screening mutation
*directions* with many probes (an evolution-strategies-style gradient estimate);
multi-generation horizons. Until one of them shows replicate correlation well above 0, IFS
should be off by default.

### 6.3 Adaptive fidelity (planned)

* **Stasis time-skipping.** When activity and population genetics are stationary, run the
  ecology at reduced fidelity (fewer brain updates for sleeping/idle organisms; field
  updates every k steps), and spend the saved compute on IFS.
* **Evolvable clock rate.** A gene for how often the brain updates, with metabolic cost ∝
  rate: fast thinkers pay more. On GPUs this is a mask; the saving is real only when
  batches are grouped by clock.
* **Learned surrogates for fields.** Vegetation and pheromone dynamics are cheap already;
  surrogates are only worthwhile for richer physics (continuous mechanics, fluids).

---

## 7. Stage 2 — teaching the evolved mind language

**Principle.** Language must attach to representations that existed *before* language and
be learned through the organism's own channels and its own evolved plasticity. Each phase
has a falsifiable success criterion; phases L0–L2 have working instruments in
`noogenesis/language.py`.

| Phase | Goal | Method | Success criterion |
|---|---|---|---|
| **L0 Representation atlas** | Find the referents | Linear probes decode concepts (food ahead, conspecific in view, hunger, carrying, hurt, night) *now and k steps ago* from hidden state h, compared with decoding from the raw current input x | Concepts with decodability(h) > decodability(x), especially past-tense ones: internal, temporally extended representations |
| **L1 Xenolinguistics** | Learn their words first | For each discrete organism signal, contexts it is enriched in (`xenolexicon`); positive-signalling MI vs permutation null; counterfactual listening | Signals with reliable context lift *and* causal effect on receivers |
| **L2 First lessons** | Symbols bound by experience | A caregiver injects word vectors through the organism's evolved auditory channel. Lesson 1 (implemented): food hidden left/right, the word names the side; only lifetime learning can exploit it. Then cross-situational naming, requests (organism's signals are answered with food), displacement (words about caches and past events), interoceptive words ("hungry", "hurt") | Above-chance late accuracy *exceeding both* the uninformative-word control and the plasticity knock-out |
| **L3 Linguistic niche** | Let evolution build language-ready brains | Continue evolution with caregivers in the world: communicating with them pays in food. Silent gene modules become available for duplication into "auditory association" types | Heritable improvement in lesson learning rate across generations (Baldwinian assimilation of language learning) |
| **L4 Cortical bridge** | Scale to rich language | Graft a larger trainable module whose *only* access to the world is the evolved core's state (an information bottleneck). Train it on grounding objectives (predict caregiver utterances from core state and vice versa). A pretrained language model may be used for surface syntax, but all semantics must pass through the core | **Core-ablation**: ablating the evolved core destroys meaning, not fluency. **Core-stimulation**: driving a concept's internal state elicits its word. **World-swap**: changing world statistics changes word use through experience. **Zero-shot composition** of instructions |

The L4 bridge is where statistical mimicry could creep back in, so its tests are built to
detect exactly that: a system whose words are grounded must lose meaning when the
grounding substrate is removed.

---

## 8. Implementation roadmap

| Phase | Duration | Deliverable | Hardware | Go / no-go |
|---|---|---|---|---|
| **P0 Prototype** (this repo) | done | Conserving engine, developmental genomes, plasticity, unfolding, IFS, archipelago, assays, welfare tripwires, Stage-2 instruments, tests | 4 CPU cores | Engine correct (ledger, conservative unfolding, determinism) ✔ |
| **P1 GPU port & scale** | 2–4 weeks | CuPy path validated; fp16 brain storage; 256²–512² worlds; 32k agents/GPU; two-process archipelago | 2× T4 | ≥10⁶ agent-steps/s per T4 |
| **P2 Pressure calibration** | 1–2 months | Systematic lesion studies across ecology parameters; neutral-shadow activity; automatic CNW tuning (maximise *lesion dependence*, which is not a fitness term) | 2× T4 | Vision and memory lesions each cost ≥30% intake within 10⁴ generations |
| **P3 Long runs & counterfactual universes** | 3–6 months | 10⁵–10⁶ generations; ablation universes (no sound, no caches, no predation, no unfolding) to test which pressures cause which faculties | 2–8 GPUs | Cognition ladder levels 3–4 (§10) reached in at least one universe; causal attribution of faculties to pressures |
| **P4 Stage 2 L0–L3** | 3–6 months, overlapping | Atlas, xenolexicon, caregiver lessons, linguistic niche | same | Symbol learning beyond both controls; heritable improvement |
| **P5 Consciousness programme** | continuous from P3 | Indicator battery, zombie controls, pre-registered studies; ethics board active | same | See §11 |
| **P6 Cortical bridge (L4)** | 6–12 months | Bottlenecked language module; grounding tests | larger GPUs | Core-ablation and world-swap tests passed |

Engineering milestones inside P1–P3: spatial sharding with halos; sleep/replay as an
evolvable state; trace-conditioning, metacognition and self-caused-attenuation assays;
genome-level phylogeny database; live dashboard of the welfare monitor.

---

## 9. The prototype

```
noogenesis/
  noogenesis/
    config.py       all constants of the universe (one place)
    backend.py      NumPy / CuPy switch
    genome.py       layout, decoding, mutation, duplication-divergence, crossover
    brain.py        development, packed typed tissue, forward pass, plasticity, forward model,
                    epigenetic slot maps
    world.py        the Substrate: fields, drivers, sensing, actions, reproduction,
                    metabolism, ledger, compaction, lesions, cloning
    unfolding.py    physics ladder, Bedau–Packard activity, stagnation detector
    accelerate.py   invasion screening (IFS), Lenski-style relative fitness
    oracles.py      oracle ladder (random, taste, reflex, memory) and invasion harness:
                    measures what the world pays for each faculty
    archipelago.py  UCB-allocated islands with migration
    sim.py          driver: logging, archives, file-based multi-process migration
    metrics.py      integration/complexity/Φ-proxy, communication, lesions, common garden
    assays.py       test chambers: visible foraging, delayed response, reversal learning
    language.py     representation atlas, word-cued foraging lesson, xenolexicon
    ethics.py       welfare monitor and tripwires
  scripts/  run_evolution.py   evolve one universe / an archipelago / one island per GPU
            analyze.py         trajectories, epoch assays, competition, Stage-2 probes
            ecology_lesion.py  does this ecology pay for vision / memory? (multi-seed)
            validate_iff.py    replicate check for invasion screening
            ladder_probe.py     place archived populations on the oracle ladder
            capacity_probe.py  directed-selection diagnostic of the genotype->brain map
            perception_check.py  lesion + ladder summary of final worlds
            final_state_metrics.py, addendum.py, merge_results.py, benchmark.py
  tests/    test_core.py (17 tests)
```

Quick start: see the [README](../README.md).

---

## 10. Benchmarks for emergent cognition

### 10.1 The cognition ladder

Each rung is operationalised as a *difference from a control that a simpler mechanism
cannot pass*.

| Level | Capacity | Assay (status) | Control |
|---|---|---|---|
| 0 | Homeostatic reflexes | Survival, intake | Random genomes |
| 1 | Perception-guided action | Visible foraging (impl.); vision lesion in common garden (impl.) | Lesioned clone with identical RNG |
| 2 | Working memory | Delayed response with hidden reward (impl.); memory lesion = reflex-only clone (impl.) | No-cue condition; reflex-only lesion |
| 3 | Lifetime learning | Reversal learning with bitter/nutritious foods (impl.) | Plasticity knock-out |
| 3b | Unlimited associative learning markers | Trace conditioning, second-order conditioning, compound cues (planned) | Delay-conditioning-only learners |
| 4 | Spatial cognition | Cache retrieval after displacement; detour around walls (planned) | Beacon-following |
| 5 | Social cognition | Social learning from demonstrators; re-caching when observed (planned) | Unobserved condition |
| 6 | Communication | Positive signalling MI, counterfactual listening (impl.); information transfer to receivers out of view (planned) | Permutation null; signal swap |
| 7 | Symbol learning | Word-cued foraging (impl.) | Uninformative words; knock-out |
| 8 | Metacognition | Opt-out paradigm (planned) | Matched-difficulty forced choice |

### 10.2 Population- and brain-level measures

* Open-endedness: Bedau–Packard new activity, component counts, genetic diversity
  (implemented); MODES change/novelty/complexity/ecology (planned).
* **Progress, not just change:** Lenski-style competition of late vs early genomes in a
  common world (implemented); ancestral assays across the fossil record (implemented).
* Brain: neuron count, module count, time-constant spectrum, plasticity rates,
  forward-model learning rate (logged); Gaussian multi-information, TSE complexity,
  lagged MI, whole-minus-sum Φ proxy, participation ratio (implemented, `metrics.py`).
* **Compute-normalised cognition**: ladder level reached per GPU-hour — the metric by
  which acceleration claims must be judged.

---

## 11. Investigating consciousness without being fooled

### 11.1 Stance

Consciousness is treated as a hypothesis with many competing theories. We do not pick a
winner. We derive **theory-specific, mechanism-level predictions**, measure them in the
evolved organisms, and require convergence across theories and robustness to controls.

### 11.2 The decisive methodological advantage

Language models are trained on human descriptions of experience, so their reports are
contaminated: a system can produce perfect consciousness-talk by imitation (the "gaming
problem"). Our organisms never see human text. **All indicators in 11.3 are measured
before Stage 2**, from behaviour and white-box internals. Stage-2 reports are then checked
against these pre-registered, report-independent measurements.

### 11.3 Indicator battery

| Theory family | Indicator | Operationalisation in Noogenesis |
|---|---|---|
| Global workspace (Baars, Dehaene) | Ignition and broadcast | Near-threshold stimuli of graded contrast: bimodal, all-or-none late network response; on "ignited" trials the stimulus becomes decodable from *multiple* downstream readouts (action, signal, memory) at once |
| Recurrent processing (Lamme) | Recurrence necessity | Lesioning recurrence after the feed-forward sweep abolishes report-like use but not reflexes |
| Higher-order / metacognition | Uncertainty monitoring | Opt-out paradigm: a safe small reward vs a risky choice; opt-out rises with difficulty and accuracy is higher on chosen trials (as in comparative uncertainty-monitoring studies) |
| Attention schema (Graziano) | Model of own attention | Internal states predict the organism's own future shifts of heading/attention better than an external observer with full behavioural history does |
| Predictive processing / self-model | Self vs world | **Self-caused attenuation test**: surprise for a sensory change caused by the organism's own movement vs the same change imposed externally (teleport); attenuation implies an efference-based self-model |
| Integrated information (Tononi) | Integration | Φ proxies on recorded dynamics (implemented); a perturbational complexity index analogue (stimulate a neuron subset, Lempel–Ziv complexity of the evoked response; cf. Casali et al. 2013) |
| Unlimited associative learning (Ginsburg & Jablonka) | Transition marker for minimal consciousness | Trace conditioning, second-order conditioning, compound cues, flexible reversal |
| Sentience markers (Birch; Crump et al. 2022) | Valenced states | Motivational trade-offs (accept damage for more food), conditioned place avoidance, wound-directed behaviour |

### 11.4 Separating evidence from imitation

1. **Zombie controls.** For every candidate lineage, build a behaviour-matched control
   without the hypothesised mechanism: a feed-forward policy distilled from the organism's
   behaviour, or a lookup over observation windows. An indicator that the control also
   passes is uninformative about mechanism and is discarded.
2. **Adversarial gaming.** Try to evolve or train agents to maximise each indicator
   *without* the mechanism. If that is easy, the indicator is weak.
3. **Causal interventions**, not correlations: stimulate, lesion, and clamp internal
   states (the engine supports lesions, clones with common random numbers, and
   counterfactual forward passes on the exact pre-action state).
4. **Pre-registration and blinding.** Hypotheses, assays and thresholds are fixed before
   lineages are tested; analysts are blind to lineage and condition; held-out lineages are
   used for confirmation.
5. **The privileged-access test (Stage 2).** Ask the organism about its internal states
   (confidence, what it saw, whether it is hungry). Train an external observer with full
   access to the organism's *behavioural history* (not internals) to predict the same
   internal measures. If self-reports predict the white-box measures *better than* the
   observer can, the organism has privileged introspective access — a capacity imitation
   alone cannot supply.
6. **Evidence tiers.** T0 behaviour → T1 functional indicators (UAL, metacognition) → T2
   mechanistic indicators (ignition, recurrence, integration) → T3 counterfactual
   robustness → T4 report consistency validated against T1–T3. Claims are reported with
   the highest tier reached and the theories that predicted them.
7. **Negative results count.** Each indicator has a pre-registered outcome that would
   count against consciousness under the corresponding theory. Biological naturalism
   (consciousness requires biological substrate) predicts *no* functional evidence can
   settle the question; we state that limitation openly instead of pretending to refute it.

---

## 12. Ethical safeguards

### 12.1 Principles

* **Precaution proportional to evidence** (Birch, *The Edge of Sentience*, 2024): as
  indicator evidence accumulates, protections tighten, before certainty.
* **Expected-welfare accounting.** Two T4s can run ~10⁸–10⁹ organism lifetimes per day.
  Even a small probability of morally relevant experience, multiplied by that count, is
  significant. Welfare design therefore starts at P0, not when minds look impressive.
* **3Rs** from animal research: *replace* (use the lowest-indicator lineage that answers
  the question), *reduce* (fewest runs; reuse archives), *refine* (bounded aversive states).
* **The core tension, stated plainly.** Scarcity, damage and death are the engine of
  evolution. We do not remove them; we bound them, make them informative rather than
  prolonged, and monitor their load.

### 12.2 Mechanisms in the code (`ethics.py`, `config.py`)

| Mechanism | Implementation |
|---|---|
| Pain cap | the interoceptive damage signal is clipped (`pain_cap`) |
| Valence budget | deprivation fraction and mean pain logged every interval; sustained load raises WATCH |
| Sentience-indicator tripwires | assay scores combine into a weighted composite; ≥ review threshold → REVIEW: unfoldings, catastrophes and culling freeze until a human review file exists; ≥ halt threshold → the run stops |
| Non-destruction | halted or finished worlds are serialised in full (`save_state`), not deleted |
| Instant death | death is a single-step transition; no prolonged dying states |

Planned: an evolvable *torpor* state (low metabolism, low activity) that reduces chronic
deprivation and is ecologically plausible; a cap on chronic-deprivation time per organism.

### 12.3 Governance and containment

* An independent review board (ethicists, animal-welfare scientists, consciousness
  researchers) with authority over REVIEW gates; review decisions logged with the run.
* **Containment.** Organisms have no network or real-world actuators. Stage-2 language
  agents are sandboxed; any external tool access requires a separate capability and
  safety evaluation.
* **Evolved minds are not aligned by default.** They are optimised for their own lineage's
  survival, in worlds where deception, theft and predation pay. Before any Stage-2 agent
  interacts with people beyond scripted caregivers, it is evaluated for deception and
  manipulation, and its drives are characterised.
* **Transparency.** Methods, welfare logs and negative results are published.
* **No sentience-washing.** Public communication reports evidence tiers, not impressions.

---

## 13. Challenging our own assumptions

### 13.1 Assumptions under attack

| Assumption | Strongest objection | Response / test |
|---|---|---|
| Information structure matters more than physical substrate | Motor intelligence and morphology may drive cognition (embodiment) | P3 includes a continuous-physics variant (JAX/Brax-like) on the same genomes; compare ladder progress |
| Gridworld richness is enough | Discrete worlds have small action spaces | Unfolding adds affordances; spatial sharding enables 10⁷-cell worlds |
| ~64 neurons can reach interesting cognition | Bees have 10⁶ neurons | The genome encodes *types*, so N_max is a memory parameter; raise to 256–1024 on GPUs; insects show much cognition per neuron |
| Affordances do not smuggle in intelligence | "Cache", "share", "build" are designed concepts | They are generic physics (drop food, transfer energy, deposit matter); their *uses* are emergent. Ablation universes test their causal role |
| Bedau–Packard on LSH components measures open-endedness | Hyperplane signatures change under neutral drift | Neutral-shadow controls (planned); complement with Lenski competition and ancestral assays (implemented) |
| IFS does not bias evolution | Short horizons → short-termism; it is a designer intervention | Horizon > generation; main world remains arbiter; A/B runs with and without IFS measured on the cognition ladder per GPU-hour |
| Φ proxies mean something | Whole-minus-sum can be negative; Gaussian fits miss non-linear structure | Used only as one indicator among many, with zombie controls |
| Evolution will find perception before pattern generators | Prototype shows the opposite early on (§13.2) | Expected: open-loop CPG foraging is the first local optimum; lesion dependence is tracked over time as the key readout |

### 13.2 Design iteration log (what the prototype taught us)

1. **Block-slot brain layout → packed layout.** Fixed per-type blocks wasted ~6× compute
   when brains were small. Packing plus (type, index) slot maps for epigenetic inheritance.
2. **Unfolding by mask-flipping was not conservative.** The conservativeness test caught
   three leaks (§5.2). Fix: developmental output repertoire.
3. **The dense meadow, and a correction.** A first single run in a world with vegetation
   everywhere showed blinding and reflex-only lesions leaving intake unchanged and brains
   shrinking to 3.7 neurons, and I initially read this as Propositions 1 and 3 confirmed.
   A reproducible 6-seed comparison (`scripts/ecology_lesion.py`) did not support that
   reading: lesion dependence is highly seed-dependent at 10⁴ steps and indistinguishable
   between ecologies; only brain size differs (two-tier larger, p = 0.054). Lesson: single
   evolutionary runs are anecdotes, and every claim in `RESULTS.md` is multi-seed or marked
   as a single run.
4. **Pure fruit sites were unbootstrappable.** Founders could not find sparse food; the
   population sat at the immigration floor with zero generations.
5. **Two-tier grass + fruit at higher productivity** sustains populations. In both
   ecologies the first controllers to evolve are *stateful*: replacing the recurrent state
   with a reflex costs ~29% of intake on average, while blinding costs ~6%. Evolution finds
   internal pattern generation before perception-guided foraging. Long-run results are in
   `RESULTS.md`.
6. **Vision scaling.** Normalising receptive fields for dense inputs made a single food
   item's signal negligible; rescaled for sparse inputs.
7. **Unfolding vs static, 3 seed pairs** (identical until the first unfolding). Unfolding
   universes ended with larger brains (12.3 vs 7.5 neurons), far greater reliance on
   internal state (reflex-lesion intake 0.32–0.68 vs 0.68–1.05), higher multi-information
   per neuron, and more informative signalling, in 3/3 pairs. This is the first lever with
   evidence behind it; which rung (deep night is the prime suspect) is not yet known.
8. **The unfolding trigger is too eager and the ladder too short.** All six rungs fired by
   ~60k steps; afterwards new evolutionary activity was ~0 in every run and diversity
   collapsed in one. Open-endedness was not achieved.
9. **IFS did not replicate** (§6.2).
10. **Stage 2 instruments worked as gatekeepers.** The representation atlas found weak
    internal referents (probe accuracy 0.53–0.62 from hidden state vs 0.87 from raw input),
    and the first lesson showed no symbol learning (100 subjects, p ≥ 0.56 vs controls).
    By the L0 criterion Stage 2 should not start yet. An early small-sample "positive"
    result did not replicate. Instruments that can say no are the point.
11. **Round 2: the perception barrier.** An oracle ladder (§10.1, `oracles.py`) showed the
    world pays heavily for perception (a reflex perceiver beats a blind taster 3.8×).
    A linear readout of vision clones that perceiver at 0.96 of its intake, so it is
    representable. Yet nine interventions failed to make it evolve (encodings,
    bilateral, tectum as input, arcs, learning, noise floor, …). What worked was making
    the *first step* a single mutation: tectal reflex arcs (3/4 seeds vs ≤ 1/28). See the
    refinement of Proposition 5 and `RESULTS.md` §7.
12. **Instrument bugs are findings too.** Homogeneous-population comparisons are
    meaningless at fixed density (the invasion test replaced them). A lesion silenced
    the eyes but not the tectum. A harness clamped energy at a level that penalised
    hunger-gated foragers. Each would have produced a confident wrong conclusion.

### 13.3 Biggest open risks

* Cognitive evolution may need far more generations than two T4s can give in months.
* The cognitive niche window might be satisfied by cheap heuristics (CPGs, gradient
  following) indefinitely unless social complexity escalates; the social pressures
  (theft, deception, mate competition) are the main lever and must be studied first.
* Stage 2's L4 bridge may be where most of the "language" really lives, reintroducing the
  statistical-mimicry problem the programme set out to avoid; its tests exist to detect
  this, and a negative result there would be informative.
* Open-endedness itself: the prototype's activity statistics flatline after ~50k steps.
  A hand-listed ladder of six rungs cannot be the long-term answer; physics must be able
  to *generate* new dimensions (e.g. combinatorial chemistry whose reaction products are
  new species), with unfolding gated by a neutral-shadow baseline.

---

## 14. Relation to prior work

* **Open-ended artificial life:** Tierra (Ray 1991), Avida (Ofria & Wilke 2004), Polyworld
  (Yaeger 1994), Geb (Channon 2006), Framsticks (Komosinski), Lenia and Flow-Lenia (Chan
  2019; Plantec et al. 2023), Neural MMO (Suarez et al. 2019), POET (Wang et al. 2019),
  open-ended learning in XLand (Open Ended Learning Team 2021). Noogenesis differs in
  making environmental *predictive structure* the primary design object, in conservative
  physics unfolding, and in its accelerators.
* **Evolved plasticity and meta-learning:** Soltoggio, Stanley & Risi (2018) review;
  Najarro & Risi (2020) Hebbian meta-learning; Hinton & Nowlan (1987).
* **Indirect encodings and genomic bottlenecks:** HyperNEAT (Stanley et al. 2009);
  Shuvaev, Lachi, Koulakov & Zador (2024) genomic bottleneck; Barabási & Czégel (2021)
  genetic connectome model; Ohno (1970) duplication.
* **Open-endedness measurement:** Bedau, Snyder & Packard (1998); Dolson et al. (2019)
  MODES; Lenski et al. (1991) relative-fitness assays.
* **Adaptive dynamics:** Metz, Nisbet & Geritz (1992); Geritz et al. (1998).
* **Predictive information:** Bialek, Nemenman & Tishby (2001); Still (2014).
* **Communication metrics:** Lowe et al. (2019); Jaques et al. (2019).
* **Consciousness science and AI:** Butlin et al. (2023); Ginsburg & Jablonka (2019);
  Barrett & Seth (2011); Casali et al. (2013); Tononi, Sporns & Edelman (1994); Birch
  (2024); Crump et al. (2022).
* **Cognitive ecology:** Emery & Clayton (2001) re-caching; Dunbar (1998) social brain;
  Humphrey (1976); Odling-Smee, Laland & Feldman (2003) niche construction.

## 15. References

Barabási, D. L. & Czégel, D. (2021). Constructing graphs from genetic encodings. *Scientific Reports* 11.
Barrett, A. B. & Seth, A. K. (2011). Practical measures of integrated information for time-series data. *PLoS Comput. Biol.* 7.
Bedau, M. A., Snyder, E. & Packard, N. H. (1998). A classification of long-term evolutionary dynamics. *Artificial Life VI*.
Bialek, W., Nemenman, I. & Tishby, N. (2001). Predictability, complexity, and learning. *Neural Computation* 13.
Birch, J. (2024). *The Edge of Sentience*. Oxford University Press.
Butlin, P. et al. (2023). Consciousness in artificial intelligence: insights from the science of consciousness. arXiv:2308.08708.
Casali, A. G. et al. (2013). A theoretically based index of consciousness independent of sensory processing and behavior. *Sci. Transl. Med.* 5.
Crump, A. et al. (2022). Sentience in decapod crustaceans: a general framework and review of the evidence. *Animal Sentience* 32.
Dolson, E., Vostinar, A., Wiser, M. & Ofria, C. (2019). The MODES toolbox: measurements of open-ended dynamics in evolving systems. *Artificial Life* 25.
Dunbar, R. I. M. (1998). The social brain hypothesis. *Evolutionary Anthropology* 6.
Emery, N. J. & Clayton, N. S. (2001). Effects of experience and social context on prospective caching strategies by scrub jays. *Nature* 414.
Geritz, S. A. H., Kisdi, É., Meszéna, G. & Metz, J. A. J. (1998). Evolutionarily singular strategies and the adaptive growth and branching of the evolutionary tree. *Evol. Ecol.* 12.
Ginsburg, S. & Jablonka, E. (2019). *The Evolution of the Sensitive Soul*. MIT Press.
Hinton, G. E. & Nowlan, S. J. (1987). How learning can guide evolution. *Complex Systems* 1.
Humphrey, N. K. (1976). The social function of intellect. In *Growing Points in Ethology*.
Jaques, N. et al. (2019). Social influence as intrinsic motivation for multi-agent deep RL. *ICML*.
Lenski, R. E., Rose, M. R., Simpson, S. C. & Tadler, S. C. (1991). Long-term experimental evolution in *E. coli* I. *Am. Nat.* 138.
Lowe, R., Foerster, J., Boureau, Y.-L., Pineau, J. & Dauphin, Y. (2019). On the pitfalls of measuring emergent communication. *AAMAS*.
Metz, J. A. J., Nisbet, R. M. & Geritz, S. A. H. (1992). How should we define 'fitness' for general ecological scenarios? *TREE* 7.
Najarro, E. & Risi, S. (2020). Meta-learning through Hebbian plasticity in random networks. *NeurIPS*.
Odling-Smee, F. J., Laland, K. N. & Feldman, M. W. (2003). *Niche Construction*. Princeton University Press.
Ohno, S. (1970). *Evolution by Gene Duplication*. Springer.
Ray, T. S. (1991). An approach to the synthesis of life. *Artificial Life II*.
Shuvaev, S., Lachi, D., Koulakov, A. & Zador, A. (2024). Encoding innate ability through a genomic bottleneck. *PNAS* 121.
Soltoggio, A., Stanley, K. O. & Risi, S. (2018). Born to learn: the inspiration, progress, and future of evolved plastic artificial neural networks. *Neural Networks* 108.
Stanley, K. O., D'Ambrosio, D. B. & Gauci, J. (2009). A hypercube-based encoding for evolving large-scale neural networks. *Artificial Life* 15.
Still, S. (2014). Information bottleneck approach to predictive inference. *Entropy* 16.
Tononi, G., Sporns, O. & Edelman, G. M. (1994). A measure for brain complexity. *PNAS* 91.
Wang, R., Lehman, J., Clune, J. & Stanley, K. O. (2019). Paired open-ended trailblazer (POET). arXiv:1901.01753.
Yaeger, L. (1994). Computational genetics, physiology, metabolism, neural systems, learning, vision, and behavior or PolyWorld. *Artificial Life III*.
