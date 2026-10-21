"""Monte Carlo checks for the exact R8 model (independent of OpenCASCADE).

 (a) frustum model: the piecewise-linear-radius union that build_r8.py fuses. The B-Rep volume should match it.
 (b) field definition: a point is solid if its distance to the nearest full BCC strut is below r(p),
     with r(p) evaluated at the point (src/topology/coupled.ts buildR8). This is the field without the
     5x5x5 block limit, so it isolates the approximation of the exact model.
Usage: python check_r8_mc.py [L=20] [nsub=4] [N=200000]
"""
import math
import sys
import os

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_r8 as B  # noqa: E402
from build_lattice import struts  # noqa: E402


def main():
    L = float(sys.argv[1]) if len(sys.argv) > 1 else 20.0
    nsub = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    N = int(sys.argv[3]) if len(sys.argv) > 3 else 200000
    segs = struts("bcc", L, B.CELL, B.R0 + B.AMP)
    A = np.array([s[0] for s in segs], float)
    Bp = np.array([s[1] for s in segs], float)
    # sub-segments for (a)
    subA, subB, rA, rB = [], [], [], []
    for a, b in zip(A, Bp):
        pts = [a + (b - a) * j / nsub for j in range(nsub + 1)]
        rs = [B.radius(tuple(p)) for p in pts]
        for j in range(nsub):
            subA.append(pts[j]); subB.append(pts[j + 1]); rA.append(rs[j]); rB.append(rs[j + 1])
    subA, subB = np.array(subA), np.array(subB)
    rA, rB = np.array(rA), np.array(rB)
    dS = subB - subA
    lenS2 = (dS ** 2).sum(1)
    rng = np.random.default_rng(7)
    P = rng.random((N, 3)) * L
    inA = np.zeros(N, bool)
    inB = np.zeros(N, bool)
    # r(p) at the sample points for (b)
    rP = np.array([B.radius(tuple(p)) for p in P])
    # (b): distance to nearest full strut
    dmin = np.full(N, np.inf)
    dA = A.copy(); dD = Bp - A; dl2 = (dD ** 2).sum(1)
    for k in range(0, len(A), 32):
        a = dA[k:k + 32]; d = dD[k:k + 32]; ll = dl2[k:k + 32]
        w = P[:, None, :] - a[None]
        t = np.clip((w * d[None]).sum(2) / ll[None], 0, 1)
        q = w - t[..., None] * d[None]
        dmin = np.minimum(dmin, np.sqrt((q ** 2).sum(2)).min(1))
    inB = dmin < rP
    # (a): frustum union
    for k in range(0, len(subA), 32):
        a = subA[k:k + 32]; d = dS[k:k + 32]; ll = lenS2[k:k + 32]
        ra = rA[k:k + 32]; rb = rB[k:k + 32]
        w = P[:, None, :] - a[None]
        t = np.clip((w * d[None]).sum(2) / ll[None], 0, 1)
        q = w - t[..., None] * d[None]
        dist = np.sqrt((q ** 2).sum(2))
        rat = ra[None] + t * (rb - ra)[None]
        inA |= (dist <= rat).any(1)
    fa, fb = inA.mean(), inB.mean()
    se = lambda f: math.sqrt(f * (1 - f) / N) * L ** 3
    print(f"frustum model (a)  volume = {fa * L**3:.2f} +- {se(fa):.2f} mm^3  (N={N}, sub-segments={len(subA)})")
    print(f"field definition (b) volume = {fb * L**3:.2f} +- {se(fb):.2f} mm^3  (full lattice, no block limit)")


if __name__ == "__main__":
    main()
