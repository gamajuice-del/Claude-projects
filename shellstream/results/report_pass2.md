## 11. Any game: the game host

### 11.1 Why the shell alone can't run Roblox

Sections 2 to 4 need a cooperating renderer: one that renders the views ShellStream asks for and hands
back depth and normals. A closed game such as Roblox, a Steam title or anything else shipped as a binary
only gives pixels. So pass 2 adds a second, game-agnostic path that streams an **unmodified game** and
still takes mouse-look off the network round trip.

```
 T4 #0: the game, unmodified          host (shellstream/host.py)                  browser (client/host.js)
 (virtual X display; VirtualGL/EGL ──▶ capture window ──▶ NVENC H.264 on T4 #1 ──WS──▶ WebCodecs decode
  puts its OpenGL/Vulkan on the T4)    ▲ calibrator: px per count, game lag,          │ every refresh: re-project the newest
                                       │ screen-fixed overlay mask                     │ frame by the mouse counts it does
                                       └─ XTest: inject keys/mouse the moment ◀──WS───┘ not show yet (HUD stays put)
                                          they arrive
```

### 11.2 Input-predicted reprojection

The browser knows exactly which mouse counts it has sent that the newest frame doesn't show yet: every
frame carries the cumulative counts it reflects, lag-compensated. The host learns the rest **while you
play**, with no knowledge of the game:

