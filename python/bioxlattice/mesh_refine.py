"""Conformal long-edge refinement of a triangle mesh, and mesh quality metrics.

OpenCASCADE discretises straight B-Rep edges (for example the vertical seams of a filleted box) with a
single segment. Triangles that span such an edge are long needles (up to 16 mm long, about 0.1 mm wide
here). They render as spikes and make the mesh poor for shading and for downstream tools.

refine_long_edges splits every edge longer than max_edge at its midpoint and re-triangulates each
triangle according to how many of its edges were split (0, 1, 2 or 3 splits). This keeps the mesh
conformal (no T-junctions), watertight, and oriented. Midpoints of straight edges lie exactly on the
surface. Midpoints of arcs move by the chord sag, which is well below the tessellation deflection.
"""
from __future__ import annotations

import math


def _edge_key(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def refine_long_edges(verts, tris, max_edge: float, max_passes: int = 6):
    """Return (verts, tris) with every edge <= max_edge (or max_passes reached).

    verts: sequence of (x, y, z); tris: sequence of (i, j, k) with consistent winding.
    """
    V = [tuple(map(float, v)) for v in verts]
    T = [tuple(map(int, t)) for t in tris]
    for _ in range(max_passes):
        mids: dict[tuple[int, int], int] = {}
        for a, b, c in T:
            for u, v in ((a, b), (b, c), (c, a)):
                k = _edge_key(u, v)
                if k in mids:
                    continue
                pu, pv = V[u], V[v]
                if math.dist(pu, pv) > max_edge:
                    mids[k] = -1  # placeholder; index assigned below
        if not mids:
            break
        for k in list(mids):
            pu, pv = V[k[0]], V[k[1]]
            V.append(((pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2, (pu[2] + pv[2]) / 2))
            mids[k] = len(V) - 1
        out: list[tuple[int, int, int]] = []
        for a, b, c in T:
            # split flags for edges (a,b), (b,c), (c,a)
            m_ab = mids.get(_edge_key(a, b))
            m_bc = mids.get(_edge_key(b, c))
            m_ca = mids.get(_edge_key(c, a))
            flags = [m_ab is not None, m_bc is not None, m_ca is not None]
            n = sum(flags)
            if n == 0:
                out.append((a, b, c))
            elif n == 1:
                # rotate so the split edge is (a, b)
                if flags[1]:
                    a, b, c, m = b, c, a, m_bc
                elif flags[2]:
                    a, b, c, m = c, a, b, m_ca
                else:
                    m = m_ab
                out.append((a, m, c))
                out.append((m, b, c))
            elif n == 2:
                # rotate so the unsplit edge is (c, a)
                if not flags[0]:
                    a, b, c = b, c, a
                    m_ab, m_bc = m_bc, m_ca
                elif not flags[1]:
                    a, b, c = c, a, b
                    m_ab, m_bc = m_ca, m_ab
                out.append((a, m_ab, c))
                out.append((m_ab, b, m_bc))
                out.append((m_ab, m_bc, c))
            else:
                out.append((a, m_ab, m_ca))
                out.append((m_ab, b, m_bc))
                out.append((m_ca, m_bc, c))
                out.append((m_ab, m_bc, m_ca))
        T = out
    return V, T


def quality_report(verts, tris, z_span_mm: float = 5.0) -> dict:
    """Edge and aspect statistics; needles are triangles with aspect > 100 that span z_span_mm in height."""
    max_edge = 0.0
    longest_over = 0
    needles = 0
    aspects = []
    for a, b, c in tris:
        pa, pb, pc = verts[a], verts[b], verts[c]
        e = [math.dist(pa, pb), math.dist(pb, pc), math.dist(pc, pa)]
        L = max(e)
        max_edge = max(max_edge, L)
        # twice the area via cross product, altitude = 2A / L
        ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
        wx, wy, wz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
        cx, cy, cz = uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx
        area2 = math.sqrt(cx * cx + cy * cy + cz * cz)
        alt = area2 / L if L > 0 else 0.0
        asp = L / alt if alt > 1e-12 else float("inf")
        aspects.append(asp)
        zs = (pa[2], pb[2], pc[2])
        if asp > 100 and max(zs) - min(zs) >= z_span_mm:
            needles += 1
    aspects.sort()
    n = len(aspects)
    return {
        "triangles": len(tris),
        "max_edge_mm": round(max_edge, 4),
        "aspect_p50": round(aspects[n // 2], 2) if n else 0.0,
        "aspect_p99": round(aspects[int(n * 0.99)], 2) if n else 0.0,
        "needles_aspect_gt_100_span_ge_%smm" % z_span_mm: needles,
    }
