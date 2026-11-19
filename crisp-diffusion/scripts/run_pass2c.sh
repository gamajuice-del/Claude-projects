#!/usr/bin/env bash
# Pass 2c (lr 1e-3 = tuned baseline): compute-optimal width, scaffold/neighbours as INPUTS with EDM's local skip, lr 2e-3.
set -euo pipefail
cd "$(dirname "$0")/.."
run() { python3 scripts/train_global.py "$@" --res 16 --threads 4 > "results/runs/$2.txt" 2>&1; }
run --name ret16_k4_e   --lr 1e-3 --scaffold --retrieve 4 --skip edm --budget 1.5e14
run --name edm16_b32    --lr 1e-3 --base 32 --budget 1.5e14
run --name scafin16     --lr 1e-3 --scaffold --aux_input --skip edm --budget 1.5e14
run --name edm16_lr2e3  --lr 2e-3 --budget 1.5e14
echo DONE > results/runs/pass2c_done.txt
