#!/usr/bin/env bash
# Creates .venv with cadquery 2.8 (CPU only) and the GL load stub. Usage: source scripts/python_env.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -d "$ROOT/.venv" ] || python3 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/pip" install -q -r "$ROOT/python/requirements.txt"
"$ROOT/scripts/make_gl_stub.sh" >/dev/null
export LD_LIBRARY_PATH="$ROOT/.venv/stubs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PY="$ROOT/.venv/bin/python"
echo "python env ready: $PY"
