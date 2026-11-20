# Noogenesis

**Evolve a mind first, then teach it language.** A research programme and a working
prototype of a computational universe designed so that intelligence can evolve on its
own: nothing in it rewards intelligence. Organisms just try to stay alive and reproduce.

* **Design and theory:** [`docs/NOOGENESIS.md`](docs/NOOGENESIS.md) covers the theory,
  architecture, environment, genetics, anti-stagnation, acceleration, Stage 2 (language),
  roadmap, benchmarks, consciousness framework, ethics and self-critique.
* **What the prototype has actually done so far:** [`docs/RESULTS.md`](docs/RESULTS.md).

## Core ideas

1. **The cognitive niche window.** Cognition only pays for predictive information that is
   missing from present senses, recoverable from the past, and changing faster than genes
   can track but slower than a lifetime. So we design the *spectrum* of the world (day,
   season, drifting fertility, chaotic climate, hidden caches), not a fitness function.
2. **Metabolic honesty.** Every neuron, activation, synapse and plasticity event costs
   energy from an exactly conserved budget. Brains have to pay for themselves.
3. **Developmental genomes.** Genes describe neuron *types*: their wiring affinities,
   receptive-field motifs, time constants, Hebbian rules and neuromodulator couplings.
   Duplication and divergence of these modules grows new cell types. There is no designer
   reward signal; any "value system" has to evolve.
4. **Physics Unfolding.** Latent dimensions of the universe (new chemical species,
   building, sound bandwidth, pheromones, deep night) switch on when evolutionary activity
   stagnates. Each switch is a *conservative extension*: tests verify that no living
   organism behaves differently at the moment it happens.
5. **Accelerators that don't fake selection.** Compute tracks the brains evolution has
   actually built. Invasion screening tests candidate mutations in paired clones of the
   real ecology using common random numbers. A UCB bandit spreads compute across an
   archipelago of universes according to their open-endedness.
6. **Language last, through the organism's own senses.** Words arrive through the evolved
   auditory channel and are learned with the organism's own evolved plasticity, against
   controls (uninformative words, plasticity knock-out).
7. **Consciousness as a hypothesis.** Theory-specific indicators are measured *before*
   language exists, so the minds can't imitate human reports. Behaviour-matched "zombie"
   controls and a privileged-access test separate evidence from imitation. Welfare
   tripwires in the code can halt a run.

## Status (details in `docs/RESULTS.md`)

**Round 3.** *Lifetime learning* has evolved. With patchy food species that alternate
between nutritious and toxic, organisms evolved a dopamine-like value-learning system
(plastic attention/salience). Their learned value of each species tracks which one is
currently nutritious (r ≈ 0.94, ~50-step lag, 2/2 seeds), and switching learning off
costs ~9% of intake. The behavioural effect is still small, and the chamber reversal
assay hasn't detected it yet. Spatial memory does not pay in any ecology tried (11
variants); that's a negative result, not a failure to look.

**Round 2.** The first *perception-driven* foragers have evolved. The oracle ladder showed
the world pays heavily for perception, and a linear readout of vision can represent it.
But evolution only found it once a single mutation could produce a first, partial
version: tectal reflex arcs in a bilateral, tectum-equipped "Cambrian" body plan. With
them, 3 of 4 seeds evolved food-gated eating and collision avoidance, and blinding cuts
their food intake by 29–90%. Without them, at most 1 borderline case appeared in ~28 runs
(p = 0.003). Physiological budding moved foragers past the blind-taster rung in 3/3 seeds.
Nine other interventions did not help; they are listed, with data, in the results.

**Round 1:**

* The engine works: energy is conserved exactly up to float32 rounding, unfolding is
  provably conservative, and one CPU core does ~7×10⁴ agent-steps/s (~400 generations in
  25 minutes).
* Evolution is progressive: final genomes displace early ones 684–753 to 0 in head-to-head
  competition.
* In 3 of 3 paired seeds, universes whose physics unfolded evolved larger brains, much
  greater reliance on internal state, more integrated neural dynamics and more informative
  signals than static universes. Three pairs is suggestive, not conclusive.
* The evolved controllers are internal rhythm generators, not perceivers: blinding them
  costs nothing. There is no working memory for world content, no reversal or symbol
  learning, and signals that nobody listens to yet.
* Two mechanisms failed their own checks and need redesign: invasion screening did not
  replicate, and the unfolding ladder was used up after which evolutionary activity
  flatlined.

## Quick start

```bash
pip install numpy pytest matplotlib          # cupy-cuda12x for GPUs
python -m pytest -q tests                    # 17 tests: conservation, conservative unfolding, ...
python scripts/run_evolution.py --steps 20000 --out results/demo
python scripts/analyze.py --runs results/demo --out results/demo/analysis
python scripts/benchmark.py
```

Variants:

```bash
python scripts/run_evolution.py --unfold off ...          # control: static physics
python scripts/run_evolution.py --iff ...                 # invasion-fitness screening on
python scripts/run_evolution.py --islands 4 --rounds 50   # activity-allocated archipelago
# 2x T4: one island per GPU, sharing migrants through a directory
python scripts/run_evolution.py --device cuda:0 --H 256 --W 256 --max-agents 32768 \
       --migrate-dir results/mig --island-id 0 --out results/gpu0 &
python scripts/run_evolution.py --device cuda:1 --H 256 --W 256 --max-agents 32768 \
       --migrate-dir results/mig --island-id 1 --out results/gpu1 &
```

The engine targets the NumPy API through one `xp` handle and uses only operations that
CuPy implements the same way. The GPU path hasn't been run yet (there was no GPU where
this was built), so treat it as untested until `scripts/benchmark.py --device cuda:0`
succeeds.

## Layout

```
noogenesis/   config, backend, genome, brain, world, unfolding, accelerate,
              archipelago, sim, metrics, assays, language, ethics
scripts/      run_evolution.py, analyze.py, benchmark.py
tests/        test_core.py
docs/         NOOGENESIS.md (design), RESULTS.md (findings), figures
```
