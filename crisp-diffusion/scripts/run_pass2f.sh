#!/usr/bin/env bash
# Pass 2f: mechanisms on top of the compute-optimal width-32 model (lr 1e-3).
set -euo pipefail
cd "$(dirname "$0")/.."
until [ -f results/runs/pass2e_done.txt ]; do sleep 20; done
run() { python3 scripts/train_global.py "$@" --res 16 --threads 4 > "results/runs/$2.txt" 2>&1; }
run --name ret16_k4_e_b32  --lr 1e-3 --base 32 --scaffold --retrieve 4 --skip edm --budget 1.5e14
run --name pret16_k2_b32   --lr 1e-3 --base 32 --scaffold --patch_retrieve 2 --skip edm --budget 1.5e14
run --name scafin16_b32    --lr 1e-3 --base 32 --scaffold --aux_input --skip edm --budget 1.5e14
echo DONE > results/runs/pass2f_done.txt
