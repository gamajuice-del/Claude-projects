#!/usr/bin/env bash
# Pass 2d: translation-equivariant patch retrieval (exemplar mosaics) and Muon, at the tuned lr, width 64.
set -euo pipefail
cd "$(dirname "$0")/.."
until [ -f results/runs/pass2c_done.txt ]; do sleep 20; done
run() { python3 scripts/train_global.py "$@" --res 16 --threads 4 > "results/runs/$2.txt" 2>&1; }
run --name pret16_k2  --lr 1e-3 --scaffold --patch_retrieve 2 --skip edm --budget 1.5e14
run --name muon16     --lr 1e-3 --opt muon --budget 1.5e14
echo DONE > results/runs/pass2d_done.txt