* **Rotation per count and game lag.** The upper middle of each capture is resampled to angle coordinates
  (azimuth and elevation, from the game's field of view), where a turn is a uniform shift. Phase correlation
  between consecutive captures gives the rotation, regressed against injected counts over multi-frame
  windows for several candidate lags. Two earlier versions were biased. A per-frame fit was off by ±15 %
  when the game renders slower than it's captured. A fit in plain pixels depended on where the texture
  happened to be, because a turn moves the edges of a 121°-wide view up to three times as far as the
  centre. In the final run the online fit is within {{CAL_ERR}} of the rotation measured directly from
  large steps.
* **Screen-fixed overlay.** While the world measurably moves, pixels that don't change are HUD, crosshair,
  chat or the first-person hand. Only blocks that can tell the two apart count. A block that changed is
  world. A block that stayed put counts as overlay only if moving it with the world would have visibly
  changed it. A plain block (sky, a flat wall) looks the same either way and doesn't vote. A first version
  counted every unchanged block and marked a quarter of the screen as HUD, sky included. The host
  accumulates a mask and sends it occasionally (about 1 KB). The browser re-projects the world and leaves
  the overlay where it is.
* **Overscan.** If the game's field of view can be set wider than what's shown (`--overscan 1.12`), the
  rotated view comes from real pixels instead of a clamped edge.

Before every display refresh, the client rotates the newest frame by `pending counts x calibration` with a
homography (fragment shader). Mouse-look responds locally; movement and actions still take the round trip.

### 11.3 Results on an unmodified third-party game (Minetest 5.6, software OpenGL in Xvfb)

![any game](shellstream/results/fig_host.png)

**Mouse-look latency in the browser** (input to the GPU-finished frame that shows the turn; 10 trials per
point):

{{HOST_H2}}

**Step response**: the game at rest is captured, a known mouse movement is injected, and the frame the game
then renders is compared with the prediction made from the first frame:

{{HOST_H1}}

* Prediction removes nearly all of the motion: {{H1_RES}}, where the stale frame is off by the full turn.
* HUD-aware prediction also beats the stale frame on PSNR at every step size ({{H1_VS_STALE}} dB).
  Without the HUD mask, prediction moves the hotbar and hand with the world; the mask is worth
  {{H1_HUDGAIN}} dB.
* PSNR still understates the gain. Minetest draws unfiltered pixel art at one sample per pixel, so any
  rotation re-rasterizes every texel edge differently, while the same view rendered twice is identical
  (53.5 dB). No warp of an earlier frame can reproduce that. Alignment is the property a player perceives.

### 11.4 What game-host mode can't do

* Movement, jumping, shooting and every in-game reaction still take a full round trip. Only looking around
  is predicted; the game alone knows what pressing W does.
* Rotation is predicted, translation is not: without depth there's no parallax. A depth estimate from the
  colour frames (a monocular depth network on the second T4's tensor cores) is the obvious next step.
* Games with mouse acceleration, smoothing or a third-person orbit camera break the linear model. The
  online fit (R²) detects this, and prediction turns itself off below R² 0.5.
* Games turn about the world's vertical axis, the client about the camera's. Looking 20° up, the synthetic
  calibration test shows a +6 % turn error (+3 % looking level). The online fit tracks the current view
  but can't remove the error. The game's pitch isn't observable from the pixels alone, so a fix needs
  pitch tracking.
* Calibration needs a textured view. A game that starts in darkness or on a blank screen gets no
  prediction until the player has looked around somewhere visible. After that, the calibrator keeps the
  good fit. If the player then changes the in-game sensitivity while the view is dark, the stale fit
  stays in use until a textured view corrects it.
* Anti-cheat systems may treat injected input or virtual displays as suspicious.

### 11.5 Roblox, specifically

* **Not on Kaggle.** Roblox has no Linux client. Kaggle kernels are Linux containers without a display
  server or GPU graphics drivers. And running a game service is the kind of "activity unrelated to ML data
  science" Kaggle's Acceptable Use Policy is quoted as prohibiting. I didn't build a Kaggle workaround.
* **Linux T4 machine.** The host runs any Linux game, or a Windows game under Proton/Wine:
  `python shellstream/server.py --game <command> --launcher "vglrun -d egl0" --encode-gpu 1 --fov <deg> --overscan 1.12`.
  Roblox's only Linux route is an unofficial community client (Sober, which runs the Android build); check
  Roblox's terms before using it.
* **Officially: a Windows VM with a T4** running the real Roblox client. That needs a Windows backend for the
  host: DXGI desktop duplication for capture, SendInput or a virtual HID driver for input. That backend is
  **not built in this proof of concept**. The protocol, calibrator, HUD mask, NVENC path and browser client
  carry over unchanged. Roblox's anti-cheat and terms apply as for any remote-play setup.

## 12. Using both T4s fully

### 12.1 Where the second GPU went in pass 1

Pass 1 split one shell's focus rows across the T4s (about 11 ms each per update, modelled). Both GPUs then
sat idle during host-side deflate and while waiting for input. Their NVENC engines were unused, and so
were their tensor cores.

### 12.2 Two complete shells per update

Now each T4 renders a **complete** shell from its own centre. T4 #0 renders the predicted pose. T4 #1
renders a **hedge**: the current position when the player moves (it covers stopping and reversing), and
alternating left/right offsets ({{HEDGE}} m) when standing, so the client soon holds both sides. T4 #1
also renders the omni cube, centred on the prediction, and T4 #0 the collision brick.

The browser keeps the newest shell of every slot and composites them nearest-centre first. A secondary
shell takes part only when its viewpoint is about as good as the primary's: within 0.15 m of the primary
centre's distance, once the camera has moved more than 0.15 m. A first version composited every shell
unconditionally. It gained up to 6 dB on sideways moves but *lost* 0.1-0.5 dB on pure rotations and on
jumps, because the 0.45 m-offset hedges then replaced pixels that the primary shell or its omni fallback
render from the correct centre, with view-dependent reflections 0.45 m wrong. The gating rule fixes that.

Among the shells that take part, shell *i* writes stencil value K-i and passes only where the stored value
is ≤ K-i. It therefore fills just the pixels no nearer shell covered, while still depth-testing against
its own triangles. Bands and the omni cube then fill whatever is left. With a single shared stencil value a
shell couldn't depth-test its own geometry; with an age filter on wall-clock time, a stalled network would
have dropped every shell. Both bugs were found by the test harness.

Results (section 4.4 tables, "1 shell" vs. "both T4s" columns): for a 0.5 m strafe,
**{{SINGLE05}} dB with one shell vs. {{DUAL05}} dB with both T4s**; inside the regions that strafe reveals,
{{DISOCC_SINGLE}} vs. {{DISOCC_DUAL}} dB. Fairness note: the left/right hedges sit at ±{{HEDGE}} m, close to
the ±0.5 m test poses. Poses away from any hedge centre gain nothing, because the gating rule keeps the
hedges out of them: forward 0.5 m {{SINGLEFWD}} vs. {{DUALFWD}} dB, jump 0.5 m {{SINGLEJUMP}} vs.
{{DUALJUMP}} dB, every rotation identical. Ungated compositing gained 0.3 dB going forward but lost up to
0.5 dB on jumps; the rule gives up the first to remove the second. The cost is a second shell on the wire:
{{DUAL_BYTES_RATIO}}x the bytes of a single shell (section 4.5).

### 12.3 No idle time

* **Pipelined stages.** `stage1` (both GPUs render and encode) of update *n+1* runs while `finish` (deflate
  and packing on the CPU cores) of update *n* completes, in order, on one worker.
* **Governor.** It scales the focus pixel budget so the busier T4 is busy 85 % of each shell interval
  (0.25-2.5 MP). With two shells at 30 updates/s, each T4 is modelled at about 22 ms per shell, which
  leaves room to raise the budget.
* **Idle refinement.** When nothing moves, the next idle intervals re-render the same shells at 4 and then
  8 samples per pixel (R2 low-discrepancy sequence), instead of leaving the GPUs idle.
* **NVENC.** Both T4s' hardware encoders are used: the game host streams H.264 through NVENC on the T4 that
  doesn't run the game. The notebook benchmarks both encoders, alone and simultaneously.

None of these were timed on a T4 here (no GPU in this sandbox). The notebook's section 3b measures GPU
busy percentages, the governor's converged budget, pipelined vs. sequential throughput and NVENC speed on
Kaggle's T4s.

## 13. Roblox, playable online, on a 2x T4 Windows machine

### 13.1 The route

Kaggle can't host it (section 11.5). A Windows machine with the same two T4s can, and Google Cloud attaches
two T4s to one VM. On it, the **official Roblox client** renders on T4 #0, NVENC on T4 #1 encodes, and the game
host streams the whole desktop. You sign in and join games online as on any PC. `windows/setup.ps1` prepares
such a machine in one command; `windows/README.md` is the step-by-step guide.

What this pass added, on top of the pass-2 game host:

* **Windows backend** (`host_win.py`). DXGI Desktop Duplication through dxcam (GDI fallback); SendInput with
  relative counts, absolute positions, all mouse buttons, both wheels, and keys as hardware scan codes;
  pointer state from `GetCursorInfo` and the cursor clip rectangle.
* **Pointer modes.** Games hide or pin the pointer while it turns the camera, and show it in menus. The host
  reports which, every frame, on Windows and Linux (XFixes). *Look* mode sends relative counts and predicts
  them. *Pointer* mode draws the pointer locally at display rate and sends absolute positions, so menus feel
  local too. The calibrator learns only from look-mode frames, since counts in menus move a pointer, not the
  camera. Without the pointer captured, plain clicks work as well.
* **Audio** (`host_audio.py`). The default output's loopback (WASAPI; PulseAudio monitor on Linux), Opus
  20 ms packets in low-delay mode, WebCodecs decode, a jitter buffer that plays 1 % faster while more than
  140 ms is queued.
* **Frame rate.** 60 fps by default and about 0.1 bit per pixel (1080p60: 12 Mbit/s). The calibrator moved to
  its own thread, and its sampling grid scales with the frame, so 1080p costs what 640x360 does.
* **Access.** A server reachable from other machines requires a token (URL once, then an HttpOnly cookie).
  `--tls` serves HTTPS with a self-signed certificate. That is also needed for speed, because browsers offer
  WebCodecs only on HTTPS or localhost; without it they fall back to JPEG.

### 13.2 Measured here (Linux stand-in, no GPU)

{{HOST_FULL}}

**Throughput of the host pipeline** (pointer state, calibrator hand-off, change detection, H.264 encode; x264 on
4 CPU cores standing in for NVENC; synthetic panning source):

{{HOST_FPS}}

Encoding is the whole bottleneck here; on the T4 machine NVENC takes it, and the notebook's NVENC cell measures
how fast. These CPU numbers are rough: the cores are shared, and an earlier run of the same benchmark reached
59 fps at 1080p. The Windows backend's input records and pointer logic pass unit tests against a simulated `user32`
(`tests/test_host_win.py`: structure layout, scan codes, absolute coordinates on a multi-monitor desktop,
buttons, wheels, pointer state).

### 13.3 Not verified

No Windows machine, GPU or Roblox account was available. Untested: the Windows backend against real Windows
APIs, DXGI capture, WASAPI loopback, NVENC on Windows, the setup script (reviewed by hand, never run or parsed),
and Roblox itself. Roblox's anti-cheat may treat injected input or virtual machines differently from a desk PC.
If it ignores injected input, a virtual HID driver would be needed, which isn't built. Roblox's terms of use
apply as on any PC.
