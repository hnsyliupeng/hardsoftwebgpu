#!/usr/bin/env bash
# Rebuilds the fusion rounds in examples/fusion/ (CPU only, one build at a time: about 2 GB peak
# memory per build on a 4 GB host). Usage: bash scripts/run_fusion_rounds.sh [round ...]
# Large STEP and mesh.bin outputs stay on disk (ignored by Git); STL goes to artifacts/fusion/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export LD_LIBRARY_PATH="$ROOT/.venv/stubs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
PY="$ROOT/.venv/bin/python"
ROUNDS=("$@")
[ ${#ROUNDS[@]} -eq 0 ] && ROUNDS=(fusion_r1 fusion_r2 fusion_r3 fusion_r4 fusion_r5)
mkdir -p "$ROOT/artifacts/fusion"
for n in "${ROUNDS[@]}"; do
  out="$ROOT/examples/fusion/$n"
  (cd "$ROOT/python" && "$PY" -m bioxlattice build "$out/spec.json" "$out")
  mv "$out/$n.stl" "$ROOT/artifacts/fusion/" 2>/dev/null || true
  node --experimental-strip-types --no-warnings "$ROOT/scripts/render_coupled.ts" "$out/$n.mesh.bin" "$out/${n}_cutaway.png" 1600 cut
  node --experimental-strip-types --no-warnings "$ROOT/scripts/render_coupled.ts" "$out/$n.mesh.bin" "$out/${n}_exterior.png" 1600 full
done
