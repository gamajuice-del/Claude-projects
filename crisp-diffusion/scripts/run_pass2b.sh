#!/usr/bin/env bash
# Pass 2b: retrieval-augmented learning and compute-optimal baseline size, at the baseline's best learning rate.
set -euo pipefail
cd "$(dirname "$0")/.."
until [ -f results/runs/pass2a_done.txt ]; do sleep 20; done
LR=$(python3 - <<'PY'
import json
best = None
for name, lr in [("edm16", 3e-4), ("edm16_lr1e3", 1e-3), ("edm16_lr1e4", 1e-4)]:
    c = json.load(open(f"results/runs/{name}/log.json"))["curve"]
    l = min(p["test_loss"] for p in c if p["flops"] <= 1.51e14)
    if best is None or l < best[0]:
        best = (l, lr)
print(best[1])
PY
)
echo "best baseline lr: $LR" > results/runs/pass2b_lr.txt
run() { python3 scripts/train_global.py "$@" --res 16 --threads 4 --lr $LR > "results/runs/$2.txt" 2>&1; }
run --name ret16_k4     --scaffold --retrieve 4 --budget 1.5e14
run --name edm16_b32    --base 32 --budget 1.5e14
run --name ret16_k4_b32 --scaffold --retrieve 4 --base 32 --budget 1.5e14
echo DONE > results/runs/pass2b_done.txt
