#!/usr/bin/env bash
# Second half of the queue (replaces the tail of run_all.sh).
set -u
cd "$(dirname "$0")"
S=4000
run() {  # name, steps, args...
  local name=$1 steps=$2; shift 2
  echo "=== $name $(date +%H:%M:%S)"
  python3 train.py --name "$name" --steps "$steps" "$@" >> "logs/$name.log" 2>&1 \
    || { echo "FAILED $name"; tail -5 "logs/$name.log"; }
  echo "=== done $name $(date +%H:%M:%S)"
}
# let the orphaned cfvg_nocontrast run finish first
while pgrep -f "name cfvg_nocontrast" > /dev/null; do sleep 20; done
echo "=== done cfvg_nocontrast $(date +%H:%M:%S)"

run paired 4000 --mode paired
# continue the main model from its 4000-step checkpoint to 12000 steps
if [ ! -d runs/cfvg_long ]; then
  mkdir -p runs/cfvg_long && cp runs/cfvg/ckpt.pt runs/cfvg_long/ && cp runs/cfvg/log.jsonl runs/cfvg_long/
fi
run cfvg_long 12000 --mode cfvg
run cfvg_direct 4000 --mode cfvg --bottleneck 0
run pool30 4000 --pool 30
run pool300 4000 --pool 300
run leaky 4000 --leaky
echo ALL_DONE
