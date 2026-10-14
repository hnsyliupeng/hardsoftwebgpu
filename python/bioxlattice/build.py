"""Feature timeline for the coupled bio-lattice part (CadQuery / OpenCASCADE B-Rep).

Each feature is executed in order and recorded (name, parameters, seconds, volume, solids,
faces) so the build log can be replayed and audited, in the spirit of a parametric timeline.
"""
from __future__ import annotations

import bisect
import math
import time
from dataclasses import dataclass, field

import cadquery as cq

from .spec import CoupledSpec
from .topology import lattice_segments


@dataclass
class BuildResult:
    part: cq.Shape
    skin: cq.Shape
    core: cq.Shape
    outer: cq.Shape
    timeline: list[dict] = field(default_factory=list)
    lattice: dict = field(default_factory=dict)


def _box_filleted(lx: float, ly: float, lz: float, r: float) -> cq.Shape:
    wp = cq.Workplane("XY").box(lx, ly, lz)
    if r > 0:
        wp = wp.edges("|Z").fillet(r)
    return wp.val()


def _stats(shape: cq.Shape) -> dict:
    return {
        "volume": round(shape.Volume(), 6),
        "solids": len(shape.Solids()),
        "faces": len(shape.Faces()),
    }


def build(spec: CoupledSpec) -> BuildResult:
    spec.validate()
    e, s, l = spec.envelope, spec.skin, spec.lattice
    t = s.thickness
    ov = l.overlap
    a = l.cell
    timeline: list[dict] = []

    def step(name: str, params: dict, fn):
        t0 = time.perf_counter()
        shape = fn()
        rec = {"feature": name, "params": params, "seconds": round(time.perf_counter() - t0, 3)}
        rec.update(_stats(shape))
        timeline.append(rec)
        return shape

    hx, hy, hz = e.length / 2, e.width / 2, e.height / 2

    # L0 envelope (macro)
    outer = step("envelope_box", {"L": e.length, "W": e.width, "H": e.height, "fillet_vertical": e.edge_fillet},
                 lambda: _box_filleted(e.length, e.width, e.height, e.edge_fillet))

    # L1 closed skin: boolean difference (shell() yields a face-based STEP, so it is not used)
    r_in = max(e.edge_fillet - t, 0.2)
    cavity = step("cavity_box", {"L": e.length - 2 * t, "W": e.width - 2 * t, "H": e.height - 2 * t,
                                 "fillet_vertical": r_in},
                  lambda: _box_filleted(e.length - 2 * t, e.width - 2 * t, e.height - 2 * t, r_in))
    skin = step("skin_boolean_cut", {"thickness": t}, lambda: outer.cut(cavity))

    # L1b printability: vents through the bottom wall open the sealed lattice gaps to the outside.
    # Each cylinder starts below the bottom face and stops at the cavity floor, so only the wall is cut.
    vn = spec.vents
    if vn.enabled and vn.positions:
        cutters = [cq.Solid.makeCylinder(vn.diameter / 2, t + 1.0,
                                         cq.Vector(x, y, -hz - 1.0), cq.Vector(0, 0, 1))
                   for x, y in vn.positions]
        skin = step("skin_vent_cut", {"diameter": vn.diameter, "count": len(cutters), "positions": vn.positions},
                    lambda: skin.cut(*cutters))

    # L2 lattice core: clip box = cavity grown by the overlap so struts fuse into the skin
    clip_x = (e.length - 2 * t + 2 * ov) / 2
    clip_y = (e.width - 2 * t + 2 * ov) / 2
    clip_z = (e.height - 2 * t + 2 * ov) / 2
    clip = cq.Solid.makeBox(2 * clip_x, 2 * clip_y, 2 * clip_z, pnt=cq.Vector(-clip_x, -clip_y, -clip_z))

    # Lattice nodes at integer multiples of the cell edge covering the clip region (plus one cell).
    # midpoint filter margin: a strut that meets the clip region has its midpoint within half a
    # strut length (<= 0.87 a) of it; 0.9 a keeps every such strut
    rc = math.hypot(clip_x, clip_y) + 0.9 * a
    zc = clip_z + 0.6 * a  # z extent of every strut is <= a/2, so its midpoint is within a/4 of the clip
    ph = tuple(float(c) for c in l.phase)
    extra = math.ceil(max(abs(c) for c in ph) / a) if any(ph) else 0  # index range widened by the phase
    lo = (math.floor(-rc / a) - 1 - extra, math.floor(-rc / a) - 1 - extra, math.floor(-zc / a) - 1 - extra)
    hi = (math.ceil(rc / a) + 1 + extra, math.ceil(rc / a) + 1 + extra, math.ceil(zc / a) + 1 + extra)
    raw = lattice_segments(l.topology, lo, hi)
    kappa = math.radians(l.twist_deg_per_mm)  # rad per mm of z (continuous helical twist map)

    def world(p):
        return (p[0] * a + ph[0], p[1] * a + ph[1], p[2] * a + ph[2])

    def twist(p):
        # helical (Bouligand-like) coupling: each node rotates about z by kappa * z, so
        # neighbouring cells share their rotated nodes and the lattice stays connected
        x, y, z = p
        th = kappa * z
        c, sn = math.cos(th), math.sin(th)
        return (x * c - y * sn, x * sn + y * c, z)

    tiers_used = [0] * len(l.tier_radii)
    # group struts by z-layer (one cell tall) so each boolean stays small: peak memory and time
    # grow super-linearly with strut count on a 2-core CPU-only host
    layers: dict[int, list[tuple[int, cq.Shape]]] = {}
    n_kept = 0
    for p0, p1 in raw:
        w0, w1 = world(p0), world(p1)
        mx, my, mz = ((w0[0] + w1[0]) / 2, (w0[1] + w1[1]) / 2, (w0[2] + w1[2]) / 2)
        if math.hypot(mx, my) > rc or abs(mz) > zc:
            continue
        n_kept += 1
        # L3 graded radius from depth below the envelope surface (pre-twist coordinates)
        depth = min(hx - abs(mx), hy - abs(my), hz - abs(mz))
        idx = bisect.bisect_right(l.tier_depths, depth)
        tiers_used[idx] += 1
        r = l.tier_radii[idx]
        q0, q1 = twist(w0), twist(w1)
        v = cq.Vector(*q1) - cq.Vector(*q0)
        length = v.Length
        if length < 1e-9:
            continue
        layer = math.floor(mz / a)
        layers.setdefault(layer, []).append((idx, cq.Solid.makeCylinder(r, length, cq.Vector(*q0), v.normalized())))

    def fuse_all(solids: list[cq.Shape]) -> cq.Shape:
        return solids[0].fuse(*solids[1:]) if len(solids) > 1 else solids[0]

    layer_cores: list[cq.Shape] = []
    for layer in sorted(layers):
        items = layers[layer]
        tier_shapes = []
        for idx in sorted({i for i, _ in items}):
            bucket = [c for i, c in items if i == idx]
            tier_shapes.append(step(f"lattice_layer{layer}_tier{idx}", {
                "radius": l.tier_radii[idx], "struts": len(bucket), "topology": l.topology,
                "cell": a, "twist_deg_per_mm": l.twist_deg_per_mm,
            }, lambda b=bucket: fuse_all(b)))
        layer_fused = fuse_all(tier_shapes)
        layer_cores.append(step(f"lattice_layer{layer}_clip", {"z_range_mm": [layer * a, (layer + 1) * a]},
                                lambda f=layer_fused: f.intersect(clip)))
        layers[layer] = []  # release cylinders of this layer
    core = step("lattice_core_union", {"layers": len(layer_cores)}, lambda: fuse_all(layer_cores))

    # union with skin (struts fuse into the skin wall along the overlap)
    part = step("union_skin_core", {}, lambda: skin.fuse(core))

    lattice_info = {
        "topology": l.topology,
        "cell_mm": a,
        "struts_raw_unique": len(raw),
        "struts_kept": n_kept,
        "struts_per_tier": tiers_used,
        "tier_radii_mm": list(l.tier_radii),
        "tier_depths_mm": list(l.tier_depths),
        "twist_deg_per_mm": l.twist_deg_per_mm,
        "phase_mm": list(ph),
    }
    return BuildResult(part=part, skin=skin, core=core, outer=outer, timeline=timeline, lattice=lattice_info)
