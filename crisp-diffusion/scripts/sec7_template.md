See `README.md` for commands. Setting: CIFAR-10 32×32, class-conditional (the class label stands in for the prompt). The
pyramid has one level: 16×16×3 Haar LL as coarse, plus one 9×16×16 detail band. Hardware: 4 CPU cores, no GPU, ≈190 GFLOP/s
sustained. All learned models use the same U-Net (6.3M parameters; 1.85 GFLOP per training sample at 16×16, 7.4 at 32×32), Adam (lr 3·10⁻⁴,
β = (0.9, 0.99)), batch 64, EMA 0.999, no augmentation, and identical hyperparameters for every method (nothing was tuned per
method). FLOPs are measured, not estimated: `torch.utils.flop_counter` for every forward and backward pass (including the scaffold's
matrix–vector products), plus analytic counts for retrieval, scaffold fitting and NMCR. Metrics use a classifier trained here from
scratch (87.5% CIFAR-10 test accuracy). "SC-FID" is the Fréchet distance in its 128-d feature space, so it is **not comparable to
published Inception FIDs**. **Budgets are ≤ 4.7·10¹⁴ FLOPs per system, about 3·10⁻⁶ of the central 2×T4 projection, and each comparison
has one seed plus one replicate. Treat every number as a mechanism test.**

### 7.1 E1 + E2: the scaffold and where label noise lives

{{E12}}

![E1](results/figures/e1_gap_profile.png)
![E2](results/figures/e2_label_noise.png)

*Reading.* (i) The class-conditional scaffold, one pass of second moments, is indistinguishable from the exact posterior at
σ ≥ 10 and 5× better than EDM's free skip term at σ = 1. (ii) The stationary (FFT) scaffold, which scales as $O(d\log d)$ to any
resolution, is within ≈10% of the full-covariance one. (iii) The posterior's ESS is 1 for σ ≤ 2, so standard DSM targets carry
**no** label noise there, and Rao-Blackwellization has nothing to remove where ≈94% of EDM's training samples live.

### 7.2 E3: closed-form fine-scale field (Theorem 3 in practice)

{{E3}}

![E3](results/figures/e3_nmcr.png)

*Reading.* The machinery works exactly as derived. One pass over 1.02M patches and 18 Cholesky solves fit the field at all
sampler noise levels in 97 s, with no noise sampling or backprop. At equal FLOPs it beats the SGD U-Net at low noise, but loses
at σ ≳ 0.25. The 5× U-Net wins everywhere, and NMCR is only 1–4% better than the purely *linear* local field. The bottleneck
is the function class (5×5 coarse context, random features in 166 dimensions), not the fitting procedure.

### 7.3 E4: FLOP-matched training of the coarse model (ablations)

{{E4}}

![E4](results/figures/e4_curves.png)

*Reading.* **C (scaffold) is the only training-side pillar with a clear effect**, and it is a head start. At 3.75·10¹³ FLOPs CRISP
matches what EDM reaches at 7.5·10¹³ (≈2×). At 1.5·10¹⁴ the speed-up is ≈1.4×. By 4.5·10¹⁴ the held-out losses are essentially equal (EDM marginally lower). The
long C-only run shows whether that convergence is caused by R/I or is intrinsic to the scaffold: {{LONGC}} **R does nothing**
(Proposition 2 predicted this: ESS = 1 where the samples are). **I is ≈0.5%.** Per noise band, the scaffold models are better at
σ ≥ 0.2 and worse at σ < 0.05, where shrinkage from estimated small eigenvalues hurts. {{SEEDS}}

### 7.4 E6: where the learned information lives (Theorem 1 ledger)

{{E6}}

![E6](results/figures/e6_info_density.png)

*Reading.* Paired on identical noisy test inputs, the non-Gaussian information captured beyond the free scaffold sits almost entirely at σ < 0.5
(≈62–65% in [0.05, 0.5), ≈28–32% in [0.002, 0.05)). It is ≈0 above σ = 5, where the EDM network is still *worse* than the scaffold
after 4.5·10¹⁴ FLOPs (negative entries). This is the ledger of Theorem 1 measured: the noise levels that carry learnable information are a
narrow band (density peaks at σ ≈ 0.05–0.1 at this scale), and it is the *expensive* band. Low noise needs fine detail. Mid noise needs semantics. Two further
observations. At σ ≤ 0.01 *every* trained network, EDM included, is worse than the free Wiener scaffold, which suggests switching to the scaffold
outright at the lowest noise levels. And the lowest band's information is acquired late (+C: ≈9 nats at 1.5·10¹⁴ → ≈100 at 4.5·10¹⁴): fine
detail is learned last.

### 7.5 E5: end-to-end generation at matched training FLOPs

{{E5}}

| EDM 32×32 | CRISP (coarse) + NMCR | pyramid only (EDM coarse + NMCR) | zero-SGD: scaffold + NMCR |
|---|---|---|---|
| ![](results/figures/samples_edm32.png) | ![](results/figures/samples_crisp16_nmcr.png) | ![](results/figures/samples_edm16_nmcr.png) | ![](results/figures/samples_scaffold_nmcr.png) |

*Reading.* **The standard pixel-space EDM wins on every metric.** The diagnostics locate the failure. (a) Coarse model: CRISP's coarse
model beats EDM's coarse model at equal FLOPs (with details zeroed: SC-FID 18.1 vs 19.8, class accuracy 0.22 vs 0.18; with NMCR details 12.5 vs 12.8 and
0.34 vs 0.29). (b) Fine scale: NMCR details help a lot (18.1 → 12.5) but add visible speckle, and recall stays near zero. (c) The real
cause is resolution. Removing the detail band from *real* images costs as much as the whole gap (SC-FID 14.3, accuracy 0.30). At 32×32 the
finest scale is semantic, so a local closed-form field cannot replace learned synthesis. The pyramid systems also spend 4× fewer
FLOPs per sample at inference (412 s vs 1,059 s on CPU for 2,000 samples).

### 7.6 What the proof of concept does and does not show

* **Shows:** Theorems 1 and 3 hold numerically. A one-pass scaffold is optimal at high noise and a better skip path early in
  training. Rao-Blackwellization cannot help where the empirical posterior is one-hot. In this setting the CRISP training-side
  mechanisms give a bounded head start, not a growing multiplicative speed-up. Closed-form local fields are cheap but under-expressive at
  the scale tested.
* **Does not show:** anything at 256²–512², where the fine bands are genuinely textural and where the pyramid's 16–256× position
  reduction is supposed to pay off. Anything about text conditioning. Anything at budgets beyond ≈5·10¹⁴ FLOPs. Seed-to-seed variance
  beyond one replicate.
