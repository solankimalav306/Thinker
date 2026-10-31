#!/bin/sh
# Runs the chat evaluation in small batches so a free-tier key (15 model requests a minute) is not throttled.
# usage: sh evals/run-paced.sh <out dir> <batch of ids> <batch of ids> ...
out="$1"; shift
for ids in "$@"; do
  node evals/run-eval.mjs --only "$ids" --out "$out"
  sleep 75
done
echo BATCHES-DONE
