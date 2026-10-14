"""Export: editable STEP (B-Rep, analytic faces), high-resolution STL and a web mesh binary."""
from __future__ import annotations

import math
import struct

import cadquery as cq


def write_step(shape: cq.Shape, path: str) -> None:
    cq.exporters.export(cq.Workplane("XY").add(shape), path, exportType="STEP")


def tessellate_merged(shape: cq.Shape, deflection: float, angular: float, tol: float = 1e-6,
                      max_edge: float | None = None):
    """Mesh the whole shape once, then read each face's triangulation and merge shared vertices.

    Meshing faces one at a time (Shape.tessellate per face) re-discretises shared edges and leaves
    inconsistent triangulations; a single BRepMesh pass keeps the edge polylines shared.
    Vertices that coincide within `tol` are merged with a spatial hash.
    """
    from OCP.BRep import BRep_Tool
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopAbs import TopAbs_REVERSED
    from OCP.TopLoc import TopLoc_Location

    BRepMesh_IncrementalMesh(shape.wrapped, deflection, False, angular, True)
    verts: list[tuple[float, float, float]] = []
    cells: dict[tuple[int, int, int], list[int]] = {}
    tris: list[tuple[int, int, int]] = []
    cell = 1e-3

    def vid(x, y, z):
        c = (math.floor(x / cell), math.floor(y / cell), math.floor(z / cell))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for i in cells.get((c[0] + dx, c[1] + dy, c[2] + dz), ()):
                        q = verts[i]
                        if abs(q[0] - x) <= tol and abs(q[1] - y) <= tol and abs(q[2] - z) <= tol:
                            return i
        i = len(verts)
        verts.append((x, y, z))
        cells.setdefault(c, []).append(i)
        return i

    for face in shape.Faces():
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face.wrapped, loc)
        if tri is None:
            continue
        trsf = loc.Transformation()
        local = []
        for n in range(1, tri.NbNodes() + 1):
            p = tri.Node(n).Transformed(trsf)
            local.append(vid(p.X(), p.Y(), p.Z()))
        flip = face.wrapped.Orientation() == TopAbs_REVERSED
        for t in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(t).Get()
            i, j, k = local[a - 1], local[b - 1], local[c - 1]
            if flip:
                j, k = k, j
            if i != j and j != k and i != k:
                tris.append((i, j, k))
    if max_edge:
        # split long straight-edge needles (OCC leaves a straight edge as one segment); conformal
        from .mesh_refine import refine_long_edges
        verts, tris = refine_long_edges(verts, tris, max_edge)
    return verts, tris


def write_stl(path: str, verts, tris, name: str = "bioxlattice") -> None:
    """Binary STL (84-byte header + 50 bytes per triangle)."""
    with open(path, "wb") as fh:
        fh.write(name.encode("ascii")[:80].ljust(80, b" "))
        fh.write(struct.pack("<I", len(tris)))
        for i, j, k in tris:
            a, b, c = verts[i], verts[j], verts[k]
            u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
            v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
            n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
            ln = (n[0] ** 2 + n[1] ** 2 + n[2] ** 2) ** 0.5 or 1.0
            fh.write(struct.pack("<12fH", n[0] / ln, n[1] / ln, n[2] / ln, *a, *b, *c, 0))


def write_mesh_bin(path: str, verts, tris) -> None:
    """Little-endian: uint32 nv, uint32 nt, float32 xyz*nv, uint32 ijk*nt (consumed by web/viewer)."""
    with open(path, "wb") as fh:
        fh.write(struct.pack("<II", len(verts), len(tris)))
        for x, y, z in verts:
            fh.write(struct.pack("<3f", x, y, z))
        for i, j, k in tris:
            fh.write(struct.pack("<3I", i, j, k))
