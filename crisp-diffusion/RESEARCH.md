# CRISP: what diffusion training actually has to compute, and how much of it can be skipped

**CRISP** = **C**losed-form scaffolds · **R**ao-Blackwellized targets · **I**nformation-allocated noise
sampling · **S**cale **P**yramid with closed-form local fields.

Every claim in this document carries one of four tags:

| Tag | Meaning |
|---|---|
| **[D]** Demonstrated | Mathematically proven here (proof in the text or Appendix A), or an exact identity checked numerically. |
| **[E]** Experimental observation | Measured in the CPU proof of concept in this repository (CIFAR-10, ≤ 5·10¹⁴ FLOPs per system). Small scale. |
| **[P]** Projection | Extrapolated from the derivations plus published results. Not yet verified at scale. |
| **[S]** Speculation | Plausible, but neither proven nor measured. |

---

## 0. Verdict first

1. **The literal target is out of reach.** A 1,000–100,000× cut in training compute with no loss on any
   axis, measured against frontier models, conflicts with the capacity, memory and text-data floors in §6.
   Two T4s (32 GB in total, no bf16, PCIe interconnect) cannot even hold the optimizer state of an
   8–12 B-parameter frontier model. Whatever the algorithm, the 100,000× end is ruled out on this hardware. **[D]** for the
   memory floor; **[P]** for the rest.
2. **The useful version of the goal, an SD-1.5-class 512² text-to-image model trained from scratch on 2×T4, is
   projected to be reachable in about 2–3 weeks** (≈5·10¹⁹ FLOPs, every component counted, no pretrained
   parts). That is **≈200× fewer useful FLOPs** than SD-1.x's U-Net + CLIP stack (≈1·10²² FLOPs), or ≈1,400× by
   the A100-hour accounting on the SD model card. **[P]** The 1,000× target holds only under the second
   accounting. Most of the factor comes from levers already known to the field (fewer tokens, curated data, sparse
   compute). The new mechanisms below add a further projected 3–10×.
3. **What is new** (to my knowledge; see §9):
   - **Theorem 1 (information ledger).** The only information a denoiser must learn beyond one pass of
     second-order statistics is $D(p\,\|\,\mathcal N(\mu,\Sigma)) = \tfrac12\int_0^\infty
     [\mathrm{lmmse}(s)-\mathrm{mmse}(s)]\,ds$. Its density over noise levels, $\mathrm{gap}(\sigma)/\sigma^2$,
     says where training compute can do any good. **[D]**
   - **Theorem 3 (NMCR).** For random-Fourier-feature local denoisers, the normal equations integrated *exactly*
     over the Gaussian noise are elementwise products of noise-independent data statistics with closed-form
     σ-kernels. One pass over clean data therefore trains the field at **every noise level at once**: no noise
     sampling, no noise-level sampling, no backprop, no epochs. **[D]**, and checked against Monte Carlo to 10⁻⁴–3·10⁻³ relative error **[E]**.
   - **Proposition 2 (where label noise lives).** Rao-Blackwellized targets leave the expected gradient
     unchanged **[D]**. But in high dimension the empirical posterior is one-hot for every σ below roughly the
     nearest-neighbour scale, so RB targets equal standard targets exactly where most training happens (σ ≲ 2
     on CIFAR). That falsifies the hope that RB alone gives a large speed-up. **[E]**
   - **The CRISP training framework:** a coarse-only learned model that is a residual over a closed-form scaffold,
     a scale pyramid whose finest fields are fitted in closed form, and noise-level allocation driven by the
     ledger.
4. **The proof of concept (§7)** separates what worked from what did not, at matched FLOPs, against an
   EDM baseline. The numbers are small-scale and CPU-bound. They show mechanisms, not a 1,000× result.

---

## 1. The target in numbers

| Quantity | Value | Note |
|---|---|---|
| T4 peak (fp16 tensor cores) | 65 TFLOP/s | 8.1 TFLOP/s fp32; **no bf16**; 16 GB GDDR6 at 320 GB/s; 70 W |
| Realistic sustained, 2×T4 | 2 × (12–30) TFLOP/s | the planning value here is **2 × 20 = 4·10¹³ FLOP/s** (31% of peak) |
| 2×T4, 30 days | ≈ 1.0·10²⁰ FLOPs | at the planning throughput |
| SD-1.x U-Net, useful FLOPs | ≈ 6.7·10²¹ | 237k steps at 256² + 1.30M steps at 512², batch 2048, ≈0.8 TFLOP/forward at 512² (×3 for training) |
| CLIP ViT-L/14 (SD-1.x text encoder) | ≈ 3.3·10²¹ | 12.8 B samples × 3 × ≈87 GFLOP |
| SD-1.x stack, useful FLOPs | **≈ 1·10²²** | VAE excluded (small) |
| SD-1.x by wall-clock | ≈ 6.7·10²² | 150k A100-hours (model card) at 40% MFU, plus CLIP's 73.7k V100-hours |
| Frontier (8–12 B-parameter image models) | ≳ 10²³–10²⁴ | not public; order of magnitude only |

"1,000× vs SD-1.x" therefore means 10¹⁹ (strict) to 7·10¹⁹ (wall-clock) FLOPs, or 3–20 days on 2×T4.
"100,000× vs frontier" means ~10¹⁹ FLOPs while matching a model with ≳10 B parameters.

---

## 2. First principles: an information ledger for diffusion training

Forward process (EDM / variance-exploding form): $x_\sigma = x_0 + \sigma\varepsilon$, $\varepsilon\sim\mathcal N(0,I)$,
$x_0\in\mathbb R^d$. The optimal denoiser is $D^*(x,\sigma)=\mathbb E[x_0\mid x_\sigma=x]$. Tweedie's formula gives
$\nabla\log p_\sigma(x) = (D^*(x,\sigma)-x)/\sigma^2$. Training minimizes
$\mathcal L(\theta)=\mathbb E_{\sigma\sim p}\,\lambda(\sigma)\,\mathbb E\|D_\theta(x_\sigma,\sigma)-x_0\|^2$.

### 2.1 Exact decomposition of the denoising loss  [D]

For any denoiser $D$ (a function of $x_\sigma$), orthogonality of $x_0-D^*$ to functions of $x_\sigma$ gives

$$\mathbb E\|D-x_0\|^2=\underbrace{\mathrm{mmse}(\sigma)}_{\text{irreducible}}+\underbrace{\mathbb E\|D-D^*\|^2}_{\text{excess}} .$$

Let $D_G(x,\sigma)=\mu+\Sigma(\Sigma+\sigma^2 I)^{-1}(x-\mu)$ be the Wiener filter built from the data mean and covariance. It is the
best *affine* estimator for **any** distribution with those two moments. Its error
$\mathrm{lmmse}(\sigma)=\sum_k\lambda_k\sigma^2/(\lambda_k+\sigma^2)$ needs only the eigenvalues. Applying the decomposition to $D=D_G$:

$$\mathrm{gap}(\sigma):=\mathrm{lmmse}(\sigma)-\mathrm{mmse}(\sigma)=\mathbb E\|D^*-D_G\|^2\;\ge 0 .$$

