
**Key results (development run; see the report for method and caveats)**

| | ShellStream | classic cloud streaming |
|---|---|---|
| look latency, input to finished frame, RTT 0 to 200 ms | **53-57 ms, flat** (= one frame of the software-rendered test client; one display refresh on a real GPU) | 240 -> 414 ms, grows with RTT |
| view lag while turning through a 1 s network stall | **0.0 deg** | up to 67 deg |
| image after a 30-degree turn (PSNR vs. 16-spp truth) | **29.0 dB** (local 1-spp render: 29.7) | 12.5 dB (stale frame) |
| image after a 0.5 m strafe | **25.7 dB** with both T4s (19.7 with one shell; naive depth warp 19.1) | 13.8 dB |
| inside regions newly revealed by a 0.5 m strafe | **22.5 dB** both T4s (16.0 one shell; naive 12.8, no band 9.8) | 10.7 dB |
| **any unmodified game** (Minetest via the game host): mouse-look latency, RTT 0 to 200 ms | **11-14 ms** with input-predicted reprojection (lower than the row above only because this client draws a single textured quad, which software rendering finishes sooner) | 118-284 ms |
| T4 time per update (modelled; measured by the notebook) | 11.2 ms on 2 T4s (22.3 on one) | 37.9 ms per 1080p frame on one T4 |
| bytes per update, 1080p client | 367 KiB (JPEG; about 4x less colour with NVENC-class video) | 193 KiB |

Under translation the gap to a local render is still large. Wet-floor mirror reflections explain much
of it for small moves (a reflection ablation is in the report); the rest is open. For closed games, only
mouse-look is predicted; movement and actions still take the round trip. T4 timings are modelled here and
measured by the notebook.
