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
| 0 ms | **13 ms** | 117 ms | 1 px |
| 50 ms | **15 ms** | 181 ms | 1 px |
| 100 ms | **12 ms** | 225 ms | 1 px |
| 200 ms | **12 ms** | 329 ms | 1 px |

| mouse step (counts) | turn (px at the centre) | misalignment left, stale frame | misalignment left, predicted | PSNR stale / predicted / predicted + HUD-aware |
|---|---|---|---|---|
| 8, 0 | 7 px | 7.0 px | **0.1 px** | 18.5 / 20.2 / **24.4** dB |
| 20, 0 | 17 px | 18.1 px | **0.1 px** | 16.1 / 18.4 / **21.2** dB |
| 40, 0 | 35 px | 36.0 px | **0.1 px** | 13.8 / 17.6 / **20.6** dB |
| 80, 0 | 70 px | 75.4 px | **2.9 px** | 11.6 / 14.8 / **16.2** dB |
| -20, 0 | 17 px | 17.9 px | **0.0 px** | 15.8 / 18.6 / **22.1** dB |
| 0, 15 | 13 px | 15.2 px | **0.3 px** | 16.0 / 18.4 / **21.9** dB |
| 0, -15 | 13 px | 15.2 px | **0.1 px** | 15.8 / 18.5 / **22.1** dB |
| 25, 10 | 23 px | 25.3 px | **0.2 px** | 14.7 / 18.3 / **20.7** dB |

Online calibration after 20 s of ordinary mouse-look: -0.871 / -0.851 px per count at the image centre, game lag 43 ms, fit R^2 0.996; measured directly from the large horizontal steps: -0.867, so the online fit is off by +0.5 %.

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
* **Roblox has no Linux client.** Its official clients are Windows, macOS and mobile. The legitimate cloud
  route is a Windows VM with a T4 running the official client. That needs a Windows capture and input
  backend for the host (DXGI desktop duplication, SendInput or a virtual HID driver), which is **not built**
  in this proof of concept; the rest (calibration, HUD mask, NVENC, browser client) carries over unchanged.
  An unofficial Linux route exists (Sober, which runs the Android build). Check Roblox's terms before using
  it.
