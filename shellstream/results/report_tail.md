## 5. Iterations: what the measurements changed

The design above is the fourth iteration. Every change below was triggered by a measurement, not by taste.

| # | Observation | Diagnosis | Change | Effect |
|---|---|---|---|---|
| 1 | Localhost RTT showed 400-2500 ms while the CPU renderer ran | OpenMP worker threads spin-wait between kernels and starve the event loop; headless software WebGL competes for the same 4 cores | `OMP_WAIT_POLICY=PASSIVE`, capped threads in experiments | RTT back to ~1 ms with the client paused; remaining inflation attributed to the software client and documented |
| 2 | The server kept re-rendering an unchanged pose | Idle refresh (0.5 s) shorter than a CPU build (2.3 s) | Never re-render an unchanged state unless content animates | Standing still now costs zero GPU time and zero bytes |
| 3 | Zero-motion PSNR was capped near 26 dB for *every* method | 1-sample-per-pixel rendering is heavily aliased (a 1-spp local render scores 27.7 dB vs. a supersampled one), and resampling aliased content can't match an aliased reference | Rotated-grid supersampling in the kernel (2 spp default for the focus layer); 16-spp reference; "local PC" baselines | Honest yardstick: every number is now relative to what a local PC with the same renderer would show |
| 4 | The topology-aware warp lost 1.5-2 dB to the naive warp *at zero motion* | Torn triangles were dropped even when no gap had opened, eroding every silhouette by one texel and filling it from coarser layers | **Motion-adaptive tearing**: keep a torn triangle while its screen size is within 1.5 px of its rotation-only footprint | Zero-motion quality equals the naive warp; disocclusion handling kept |
| 5 | Holes filled with dark smears | Fallback triangles interpolated occluder colours into the hole; the disocclusion band (0.3 m) was narrower than realistic unpredicted motion | Fallback holes take the farthest corner's depth *and* colour; band >= 0.5 m, growing with speed x look-ahead | +1.5-2 dB at 0.25-0.5 m strafes (v2 -> v3) |
| 6 | Coarse omni triangles poked through sharp layers at silhouettes; random speckle after pure rotation | Rubber-sheet omni triangles at intermediate depth; exact depth ties at infinity resolved per pixel | Fallback edge triangles always at background depth; a smaller far-plane epsilon for the fallback layer | Removes silhouette contamination and tie noise |
| 7 | Dark speckles along silhouettes in the background band | Unused band texels were black, and JPEG's 8x8 / 16x16 blocks bled black into valid band texels | `ss_fill`: unused texels get the mean of nearby valid colours (fog colour if none) before encoding | Speckles gone (final run) |
| 8 | The second-order depth predictor lost to PNG-16 | Rounding noise in second differences; distant surfaces dominate | Predictor bake-off -> JPEG-LS MED + byte planes + deflate-6 | Depth 30-45 % smaller than v1 and smaller than PNG-16 |
| 9 | The latency probe reported 0.3 ms for ShellStream | WebGL calls are asynchronous: the timestamp marked command submission, not completion | Time to a forced one-row `readPixels` after every frame (GPU completion) | Latency now includes the GPU work of the frame |
| 10 | ptxas showed an 80-byte stack frame after adding supersampling | Constant lookup tables (sub-pixel offsets, band-search radii) placed in local memory | Computed arithmetically | 107 registers, 0 stack, 0 spills on sm_75 |
| 11 | The fallback layer still leaked coarse silhouettes | Its foreground geometry is sometimes legitimately nearer than the focus layer's background | Stencil priority: focus + band mark pixels, the fallback fills only the rest | Leak fixed, but see row 13 |
| 12 | With every other cause removed, ShellStream still lost 1.5 dB to the *stale frame at zero motion*; the focus layer alone differed from the identical stale draw | The GPU interpolates texture coordinates perspective-correctly *in the target view*; shell texels are a grid in the *source* view, so rubber-sheet triangles spanning a 2 m / 50 m depth ratio sampled almost only their near corner | Interpolate `(uv x z_src, z_src)` and divide per fragment: the exact source-affine mapping | Zero-motion output identical to the stale frame (mean abs. difference 0.00-0.02 / 255); texture mapping exact under motion too |
| 13 | A 0.5 m jump in the plaza scene lost 4.3 dB after row 11; the other scenes were unchanged | Giving the *band* stencil priority over the fallback was wrong: next to a grazing wall the band holds "what's behind", while the omni cube correctly holds the wall itself, which is nearer | Only the focus layer outranks the fallback by stencil. Inside its holes, band and fallback compete by depth | Regression gone (14.6 -> 18.7 dB at debug scale); zero-motion exactness kept |

## 6. Kaggle: what this uses, and what is permitted

* **Hardware target:** Kaggle's "GPU T4 x2" accelerator: two NVIDIA T4s (Turing, sm_75, 16 GB, 70 W, one
  NVENC each), a few CPU cores, Python with PyTorch/torchvision.
* **Dependencies:** CuPy (NVRTC kernel compilation; installed by the notebook if missing), Tornado (ships
  with Jupyter), torchvision nvJPEG for GPU JPEG with automatic CPU fallback, and NumPy, Pillow and
  matplotlib (preinstalled).
