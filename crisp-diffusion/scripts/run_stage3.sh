#!/usr/bin/env bash
# Third stage (after run_after.sh): a long scaffold-only run to test whether the scaffold's advantage
# is a persistent offset or a transient head start, plus second-seed replicates of the headline
# comparison at 7.5e13 FLOPs; then refresh the paired gap measurement and the report.
set -euo pipefail
cd "$(dirname "$0")/.."
until [ -f results/after_done.txt ]; do sleep 20; done
python3 scripts/train_global.py --name abl16_scaffold_long --res 16 --scaffold --budget 4.5e14 --threads 4 > results/runs/abl16_scaffold_long.txt 2>&1
python3 scripts/train_global.py --name edm16_s1   --res 16 --budget 7.5e13 --evals 6 --seed 1 --threads 4 > results/runs/edm16_s1.txt 2>&1
python3 scripts/train_global.py --name crisp16_s1 --res 16 --rb --scaffold --ia --budget 7.5e13 --evals 6 --seed 1 --threads 4 > results/runs/crisp16_s1.txt 2>&1
python3 scripts/gap_paired.py 4 edm16,crisp16_full,abl16_scaffold_long,abl16_rb,abl16_scaffold,abl16_rb_scaf,abl16_scaf_ia > results/gap_paired.txt 2>&1
python3 scripts/make_report.py > results/report.txt 2>&1
echo STAGE3_DONE > results/stage3_done.txt