So **at noise level σ, the only thing any network can add beyond one pass of second-order statistics is the
residual $D^*-D_G$, whose energy is $\mathrm{gap}(\sigma)$.** Where the gap is zero, training compute is wasted.

### 2.2 Theorem 1: the non-Gaussian information identity  [D]

Write snr $s=1/\sigma^2$ and $Y=\sqrt s\,x_0+\varepsilon$. Let $x_0$ have a density $p$ with finite covariance Σ, and let
$G=\mathcal N(\mu,\Sigma)$. Then

$$\boxed{\;D(p\,\|\,G)=\tfrac12\int_0^\infty\big[\mathrm{lmmse}(s)-\mathrm{mmse}(s)\big]\,ds
=\int_{0}^{\infty}\frac{\mathrm{gap}(\sigma)}{\sigma^{2}}\,d\ln\sigma\;}$$

with the analogous statement conditional on a label or prompt, using $\mathcal N(\mu_c,\Sigma_c)$.

*Proof.* The I-MMSE relation (Guo, Shamai & Verdú 2005) gives $\tfrac{d}{ds}I(x_0;Y)=\tfrac12\mathrm{mmse}(s)$. For the Gaussian with
the same covariance, the MMSE equals the LMMSE, which depends only on second moments. Hence $\tfrac{d}{ds}I_G=\tfrac12\mathrm{lmmse}(s)$, and
$I_G(s)-I(s)=\tfrac12\int_0^s(\mathrm{lmmse}-\mathrm{mmse})$. As $s\to\infty$, $I(s)=h(\sqrt s x_0+\varepsilon)-h(\varepsilon)=\tfrac d2\ln s+h(x_0+\varepsilon/\sqrt s)-h(\varepsilon)$, so
$I_G(s)-I(s)\to h(G)-h(p)$. Since $G$ matches $p$'s first two moments, $h(G)-h(p)=D(p\|G)$. The change of variables
$ds=2s\,d\ln(1/\sigma)$ gives the second form. ∎

**Consequences.**
* The total information that *must* be learned by iterative optimization is the negentropy $D(p\|G)$. Everything
  else is available in closed form from one pass. **[D]**
* $\rho(\sigma)=\mathrm{gap}(\sigma)/\sigma^2$ is the **learnable-information density** per unit log-noise. Noise levels with
  ρ ≈ 0 carry no information a network can extract. Spending SGD samples there is pure overhead. **[D]**
* For 8-bit data the true density is discrete and $D(p\|G)=\infty$. The integral restricted to $\sigma\ge\sigma_{\min}$ is finite
  and is the non-Gaussian information resolvable above the quantization scale.
* A trained network gives an *upper* bound on mmse, so $\tfrac12\int(\mathrm{lmmse}-\mathrm{mse}_\theta)\,ds$ is a *lower* bound
  on how many nats per image the network has actually captured, resolved by noise band. §7 reports it.

### 2.3 Where the label noise of denoising score matching lives  [D] + [E]

Standard DSM regresses $D_\theta(x_\sigma)$ onto $x_0$. Given $x_\sigma$, the target $x_0$ is random. Under the **empirical** training
distribution the conditional mean has a closed form:
$\hat y(x_\sigma)=\sum_j\pi_j x_0^{(j)}$ with $\pi_j\propto e^{-\|x_\sigma-x_0^{(j)}\|^2/2\sigma^2}$.

**Proposition 2.** (a) $\mathbb E[\nabla_\theta\|D_\theta-x_0\|^2\mid x_\sigma]=\nabla_\theta\|D_\theta-\hat y\|^2$. Replacing $x_0$ by $\hat y$
(Rao-Blackwellization) leaves the expected gradient *exactly* unchanged and removes the label-noise term
$\mathbb E\|J^\top(\hat y-x_0)\|^2$ from its variance. The remaining gradient noise is proportional to the
*excess* loss, so it vanishes as the model improves. This is the "strong growth" regime in which SGD converges at
deterministic rates (Vaswani et al. 2019). (b) The label-noise energy is the posterior variance
$V(\sigma)=\mathbb E\big[\sum_j\pi_j\|x_0^{(j)}-\hat y\|^2\big]$. It is zero whenever the posterior is one-hot, i.e. whenever
$\sigma^2$ is small relative to the gap between the squared distances from $x_\sigma$ to its first and second nearest training
images.

Part (a) is exact (proof in A.2). Part (b) is the catch, and §7 / `results/analytic.json` measures it **[E]**. On CIFAR-10 pixels
(d = 3072, 5k images per class) the posterior's effective sample size is exactly 1.0 for every σ ≤ 2,
and $V(\sigma)\le 0.12\%$ of the residual energy there. Label noise becomes noticeable at σ = 3 (3.4% of the residual)
and dominates from σ = 10. EDM's training distribution (log-normal, median σ = 0.3) puts ≈94% of its samples at σ ≤ 2,
where RB targets *equal* the standard ones, and ≈97% at σ ≤ 3.
**Rao-Blackwellization cannot speed up the part of training that matters most.** It helps only at high noise, and E1
shows that is exactly where the closed-form scaffold is already optimal (gap ≈ 0). The two mechanisms overlap. This
is the clearest example in this study of why "multiply all the speed-ups together" overstates the total (§6, L4).

