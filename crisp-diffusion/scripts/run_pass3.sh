#!/usr/bin/env bash
# Pass 3: multiscale factorization at 64x64 (Imagenette), FLOP-matched at 4e14 total per system.
set -euo pipefail
cd "$(dirname "$0")/.."
until [ -f results/runs/pass2f_done.txt ]; do sleep 20; done
cd scripts
python3 eval_imagenette.py classifier > ../results/imagenette_premise.txt 2>&1
python3 train_imagenette.py --name in64_pix    --mode pix    --budget 4.0e14 > ../results/runs/in64_pix.txt 2>&1
python3 train_imagenette.py --name in64_coarse --mode coarse --budget 2.4e14 > ../results/runs/in64_coarse.txt 2>&1
python3 train_imagenette.py --name in64_detail --mode detail --budget 1.6e14 > ../results/runs/in64_detail.txt 2>&1
python3 eval_imagenette.py generate edm64,pyramid,coarse_zero > ../results/imagenette_generation.txt 2>&1
echo DONE > ../results/runs/pass3_done.txt
