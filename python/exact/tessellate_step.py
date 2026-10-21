"""Tessellate an exact STEP (OpenCASCADE) into a binary triangle mesh for the renderer.

Format (little endian): uint32 nv, uint32 nt, then nv*3 float32 positions, then nt*3 uint32 indices.
Usage: python tessellate_step.py <in.step> <out.mesh> [tolerance_mm=0.02] [angular_rad=0.2]
Also prints the mesh volume (divergence theorem) and the tessellation's watertightness check.
"""
import struct
import sys
from collections import Counter

import cadquery as cq
import numpy as np


def tessellate_to_mesh(shape, dst, tol=0.02, ang=0.2):
    """Tessellate an OCC shape, weld duplicate vertices, write the binary mesh, return topology stats."""
    verts, tris = shape.tessellate(tol, ang)
    P = np.array([[v.x, v.y, v.z] for v in verts], dtype=np.float64)
    T = np.array(tris, dtype=np.int64)
    # OCC tessellates each face separately, so coincident vertices on shared edges are duplicated.
    # Weld them by position (1e-5 mm grid) so that the edge check is topological.
    keys = np.round(P * 1e5).astype(np.int64)
    _, first, inv = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    P = P[first]
    T = inv.reshape(-1)[T]
    keep = (T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])
    T = T[keep]
    P = P.astype(np.float32)
    T = T.astype(np.uint32)
    a, b, c = P[T[:, 0]].astype(np.float64), P[T[:, 1]].astype(np.float64), P[T[:, 2]].astype(np.float64)
    vol = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)
    edges = Counter()
    for i, j, k in T:
        for u, v in ((i, j), (j, k), (k, i)):
            edges[(min(u, v), max(u, v))] += 1
    with open(dst, "wb") as f:
        f.write(struct.pack("<II", len(P), len(T)))
        f.write(P.tobytes())
        f.write(T.tobytes())
    return {"vertices": int(len(P)), "triangles": int(len(T)), "volume_mesh_mm3": round(vol, 3),
            "open_edges": int(sum(1 for n in edges.values() if n == 1)),
            "nonmanifold_edges": int(sum(1 for n in edges.values() if n > 2)), "tol_mm": tol, "angular_rad": ang}


def main():
    src, dst = sys.argv[1], sys.argv[2]
    tol = float(sys.argv[3]) if len(sys.argv) > 3 else 0.02
    ang = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2
    shape = cq.importers.importStep(src).val()
    print({"mesh": dst, **tessellate_to_mesh(shape, dst, tol, ang)})


if __name__ == "__main__":
    main()
