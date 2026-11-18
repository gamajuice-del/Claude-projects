# ShellStream: Latency-Inverted Cloud Rendering on Kaggle T4 x2

*Technical report for the ShellStream proof of concept. The notebook is [`ShellStream.ipynb`](ShellStream.ipynb); the sources are in [`shellstream/`](shellstream/).*

![ShellStream in the browser](shellstream/results/hero.png)

*The real browser client showing a cloud-rendered shell (CPU build of the T4 kernel in this run). The
glowing orbs are game objects owned and drawn by the browser; the coloured light they cast on the wet
floor is rendered by the server from the light list the client sends.*

---

## Summary

Classic cloud gaming streams **frames**. Every input (a mouse flick, a step) has to travel to the
data centre, be simulated, rendered, encoded, sent back, decoded and displayed before the player sees
it. Responsiveness is therefore bounded below by the network round trip, and no amount of GPU
power changes that.

ShellStream removes the round trip from the interaction path. The cloud GPUs don't render the player's
frame. They render a **shell**: a set of views around the player's predicted position that carries
colour, exact 16-bit inverse depth, and a per-texel **topology map** marking real occlusion edges. Each
shell has a high-resolution, adaptively widened focus layer, a **background band** that holds the
surfaces hidden behind occluders (traced only where predicted motion can reveal them), a 360-degree
fallback cube, and a small signed-distance **collision brick**. The browser owns the camera, the game
logic and the final image. At every display refresh it re-projects the newest shell from the camera
pose sampled at that instant, using a mesh that tears exactly at the server-marked occlusion edges and
only once motion has actually opened a gap.

**Pass 2** extends this in two directions. **Any game:** a game host streams *unmodified* games (tested
with the open-source game Minetest). It injects your input, encodes with NVENC, and learns online how the
image moves per mouse count and which pixels are HUD. The browser then predicts mouse-look locally for a
game it knows nothing about (section 11, which also covers Roblox). **Both T4s fully:** each T4 now renders
a complete shell from its own viewpoint, the browser composites them, and GPU stages overlap host stages,
with a load governor, idle refinement and NVENC (section 12). **Pass 3** makes Roblox playable online:
the official client on a Windows machine with two T4s, with full desktop control, game audio, 60 fps, HTTPS
and an access token, set up by one script (section 13).

Looking, moving, jumping and picking things up therefore have the *latency* of a local PC: about one
display frame. Network RTT, jitter and even multi-second stalls only affect how *fresh* the lighting
and distant content are. Human perception tolerates that far better than lag between hand and eye. *Image
quality* is a separate question: rotations reproduce a local render, but translations still fall well
short of one (section 4.4).

RESULTS_SUMMARY_PLACEHOLDER

---

## 1. First principles: where cloud-gaming latency comes from, and what can actually move

A classic cloud-gaming input travels this chain (typical ranges for a good consumer connection):

| Stage | Typical time |
|---|---|
| input sampled, sent with the next packet | 1-8 ms |
| uplink, one way | 10-50 ms |
| server simulation and render | 8-16 ms |
| hardware encode | 3-10 ms |
| downlink one way + serialisation of the frame | 10-60 ms |
| browser decode | 2-10 ms |
| display: wait for vsync + scan-out | 8-25 ms |
| **input to photon** | **~50-150 ms** |

A local gaming PC sits at roughly 20-40 ms for the same chain without the network. The difference is
dominated by the **round trip**, which is bounded by the speed of light in fibre (about 1 ms of RTT per
100 km in practice) and by the routing between the player and the data centre. A faster GPU removes
none of it.

So the useful question isn't "how do we make the pipeline faster?" but **"which parts of what the
player sees actually need the network on the critical path?"** Splitting a game's output by how
latency-sensitive it is and how expensive it is to compute gives:

| Information | Changes within one RTT | Latency sensitivity | Compute cost | Where it belongs |
|---|---|---|---|---|
| camera orientation (mouse look) | a lot | extreme: the hand-eye loop | trivial (a matrix) | **client** |
| camera position (movement, jumps) | moderately | high | trivial, but needs collision | **client** (with streamed collision data) |
| own actions, local effects, HUD | instantly | high | cheap | **client** |
| world appearance: shading, lighting, reflections, detail | slowly | low (lag is perceived as "lighting delay", not input lag) | **very expensive** | **cloud GPUs** |
| other dynamic objects | depends | medium | cheap to draw, expensive to light | geometry on the client, **light from the cloud** |