The real "noise" SGD fights at mid σ is *model-relative*: the network cannot represent the memorizing posterior, so
$x_0-D_{\theta^*}$ acts as noise even though the empirical posterior is deterministic. Reducing that would need a
*generalizing* posterior target (for example the patch-local posterior of Kamb & Ganguli's ELS machine). Such a target is biased,
and is left as hypothesis H3′ (§3).

### 2.4 Audit of every ingredient of conventional training

| Ingredient | What it computes | Redundant part | Max saving from removing that part | Status |
|---|---|---|---|---|
| Back-propagation | exact gradient; ≈2× forward cost | none of its *information* is redundant | ≤ 3× per step, and every known alternative needs more steps | [D] bound, [E] literature |
| Gradient descent | first-order steps | curvature ignored | 1.3–2× fewer steps (Shampoo/SOAP-type preconditioning); exact solves only for linear-in-parameter blocks | [E] literature |
| Many noise levels | regression at every σ | σ where gap(σ) ≈ 0 | fraction of samples in those σ: ~1.1× for EDM on CIFAR, up to ~2× for high-res schedules shifted to high noise | [D] + [E] |
| Noise sampling (Monte Carlo over ε) | stochastic estimate of a Gaussian integral | all of it, *for linear-in-features models* | exact integration (Theorem 3) | [D] |
| Random initialization | starts from D ≈ c_skip·x | the affine part of D* | scaffold init: held-out loss at step 0 is 0.42 vs 1.01 (CIFAR LL) | [E] |
| Repeated exposure (epochs) | re-reading data | sufficient statistics of linear blocks | one pass for scaffold and fine fields; the global model still needs several epochs | [D] |
| Dense global compute at all resolutions | attention/conv over every pixel at every layer | fine scales are local given coarser ones | 16–256× fewer positions at the expensive model | [P], [E] literature |
| Dense matmul | all parameters, all tokens | masked / dropped tokens; experts | 2–3× (MaskDiT, deferred masking) | [E] literature |
| Representation learning | semantics | **none removable** without external data or models | — (this is the irreducible core) | [P] |
| Noise schedule | weights per σ | mis-allocation | ≤ 2× | [E] literature |

The honest reading: **no single ingredient hides a 1,000× redundancy.** The large factors come from (i) removing whole
*dimensions* from the expensive model (multiscale locality), and (ii) removing whole *categories* of computation for
the parts of the problem with closed-form structure: second-order statistics, high noise, and fine-scale local
fields.

---

## 3. Fourteen hypotheses, each attacked

Format for each: **Mechanism · Cost · Potential gain · Does it keep generative ability? · Limits · Prior work ·
Falsification attempt · Verdict.**

**H1. Closed-form empirical-Bayes diffusion (no network at all).**
Mechanism: use $\hat y(x_\sigma)$ from §2.3 as the denoiser. Cost: 0 training, $O(Nd)$ per sampling step.
Gain: unbounded on training. Ability: **no**. Sampling the exact empirical score returns training images.
Prior: folklore; Scarvelis et al. 2023 ("closed-form diffusion models") smooth it. Falsification **[E]**: on held-out
CIFAR images the empirical posterior's denoising MSE is ≈390 at every σ ≤ 1, against 0.01–121 for the Gaussian scaffold.
It snaps test images onto training images. **Rejected** as a model. Kept as a target estimator (H3).

**H2. Analytic Gaussian / spectral scaffold for high noise.**
Mechanism: the Wiener filter $D_G$ (full covariance, class- or prompt-conditional), or its stationary version, which is diagonal per
frequency with a C×C cross-spectrum. Cost: $O(Nd^2+d^3)$ or $O(Nd\log d)$ in one pass. Gain: makes high-σ training
unnecessary and gives a far better skip connection than EDM's $c_\text{skip}x$ (that term is the LMMSE under an
*isotropic* prior). Ability: no multimodality, so it is a scaffold, not a model. Prior: Wang & Vastola 2023/2024 show
trained scores are close to the Gaussian score at moderate and high noise, and use this to skip 15–30% of *sampling*
steps. They do not use it to remove *training*. Falsification **[E]**: at σ = 20 the class-conditional scaffold's test MSE is
608.78 against 608.55 for the exact empirical posterior (0.04% apart). At σ = 1 it beats EDM's skip term 5×
(121 vs 613). **Accepted.**

**H3. Rao-Blackwellized (posterior-mean) targets.**
Mechanism: Proposition 2. Scalable estimator: exact head over k approximate nearest neighbours (IVF index on a
PCA sketch) plus a uniformly sampled tail with importance weight (N−k)/s. Cost ≈ $B[N r/n_\text{list}\cdot n_\text{probe}+(k+s)d]$,
about 10⁻⁴ of a network forward at scale. Gain: in theory, deterministic-rate SGD wherever the posterior is spread.
Prior: Stable Target Field (Xu, Tong & Jaakkola, ICLR 2023) uses a reference batch, which has larger bias. Falsification
**[E]**: label noise is zero for σ ≤ 2 on CIFAR (§2.3). At σ ≥ 5 the stratified estimator cuts it 20–250× (σ = 10:
455 → 15; σ = 80: 700 → 2.7). **Partially falsified:** real but confined to high noise. Retained only because it is what makes
H4 work (below).
*H3′ (open):* targets from a generalizing *local* posterior (patch mosaics), annealed to unbiased targets. **[S]**

**H4. Information-allocated noise-level sampling.**
Mechanism: Theorem 1 says where learning can happen. Sample σ from $q\propto p\cdot\sqrt{\mathbb E[\ell^2\mid\sigma]}$, the
variance-optimal importance-sampling proposal (A.4), with weights $p/q$ so the objective is unchanged. With *standard* targets, ℓ at high σ is dominated by
irreducible mmse, so this proposal (as in iDDPM) allocates *more* samples to high noise, which is the wrong direction. With
scaffold + RB targets, ℓ becomes the excess loss, so the proposal learns to skip what is already solved. Cost: negligible. Gain: bounded by the
mass p puts on ρ ≈ 0, so ≤1.2× for EDM-CIFAR and up to ~2× for schedules shifted toward high noise. **Accepted as a small,
principled factor.** §7 tests it.

**H5. Multiscale factorization with local conditionals (scale pyramid).**
Mechanism: for an orthonormal wavelet transform, $p(x)=p(x^{(J)})\prod_j p(d^{(j)}\mid x^{(j)})$. The chain rule makes this exact,
and orthonormality means pixel noise σ is coefficient noise σ. Hypothesis: at fine scales the conditional score is local
(Markov in a small neighbourhood). Cost: the expensive global model sees $d/4^J$ dimensions. Fine fields cost
O(pixels). Gain: 16–256× fewer positions in the expensive model, and fine fields need no global compute. Ability:
preserved *if* locality holds; it fails for long-range fine structure such as text glyphs and symmetric faces, which intermediate scales must handle
with larger receptive fields. Prior: Kadkhodaie, Guth, Mallat & Simoncelli (ICLR 2023) show
face structure is captured with much smaller conditioning neighbourhoods than a pixel-domain Markov model needs.
Guth et al. (NeurIPS 2022) show a constant number of sampling steps per scale. **Accepted. This is the main structural
lever.**

**H6. Noise-marginalized closed-form regression (NMCR) for local fields.**
Mechanism: Theorem 3 (§4.5). Cost: $N_p(d_\text{in}+m)^2$ once, plus one $(d_\text{in}+m)^3$ solve per σ. Gain over SGD
local nets: no noise Monte Carlo, no epochs, no backprop, no learning-rate tuning, and the validation loss is also closed
form. In absolute terms fine fields become ≈10¹⁶ FLOPs at 512². Ability: limited by random-feature
expressivity in 100–200 input dimensions. Limits: only the first layer of a deep net can be noise-marginalized, so the method
**requires locality (H5)** to keep input dimension low. Prior: random features (Rahimi & Recht 2007); kernel denoisers.
I know of no prior use of σ-independent sufficient statistics that train all noise levels at once. Falsification: E3 (§7)
compares against SGD-trained CNNs at 1× and 5× the FLOPs. **Accepted for fine scales, see §7.**

**H7. Backprop-free learning (forward-forward, feedback alignment, predictive coding, NoProp).**
Ceiling: the backward pass is ≈2/3 of step FLOPs, so per-step savings are ≤3× **[D]**. Bio-plausible rules scale poorly
(Bartunov et al. 2018). NoProp (2025) targets classification. **Rejected** for compute. Memory benefits are real.

**H8. Analytic weight construction for deep networks (NTK regression, scattering / PCA-nets).**
NTK regression costs $O(N^2)$ memory and $O(N^3)$ time (impossible at N = 3·10⁷) and lacks feature learning. Fixed
scattering front-ends replace the *cheapest* part of learning (low-level filters). **Rejected**, except for the
analytic wavelet front-end, which is what H5 already is.