* **Policy.** I couldn't load kaggle.com from the development sandbox, so the following comes from
  secondary sources quoting Kaggle's Terms of Use and Acceptable Use Policy: use is limited to *"internal,
  personal, non-commercial use, and not on behalf of or for the benefit of any third party"*;
  *"server farming"* and *"activity unrelated to ML data science"* are listed as abuse; and Kaggle has
  blocked SSH tunnelling into kernels in the past. The notebook therefore:
  * runs as a **self-contained benchmark by default** (no network exposure; only the user's own session);
  * makes interactive play **opt-in** behind two flags, binds the server to `127.0.0.1`, and explains that
    reaching it from a browser needs a public tunnel that may conflict with the terms, so it's for the
    account holder's own short sessions at most, never shared;
  * keeps the code **portable**: the same `server.py` runs unchanged on any CUDA machine with T4s, which is
    where a real deployment belongs.
* Please read [kaggle.com/terms](https://www.kaggle.com/terms) yourself before enabling section 5 of the notebook.

## 7. Limitations (stated plainly)

1. **No T4 timings were measured in this session.** The development container has no GPU. GPU numbers in
   this report are a model (SASS size x measured SDF-evaluation counts x a stated throughput range). The
   notebook's section 3 measures them for real on Kaggle's T4s.
2. **Client timings come from software WebGL.** Headless Chromium used SwiftShader on 4 shared CPU cores.
   Absolute frame times (about 57 ms) are far slower than any real GPU. The *structure* of the latency
   result (flat vs. growing with RTT) doesn't depend on that, but absolute numbers do. On a real GPU the
   ShellStream look latency is one refresh interval plus compositor latency, the same as a local game.
3. **View-dependent shading is warped as if diffuse, and translation quality is far from local.** Mirror
   reflections and highlights move with the surface instead of with their virtual image. The reflection
   ablation (section 4.4) attributes 4.6 dB of the 0.1 m gap and 1.3-3.1 dB of the 0.5 m gaps to the mirror
   term. The rest of the translation gap is not explained by these experiments. A virtual-depth reflection
   layer is designed but not implemented.
4. **Residual silhouette speckle.** Faint single-pixel dark specks remain along some silhouettes under
   translation (visible in the gallery). They come from the boundary between culled focus triangles and the
   band/fallback coverage. Not yet diagnosed.
5. **Classic-mode latency in the experiment includes a slow CPU server.** The comparison of shapes is
   valid; the T4-adjusted classic latency is an estimate.
6. **Single-player.** Client-authoritative play is the right split for single-player. Multiplayer needs
   standard netcode (server authority, client prediction, reconciliation) layered on top.
7. **The renderer is a stand-in.** A sphere-traced SDF city with soft shadows, AO, reflections and 24
   lights is heavy enough to make the point. A production renderer (a rasterizer or path tracer of mesh
   scenes) would expose the same interface: views in, colour + depth + normals out.

## 8. Related work, and what is new here

Individual ingredients have a long history: post-rendering 3D warping (Mark, McMillan and Bishop 1997);
layered depth images (Shade et al. 1998); VR asynchronous timewarp/spacewarp; client-side prediction in
networked games; speculative execution for cloud gaming that renders likely futures and repairs
mispredictions by image-based rendering (Outatime, Lee et al. 2015); collaborative rendering with a weak
local renderer (Kahawai, Cuervo et al. 2015); shading-atlas streaming of object-space shading (Mueller et
al. 2018); split VR rendering with panoramic backgrounds (Furion, Lai et al. 2017).

To my knowledge, the following specific elements, and their combination into one browser-delivered
system for Kaggle-class GPUs, are new:

1. **Exact, server-computed topology bits** (from SDF hit positions and normals) transmitted with the depth,
   so the client tears its mesh exactly at occlusion boundaries, never at grazing planes or creases.
2. **Motion-adaptive tearing**: a torn triangle stays a rubber sheet until its on-screen footprint exceeds
   its rotation-only footprint by 1.5 px. This gives exact silhouettes at rest and correct disocclusion in
   motion.
3. **A motion-predicted disocclusion band**: a second-surface layer traced only within
   `f x delta x (1/z_fg - 1/z_bg)` of edges, with `delta` set from the predicted motion uncertainty.
4. **A latency-adaptive guard band inside a fixed pixel budget** (*resolution follows stability*).
5. **A latency-tolerant light channel**: client-owned dynamic objects are drawn locally, while their light is
   rendered remotely into the world.
6. **A streamed SDF collision brick** that makes client-authoritative movement possible without the client
   holding the world's geometry.
7. **One kernel source, two targets**: the CPU build is fallback, test oracle and cost-model
   instrumentation at once.

## 9. How to run

* **Kaggle:** upload `ShellStream.ipynb`, choose *Accelerator: GPU T4 x2* (and internet on, if CuPy needs
  installing), *Run all*. Sections 1-4 run unattended. Section 5 is opt-in (see section 6).
* **Any CUDA machine with T4s:** `pip install cupy-cuda12x tornado simplejpeg`, then
  `python shellstream/server.py --address 0.0.0.0` and open `http://<host>:8765`.
* **CPU only (laptop demo):** `python shellstream/server.py --cpu --budget 150000 --omni 128 --quality medium`.
* **Reproduce the experiments:** `cd shellstream/bench && ./run_all.sh` (needs Playwright + Chromium,
  scikit-image, matplotlib).

## 10. Next steps

1. NVENC H.264/HEVC for the colour layers. The focus layer compresses about 4x better with inter-frame
   coding, as well as classic frames do. Keep the focus pixel size fixed and let its field of view breathe.
2. A virtual-depth reflection layer (section 7, item 3).
3. WebTransport (QUIC datagrams) in place of the WebSocket. Shells are already loss-tolerant.
4. A WebGPU client with a compute-shader warp for low-end GPUs.
5. A learned pose predictor trained online on the player's own input traces, so the shell centre and band
   track intent (strafe reversals, jump timing) instead of constant velocity.
