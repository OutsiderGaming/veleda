#!/usr/bin/env bash
# Generates large random trading sessions with the TypeScript reference model
# and replays them through the Rust engine. Usage: scripts/cross-check.sh [ops-per-session]
set -euo pipefail
cd "$(dirname "$0")/.."
OPS="${1:-2500}"
OUT="$PWD/target/vectors"
rm -rf "$OUT" && mkdir -p "$OUT"
for seed in 11 12 13; do node packages/reference/scripts/gen-vectors.ts fast "$OPS" "$seed" "$OUT/fast-$seed.txt"; done
for seed in 21 22 23; do node packages/reference/scripts/gen-vectors.ts flagship "$OPS" "$seed" "$OUT/flagship-$seed.txt"; done
VELEDA_VECTORS="$OUT" cargo test -p veleda-math --release --test cross_check -- --nocapture
