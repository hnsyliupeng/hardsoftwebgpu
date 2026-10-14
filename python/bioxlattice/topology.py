"""Unit-cell strut topologies in lattice units (cell edge = 1).

Definitions follow the standard strut lattices catalogued by LatticeQuery
(simple cubic, body-centred, face-centred). Formulas are re-implemented here;
no LatticeQuery code is copied. Segments are returned in global lattice units
and de-duplicated by endpoint so that cells sharing a node or edge do not
produce duplicate struts.
"""
from __future__ import annotations

import itertools

Point = tuple[float, float, float]
Segment = tuple[Point, Point]

TOPOLOGIES = ("sc", "bcc", "fcc")


def _cell_segments(kind: str, i: int, j: int, k: int) -> list[Segment]:
    def P(x: float, y: float, z: float) -> Point:
        return (i + x, j + y, k + z)

    if kind == "sc":
        o = P(0, 0, 0)
        return [(o, P(1, 0, 0)), (o, P(0, 1, 0)), (o, P(0, 0, 1))]
    if kind == "bcc":
        c = P(0.5, 0.5, 0.5)
        return [(P(*corner), c) for corner in itertools.product((0.0, 1.0), repeat=3)]
    if kind == "fcc":
        segs: list[Segment] = []
        # six faces; each face centre joins the four corners of that face
        for axis in range(3):
            for side in (0.0, 1.0):
                others = [a for a in range(3) if a != axis]
                centre = [0.5, 0.5, 0.5]
                centre[axis] = side
                cp = P(*centre)
                for u, v in itertools.product((0.0, 1.0), repeat=2):
                    corner = [0.0, 0.0, 0.0]
                    corner[axis] = side
                    corner[others[0]] = u
                    corner[others[1]] = v
                    segs.append((cp, P(*corner)))
        return segs
    raise ValueError(f"unknown topology {kind!r}; expected one of {TOPOLOGIES}")


def _key(p: Point) -> tuple[int, int, int]:
    return (round(p[0] * 1e6), round(p[1] * 1e6), round(p[2] * 1e6))


def lattice_segments(kind: str, lo: tuple[int, int, int], hi: tuple[int, int, int]) -> list[Segment]:
    """All unique struts of cells with integer origins in [lo, hi) per axis."""
    seen: set[frozenset] = set()
    out: list[Segment] = []
    for i, j, k in itertools.product(range(lo[0], hi[0]), range(lo[1], hi[1]), range(lo[2], hi[2])):
        for a, b in _cell_segments(kind, i, j, k):
            key = frozenset((_key(a), _key(b)))
            if key in seen:
                continue
            seen.add(key)
            out.append((a, b))
    return out
