## 4c. Any game: the game host (for a T4 machine, not run on Kaggle)

Shells need a renderer that cooperates (depth, normals, chosen views). Closed games, such as Roblox or a
Steam title, only give pixels. `host.py` streams **any unmodified game**:

* runs it on a virtual display (on a GPU machine through VirtualGL/EGL, so its OpenGL/Vulkan runs on T4 #0);
* injects your keys and mouse the moment they arrive;
* encodes with NVENC H.264 on T4 #1, decoded by WebCodecs in the browser;
* learns, while you play, how far the image moves per mouse count, the game's display lag, and which pixels
  are screen-fixed (HUD, crosshair, hand);
* has the browser re-project the newest frame by the mouse movement the frame doesn't show yet, leaving
  the HUD in place, so **mouse-look responds locally even though the game runs remotely**.

Measured in the development run on an unmodified open-source game (Minetest 5.6, software OpenGL):

| emulated RTT | mouse-look latency, prediction ON | mouse-look latency, prediction OFF (classic) | image jump when the real frame lands |
|---|---|---|---|
| 0 ms | **12 ms** | 118 ms | 2 px |
| 50 ms | **14 ms** | 143 ms | 1 px |
| 100 ms | **13 ms** | 202 ms | 1 px |
| 200 ms | **11 ms** | 284 ms | 2 px |

| mouse step (counts) | turn (px at the centre) | misalignment left, stale frame | misalignment left, predicted | PSNR stale / predicted / predicted + HUD-aware |
|---|---|---|---|---|
| 8, 0 | 7 px | 7.0 px | **0.1 px** | 18.3 / 20.1 / **24.2** dB |
| 20, 0 | 17 px | 18.7 px | **0.5 px** | 15.8 / 18.1 / **20.9** dB |
| 40, 0 | 35 px | 35.2 px | **0.9 px** | 13.2 / 16.7 / **18.7** dB |
| 80, 0 | 70 px | 103.4 px | **2.5 px** | 11.0 / 14.3 / **15.3** dB |
| -20, 0 | 17 px | 17.1 px | **0.3 px** | 15.2 / 18.0 / **21.2** dB |
| 0, 15 | 13 px | 16.2 px | **0.2 px** | 15.8 / 18.4 / **21.7** dB |
| 0, -15 | 13 px | 15.0 px | **0.1 px** | 15.7 / 18.5 / **21.9** dB |
| 25, 10 | 23 px | 24.6 px | **0.6 px** | 14.6 / 17.6 / **19.7** dB |

Online calibration after 20 s of ordinary mouse-look: -0.871 / -0.851 px per count at the image centre, game lag 43 ms, fit R^2 0.996; measured directly from the large horizontal steps: -0.846, so the online fit is off by +2.9 %.

Movement and in-game actions still take the round trip; only looking around is predicted.

**Run it on a Linux machine with 2x T4** (not on Kaggle):

```bash
pip install cupy-cuda12x tornado simplejpeg av python-xlib   # + apt: xvfb, virtualgl
python shellstream/server.py --game <game command line> --launcher "vglrun -d egl0" \
       --encode-gpu 1 --fov <game vertical FOV> --overscan 1.12 --address 0.0.0.0
```

**Why this section doesn't run on Kaggle, and what about Roblox:**

* Kaggle's Acceptable Use Policy is quoted as prohibiting "activity unrelated to ML data science". Hosting
  a game is exactly that, so this notebook doesn't do it. Kaggle kernels also have no display server or
  GPU graphics drivers to run a game with.
* **Roblox has no Linux client**, so it can't run in a Kaggle kernel at all.
* **Roblox, playable online, on a machine with the same two T4s:** a Windows VM (Google Cloud attaches two T4s
  to one VM) running the official client. The game renders on T4 #0, NVENC on T4 #1 encodes, and the game host
  streams the whole desktop with mouse-look prediction, a locally drawn menu pointer, scan-code keyboard, game
  audio (Opus), 60 fps, HTTPS and an access token. One command sets it up: `windows/setup.ps1`; the guide is
  `windows/README.md`. Tested on Linux against an unmodified game (menus, pointer modes, audio, TLS); the
  Windows backend is unit-tested but wasn't run on Windows or with Roblox here.
