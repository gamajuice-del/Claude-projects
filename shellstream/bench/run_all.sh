#!/bin/bash
# Reproduces every result in ShellStream_Report.md (CPU server + headless Chromium; ~3.5 h on 4 cores).
# Needs: playwright + chromium, scikit-image, matplotlib, av (PyAV), python-xlib, Xvfb, Minetest (apt: minetest xvfb).
# The experiments run one after another because they compete for the same CPU cores.
set -ex
cd "$(dirname "$0")"
python3 -u host_calib.py                   # game-host calibrator vs. a known rotation (synthetic perspective views)
python3 -u host_bench.py                   # ANY game (Minetest, unmodified): prediction step response + look latency
python3 -u quality.py                      # image quality vs. 16-spp ground truth, 3 scenes x 12 displacements, 1 vs 2 T4s
python3 -u disocc.py                       # quality inside newly revealed regions only
SS_QUALITY=high_noreflect SS_TAG=_noreflect SS_SCENES=plaza,pillars SS_OFFSETS="none,yaw 30deg,strafe 0.1m,strafe 0.5m,forward 0.5m" python3 -u quality.py
SS_QUALITY=high SS_TAG=_reflect_subset SS_SCENES=plaza,pillars SS_OFFSETS="none,yaw 30deg,strafe 0.1m,strafe 0.5m,forward 0.5m" python3 -u quality.py
python3 -u latency.py                      # look latency vs RTT, network stall
python3 -u bandwidth.py                    # bytes per layer, 1080p client
python3 -u codec_explore.py                # depth codec bake-off
python3 -u video.py                        # H.264 headroom (x264 as NVENC stand-in)
python3 -u cuda_check.py                   # NVRTC + ptxas sm_75 (needs nvidia-cuda-nvrtc-cu12, nvidia-cuda-nvcc-cu12)
python3 -u cost_model.py                   # modelled T4 time per pass
python3 -u hero.py                         # report screenshots
python3 -u make_figures.py
python3 -u make_tables.py > /dev/null
python3 -u assemble_report.py > /dev/null  # writes ../../ShellStream_Report.md
echo ALL_DONE
