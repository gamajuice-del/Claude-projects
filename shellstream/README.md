# ShellStream

Latency-inverted cloud rendering: the cloud GPUs (Kaggle T4 x2 as the design target) stream a depth-carrying,
topology-annotated, layered **shell** of the world around the player's predicted position, and the browser
re-projects it every display refresh with the camera sampled at that instant. Looking and moving cost about
one display frame of latency, whatever the network RTT. With two T4s each GPU renders a complete shell from
its own viewpoint and the browser composites them. A game host streams *unmodified* games too, and predicts
mouse-look locally for them.

* Notebook: [`../ShellStream.ipynb`](../ShellStream.ipynb), the runnable Kaggle deliverable (generated from these sources)
* Technical report: [`../ShellStream_Report.md`](../ShellStream_Report.md)

| File | Role |
|---|---|
| `kernel.cu` | Sphere-tracing renderer, one source: NVRTC/CUDA on the T4s, g++/OpenMP on CPUs (fallback and test oracle) |
| `engine.py` | Backends, shell planning (prediction, guard band, budget), dual-GPU split-frame scheduling, codecs |
| `server.py` | Tornado WebSocket server, ack flow control, event-driven updates, network emulation |
| `client/` | WebGL2 client: topology-aware mesh warp, multi-shell compositing, local physics and objects; `host.js`: game-host mode |
| `host.py` | Game host: runs ANY unmodified game on a virtual display, injects input, NVENC H.264, learns pixels-per-count, lag and the HUD mask online |
| `bench/` | Experiments (`quality.py`, `disocc.py`, `latency.py`, `bandwidth.py`, `codec_explore.py`, `video.py`, `cost_model.py`, `cuda_check.py`; game host: `host_bench.py`, `host_calib.py`) and report generation |
| `results/` | Raw results (JSON) and figures from the development run |
| `build_notebook.py` | Regenerates the notebook from the sources |

## Run

```bash
pip install tornado numpy pillow simplejpeg            # + cupy-cuda12x on a CUDA machine
python server.py                    # uses up to 2 CUDA GPUs if present, else the CPU build
python server.py --cpu --budget 150000 --omni 128 --quality medium   # laptop-friendly CPU run
# open http://127.0.0.1:8765, click, WASD + mouse; keys 1-4 switch modes for comparison
```

Any unmodified game (Linux; on a T4 machine render it with VirtualGL and encode on the other T4):

```bash
pip install av python-xlib && sudo apt install xvfb          # + virtualgl on a GPU machine
python server.py --game minetest --size 1280x720 --fov 90 --overscan 1.12      # built-in test game
python server.py --game /path/to/game --launcher "vglrun -d egl0" --encode-gpu 1 --fov 75 --overscan 1.12
```

Experiments (headless Chromium via Playwright, CPU renderer):

```bash
pip install playwright scikit-image matplotlib && python -m playwright install chromium
cd bench && ./run_all.sh          # every number and figure in the report, ~2.5 h on 4 CPU cores
```
