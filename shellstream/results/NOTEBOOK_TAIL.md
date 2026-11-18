## 6. What's proven here, what isn't, and where to go next

**Measured in the development run** (no GPU there: CPU build of the same kernel, headless Chromium with
software WebGL, emulated networks):

* look latency stays at one client frame for every RTT tested, while classic streaming grows with RTT plus
  server and decode time;
* through a 1-second network stall the view keeps following the mouse with zero lag;
* image quality after rotations and translations, against a 16-sample ground truth, with ablations;
* bytes per layer, depth-codec alternatives, and H.264 headroom (x264 standing in for the T4's NVENC);
* the CUDA source compiles for sm_75 with no spills; T4 time is *modelled* from SASS size and measured SDF
  evaluation counts.

**Measured only when you run section 3 on the T4s:** the real per-pass and end-to-end GPU timings,
nvJPEG encode times, and the split-frame balance across the two GPUs.

**Known limitations:**

* **Translation quality is still far from a local render.** Mirror reflections in the wet floor are
  re-projected as if painted onto surfaces. The reflection ablation in the report attributes much of the gap
  for small moves to them, but the rest of the gap for larger moves is not yet explained. The designed fix
  for reflections is a separate layer warped by its *virtual* (mirror-image) depth and depth-tested with
  the surface depth.
* **Server-side dynamic objects** appear at their shell-time position. The PoC puts every
  latency-critical dynamic object on the client, which is the intended split, but a game with many
  physics-driven objects needs per-object motion vectors in the shell.
* **Bandwidth.** Intra-only JPEG keeps decoding trivial and loss-tolerant but costs about 4x a video codec. The
  focus layer compresses with H.264 as well as classic frames do, and both T4s have NVENC.
* **Multiplayer** needs server-authoritative state with client prediction and reconciliation (standard
  netcode) on top of this rendering split.

**Next steps:** NVENC H.264/HEVC for the colour layers (fixed focus size, breathing field of view);
the virtual-depth reflection layer; WebTransport datagrams instead of a WebSocket; a WebGPU client;
gaze- or saliency-driven pixel budgets; a learned pose predictor trained on the player's own input traces.