**H9. Data reduction (deduplication, coresets, distillation).** Semantic deduplication removes ~50% of web data with
minimal loss for CLIP-type models (Abbas et al. 2023). Generative dataset distillation is not shown at scale.
**Accepted as hygiene, ≤2×.**

**H10. Sparse and dynamic compute (token masking, MoE).** MaskDiT and deferred masking (Sehwag et al. 2024/25: 1.16 B
parameters, 37M images, $1,890, 2.6 days on 8×H100, COCO FID 12.7, ~14× cheaper than the previous cheapest approach) show
2–3× from masking. **Accepted (known).**

**H11. Closed-form semantic scaffold (text → coarse image statistics).**
Mechanism: word embeddings from a one-pass co-occurrence count plus a truncated SVD of the PPMI matrix
(Levy & Goldberg 2014: skip-gram ≈ implicit PMI factorization). Then a *conditional* LMMSE scaffold
$\mu(c)=A\psi(c)+b$, $\Sigma_{x|c}=\Sigma_{xx}-\Sigma_{x\psi}\Sigma_{\psi\psi}^{-1}\Sigma_{\psi x}$ (A.3). Gain: the
prompt-dependent global colour and layout prior is solved before training starts. Limits: bag-of-words, so no binding
("red cube left of a blue ball"). **Accepted as a scaffold**, insufficient alone **[P]**.

**H12. Scale recursion (share fine fields across scales).** Natural images have approximately scale-invariant
statistics (1/f² spectra), so a single local field with a scale-index input could serve every octave and extend to unseen resolutions
with no training. Limits: real images have characteristic scales. **Plausible, untested [S].**

**H13. Mixture-of-factor-analyzers scaffold (multimodal, closed form at all σ).** A noised MFA is still an MFA, so its score is
analytic for every σ. Richardson & Weiss (2018) showed MFAs with many components capture image diversity well.
Evidence here **[E]**: the class-conditional Gaussian (an MFA with 10 known, full-rank components) improves on the
unconditional scaffold by only 4% at σ = 5 on CIFAR pixels. Multimodality by class barely reduces the gap, which suggests
modest returns. **Open; low priority.**

**H14. Representation alignment without external encoders.** REPA's 17.5× uses DINOv2, a pretrained model trained on
142M curated images, so it is excluded here and its cost would have to be counted. Self-alignment variants recover part of the gain.
**Optional; modest [P].**

| # | Idea | Verdict | Expected factor at scale |
|---|---|---|---|
| H1 | empirical-Bayes closed form | rejected (memorizes) | — |
| H2 | Gaussian / spectral scaffold | **accepted** | 1.2–2× (with H4) |
| H3 | RB targets | partially falsified | ~1× alone; enables H4 |
| H4 | information-allocated σ | **accepted** | 1.1–2× |
| H5 | scale pyramid with local fields | **accepted** | 4–16× vs f8 latents |
| H6 | NMCR closed-form fields | **accepted (fine scales)** | fine-scale training → ~0 |
| H7 | backprop-free | rejected | ≤3× ceiling, worse in practice |
| H8 | NTK / analytic deep weights | rejected | — |
| H9 | data hygiene | accepted (known) | ≤2× |
| H10 | masking / MoE | accepted (known) | 2–3× |
| H11 | closed-form text scaffold | accepted as scaffold | small, grows with H2 |
| H12 | scale recursion | untested | resolution for free [S] |
| H13 | MFA scaffold | open | small (evidence) |
| H14 | self-representation alignment | optional | 1.3–2× [P] |

---

## 4. The invention: CRISP

### 4.1 Generative factorization

Orthonormal Haar (or any orthonormal wavelet) analysis $x\mapsto(x^{(J)},d^{(J)},\dots,d^{(1)})$, exact by the chain rule:

$$p(x\mid c)=\underbrace{p(x^{(J)}\mid c)}_{\text{coarse: learned + scaffold}}\;\prod_{j=J}^{J_m}\underbrace{p(d^{(j)}\mid x^{(j)},c)}_{\text{mid: small learned local conv fields}}\;\prod_{j<J_m}\underbrace{p(d^{(j)}\mid x^{(j)},c)}_{\text{fine: NMCR closed form}} .$$

For 512² images: J = 4, so the coarse level is 32×32×3 (3,072 dimensions; Torralba et al. 2008 found 32×32 colour
thumbnails sufficient for human scene and object recognition). Mid levels produce 64² and 128²; fine levels produce 256² and 512².
Every level is a conditional diffusion with its own σ range. Orthonormality makes each level's forward
process an ordinary $x_\sigma=x_0+\sigma\varepsilon$ in coefficient space.

### 4.2 Pillar C: closed-form scaffolds

**Coarse level.** Conditional LMMSE from the pair (noisy coarse image, text feature ψ(c)) (derivation in A.3):

$$D_G(x,\sigma,c)=\mu(c)+\Sigma_{x|c}\,(\Sigma_{x|c}+\sigma^2I)^{-1}\,(x-\mu(c)),\qquad \mu(c)=\mu+\Sigma_{x\psi}\Sigma_{\psi\psi}^{-1}(\psi(c)-\mu_\psi).$$

Eigendecompose $\Sigma_{x|c}=U\Lambda U^\top$ once. Then $D_G$ costs two dense matrix–vector products. With labels instead of prompts (the proof of concept), $\mu(c),\Sigma_c$ are
per-class moments shrunk toward the pooled covariance.

**Text features ψ(c).** One pass over captions counts word co-occurrences. Take a truncated SVD of the PPMI matrix
(rank 512), average over caption tokens, and append bigram hashes. This is closed form, costs ≈10¹⁵ FLOPs on CPU, and also initializes the
embedding table of the small learned text encoder.

**Residual parametrization.** The learned coarse denoiser is

$$D_\theta(x,\sigma,c)=D_G(x,\sigma,c)+c_\text{out}(\sigma)\,F_\theta\big([c_\text{in}(\sigma)x,\;D_G/\sigma_\text{data}],\,c_\text{noise}(\sigma),\,c\big),$$

with EDM's $c_\text{in},c_\text{out},c_\text{noise}$ and EDM's loss weight λ(σ), so **the objective is identical to EDM's** and only the
skip path changes. EDM's $c_\text{skip}x$ is the LMMSE under an isotropic $\mathcal N(0,\sigma_\text{data}^2I)$ prior, and CRISP
replaces it with the full LMMSE. The output layer is zero-initialized, so **the model at step 0 is already the optimal affine
denoiser**.

### 4.3 Pillar R: Rao-Blackwellized targets (stratified posterior)

For a training pair $(x_0^{(i)},c_i)$ and noisy $x_\sigma$:
1. $q=P^\top(x_\sigma-\bar x)$ (PCA sketch, r = 64–256). IVF lookup gives a head $K$ of k approximate nearest neighbours of $q$
   within the same class or caption cluster. Always add $i$ itself.
2. Draw a tail $S$ of s indices uniformly. Mask entries already in $K$. Each surviving tail entry carries log-weight $\ln\frac{N-k}{|S\setminus K|}$.
3. Compute exact logits $\ell_j=(x_\sigma\cdot x_0^{(j)}-\tfrac12\|x_0^{(j)}\|^2)/\sigma^2$ in full dimension for $j\in K\cup S$, take the softmax, and form the target
   $\hat y=\sum_j w_jx_0^{(j)}$.

