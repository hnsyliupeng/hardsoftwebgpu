"""Exact B-Rep strut lattices (OpenCASCADE via CadQuery) for the field lattice types.

Geometry: the unit-cell strut patterns of src/topology/lattice.ts (exported to patterns.json by
scripts/export_lattice_patterns.ts), tiled over an L x L x L box with cell size `cell`. Each strut
is a cylinder of radius r with a sphere at every node, so the union equals the union of capsules
used by the field (distance to segment <= r). The box is the build envelope; the result is
intersected with it.

Memory: one boolean over all struts exceeded 3.8 GB at BCC L=20 on this 4 GB host. Struts are
therefore grouped by the z-layer of their midpoint, each layer is fused in chunks, the layers are
clipped and unioned, and the result is intersected with the envelope once.

Usage (from the repo root, with the cadquery environment and the GL stub on LD_LIBRARY_PATH):
  python python/exact/build_lattice.py <type> <L_mm> <cell_mm> <radius_mm> [out_prefix]
Writes <out_prefix>.step (if given) and prints a JSON record.
"""
from __future__ import annotations

import itertools
import json
import math
import os
import sys
import time

import cadquery as cq

HERE = os.path.dirname(os.path.abspath(__file__))
SPHERE_SCALE = 1.002   # node sphere slightly larger than r: avoids tangent contact with the struts
PATTERNS = os.path.join(HERE, "patterns.json")


def _key(p):
    return (round(p[0] * 1e6), round(p[1] * 1e6), round(p[2] * 1e6))


def _in_box(p, lo, hi):
    return all(lo[c] <= p[c] <= hi[c] for c in range(3))


def _seg_hits_box(p0, p1, lo, hi):
    """Segment-box overlap (slab method)."""
    t0, t1 = 0.0, 1.0
    for c in range(3):
        d = p1[c] - p0[c]
        if abs(d) < 1e-12:
            if p0[c] < lo[c] or p0[c] > hi[c]:
                return False
            continue
        a, b = (lo[c] - p0[c]) / d, (hi[c] - p0[c]) / d
        if a > b:
            a, b = b, a
        t0, t1 = max(t0, a), min(t1, b)
        if t0 > t1:
            return False
    return True


def struts(kind: str, L: float, cell: float, r: float):
    """Unique struts (p0, p1) of the tiled pattern that come within r of the envelope [0, L]^3."""
    pattern = json.load(open(PATTERNS))[kind]
    n = int(round(L / cell))
    seen = set()
    out = []
    lo, hi = (-r, -r, -r), (L + r, L + r, L + r)
    for i, j, k in itertools.product(range(-2, n + 2), repeat=3):
        for s in pattern:
            p0 = (s[0] * cell + i * cell, s[1] * cell + j * cell, s[2] * cell + k * cell)
            p1 = (s[3] * cell + i * cell, s[4] * cell + j * cell, s[5] * cell + k * cell)
            if not _seg_hits_box(p0, p1, lo, hi):
                continue
            key = frozenset((_key(p0), _key(p1)))
            if key in seen:
                continue
            seen.add(key)
            out.append((p0, p1))
    return out


def fuse_all(solids):
    """One boolean call over all items. Chunked trees of fuse results (compounds) were tested and
    gave wrong solids (BCC L=8 cell: 18 solids instead of 1), so chunking is not used. Memory is
    kept bounded by building per z-layer (see build)."""
    items = list(solids)
    if len(items) == 1:
        return items[0]
    return items[0].fuse(*items[1:])


FUZZY = 1e-4   # mm. Without it, sequential fuses of cylinders and spheres silently dropped pieces
               # (BCC block: 13 solids instead of 1). A single multi-argument fuse over ~85 FBCC tools
               # exhausted 3.4 GB, so the cell-block mode fuses one item at a time with this tolerance.


def fuse_seq(solids):
    items = list(solids)
    acc = items[0]
    for it in items[1:]:
        acc = acc.fuse(it, tol=FUZZY)
    return acc


