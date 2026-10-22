"""Independent Monte Carlo check of an exact constant-radius strut lattice (no OpenCASCADE).

A point is solid if its distance to the nearest strut (within the envelope) is below r. The struts
are the same set build_lattice.struts() returns, so this checks the B-Rep boolean, not the pattern.
Usage: python check_lattice_mc.py <type> <L> <cell> <r> [N=100000]
Prints the estimate and its one-sigma error: the volume is L^3 * p with sigma = L^3 sqrt(p(1-p)/N).
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_lattice import struts  # noqa: E402


def main():
    kind = sys.argv[1]
    L, cell, r = float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
    N = int(sys.argv[5]) if len(sys.argv) > 5 else 100000
    segs = struts(kind, L, cell, r)
    A = np.array([s[0] for s in segs], float)
    D = np.array([s[1] for s in segs], float) - A
    dl2 = (D ** 2).sum(1)
    rng = np.random.default_rng(11)
    P = rng.random((N, 3)) * L
    dmin = np.full(N, np.inf)
    for k in range(0, len(A), 32):
        a = A[k:k + 32]; d = D[k:k + 32]; ll = dl2[k:k + 32]
        w = P[:, None, :] - a[None]
        t = np.clip((w * d[None]).sum(2) / ll[None], 0, 1)
        q = w - t[..., None] * d[None]
        dmin = np.minimum(dmin, np.sqrt((q ** 2).sum(2)).min(1))
    p = float((dmin < r).mean())
    V = L ** 3
    sig = V * math.sqrt(p * (1 - p) / N)
    print(f"{kind} L={L} cell={cell} r={r} N={N} struts={len(segs)}: V = {V * p:.3f} +- {sig:.3f} mm^3")


if __name__ == "__main__":
    main()