With exact head and tail sums the estimator is consistent. Its bias comes only from self-normalization of the tail and vanishes as
s grows. Its residual error against the exact posterior is measured in E2 (`V_strat`). For text conditioning, captions
are almost all unique, so the exact empirical conditional posterior is one-hot. The posterior is therefore taken over a *caption-kernel* neighbourhood
($\pi_j\propto e^{-\|x_\sigma-x_0^{(j)}\|^2/2\sigma^2}\,k_h(\psi_i,\psi_j)$, bandwidth h → 0 over training). By §2.3, use it only for
σ above the empirical ESS threshold (ESS > 1.5, estimated once on a σ grid).

### 4.4 Pillar I: information-allocated noise levels

Twenty-four bins in ln σ. Each bin keeps an EMA of $\ell^2$, where ℓ is the λ-weighted per-sample loss against the RB target. The proposal is
$q(\sigma)\propto p(\sigma)\,[(1-\phi)\,r(\sigma)/\bar r+\phi]$ with $r=\sqrt{\mathrm{EMA}(\ell^2)}$ and floor φ = 0.2. Each sample's loss
is weighted by $p/q=\bar r/r$. Because ℓ is the *excess* loss (Prop. 2), r(σ) tracks the remaining learnable information
ρ(σ) of Theorem 1, and the sampler stops paying for noise levels the scaffold has already solved.

### 4.5 Pillar SP: the pyramid, and Theorem 3 (NMCR)

**Mid levels (64², 128²)** are small conditional U-Nets (~30M parameters each). Each takes the noisy detail band, the clean
coarser band and a pooled text embedding, has a receptive field of about 32–64 coefficients, and trains with EDM on random crops.
Patch-level data is plentiful and the conditional problem is well conditioned, so they converge with few image-level passes
(Guth et al. 2022).

**Fine levels (256², 512²): NMCR.** At site $u$ the local field predicts the clean detail vector $y=d_0[u]\in\mathbb R^{9}$ from
$z_\sigma=[\text{noisy }3{\times}3\text{ detail patch};\ \text{clean }5{\times}5\text{ coarse patch};\ \text{text or class code}]$,
i.e. $z_\sigma=z_0+\sigma M\varepsilon$ with $M$ selecting the noisy coordinates. Features:

$$\phi(z)=\big[1,\;z,\;\sqrt{2/m}\cos(Wz+b)\big],\qquad W\in\mathbb R^{m\times d_\text{in}} \text{ (multi-bandwidth Gaussian rows)} .$$

**Theorem 3.** Let $u_k=M^\top w_k$, $A_k=w_k\!\cdot z_0+b_k$, $C_k=\cos A_k$, $S_k=\sin A_k$, $e_k(\sigma)=e^{-\sigma^2\|u_k\|^2/2}$,
$E^{\mp}_{kl}(\sigma)=e^{-\sigma^2\|u_k\mp u_l\|^2/2}$. Then, with expectations over $\varepsilon$ conditional on $z_0$:

$$\begin{aligned}
\mathbb E[\phi_k] &= \sqrt{2/m}\,e_kC_k, &
\mathbb E[\phi_k\phi_l] &= \tfrac1m\big[E^-_{kl}(C_kC_l+S_kS_l)+E^+_{kl}(C_kC_l-S_kS_l)\big],\\
\mathbb E[z_\sigma\phi_k] &= \sqrt{2/m}\,e_k\big(z_0C_k-\sigma^2Mu_kS_k\big), &
\mathbb E[z_\sigma z_\sigma^\top] &= z_0z_0^\top+\sigma^2MM^\top .
\end{aligned}$$

Hence the noise-integrated Gram matrix and right-hand side are

$$G(\sigma)=\mathcal K(\sigma)\odot\mathcal S,\qquad B(\sigma)=\kappa(\sigma)\odot\mathcal T ,$$

where $\mathcal S=\{\overline{z_0z_0^\top},\overline{z_0C^\top},\overline{CC^\top},\overline{SS^\top},\bar z_0,\bar C,\bar S\}$ and
$\mathcal T=\{\bar y,\overline{z_0y^\top},\overline{Cy^\top}\}$ are averages over **clean** data that **do not depend on σ**, and
$\mathcal K,\kappa$ are the closed-form kernels above. *Proof:* Gaussian characteristic function, product-to-sum
identities, and Stein's lemma $\mathbb E[\varepsilon f(\varepsilon)]=\mathbb E[\nabla f]$ (A.1). ∎

**Corollary.** One pass over clean data, costing $N_p[2d_\text{in}m+2(d_\text{in}+m)^2+2m^2]$ FLOPs, followed by one
$(1+d_\text{in}+m)^3/3$ Cholesky per σ, yields the *exact population least-squares* local denoiser for every noise level of the
sampler, which is what infinitely many SGD epochs with infinitely many noise draws would converge to within this function class. The
population training loss and a held-out loss are also closed form ($\bar{yy}-2\langle W,B\rangle+\langle W,GW\rangle$), and we use the
held-out loss to choose the ridge per σ with no Monte Carlo. **[D]**, numerically verified in `tests/test_core.py` **[E]**.

### 4.6 Architecture summary (512² text-to-image target)

| Component | Form | Size |
|---|---|---|
| Coarse model | DiT-style transformer on 32×32×3 coarse band, patch 2 → 256 tokens; adaLN-single conditioning on σ; cross-attention to text tokens; 50% token masking during training (small unmasked decoder) | width 1024, depth 24, ≈400M params |
| Coarse scaffold | conditional LMMSE (A.3) or MFA, eigen-cached | 3072×3072 + 3072×512 |
| Text encoder | PPMI-SVD embedding init → 6-layer transformer, trained jointly through the coarse loss | ≈25M params, 64 tokens |
| Mid fields | conditional U-Nets on (noisy detail, clean coarser band, pooled text) | 2 × ≈30M params |
| Fine fields | NMCR, m = 8192, d_in ≈ 172 | 2 × (8365×9) weights per σ, 32 σ values |
| RB index | PCA-256 sketch + IVF (16k lists) over coarse thumbnails | 15 GB host RAM (fp16) |

### 4.7 Losses

Coarse: $\mathcal L_C=\mathbb E_{\sigma\sim q}\frac{p(\sigma)}{q(\sigma)}\lambda(\sigma)\|D_\theta(x_\sigma,\sigma,c)-\hat y_\text{RB}\|^2$, with label
dropout of 10% (unconditional branch uses $D_G(\cdot,\sigma,\varnothing)$ and the unconditional posterior). Mid: standard
EDM loss per level. Fine: none. NMCR minimizes the exact noise-integrated squared error in closed form.

### 4.8 Training algorithm