The conclusion is a design principle, which I'll call **latency inversion**: *put the network round
trip on the paths that change slowly and cost a lot, and take it off every path a human closes a loop
through.* The server must then produce something that stays valid while the client's camera keeps moving
for one RTT or more. That means a *representation* with depth, coverage beyond the current frustum, and
knowledge of what is hidden, rather than a frame.

---

## 2. Architecture

```
  Kaggle T4 #0 ────────────┐                        Browser (any WebGL2 GPU)
    focus colour, top half │                         every display refresh (60-240 Hz):
                           │   ┌─────────────────┐     1. sample mouse/keys (late-latched)
  Kaggle T4 #1 ────────────┼──▶│  shell message  │─WS─▶ 2. step physics vs. streamed SDF brick
    focus colour, bottom   │   │ JPEG colour     │     3. re-project newest shell with *current* camera:
    focus geometry + topo  │   │ 16-bit inv. z   │        omni cube -> background band -> focus layer
    background band (LDI)  │   │ topology bits   │     4. draw local objects (orbs) with depth test
    omni cube, 6 faces     │   │ SDF brick       │     5. send pose, velocity, angular rate, light list
    collision brick ───────┘   └─────────────────┘                     │
                    ▲ predicted pose, guard band, light list ◀─────────┘
```

### 2.1 The shell

| Layer | Content | Default size (1080p client) |
|---|---|---|
| focus colour | perspective view centred on the *predicted* view direction, field of view widened by an adaptive guard band, 2 samples/pixel rotated-grid AA, JPEG | 1.0 MP budget |
| focus geometry | 16-bit inverse view-z per 2x2 block + 3 topology bits | 1/4 of the colour |
| background band | second surface (what's behind the occluder) for texels within the predicted disocclusion distance of an edge; first surface for background texels next to edges; nothing elsewhere | 1/4 of the colour, mostly empty |
| omni cube | 6 x 256^2 colour + geometry + topology at the same centre | fallback for any direction |
| collision brick | 48 x 18 x 48 signed distances at 0.25 m, int8 centimetres | 12 x 4.5 x 12 m around the player |

### 2.2 Server: planning a shell

Given the client's last reported state (position, velocity, yaw/pitch, angular rates, field of view,
display size, measured RTT), the server:

1. **Predicts** the pose at the middle of the shell's useful life: look-ahead
   `L = RTT/2 + pipeline + 0.5 x shell interval`, position `p + v L`, orientation extrapolated with 80 %
   of the angular rate.
2. **Sizes the guard band**: `margin = 7 deg + |extrapolated rotation| + 0.5 x |angular rate| x L`.
   Field of view = client FOV + 2 x margin, inside a **fixed pixel budget**. Standing still, pixels
   concentrate in the view; during a fast turn the band widens and angular resolution drops. That's
   when motion blur and saccadic suppression hide it (*resolution follows stability*).
3. **Sizes the disocclusion band** `delta = 0.5 m + 0.6 x speed x L`, the unpredicted translation the
   shell must survive (direction changes, jumps).
4. **Schedules the work on both T4s** (section 2.6) and encodes.

### 2.3 Exact topology: telling the client where the world really tears

A depth map alone can't say whether two neighbouring texels lie on the same surface. A floor seen at a
grazing angle jumps in depth between rows just like a real occlusion edge, while a box corner (a crease)
has continuous depth but a discontinuous normal. Client-side heuristics get one of the two wrong. The
server *knows* the geometry, so the GPU computes, for every texel and its right, lower and anti-diagonal
neighbours, whether they belong to one surface:

```
connected(a, b) =  |p_b - p_a| < 2.5 x pixel footprint                    (creases, tiny steps)
                or max(|n_a . (p_b - p_a)|, |n_b . (p_b - p_a)|) < 0.2 |p_b - p_a|   (same local plane)
```

`p` are exact hit positions and `n` exact SDF normals. Requiring *both* normals to agree rejects
silhouettes, where the occluder's normal is perpendicular to the view ray and would otherwise pass. Three
bits per texel compress to a few kilobytes with deflate.

### 2.4 Client: re-projection with motion-adaptive tearing

Each layer is drawn as an attribute-less triangle grid (`gl_VertexID` -> texel). The vertex shader fetches
inverse depth and topology, un-projects with the shell's camera and re-projects with the current camera.
Sky texels become points at infinity (`w = 0`), so rotation is exact for any field of view, with an
infinite-far projection.

A triangle whose three edges are all connected is drawn normally. A **torn** triangle (it spans an
occlusion edge) is handled by comparing its on-screen size under the full warp with its size under a
rotation-only warp:

* within 1.5 px: no gap has opened yet, so draw it as is. Edges stay exact when the camera hasn't moved.
* larger: in the focus and background layers, drop it, so whatever lies behind shows through. In the
  omni fallback, flatten it to the depth and colour of its *farthest* corner, so remaining holes are
  filled with background rather than smeared occluder.

Three details turned out to matter as much as the geometry (section 5 has the measurements):

* **Source-affine texture mapping.** GPUs interpolate varyings perspective-correctly *in the target
  view*, but a shell's texels form a regular grid *in the source view*. The shader interpolates
  `(uv x z_src, z_src)` and divides per fragment. That is the exact source-affine mapping for any camera
  motion, and the identity when the camera hasn't moved.
* **Layer priority: stencil where it must, depth where it should.** The sharp focus layer marks the
  stencil, and the coarse omni fallback can never override it: its coarse silhouettes are sometimes
  legitimately *nearer*, so depth alone let them leak. Inside the focus layer's holes, the background
  band and the fallback compete by depth: the band knows what is *behind* an edge, but the fallback may
  hold a nearer surface, such as a wall right next to the camera.
* **Bicubic (Catmull-Rom) reconstruction** with 9 bilinear taps, since every re-projected texel lands
  between display pixels.

Draw order: focus layer (stencil-marking), background band and omni fallback (stencil-restricted,
depth-tested against each other, omni pushed 3 % back), then local dynamic objects (depth-tested against
everything). Input is **late-latched**: mouse deltas
are applied at the start of the `requestAnimationFrame` callback that renders, and the canvas is created
`desynchronized`.

### 2.5 Client-authoritative play

* **Movement and collision** run in the browser at 240 Hz sub-steps against the streamed SDF brick
  (trilinear distance, gradient push-out, ground detection). The server never sees the player "wait".
* **Dynamic objects** (glowing orbs to collect) are owned and drawn by the client, depth-tested against
  the re-projected world. Their **light** is sent to the server and rendered into the world's shading:
  a *latency-tolerant channel*. Geometry is on the latency-critical path and is local; light reaching the
  floor 50 ms late is imperceptible.

### 2.6 Using two T4s

* **Layer parallelism:** T4 #1 owns geometry, topology, the background band, the omni cube and the brick.
* **Split-frame focus rendering:** the focus colour is split into two row stripes, one per GPU, each
  encoded by that GPU's nvJPEG and uploaded by the client into one texture with `texSubImage2D`. The split
  row is re-balanced every frame from the measured per-GPU times, so both GPUs finish together and the
  shell's latency is the *maximum* of two halves rather than the sum.

### 2.7 Transport

* One WebSocket carries everything: input and acks up, shells down. It runs through Tornado, which ships
  with every Jupyter installation, so Kaggle needs no extra dependency.
* **Ack-based flow control**: at most two un-acknowledged shells are in flight, so TCP buffers never fill
  and a congested link costs freshness, not queueing delay.
* **Event-driven:** a shell is rendered only when the pose or the light list changes (or on a timer
  when content animates). A player standing still costs about zero GPU and bandwidth.
* **Decoupled rates:** the display rate (the client's refresh) is independent of the shell rate (30-45/s
  by default). Shells are decoded in a Web Worker (`createImageBitmap`, `DecompressionStream`) and
  double-buffered, so decoding never stalls the render loop.

### 2.8 Lossless geometry coding (a hypothesis that measurement rejected)

Inverse view-z `u = z_near / z` is *affine in screen space* on any plane, so my first codec used a
second-order horizontal predictor `u[x] - 2u[x-1] + u[x-2]`, which is exactly zero on planes. Measured on
real buffers, it **lost**: 16-bit rounding turns second differences into ±1-2 noise, and most texels are
distant surfaces whose first differences are already near zero. `bench/codec_explore.py` compared four
predictors x two byte layouts x three deflate levels. The JPEG-LS **median edge detector (MED)** with
zig-zag residuals in low/high byte planes and deflate level 6 won, beating PNG-16 too (section 4.5). The
browser decodes it in a 15-line loop inside the decode worker; the Python and JS decoders are
bit-exact against the encoder.

### 2.9 One kernel, two targets

`kernel.cu` is plain C++ with a tiny vector library and two macros. NVRTC (via CuPy) compiles it for
the T4s; `g++ -fopenmp` compiles the same file for any CPU. The CPU build is the fallback (the notebook
runs without a GPU), the **ground-truth oracle** for the quality experiments, and the **instrumented
build** for the T4 cost model. ptxas for sm_75: `ss_render` uses 107 registers with **no spills and no
stack** (verified in this report's toolchain run).

---

RESULTS_SECTION_PLACEHOLDER
