#!/usr/bin/env bash
# Pass 2e: map the compute-optimal EDM frontier (width x lr) at 1.5e14 FLOPs, then mechanisms on top of it.
set -euo pipefail
cd "$(dirname "$0")/.."
until [ -f results/runs/pass2d_done.txt ]; do sleep 20; done
run() { python3 scripts/train_global.py "$@" --res 16 --threads 4 > "results/runs/$2.txt" 2>&1; }
run --name edm16_b16        --lr 1e-3 --base 16 --budget 1.5e14
run --name edm16_b32_lr2e3  --lr 2e-3 --base 32 --budget 1.5e14
echo DONE > results/runs/pass2e_done.txt