```
INPUT  image–caption corpus (alt text only), J = 4 levels, budgets
# --- Phase 0: one pass, no gradients ------------------------------------------------
for each image x (streamed once):
    (x4, d4, d3, d2, d1) ← orthonormal_haar(x, levels=4)         # x4: 32×32×3
    store x4 (uint8-quantized), and d1..d3 for a 5% subset (fine/mid fields)
    accumulate caption co-occurrences
ψ ← mean of PPMI-SVD(cooc, rank 512) over caption tokens         # closed-form text features
scaffold ← conditional LMMSE(x4, ψ)  [+ optional MFA]             # A.3, eigen-cached
index ← IVF(PCA_256(x4))                                         # for RB targets
for fine level j in {1, 2}:                                      # NMCR, Theorem 3
    S_j, T_j ← accumulate σ-free statistics over N_p patches of (d_j, x_j, ψ)
    for σ in sampler_sigmas_j:  W_j(σ) ← argmin_ridge closed-form-val-loss(Cholesky(K(σ)⊙S_j + λI), κ(σ)⊙T_j)
# --- Phase 1: coarse model (the only large SGD job) ------------------------------------
init F_θ with zero output layer  → D_θ ≡ D_G at step 0
repeat until budget:
    (x4, c, i) ← minibatch;  σ, w ← InfoAllocatedSampler.sample()
    x_σ ← x4 + σ ε
    ŷ ← StratifiedPosterior(x_σ, σ, i, c)  if ESS(σ) > 1.5 else x4      # Pillar R
    ℓ ← λ(σ) ‖D_G(x_σ,σ,c) + c_out F_θ(...) − ŷ‖² ;  loss ← mean(w · ℓ)
    AdamW step (fp16 + dynamic loss scaling; ZeRO-1 across the 2 GPUs);  EMA update
    InfoAllocatedSampler.update(σ, ℓ)                                    # Pillar I
# --- Phase 2: mid fields (can run concurrently on the second GPU) ----------------------
for level j in {3, 2}:  standard EDM on random crops of (d_j | x_j, pooled text)
```

### 4.9 Sampling

Coarse: Heun/EDM with classifier-free guidance on $D_\theta$ (35 NFE). Then, for each finer level, a conditional
reverse diffusion on that level's detail band (mid: learned field, fine: NMCR with $W_j(\sigma)$ at exactly the sampler's
σ grid), followed by an inverse Haar step. Inference at 512² ≈ 7·10¹² FLOPs (coarse) + ≈9·10¹² FLOPs (NMCR fine
levels) + ≈4·10¹² (mid), about 1 s per image on one T4.

---

## 5. Cost model on 2×T4: 512² text-to-image, SD-1.5-class target  [P]

### 5.1 Assumptions

* Data: ≈30M deduplicated image–alt-text pairs from open sets. **No recaptioning by pretrained VLMs, no synthetic
  images from other models, no pretrained encoders of any kind.**
* Throughput: 20 TFLOP/s sustained per T4 on the transformer (31% of fp16 peak; sensitivity at 12 and 30).
* Host: 16 CPU cores, 128 GB RAM, 2 TB NVMe.
* Global-model sample count: **120M** (4 epochs). This is the most uncertain number; the range is 60M–400M. For reference,
  SD-1.x saw ≈3.2 B samples.

### 5.2 FLOPs (everything counted)

| Component | How | FLOPs | 2×T4 days |
|---|---|---|---|
| Decode / resize / Haar for 30M images | CPU | ≈2·10¹⁶ (CPU) | 0 GPU (≈2 h on 16 cores) |
| PPMI-SVD text features | CPU, closed form | ≈10¹⁵ | 0 |
| Coarse scaffold (conditional moments, eigen) | one pass | ≈7·10¹⁷ | 0.2 |
| RB index (PCA projection + IVF assignment) | one pass | ≈3·10¹⁷ | 0.1 |
| **Coarse transformer** 400M × 256 tokens × 120M samples, 50% masking (≈3.5·10¹¹/sample) | SGD | **4.2·10¹⁹** | **12.2** |
| Text encoder 25M × 64 tokens, joint | SGD | 1.2·10¹⁸ | 0.35 |
| RB queries (n_probe = 8, k + s = 288) | per sample | ≈1.3·10¹⁵ | ~0 |
| Mid fields 2 × 30M parameters, 3·10⁷ crops each | SGD | 8.4·10¹⁸ | 2.4 |
| Fine fields NMCR, m = 8192, 2·10⁷ patches per level | closed form | ≈1.1·10¹⁶ | <0.01 |
| In-training evaluation | | ≈5·10¹⁷ | 0.15 |
| Communication and stalls | DDP all-reduce 0.8 GB/step over PCIe (≈0.1 s per 2.2 s step), partly overlapped | +≈7% wall | +1.1 |
| **Total** | | **≈5.4·10¹⁹** | **≈16.5 days** |

Sensitivity: 60M–400M coarse samples and 12–30 TFLOP/s per GPU give **8 to ≈100 days**. The coarse model is ≈80%
of the cost, so the uncertainty lives almost entirely in how many samples it needs.

### 5.3 Memory (per T4, 16 GB)

Coarse model, 400M parameters, ZeRO-1 across both GPUs: fp32 master 1.6 GB + fp16 weights 0.8 + fp16 grads 0.8 +
half of the Adam moments 1.6 = **4.8 GB**. Activations at micro-batch 32 × 128 visible tokens × 24 layers (≈44 B/token/width/layer)
≈ **4.4 GB**. Scaffold 3072² fp16 eigenbasis 19 MB. Workspace ≈1 GB. **≈10.2 GB, fits.** Global batch 256 via accumulation.
Mid fields train on the second GPU in a later phase, or interleaved (≈3 GB each). NMCR Gram matrices: 8365² fp32 = 280 MB,
accumulated on GPU in fp32 and solved in fp64 on the host. RB index: ≈15 GB host RAM.

### 5.4 Wall clock and energy

≈16.5 days at 2 × 70 W GPU + ≈150 W host → **≈115 kWh**. SD-1.x: 150k A100-hours × 250 W ≈ 37.5 MWh for the U-Net alone. The model
card estimates 11,250 kg CO₂-eq. Energy ratio ≈ 300× for the U-Net alone. **[P]**

### 5.5 Where the factor comes from (vs SD-1.x useful FLOPs ≈ 1·10²²)

| Lever | Known? | Projected factor | Status |
|---|---|---|---|
| Fewer samples: 120M curated vs 3.2B | known (data curation; H9) | ≈10× in sample count, partly offset by higher per-sample cost | [P] |
| Expensive model sees 256 tokens, not a 64² latent U-Net at 0.8 TFLOP/forward | pyramid (H5), new combination | ≈4× per sample (2.1·10¹¹ vs 8·10¹¹ fwd) | [P] |
| Token masking 50% | known (H10) | ≈1.8× | [E] literature |
| Text encoder trained jointly at 25M params instead of CLIP-L (3.3·10²¹) | design choice, costs prompt fidelity | ≈3× on the total stack | [P] |
| Scaffold + information allocation + RB (H2, H4, H3) | **new** | 1.2–2× | [E] small scale (§7) |
| Fine scales in closed form (H6) instead of training them inside the big model | **new** | removes ≈30–50% of what a single-resolution model spends on detail | [P] |
| **Product (overlaps discounted)** | | **≈200×** | [P] |

