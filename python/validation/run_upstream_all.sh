#!/usr/bin/env bash
# Runs the deterministic and seeded upstream base codes in headless Blender (bpy) and writes one JSON line each.
# Needs: a Bioinspired123D checkout (argument 1), bpy in /home/user/venv_bpy (pip install bpy, Python 3.11),
# and the no-op X11/GL stubs in /home/user/bpy_stubs (see docs/BIOINSPIRED_GEOMETRY.md, status note).
set -u
CHK="${1:?usage: run_upstream_all.sh <Bioinspired123D checkout>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PY=/home/user/venv_bpy/bin/python
export LD_LIBRARY_PATH="/home/user/bpy_stubs"
# Fracture Cell (object_fracture_cell) from blender/blender-addons, copied to this folder; see docs/BIOINSPIRED_GEOMETRY.md
export BLENDER_USER_SCRIPTS="/home/user/bpy_addons"
run() { timeout 900 "$PY" "$HERE/run_upstream_bpy.py" "$CHK" "$@" 2>/dev/null | tail -1; }
run helical_generic num_plies=10 rotation=10
run helical_rectfibers num_plies=10 rotation=10
run helical_cylinfibers num_plies=10 rotation=10
run tubular_generic num_tubules=16
run tubular_shapesize num_tubules=16 ellipticity=1.5 radius=0.1
run tubular_layers num_tubules=16 thickness=0.04
for s in 1 2 3; do run helical_noise num_plies=10 rotation=10 noise=5 seed=$s; done
run tubular_noise num_tubules=16 noise=0.07 seed=1
# cellular base codes: Fracture Cell (object_fracture_cell) + wireframe, 20 seeds each, same parameters as the gallery
for s in $(seq 1 20); do run cellular_generic thickness=0.2 seed=$s; done
for s in $(seq 1 20); do run cellular_voronoi thickness=0.2 smoothlevel=3 seed=$s; done
for s in $(seq 1 20); do run cellular_sandwich thickness=0.2 size=0.2 seed=$s; done
for s in $(seq 1 20); do run cellular_vorosand thickness=0.2 smoothlevel=3 size=0.2 seed=$s; done
