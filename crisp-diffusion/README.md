# CRISP diffusion: a first-principles attempt at radically cheaper diffusion training

**Read [`RESEARCH.md`](RESEARCH.md)** for the full study: the information ledger (Theorem 1), the closed-form
noise-marginalized local fields (Theorem 3), 14 hypotheses each tested against evidence, the CRISP framework,
a fully counted cost model for 2×T4, hard limits, and the validation protocol.

This directory also holds a minimal, CPU-runnable PyTorch proof of concept on CIFAR-10. No pretrained components
are used anywhere, evaluation included.

## Layout

```
crisp/
  data.py       CIFAR-10 loading, orthonormal Haar analysis/synthesis
  scaffold.py   Pillar C: class-conditional LMMSE (Wiener) scaffold; stationary spectral variant
  rb.py         Pillar R: exact and stratified (kNN head + uniform tail) empirical-posterior targets
  edm.py        EDM preconditioning, CRISP residual denoiser, Pillar I sampler, Heun sampler, FLOP counting
  nmcr.py       Pillar SP: Noise-Marginalized Closed-form Regression local fields (Theorem 3)
  unet.py       compact class-conditional U-Net
  common.py     patch extraction, coarse-band views, result IO
scripts/
  prepare_data.py      raw downloads -> npz
  exp_analytic.py      E1 gap profile + E2 label-noise analysis
  exp_nmcr.py          E3 closed-form fine-scale field vs SGD-trained U-Nets
  train_global.py      E4 FLOP-budgeted training (EDM / +C / +R / +I, 16x16 or 32x32)
  gap_paired.py        E6 learned non-Gaussian information by noise band (Theorem 1)
  train_classifier.py  self-trained evaluation classifier (features for SC-FID, P/R, accuracy)
  generate_eval.py     E5 end-to-end generation + metrics
  make_report.py       figures + markdown tables
  run_training.sh, run_after.sh   the exact pipeline that produced results/
tests/test_core.py     Haar orthonormality, NMCR closed form vs Monte Carlo, RB estimator, LMMSE optimality
results/               JSON logs, figures/, samples_*.npz, results_tables.md
```

## Reproduce (CPU, about 4–5 hours on 4 cores)

```bash
pip install torch numpy scipy matplotlib pillow
# CIFAR-10 PNG tree (fast.ai mirror) and MNIST idx files, then:
python -I scripts/prepare_data.py <cifar10_png_root> <mnist_dir> /home/user/data/npz   # or set CRISP_DATA
python tests/test_core.py
python scripts/exp_analytic.py 4
scripts/run_training.sh && scripts/run_after.sh
```

All FLOPs are counted: network forward and backward (measured with `torch.utils.flop_counter`, which includes the scaffold's
matrix–vector products), retrieval for RB targets, scaffold fitting, and NMCR statistics and solves.

## Honest summary

* The literal goal of 1,000–100,000× less compute with nothing sacrificed is **not** achievable against frontier models:
  memory, capacity and text-data floors rule it out on 2×T4 (RESEARCH.md §6).
* An SD-1.5-class 512² model trained fully from scratch is **projected** at ≈5·10¹⁹ FLOPs, about 2–3 weeks on 2×T4. That is
  ≈200× fewer useful FLOPs than the SD-1.x U-Net + CLIP stack (≈1,400× by A100-hour accounting). Unverified at scale.
* Exact results: Theorem 1 and Theorem 3. Empirical: the scaffold is near-optimal at high noise. RB targets turn out to help
  *only* at high noise, a partial falsification. Closed-form local fields and FLOP-matched training comparisons are in §7.