The new mechanisms account for a modest share of the total. The largest single factor is a choice, not an invention: training on 30× fewer, better samples
with a model whose expensive part never sees more than 32×32×3 numbers. The new parts are what make that choice viable from scratch:
closed-form fine scales instead of a trained VAE or super-resolution stack, and closed-form treatment of high noise.

---

## 6. Hard limits: why 1,000–100,000× "with nothing sacrificed" fails

**L1. Statistical floor [D, literature].** Score-based estimators are minimax-optimal at rates like $n^{-s/d}$ for Besov
densities (Oko, Akiyama & Suzuki 2023). The data requirement is set by smoothness and intrinsic dimension, so no
algorithm removes the need for samples. Compute per sample is the only lever.

**L2. Computational hardness [D, literature].** L2-accurate score estimation is cryptographically hard for some
distributions with polynomial sample complexity (Song, NeurIPS 2024, via Gaussian pancakes). **Any large shortcut must exploit
structure specific to natural images.** CRISP's pillars are exactly such assumptions (Gaussianity at high noise,
locality at fine scales). Their validity is empirical, not guaranteed.

**L3. Capacity floor [P].** Knowledge storage in trained networks saturates at ≈2 bits per parameter (Allen-Zhu & Li 2024,
for language models). Matching the semantic breadth of a P-parameter model needs comparable capacity. Training it by any
gradient method costs ≥ 6·P·tokens per sample, and closed-form solves cost more per sample (Theorem 3 is cheap only because
d_in and m are small).

**L4. Overlap, so gains don't multiply [E].** E2 is a direct measurement: RB targets and the scaffold both act on high σ,
so their speed-ups are not independent. Token masking and multiscale both cut tokens. Published gains of 1.5–20× per technique
rarely compound beyond ~100× in total.

**L5. Hardware floor [D].** 32 GB in total → with Adam, at most ≈1–1.5 B trainable parameters at useful speed. A 12 B-parameter model needs
≈192 GB of optimizer and master state. Frontier parity on 2×T4 is impossible regardless of algorithm.

**L6. Data-ingest floor [D].** Decoding 2 B web images once at ≈5k images/s (16 cores) takes ≈4.6 days, so a LAION-scale
corpus is impractical on this host. Hence the 30M curated set.

**L7. Text floor [P].** Without pretrained language models, prompt understanding is limited to what ≈30M alt-texts
(≈4·10⁸ tokens) can teach. CLIP saw 12.8 B pairs and T5 saw ≈10¹² tokens. Compositional prompt following (attribute binding, counting,
spatial relations) will lag SD-1.5 and fall far behind T5- or LLM-conditioned models. **This is the axis that would be "sacrificed" first.**

**What approaches the limits.** In the ledger's terms, CRISP aims to spend SGD compute only on $D(p\|G)$ restricted to
coarse scales and the critical noise window. Everything with closed-form structure is solved in one pass. An ideal
algorithm under L1–L3 would spend compute proportional to *learnable information × cost per bit extracted*. The remaining
inefficiency is the SGD constant on the coarse model, for which no first-principles shortcut was found.

---

## 7. Proof of concept on CPU: results

See `README.md` for commands. Setting: CIFAR-10 32×32, class-conditional (the class label stands in for the prompt). The
pyramid has one level: 16×16 Haar LL as coarse, plus one detail band. Hardware: 4 CPU cores, no GPU, ≈190 GFLOP/s sustained.
**Training budgets are ≤4.5·10¹⁴ FLOPs per system, about 10⁻⁵ of the target scale, so treat every number as a mechanism test.**

RESULTS_PLACEHOLDER

---

## 8. Validation protocol at scale (what would establish or refute the claims)

