"""Check which fibre convention reproduces the recorded fibre volumes in the gallery.

The gallery rect/cylinder designs were generated before commit aff94f9 (fibre half-length sqrt(2),
fibres extended beyond the plate). This script evaluates the four combinations of ply centring and
fibre length/extension, to show which convention produced the recorded numbers.
Usage: python3 python/validation/fibre_hypothesis.py [N=1000000]
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bio_reference as B  # noqa: E402


def fibre_volume(kind, n_plies, rot, zmode, half, grid, N=1_000_000, seed=3):
    t = 2.0 / n_plies
    pitch = t + B.GAP if kind == "rect" else t
    n_fib = max(1, int(2.0 / pitch))
    start = (-1.0 + pitch / 2.0 + (2.0 - n_fib * pitch) / 2.0) if kind == "rect" else \
        (-1.0 + t / 2.0 + (2.0 - n_fib * t) / 2.0)
    plies = []
    for i in range(n_plies):
        zc = i * t if zmode == "upstream" else (i + 0.5) * t
        th = math.radians(i * rot)
        if grid == "upstream":
            centres = [start + k * pitch for k in range(n_fib)]
        else:
            lim = math.sqrt(2.0) + pitch
            k_lo, k_hi = math.floor((-lim - start) / pitch), math.ceil((lim - start) / pitch)
            centres = [start + k * pitch for k in range(k_lo, k_hi + 1)]
        plies.append((zc, th, centres))
    rng = np.random.default_rng(seed)
    total = 0
    for m in B._chunks(N):
        P = rng.random((m, 3)) * np.array([2.0, 2.0, 2.0]) + np.array([-1.0, -1.0, 0.0])
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ins = np.zeros(m, bool)
        for zc, th, cs in plies:
            c, s = math.cos(th), math.sin(th)
            xr = c * x + s * y
            yr = -s * x + c * y
            dz = z - zc
            inz = np.abs(dz) <= t / 2
            for yk in cs:
                if kind == "rect":
                    ins |= (np.abs(xr) <= half) & (np.abs(yr - yk) <= t / 2) & inz
                else:
                    ins |= (np.abs(xr) <= half) & ((yr - yk) ** 2 + dz ** 2 <= (t / 2) ** 2)
        total += int(ins.sum())
    return 8.0 * total / N * 1000.0


def main():
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 1_000_000
    cases = [("rect", 10, 10, 6581.9), ("cyl", 9, 10, 5548.4)]
    for kind, n, rot, rec in cases:
        for zmode in ["upstream", "repo"]:
            for half in [1.0, math.sqrt(2.0)]:
                for grid in ["upstream", "extended"]:
                    v = fibre_volume(kind, n, rot, zmode, half, grid, N)
                    print(f"{kind:5s} zc={zmode:8s} half={half:.3f} grid={grid:9s} -> {v:8.1f} mm3"
                          f"  (recorded {rec}, {100 * (rec - v) / v:+.1f} %)", flush=True)


if __name__ == "__main__":
    main()
