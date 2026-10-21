"""Exact B-Rep for R8: a BCC strut lattice whose strut radius is set by a gyroid field.

Field (src/topology/coupled.ts, buildR8):  r(p) = r0 + amp * tanh(gain * F(p)),
F = sinX cosY + sinY cosZ + sinZ cosX with X = 2*pi*x / tpms_cell (src/topology/lattice.ts).

Exact model: each BCC strut is split into `nsub` sub-segments at which the radius r(p) is sampled; the strut
is a ruled loft through the circles (radius piecewise linear along the axis). Every node gets a
sphere of radius r(node). All tools are fused per z-layer (one boolean per layer) and the union is
intersected with the L^3 envelope. The result is an exact OpenCASCADE B-Rep.

Usage: python build_r8.py <out_prefix> [L=20] [nsub=4]
"""
from __future__ import annotations

import json
import math
import os
import sys
import time

import cadquery as cq

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_lattice import _key, fuse_all, struts  # noqa: E402

CELL = 4.0
R0, AMP, GAIN, TPMS_CELL = 0.45, 0.1, 1.0, 5.0
SPHERE_SCALE = 1.002


def gyroid_F(x, y, z):
    k = 2 * math.pi / TPMS_CELL
    X, Y, Z = k * x, k * y, k * z
    return math.sin(X) * math.cos(Y) + math.sin(Y) * math.cos(Z) + math.sin(Z) * math.cos(X)


def radius(p):
    return R0 + AMP * math.tanh(GAIN * gyroid_F(*p))


def build(L: float, nsub: int, prefix: str | None, log=print):
    t0 = time.perf_counter()
    segs = struts("bcc", L, CELL, R0 + AMP)  # margin = max radius, so struts that reach the box are kept
    env = cq.Solid.makeBox(L, L, L, pnt=cq.Vector(0, 0, 0))
    h = CELL * float(os.environ.get("LAYER_FRAC", "1.0"))
    layers: dict[int, list] = {}
    for p0, p1 in segs:
        mz = (p0[2] + p1[2]) / 2
        layers.setdefault(math.floor(mz / h), []).append((p0, p1))
    log(f"struts {len(segs)} layers {len(layers)} nsub {nsub}")
    layer_shapes = []
    total_nodes = set()
    for li in sorted(layers):
        tools = []
        nodes = {}
        for p0, p1 in layers[li]:
            for p in (p0, p1):
                nodes[_key(p)] = p
            d = [p1[c] - p0[c] for c in range(3)]
            pts = [tuple(p0[c] + d[c] * j / nsub for c in range(3)) for j in range(nsub + 1)]
            rs = [radius(p) for p in pts]
            # one ruled loft per strut (piecewise frusta, no internal caps). Sub-cones with coincident
            # caps gave a silently incomplete layer fuse (about 1 mm of lattice missing at z = 10 mm).
            ax = cq.Vector(*d).normalized()
            wires = [cq.Wire.makeCircle(rs[j], cq.Vector(*pts[j]), ax) for j in range(nsub + 1)]
            tools.append(cq.Solid.makeLoft(wires, True))
        for k, p in nodes.items():
            total_nodes.add(k)
            tools.append(cq.Solid.makeSphere(radius(p) * SPHERE_SCALE, cq.Vector(*p), cq.Vector(0, 0, 1), -90, 90, 360))
        core = fuse_all(tools)
        layer_shapes.append(core)
        log(f"  layer {li}: struts {len(layers[li])} tools {len(tools)} solids {len(core.Solids())} t={time.perf_counter() - t0:.1f}s")
    # Layers are unioned one at a time: a single call over 12 layer solids segfaulted in OCCT.
    union = layer_shapes[0]
    for i, sh in enumerate(layer_shapes[1:], start=1):
        union = union.fuse(sh)
        log(f"  union {i}/{len(layer_shapes) - 1}: solids {len(union.Solids())} t={time.perf_counter() - t0:.1f}s")
    solid = union.intersect(env)
    log(f"  intersect: solids {len(solid.Solids())} t={time.perf_counter() - t0:.1f}s")
    res = {
        "type": "R8 (BCC strut radius from gyroid)", "L_mm": L, "cell_mm": CELL, "r0_mm": R0, "amp_mm": AMP,
        "gain": GAIN, "tpms_cell_mm": TPMS_CELL, "nsub": nsub, "struts": len(segs), "nodes": len(total_nodes),
        "volume_mm3": round(solid.Volume(), 4), "is_valid": solid.isValid(), "solids": len(solid.Solids()),
        "faces": len(solid.Faces()), "build_s": round(time.perf_counter() - t0, 1),
    }
    if prefix:
        cq.exporters.export(cq.Workplane().add(solid), prefix + ".step")
        res["step"] = prefix + ".step"
    return solid, res


if __name__ == "__main__":
    prefix = sys.argv[1]
    L = float(sys.argv[2]) if len(sys.argv) > 2 else 20.0
    nsub = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    _, res = build(L, nsub, prefix, log=lambda m: print(m, file=sys.stderr, flush=True))
    print(json.dumps(res, indent=1))