**Stage A: class-conditional ImageNet 64² and 256² (from scratch, including the pyramid's own levels).**
* Baselines at *identical* data, resolution and FLOPs: EDM2, SiT/DiT with and without MaskDiT masking, and a latent-diffusion
  baseline whose autoencoder is trained from scratch, with its cost counted.
* Budgets: 10¹⁸, 3·10¹⁸, 10¹⁹, 3·10¹⁹ FLOPs. Three seeds each.
* Metrics: FID-50k (Inception; evaluation-only pretrained networks are allowed for *measurement*), FD-DINOv2, precision /
  recall / density / coverage, Inception score, memorization (SSCD copy detection against the train set).
* Ablations: −C, −R, −I, −SP(learned fine fields instead of NMCR), NMCR feature count m ∈ {2k, 8k, 32k}.
* Report FLOPs-to-threshold curves, i.e. compute needed to reach FID ≤ {20, 10, 5}. **Pre-registered success criterion:** CRISP reaches
  the baseline's FID at ≤ ⅓ of its FLOPs at every budget ≥ 10¹⁹. Falsified if the ratio is > ½ at two of four budgets.

**Stage B: text-to-image 256² → 512² on 2×T4.**
* Data: the same ≈30M alt-text pairs for every system. All text encoders trained from scratch and their cost counted.
* Baselines: the micro-budget recipe (deferred masking) and a PixArt-style DiT, both re-trained from scratch with from-scratch
  text encoders, at matched FLOPs.
* Metrics: COCO-30k FID, CLIP-score and GenEval (evaluation-only), human pairwise preference (n ≥ 1,000 pairs), diversity
  (LPIPS-free: pairwise feature distance under DINOv2), resolution fidelity (FID at 512² vs 256² upsampled).
* Compute: FLOPs logged by an op-level counter, energy from `nvidia-smi --query-gpu=power.draw` at 1 Hz, wall clock
  including data loading, preprocessing, index builds and evaluation.
* Statistics: bootstrap 95% CIs over samples, seeds as blocks. A result counts only if the CIs separate.

**Per-pillar falsifiers.** C: the gap at σ ≥ 10 exceeds 2% of lmmse on ImageNet-256 coarse bands. R / I: the info-allocated
sampler does not reduce FLOPs-to-threshold by ≥ 10%. SP: NMCR fine fields lose more than 1 FID point to learned fine fields at
equal *total* FLOPs. Pyramid: the coarse-only model's FID-at-32² does not predict final FID (rank correlation < 0.8 across runs).

---

## 9. Relation to prior work

| Piece | Closest prior work | What is different here |
|---|---|---|
| Gaussian scaffold | Wang & Vastola 2023, 2024 (Gaussian score dominates at high noise; used to skip sampling steps) | used as the *training-time* skip path; class/prompt-conditional; tied to the information ledger |
| Theorem 1 | I-MMSE (Guo, Shamai & Verdú 2005); information-theoretic diffusion (Kong et al. 2023) | used as a compute ledger: learnable-information density per noise level |
| RB targets | Stable Target Field (Xu, Tong & Jaakkola 2023) | stratified full-dataset estimator; Prop. 2 shows *where* it can and cannot help (one-hot regime) |
| Info-allocated σ | importance sampling of t in iDDPM; adaptive weighting in EDM2 | argument that loss-based allocation becomes informative only with RB + scaffold targets |
| Scale pyramid with local fields | Kadkhodaie et al. 2023; Guth et al. 2022 (WSGM) | fine fields fitted in closed form; compute accounting for from-scratch T2I |
| NMCR (Theorem 3) | random features (Rahimi & Recht 2007); ELS machine (Kamb & Ganguli 2024/25) | σ-independent sufficient statistics: exact noise-integrated training at all σ in one pass; a parametric, amortized counterpart of the patch-posterior (ELS) view |
| Cheap from-scratch training | micro-budget (Sehwag et al. 2024/25), PixArt-α, Würstchen, DC-AE | no pretrained text encoder, VAE or synthetic data; everything counted |

---

## 10. Claims ledger

| Claim | Tag |
|---|---|
| Loss decomposition and gap = E‖D*−D_G‖² | [D] |
| Theorem 1 (negentropy = ½∫ gap ds) | [D] |
| Prop. 2(a): RB leaves the expected gradient unchanged | [D] |
| Prop. 2(b): RB targets equal standard targets for σ ≲ 2 on CIFAR pixels | [E] |
| Theorem 3 (NMCR closed form) and agreement with Monte Carlo | [D] + [E] |
| Scaffold ≈ optimal at σ ≥ 10 on CIFAR; 5× better than EDM's skip at σ = 1 | [E] |
| FLOP-matched results of §7 | [E] (small scale) |
| ≈5.4·10¹⁹ FLOPs and ≈16.5 days on 2×T4 for an SD-1.5-class model | [P] |
| ≈200× (useful-FLOP) / ≈1,400× (wall-clock) vs SD-1.x | [P] |
| Frontier parity at 100,000× less compute on 2×T4 | ruled out (L5 [D], L3/L7 [P]) |
| Scale recursion, MFA scaffold, H3′ local-posterior targets | [S] |

---

## Appendix A: proofs

**A.1 Theorem 3.** For $\varepsilon\sim\mathcal N(0,I)$ and a fixed vector $u$: $\mathbb E[e^{i\sigma u\cdot\varepsilon}]=e^{-\sigma^2\|u\|^2/2}$, so
$\mathbb E[\cos(A+\sigma u\cdot\varepsilon)]=e^{-\sigma^2\|u\|^2/2}\cos A$. Product to sum:
$\cos(A_k+\sigma u_k\cdot\varepsilon)\cos(A_l+\sigma u_l\cdot\varepsilon)=\tfrac12[\cos(A_k-A_l+\sigma(u_k-u_l)\cdot\varepsilon)+\cos(A_k+A_l+\sigma(u_k+u_l)\cdot\varepsilon)]$.
Take expectations and expand $\cos(A_k\mp A_l)=C_kC_l\pm S_kS_l$. With the $\sqrt{2/m}$ normalization this gives the stated $\mathbb E[\phi_k\phi_l]$. For the
linear–cosine block, Stein's lemma gives $\mathbb E[\varepsilon\cos(A+\sigma u\cdot\varepsilon)]=-\sigma u\,e^{-\sigma^2\|u\|^2/2}\sin A$, so
$\mathbb E[(z_0+\sigma M\varepsilon)\cos(\cdot)]=e_k(z_0C_k-\sigma^2Mu_kS_k)$. The linear–linear block follows from $\mathbb E[\varepsilon]=0$,
$\mathbb E[\varepsilon\varepsilon^\top]=I$. The targets $y$ are noise-free, so $\mathbb E[\phi y^\top]=\mathbb E[\phi]y^\top$. Averaging over the data distribution of
$(z_0,y)$ commutes with these noise expectations. Every data-dependent factor ($z_0z_0^\top$, $z_0C^\top$, $CC^\top$, $SS^\top$, $Cy^\top$, $z_0y^\top$,
means) is free of σ. ∎ Numerical check: `tests/test_core.py::test_nmcr_closed_form_matches_monte_carlo` (relative error
5·10⁻⁵–3·10⁻³ at 1.2·10⁷ Monte Carlo draws, consistent with Monte Carlo error).

**A.2 Proposition 2(a).** $\|D-x_0\|^2=\|D-\hat y\|^2+2(D-\hat y)\cdot(\hat y-x_0)+\|\hat y-x_0\|^2$. Conditional on $x_\sigma$, $D$ and $\hat y$ are
fixed and $\mathbb E[\hat y-x_0\mid x_\sigma]=0$, so the cross term vanishes in conditional expectation, as does its θ-gradient
$2J^\top(\hat y-x_0)$. The variance difference is $\mathbb E\|2J^\top(\hat y-x_0)\|^2\ge0$. ∎

**A.3 Conditional LMMSE.** Let $Z=(x_\sigma,\psi)$ and let $x_0,\psi$ have joint second moments. The LMMSE of $x_0$ from $Z$ is
$\mu+C_{x_0Z}C_{ZZ}^{-1}(Z-\mu_Z)$. Block inversion with the Schur complement of $C_{\psi\psi}$ gives
$\mu(c)+\Sigma_{x|c}(\Sigma_{x|c}+\sigma^2I)^{-1}(x_\sigma-\mu(c))$ with $\mu(c)=\mu+\Sigma_{x\psi}\Sigma_{\psi\psi}^{-1}(\psi-\mu_\psi)$ and
$\Sigma_{x|c}=\Sigma_{xx}-\Sigma_{x\psi}\Sigma_{\psi\psi}^{-1}\Sigma_{\psi x}$. ∎

**A.4 Variance-optimal σ proposal.** Minimize $\mathbb E_q[(p/q)^2\|g_\sigma\|^2]$ over densities $q$. A Lagrange multiplier gives
$q^*\propto p\,\sqrt{\mathbb E\|g_\sigma\|^2}$. With $\|g\|^2\propto\ell^2$ this is the rule of §4.4. ∎

## Appendix B: references

Abbas et al. 2023 (SemDeDup) · Allen-Zhu & Li 2024 (Physics of LMs 3.3) · Bartunov et al. 2018 · Chen et al. 2024/25
(DC-AE, ICLR 2025: f64 gives 17.9× training throughput on UViT-H) · Guo, Shamai & Verdú 2005 (I-MMSE) · Guth, Coste, De Bortoli &
Mallat 2022 (Wavelet score-based generative modeling) · Kadkhodaie, Guth, Mallat & Simoncelli 2023 (multi-scale local
conditional models) · Kamb & Ganguli 2024/25 (analytic theory of creativity; ELS machine, ICML 2025) · Karras et al. 2022 (EDM)
· Kong et al. 2023 (information-theoretic diffusion) · Levy & Goldberg 2014 · Nichol & Dhariwal 2021 (iDDPM) · Oko, Akiyama &
Suzuki 2023 (minimax optimality of diffusion) · Rahimi & Recht 2007 · Richardson & Weiss 2018 (GANs and GMMs) · Sehwag et al.
2024/25 (micro-budget, CVPR 2025) · Song 2024 (cryptographic hardness of score estimation, NeurIPS) · Torralba, Fergus & Freeman
2008 (80M tiny images) · Vaswani, Bach & Schmidt 2019 (strong growth) · Wang & Vastola 2023/2024 (hidden linear structure;
Gaussian score approximation) · Xu, Tong & Jaakkola 2023 (Stable Target Field) · Yu et al. 2025 (REPA, ICLR 2025) · Zheng et
al. 2023 (MaskDiT).
