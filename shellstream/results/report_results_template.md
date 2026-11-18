## 4. Experiments and results

### 4.1 Setup, and what was and wasn't measured

The development container has **no GPU**, 4 CPU cores and no access to Kaggle. Everything below was
therefore run with:

* **Server:** the CPU build of the *same* `kernel.cu`, driven by the same `engine.py` / `server.py` that
  run on the T4s.
* **Client:** the real browser client in headless Chromium. WebGL2 runs on SwiftShader, a software GPU
  sharing the 4 CPU cores with the server.
* **Network:** emulated inside the server (one-way delays, jitter, a downlink stall switch). Everything
  else is a real WebSocket on localhost.

Image quality, bytes, codec results and the ptxas report are hardware-independent. Latency *shapes* are
hardware-independent; absolute latencies are inflated by the software client (about 57 ms per frame instead
of 7-17 ms on a real GPU) and, for classic mode, by the slow CPU server. **T4 timings are modelled, not
measured**; the notebook measures them on Kaggle.

### 4.2 Look latency vs. network round trip

A 7-degree mouse-look step is injected; latency runs until the GPU has finished the first frame whose
pixels reflect it (one-row `readPixels` after every frame). 12 trials per point.

![latency](shellstream/results/fig_latency.png)

{{LATENCY}}

**ShellStream's look latency is flat: one client frame at every RTT from 0 to 200 ms.** Classic streaming
grows with RTT (slope ≈ {{SLOPE}}) on top of server time, decode and frame waits. With a real GPU client
the ShellStream number becomes one display refresh (16.7 ms at 60 Hz, 6.9 ms at 144 Hz). That is the
same as a game running locally, which also needs one frame to show an input.

### 4.3 Through a network stall

The camera turns continuously at 1 rad/s; the downlink is frozen for 1 s.

{{STALL}}

The ShellStream view follows the mouse exactly, before, during and after the stall: the client keeps
re-projecting the last shell, and only freshness of lighting suffers. Classic streaming already trails the
input by about 21 degrees while turning (its round trip at 1 rad/s), and the stall adds a full second of
frozen view.

### 4.4 Image quality under motion

A shell is rendered at pose P0 and frozen. The client then renders from displaced poses, and each image
is compared with a **16-sample anti-aliased ground truth** at exactly that pose. Three scenes (plaza,
pillars, street); 640x400 client, 90-degree FOV; server at 2 spp, budget 0.6 MP. "Local PC" columns show
what a local machine running the same renderer would display, the ceiling for any streaming method.

![quality](shellstream/results/fig_quality.png)

**PSNR (dB), mean of 3 scenes** (best streaming method in bold):

{{QUALITY}}

<details><summary>SSIM</summary>

{{SSIM}}

</details>

![gallery](shellstream/results/fig_gallery.png)

Reading the table:

* **Rotation is solved.** Within the guard band (up to 30 degrees here), ShellStream stays within
  {{ROTGAP}} dB of its zero-motion value and matches a local 1-spp render ({{ROT_VS_LOCAL1}}). At 60
  degrees part of the view comes from the coarser omni cube until the next shell arrives
  ({{YAW60}} dB): softer, but never a hole. The classic stale frame collapses to 12-13 dB because it shows
  the wrong view until the next frame arrives.
* **Translation is where the layers earn their keep.** For a 0.5 m strafe (about 90 ms of sprinting),
  ShellStream reaches {{S05}} dB vs. {{C05}} dB for the classic stale frame and {{N05}} dB for a naive
  depth warp. Removing the background band costs {{BAND05}} dB.
* **At rest it is exact.** With source-affine texture mapping, every method reproduces the server frame
  bit-for-bit at zero motion. The remaining {{ZEROGAP}} dB to a local 2-spp render is JPEG plus bicubic
  resampling.

**Where the layers matter: inside disocclusions.** Whole-frame PSNR is dominated by errors every method
shares. `bench/disocc.py` finds the pixels whose surface was *hidden* from the shell's viewpoint
(ground-truth geometry, shadow-map test against a wide depth map at P0) and scores only those:

{{DISOCC}}

Inside newly revealed regions, the background band is decisive. It shows the actual hidden surface
instead of a smear (naive warp), a stale frame, or a background-coloured fill (no band).

**Why the translation gap to "local" is still large: view-dependent shading.** This city is wet and neon:
much of every frame is mirror reflection, which depth re-projection moves with the *surface* instead of
with the *mirror image*. Turning reflections off in both the server and the reference isolates the effect:

{{ABLATION}}

Mirror reflections explain most of the gap for *small* displacements ({{ABL_01}} dB of {{GAP_01}} dB at a
0.1 m strafe) and a smaller share for larger ones ({{ABL_GAIN}} dB at 0.5 m, {{ABL_FWD}} dB for 0.5 m
forward). They are the target of the designed virtual-depth reflection layer (section 10). The residual
that remains with reflections off is **not explained by these experiments**. Likely contributors, all
untested: the other view-dependent terms the ablation keeps (volumetric neon glow, specular
highlights), disocclusions wider than the band, and PSNR's sensitivity to sub-pixel misregistration of
high-contrast window textures.

### 4.5 Bandwidth and coding

Per-layer bytes for a 1920x1080 / 90-degree client (focus budget 1.0 MP, 2 spp, JPEG q85 colour):

![bytes and cost](shellstream/results/fig_cost.png)

{{BANDWIDTH}}

Depth codec bake-off on real focus-geometry buffers:

{{CODEC}}

Inter-frame coding headroom (x264 standing in for the T4's NVENC):

{{VIDEO}}

* A shell costs about {{SHELL_VS_CLASSIC}}x a classic JPEG frame of the same view, because it carries the
  guard band, the background band, depth, topology and a 360-degree fallback. In return it stays usable for
  a whole RTT, so it can be sent **less often**. The client renders at display rate whatever the shell rate,
  and a player standing still costs **zero** bytes (event-driven updates).
* With inter-frame coding of the colour layers, the measured 4x factor brings a 30 shells/s stream from
  about {{MBPS}} Mbit/s to about {{MBPS_H264}} Mbit/s.

### 4.6 Server cost on the T4s (modelled) and the CUDA build

{{COST}}

A complete shell is modelled at **{{SHELL1}} ms on one T4 and {{SHELL2}} ms on two**, with the focus split
re-balanced every frame. That leaves headroom for 30-60 shells/s, plus nvJPEG encode (about 1-2 ms per
layer) and host-side deflate (about 10 ms, in parallel threads). A classic 1080p frame of the same scene at
the same anti-aliasing models at {{CLASSIC_MS}} ms, so a shell costs *less* GPU time than a frame. This is a
trade-off, not a free lunch: the 1.0 MP focus budget spreads over the guard-banded field of view, so
angular resolution in the centre of the view is about 0.6x that of native 1080p. Two T4s afford a 2 MP
budget (about 0.85x) within the time of one classic frame. The notebook's section 3 replaces every number
in this table with a measurement.
