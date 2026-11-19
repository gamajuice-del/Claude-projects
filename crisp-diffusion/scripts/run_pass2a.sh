#!/usr/bin/env bash
# Pass 2a: how much of diffusion training compute is spent averaging out label noise? + baseline fairness.
set -euo pipefail
cd "$(dirname "$0")/.."
run() { python3 scripts/train_global.py "$@" --res 16 --threads 4 > "results/runs/$2.txt" 2>&1; }
run --name oracle16      --teacher_net edm16 --count_teacher 0 --budget 1.5e14
run --name edm16_lr1e3   --lr 1e-3 --budget 1.5e14
run --name td16_r05      --td 0.5 --budget 1.5e14
run --name edm16_lr1e4   --lr 1e-4 --budget 1.5e14
echo DONE > results/runs/pass2a_done.txt
