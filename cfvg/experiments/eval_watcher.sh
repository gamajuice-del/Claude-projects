#!/usr/bin/env bash
# Evaluate each run as soon as the queue reports it finished.
cd "$(dirname "$0")"
for name in cfvg cfvg_nocontrast paired cfvg_long cfvg_direct pool30 pool300 leaky; do
  until grep -qE "^=== done $name [0-9]" logs/queue.log; do sleep 30; done
  [ -f "results/$name.json" ] && continue
  echo "eval $name $(date +%H:%M:%S)"
  sweep=""; case $name in cfvg|cfvg_long) sweep="--sweeps";; esac; python3 evaluate.py "$name" $sweep --threads 1 > "logs/eval_$name.log" 2>&1 || echo "EVAL FAILED $name"
done
echo WATCHER_DONE
