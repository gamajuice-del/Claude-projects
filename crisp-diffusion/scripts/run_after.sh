#!/usr/bin/env bash
# Second stage, run strictly after run_training.sh so nothing competes for the 4 cores.
set -euo pipefail
cd "$(dirname "$0")/.."
until [ -f results/runs/queue_done.txt ]; do sleep 20; done
python3 scripts/exp_nmcr.py 4 > results/nmcr.txt 2>&1
python3 scripts/train_global.py --name abl16_scaf_ia --res 16 --scaffold --ia --budget 1.5e14 --threads 4 > results/runs/abl16_scaf_ia.txt 2>&1
python3 scripts/train_classifier.py 4 6 > results/classifier.txt 2>&1
python3 scripts/gap_paired.py 4 > results/gap_paired.txt 2>&1
python3 scripts/generate_eval.py 4 > results/generation.txt 2>&1
python3 scripts/make_report.py > results/report.txt 2>&1
echo AFTER_DONE > results/after_done.txt