def build_cells(kind: str, L: float, cell: float, r: float, step: str | None = None, log=print):
    """Cell-block variant (used for FBCC, which runs out of memory in one z-layer fuse).

    Each strut belongs to the cell that contains its midpoint; each node sphere belongs to the cell
    that contains the node (clamped to the envelope). So every sphere is built once and no two blocks
    share a coincident spherical face. Blocks are fused within a z-layer, layers are unioned, and the
    result is intersected with the envelope once.
    """
    t0 = time.perf_counter()
    segs = struts(kind, L, cell, r)
    n = int(round(L / cell))
    env = cq.Solid.makeBox(L, L, L, pnt=cq.Vector(0, 0, 0))

    def cell_of(p):
        return tuple(min(max(math.floor(p[c] / cell), 0), n - 1) for c in range(3))

    blocks: dict[tuple, dict] = {}
    for p0, p1 in segs:
        mid = [(p0[c] + p1[c]) / 2 for c in range(3)]
        bl = blocks.setdefault(cell_of(mid), {"s": [], "n": {}})
        bl["s"].append((p0, p1))
        # every strut end gets a sphere in the block that holds the strut, so its flat end caps lie
        # inside a sphere of the same fuse (coincident caps across blocks crashed OCCT, see notes).
        for p in (p0, p1):
            bl["n"][_key(p)] = p
    for p0, p1 in segs:
        for p in (p0, p1):
            blocks.setdefault(cell_of(p), {"s": [], "n": {}})["n"][_key(p)] = p
    log(f"struts {len(segs)} blocks {len(blocks)}")
    cores = {}
    for idx in sorted(blocks):
        bl = blocks[idx]
        tools = []
        for p0, p1 in bl["s"]:
            v = cq.Vector(*[p1[c] - p0[c] for c in range(3)])
            tools.append(cq.Solid.makeCylinder(r, v.Length, cq.Vector(*p0), v.normalized()))
        for p in bl["n"].values():
            tools.append(cq.Solid.makeSphere(r * SPHERE_SCALE, cq.Vector(*p), cq.Vector(0, 0, 1), -90, 90, 360))
        cores[idx] = fuse_seq(tools)
    log(f"  blocks fused t={time.perf_counter() - t0:.1f}s")
    layers: dict[int, list] = {}
    for idx, sh in cores.items():
        layers.setdefault(idx[2], []).append(sh)
    layer_shapes = []
    for k in sorted(layers):
        layer_shapes.append(fuse_seq(layers[k]))
        log(f"  layer {k}: blocks {len(layers[k])} t={time.perf_counter() - t0:.1f}s")
    union = fuse_seq(layer_shapes)
    log(f"  union: solids {len(union.Solids())} vol {union.Volume():.3f} valid {union.isValid()}")
    solid = union.intersect(env)
    res = {
        "type": kind, "L_mm": L, "cell_mm": cell, "radius_mm": r, "mode": "cells",
        "struts": len(segs), "blocks": len(blocks), "layers": len(layers),
        "volume_mm3": round(solid.Volume(), 4), "is_valid": solid.isValid(),
        "solids": len(solid.Solids()), "faces": len(solid.Faces()),
        "build_s": round(time.perf_counter() - t0, 1),
    }
    if step:
        cq.exporters.export(cq.Workplane().add(solid), step)
        res["step"] = step
    return solid, res


def build(kind: str, L: float, cell: float, r: float, step: str | None = None, log=print):
    t0 = time.perf_counter()
    segs = struts(kind, L, cell, r)
    env = cq.Solid.makeBox(L, L, L, pnt=cq.Vector(0, 0, 0))
    # layer by midpoint z (cell units); layer boundaries are offset from nodes by a fixed fraction
    # LAYER_FRAC (default 1.0) sets the layer height as a fraction of the cell. Thinner layers reduce
    # the number of struts fused in one call (FBCC ran out of memory at 1.0). Geometry is unchanged.
    h = cell * float(os.environ.get("LAYER_FRAC", "1.0"))
    layers: dict[int, list] = {}
    for p0, p1 in segs:
        mz = (p0[2] + p1[2]) / 2
        layers.setdefault(math.floor(mz / h), []).append((p0, p1))
    log(f"struts {len(segs)} layers {len(layers)}")
    layer_shapes = []
    n_nodes = 0
    for li in sorted(layers):
        tools = []
        nodes = {}
        for p0, p1 in layers[li]:
            for p in (p0, p1):
                nodes[_key(p)] = p
            v = cq.Vector(*[p1[c] - p0[c] for c in range(3)])
            tools.append(cq.Solid.makeCylinder(r, v.Length, cq.Vector(*p0), v.normalized()))
        for p in nodes.values():
            tools.append(cq.Solid.makeSphere(r * SPHERE_SCALE, cq.Vector(*p), cq.Vector(0, 0, 1), -90, 90, 360))
        n_nodes += len(nodes)
        core = fuse_all(tools)
        layer_shapes.append(core)
        log(f"  layer {li}: struts {len(layers[li])} tools {len(tools)} t={time.perf_counter() - t0:.1f}s")
    for li, sh in zip(sorted(layers), layer_shapes):
        log(f"  core {li}: solids {len(sh.Solids())} vol {sh.Volume():.3f} valid {sh.isValid()}")
    union = fuse_all(layer_shapes)
    log(f"  union: solids {len(union.Solids())} vol {union.Volume():.3f} valid {union.isValid()}")
    solid = union.intersect(env)
    res = {
        "type": kind, "L_mm": L, "cell_mm": cell, "radius_mm": r,
        "struts": len(segs), "nodes": n_nodes, "layers": len(layers),
        "volume_mm3": round(solid.Volume(), 4), "is_valid": solid.isValid(),
        "solids": len(solid.Solids()), "faces": len(solid.Faces()),
        "build_s": round(time.perf_counter() - t0, 1),
    }
    if step:
        cq.exporters.export(cq.Workplane().add(solid), step)
        res["step"] = step
    return solid, res


if __name__ == "__main__":
    kind, L, cell, r = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
    prefix = sys.argv[5] if len(sys.argv) > 5 else None
    fn = build_cells if os.environ.get("MODE") == "cells" else build
    _, res = fn(kind, L, cell, r, step=(prefix + ".step") if prefix else None,
                log=lambda m: print(m, file=sys.stderr, flush=True))
    print(json.dumps(res, indent=1))
