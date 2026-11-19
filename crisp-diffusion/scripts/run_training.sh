#!/usr/bin/env bash
# FLOP-matched training queue (CPU, 4 threads).  Long runs double as the end-to-end systems;
# their early checkpoints (<=1.5e14 FLOPs) double as the ablation baselines.
set -euo pipefail
cd "$(dirname "$0")/.."
L=4.5e14   # long-run budget (end-to-end comparison)
S=1.5e14   # ablation budget
run() { python3 scripts/train_global.py "$@" --threads 4 > "results/runs/$2.txt" 2>&1; }
mkdir -p results/runs
run --name crisp16_full   --res 16 --rb --scaffold --ia --budget $L
run --name edm16          --res 16 --budget $L
run --name edm32          --res 32 --budget $L
run --name abl16_rb       --res 16 --rb --budget $S
run --name abl16_scaffold --res 16 --scaffold --budget $S
run --name abl16_rb_scaf  --res 16 --rb --scaffold --budget $S
echo ALL_DONE > results/runs/queue_done.txt
