# ShellStream

Latency-inverted cloud rendering: the cloud GPUs (Kaggle T4 x2 as the design target) stream a depth-carrying,
topology-annotated, layered **shell** of the world around the player's predicted position, and the browser
re-projects it every display refresh with the camera sampled at that instant. Looking and moving cost about
one display frame of latency, whatever the network RTT.

* Notebook: [`../ShellStream.ipynb`](../ShellStream.ipynb), the runnable Kaggle deliverable (generated from these sources)
* Technical report: [`../ShellStream_Report.md`](../ShellStream_Report.md)

| File | Role |
|---|---|
| `kernel.cu` | Sphere-tracing renderer, one source: NVRTC/CUDA on the T4s, g++/OpenMP on CPUs (fallback and test oracle) |
| `engine.py` | Backends, shell planning (prediction, guard band, budget), dual-GPU split-frame scheduling, codecs |
| `server.py` | Tornado WebSocket server, ack flow control, event-driven updates, network emulation |
| `client/` | WebGL2 client: topology-aware mesh warp, background band, omni fallback, local physics and objects |
| `bench/` | Experiments (`quality.py`, `disocc.py`, `latency.py`, `bandwidth.py`, `codec_explore.py`, `video.py`, `cost_model.py`, `cuda_check.py`) and report generation |
| `results/` | Raw results (JSON) and figures from the development run |
| `build_notebook.py` | Regenerates the notebook from the sources |

## Run

```bash
pip install tornado numpy pillow simplejpeg            # + cupy-cuda12x on a CUDA machine
python server.py                    # uses up to 2 CUDA GPUs if present, else the CPU build
python server.py --cpu --budget 150000 --omni 128 --quality medium   # laptop-friendly CPU run
# open http://127.0.0.1:8765, click, WASD + mouse; keys 1-4 switch modes for comparison
```

Experiments (headless Chromium via Playwright, CPU renderer):

```bash
pip install playwright scikit-image matplotlib && python -m playwright install chromium
cd bench && ./run_all.sh          # every number and figure in the report, ~2.5 h on 4 CPU cores
```
