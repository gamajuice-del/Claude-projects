#!/usr/bin/env bash
# The full experiment queue. Idempotent: finished runs are skipped and
# interrupted ones resume from their last checkpoint.
set -u
cd "$(dirname "$0")"
mkdir -p logs runs
S=${STEPS:-4000}

run() {  # name, args...
  local name=$1; shift
  echo "=== $name $(date +%H:%M:%S)"
  python3 train.py --name "$name" --steps "$S" "$@" >> "logs/$name.log" 2>&1 \
    || { echo "FAILED $name"; tail -5 "logs/$name.log"; }
  echo "=== done $name $(date +%H:%M:%S)"
}

# E1  core claim: independent targets vs replication-style training
run cfvg            --mode cfvg
run cfvg_nocontrast --mode cfvg --contrastive 0     # E5: is the group-contrastive loss needed?
run paired          --mode paired
# E1b the main model, trained 3x longer (continues from cfvg's checkpoint)
if [ ! -d runs/cfvg_long ]; then mkdir -p runs/cfvg_long && cp runs/cfvg/ckpt.pt runs/cfvg/log.jsonl runs/cfvg_long/; fi
S=12000 run cfvg_long --mode cfvg
# E2  does the bottleneck matter, once the objective already forbids copying?
run cfvg_direct     --mode cfvg   --bottleneck 0
# E3  zero-shot generalisation vs the number of distinct worlds seen in training
run pool30          --pool 30
run pool300         --pool 300
# E4  captions that leak the world
run leaky           --leaky
echo ALL_DONE
