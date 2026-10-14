"""Multi-level structural checks for a built coupled lattice part.

Each level has its own checks. A check records the observed value, the expected value (closed form
or an independent re-derivation from the spec), the tolerance, and a pass flag. Levels:

  L0 envelope    bounding box and outer volume against the closed form LWH - (4 - pi) r^2 H
  L1 skin        skin volume against envelope - cavity - vents (closed forms), vents open in the bottom wall only
  L2 lattice     core inside the clip box, strut bookkeeping
  L3 tiers       depth-tier radii re-derived from the spec, compared with the build's counts
  coupling       overlap volume computed independently (skin intersect core) against skin + core - part
  printability   watertight boundary, enclosed (internal) voids, vent openings, minimum wall proxy
  export         STEP re-import and editable B-Rep (from verify_step)

Gates: a level passes only if all its checks pass. Enclosed voids are a hard printability gate: a
sealed cavity cannot drain in printing. The report lists every void component with its location.
"""
from __future__ import annotations

import bisect
import math

import cadquery as cq

from .spec import CoupledSpec
from .spec import resolved_zones
from .topology import lattice_segments


def _check(cid: str, observed, expected, tol: float, note: str = "") -> dict:
    if isinstance(observed, bool) or isinstance(expected, bool):
        ok = bool(observed) == bool(expected)
    else:
        ok = abs(float(observed) - float(expected)) <= tol
    return {"id": cid, "observed": observed, "expected": expected, "tolerance": tol,
            "pass": bool(ok), "note": note}


def _level(checks: list[dict]) -> dict:
    return {"pass": all(c["pass"] for c in checks), "checks": checks}


VOID_MIN_VOLUME_MM3 = 1e-3


def analytic_envelope(spec: CoupledSpec) -> float:
    e = spec.envelope
    return e.length * e.width * e.height - (4 - math.pi) * e.edge_fillet ** 2 * e.height


def analytic_cavity(spec: CoupledSpec) -> float:
    e, t = spec.envelope, spec.skin.thickness
    r_in = max(e.edge_fillet - t, 0.2)  # same rule as build.py
    h_in = e.height - 2 * t
    return (e.length - 2 * t) * (e.width - 2 * t) * h_in - (4 - math.pi) * r_in ** 2 * h_in


def analytic_vent_volume(spec: CoupledSpec) -> float:
    v = spec.vents
    if not v.enabled:
        return 0.0
    return len(v.positions) * math.pi * (v.diameter / 2) ** 2 * spec.skin.thickness


def _tier_counts_from_spec(spec: CoupledSpec) -> tuple[list[int], int, list[int]]:
    """Re-derive per-tier and per-zone strut counts from the spec.

    Written separately from build.py's loop (same rules, independent code): zone grid from the
    phase, midpoint filter against the clip margin, zone ownership by midpoint, depth tier by the
    envelope surface distance.
    """
    e, t, l = spec.envelope, spec.skin.thickness, spec.lattice
    ov = l.overlap
    hx, hy, hz = e.length / 2, e.width / 2, e.height / 2
    clip_x = (e.length - 2 * t + 2 * ov) / 2
    clip_y = (e.width - 2 * t + 2 * ov) / 2
    clip_z = (e.height - 2 * t + 2 * ov) / 2
    ph = [float(c) for c in l.phase]
    zones = resolved_zones(spec)
    counts = [0] * len(l.tier_radii)
    per_zone = [0] * len(zones)
    kept = 0
    for zi, zn in enumerate(zones):
        a = zn["cell"]
        lo_bound = -math.inf if zi == 0 else zn["z0"]
        hi_bound = math.inf if zi == len(zones) - 1 else zn["z1"]
        rc = math.hypot(clip_x, clip_y) + 0.9 * a
        zc = clip_z + 0.6 * a
        extra = math.ceil(max(abs(c) for c in ph) / a) if any(ph) else 0
        zr0, zr1 = max(-zc, lo_bound), min(zc, hi_bound)
        if zr1 <= zr0:
            continue
        lo = (math.floor(-rc / a) - 1 - extra, math.floor(-rc / a) - 1 - extra,
              math.floor((zr0 - ph[2]) / a) - 1 - extra)
        hi = (math.ceil(rc / a) + 1 + extra, math.ceil(rc / a) + 1 + extra,
              math.ceil((zr1 - ph[2]) / a) + 1 + extra)
        for p0, p1 in lattice_segments(zn["topology"], lo, hi):
            w0 = [p0[i] * a + ph[i] for i in range(3)]
            w1 = [p1[i] * a + ph[i] for i in range(3)]
            mx, my, mz = ((w0[0] + w1[0]) / 2, (w0[1] + w1[1]) / 2, (w0[2] + w1[2]) / 2)
            if math.hypot(mx, my) > rc or abs(mz) > zc:
                continue
            if not (lo_bound <= mz < hi_bound):
                continue
            kept += 1
            per_zone[zi] += 1
            depth = min(hx - abs(mx), hy - abs(my), hz - abs(mz))
            counts[bisect.bisect_right(l.tier_depths, depth)] += 1
    return counts, kept, per_zone


def _void_components(comps: list[dict], verts, tris, spec: CoupledSpec) -> list[dict]:
    """Enclosed components (all but the outer boundary) with bbox, centroid, volume and location.

    `comps` is accepted for signature symmetry with mesh_components; the grouping is recomputed here
    so each void keeps its triangles for the volume integral.
    """
    e, t = spec.envelope, spec.skin.thickness
    hxi, hyi, hzi = e.length / 2 - t, e.width / 2 - t, e.height / 2 - t  # inner (cavity) half sizes
    # group triangles by component via the same union-find used in mesh_components
    parent = list(range(len(verts)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j, k in tris:
        for p, q in ((i, j), (j, k)):
            rp, rq = find(p), find(q)
            if rp != rq:
                parent[rp] = rq
    groups: dict[int, list] = {}
    for tr in tris:
        groups.setdefault(find(tr[0]), []).append(tr)
    out = []
    for g in groups.values():
        vidx = {v for tr in g for v in tr}
        pts = [verts[v] for v in vidx]
        lo = [min(p[d] for p in pts) for d in range(3)]
        hi = [max(p[d] for p in pts) for d in range(3)]
        vol = 0.0
        for i, j, k in g:
            a_, b_, c_ = verts[i], verts[j], verts[k]
            vol += (a_[0] * (b_[1] * c_[2] - b_[2] * c_[1]) - a_[1] * (b_[0] * c_[2] - b_[2] * c_[0])
                    + a_[2] * (b_[0] * c_[1] - b_[1] * c_[0])) / 6.0
        cen = [sum(p[d] for p in pts) / len(pts) for d in range(3)]
        out.append({"triangles": len(g), "volume_mm3": round(abs(vol), 4),
                    "bbox_min": [round(x, 3) for x in lo], "bbox_max": [round(x, 3) for x in hi],
                    "centroid": [round(x, 3) for x in cen],
                    "location": _location(lo, hi, hxi, hyi, hzi),
                    "_diag": sum((hi[d] - lo[d]) ** 2 for d in range(3)) ** 0.5})
    # the outer boundary is the component with the largest bounding-box diagonal (as in verify.mesh_components)
    out.sort(key=lambda c: -c["_diag"])
    for c in out:
        c.pop("_diag")
    return out[1:]


def _location(lo, hi, hxi, hyi, hzi, tol: float = 0.5) -> str:
    """Classify a void by its distance to the INNER wall planes (cavity half-sizes), not the outer faces."""
    lateral = hi[0] >= hxi - tol or lo[0] <= -hxi + tol or hi[1] >= hyi - tol or lo[1] <= -hyi + tol
    vertical = hi[2] >= hzi - tol or lo[2] <= -hzi + tol
    if lateral and not vertical:
        return "lateral wall"
    if vertical and not lateral:
        return "bottom/top wall"
    if lateral and vertical:
        return "edge"
    return "interior"


def _vent_checks(spec: CoupledSpec, verts, tris) -> list[dict]:
    v = spec.vents
    if not v.enabled:
        return []
    hz = spec.envelope.height / 2
    checks = []
    bottom = []
    for tr in tris:
        zs = [verts[i][2] for i in tr]
        if all(abs(z + hz) < 1e-3 for z in zs):
            cx = sum(verts[i][0] for i in tr) / 3
            cy = sum(verts[i][1] for i in tr) / 3
            bottom.append((cx, cy))
    for n, (x, y) in enumerate(v.positions):
        r = v.diameter / 2
        inside = sum(1 for cx, cy in bottom if math.hypot(cx - x, cy - y) < r - 0.1)
        rim = sum(1 for p in verts if abs(p[2] + hz) < 1e-3 and abs(math.hypot(p[0] - x, p[1] - y) - r) < 0.02)
        checks.append(_check(f"printability.vent{n}_open", inside == 0 and rim > 0, True, 0,
                             f"vent at ({x}, {y}): no bottom-face triangle inside the hole, rim vertices {rim}"))
    return checks


def run_checks(spec: CoupledSpec, result, verts, tris, verify_step_out: dict | None = None) -> dict:
    """Run all level checks on a BuildResult and its tessellation. Returns a JSON-ready report."""
    spec.validate()
    e, s, l, v = spec.envelope, spec.skin, spec.lattice, spec.vents
    t, ov, a = s.thickness, l.overlap, l.cell
    part, skin, core, outer = result.part, result.skin, result.core, result.outer
    levels: dict[str, dict] = {}

    # L0 envelope
    bb = part.BoundingBox()
    levels["L0_envelope"] = _level([
        _check("L0.bbox_x", bb.xlen, e.length, 0.05),
        _check("L0.bbox_y", bb.ylen, e.width, 0.05),
        _check("L0.bbox_z", bb.zlen, e.height, 0.05),
        _check("L0.outer_volume_closed_form", outer.Volume(), analytic_envelope(spec), 1e-3,
               "LWH - (4 - pi) r^2 H"),
    ])

    # L1 skin
    exp_skin = analytic_envelope(spec) - analytic_cavity(spec) - analytic_vent_volume(spec)
    levels["L1_skin"] = _level([
        _check("L1.skin_volume_closed_form", skin.Volume(), exp_skin, 1e-3,
               "envelope - cavity - n*pi*(d/2)^2*t"),
        _check("L1.skin_single_solid", len(skin.Solids()), 1, 0),
    ])

    # L2 lattice core
    clip_x = (e.length - 2 * t + 2 * ov) / 2
    clip_y = (e.width - 2 * t + 2 * ov) / 2
    clip_z = (e.height - 2 * t + 2 * ov) / 2
    cb = core.BoundingBox()
    levels["L2_lattice"] = _level([
        _check("L2.core_inside_clip_x", cb.xmax <= clip_x + 1e-3 and cb.xmin >= -clip_x - 1e-3, True, 0),
        _check("L2.core_inside_clip_y", cb.ymax <= clip_y + 1e-3 and cb.ymin >= -clip_y - 1e-3, True, 0),
        _check("L2.core_inside_clip_z", cb.zmax <= clip_z + 1e-3 and cb.zmin >= -clip_z - 1e-3, True, 0),
        _check("L2.core_volume_below_clip_box", core.Volume() <= 8 * clip_x * clip_y * clip_z, True, 0),
        _check("L2.core_nonempty", core.Volume() > 0, True, 0),
        _check("L2.struts_kept_equals_tier_sum", result.lattice["struts_kept"],
               sum(result.lattice["struts_per_tier"]), 0),
    ])

    # multi-zone fusion: zones are contiguous and cover the lattice clip height
    zones = resolved_zones(spec)
    zone_checks = [
        _check("L2.zones_cover_clip_height", zones[0]["z0"] <= -clip_z + 1e-9 and zones[-1]["z1"] >= clip_z - 1e-9, True, 0,
               f"{len(zones)} zone(s)"),
        _check("L2.zones_contiguous", all(abs(a_["z1"] - b_["z0"]) < 1e-9 for a_, b_ in zip(zones, zones[1:])), True, 0),
    ]
    levels["L2_zones"] = _level(zone_checks)

    # L3 tiers, re-derived from the spec
    exp_counts, exp_kept, exp_zone = _tier_counts_from_spec(spec)
    per_zone_built = result.lattice.get("struts_per_zone", [exp_kept])
    tier_checks = [_check("L3.struts_kept_rederived", result.lattice["struts_kept"], exp_kept, 0)]
    for zi, (got, exp) in enumerate(zip(per_zone_built, exp_zone)):
        tier_checks.append(_check(f"L3.zone{zi}_struts_rederived", got, exp, 0,
                                  f"{zones[zi]['topology']} cell {zones[zi]['cell']} mm"))
    for i, (got, exp) in enumerate(zip(result.lattice["struts_per_tier"], exp_counts)):
        tier_checks.append(_check(f"L3.tier{i}_count_rederived", got, exp, 0,
                                  f"radius {l.tier_radii[i]} mm"))
    tier_checks.append(_check("L3.depth_tiers_ascending", list(l.tier_depths) == sorted(l.tier_depths), True, 0))
    levels["L3_tiers"] = _level(tier_checks)

    # zone interfaces: a thin slab across each interface must intersect the lattice, otherwise the
    # two zones are only connected through the skin
    iface_checks = []
    for zi, (za, zb) in enumerate(zip(zones, zones[1:])):
        zb_plane = za["z1"]
        if not (-clip_z < zb_plane < clip_z):
            continue
        slab = cq.Solid.makeBox(2 * clip_x, 2 * clip_y, 0.1, pnt=cq.Vector(-clip_x, -clip_y, zb_plane - 0.05))
        crossing = core.intersect(slab).Volume()
        iface_checks.append(_check(f"coupling.zone{zi}_interface_crossed", crossing > 1e-6, True, 0,
                                   f"z = {zb_plane} mm, lattice volume in slab {crossing:.4f} mm^3"))
    # coupling: overlap computed independently, identity skin + core - overlap = part
    overlap_direct = skin.intersect(core).Volume()
    overlap_identity = skin.Volume() + core.Volume() - part.Volume()
    levels["coupling"] = _level(iface_checks + [
        _check("coupling.overlap_identity", overlap_direct, overlap_identity, 1e-4 * max(1.0, overlap_identity),
               "skin ∩ core (direct) vs skin + core - part; relative tolerance 1e-4 (OCC boolean error "
               "on a multi-solid core is about 1e-5 relative)"),
        _check("coupling.overlap_positive", overlap_direct > 0, True, 0),
        _check("coupling.overlap_within_parts", overlap_direct <= min(skin.Volume(), core.Volume()) + 1e-6, True, 0),
        _check("coupling.single_solid", len(part.Solids()), 1, 0),
    ])

    # printability (tessellated boundary)
    from .verify import mesh_components
    comps = mesh_components(verts, tris)
    all_closed = _void_components(comps, verts, tris, spec)
    # A closed shell that encloses no air cannot trap resin. Fragments below VOID_MIN_VOLUME_MM3 are
    # degenerate tessellation patches on a cavity edge (closed, watertight, zero volume). They are
    # reported as warnings, not as voids.
    voids = [c for c in all_closed if c["volume_mm3"] >= VOID_MIN_VOLUME_MM3]
    slivers = [c for c in all_closed if c["volume_mm3"] < VOID_MIN_VOLUME_MM3]
    n_enclosed = len(voids)
    lateral = sum(1 for c in voids if c["location"] == "lateral wall")  # classified by inner wall planes
    vol_enclosed = sum(c["volume_mm3"] for c in voids)
    watertight = all(c["non_manifold_or_boundary_edges"] == 0 for c in comps)
    r_used = [r for r, n in zip(l.tier_radii, result.lattice["struts_per_tier"]) if n > 0]
    wall = min(t, 2 * min(r_used)) if r_used else t
    pr = [
        _check("printability.watertight", watertight, True, 0),
        _check("printability.enclosed_voids", n_enclosed, 0, 0,
               f"{n_enclosed} sealed components (>= {VOID_MIN_VOLUME_MM3} mm^3); {lateral} against lateral walls; "
               f"total {vol_enclosed:.3f} mm^3; see voids[]; {len(slivers)} zero-volume fragments in warnings[]"),
        _check("printability.min_wall_proxy_ge_0.4", wall >= 0.4 - 1e-9, True, 0, f"proxy {wall:.2f} mm"),
    ]
    # mesh quality: no long needles; longest edge within the refinement bound (see mesh_refine.py)
    from .mesh_refine import quality_report
    q = quality_report(verts, tris)
    needles = q["needles_aspect_gt_100_span_ge_5.0mm"]
    pr += [
        _check("mesh.max_edge_within_bound", q["max_edge_mm"] <= spec.tessellation.max_edge_mm + 1e-6, True, 0,
               f"max edge {q['max_edge_mm']} mm, bound {spec.tessellation.max_edge_mm} mm"),
        _check("mesh.no_needles", needles, 0, 0, "triangles with aspect > 100 spanning >= 5 mm in z"),
    ]
    pr += _vent_checks(spec, verts, tris)
    levels["printability"] = _level(pr)

    # export
    ex = []
    if verify_step_out is not None:
        ex = [
            _check("export.step_volume_rel_error", verify_step_out["volume_rel_error"], 0.0, 1e-6),
            _check("export.editable_brep", verify_step_out["editable_brep_ok"], True, 0),
            _check("export.no_shell_based_model", verify_step_out["shell_based_surface_model_entities"], 0, 0),
        ]
    else:
        ex = [_check("export.step_verified", False, True, 0, "no STEP verification supplied")]
    levels["export"] = _level(ex)

    failed = [c["id"] for lv in levels.values() for c in lv["checks"] if not c["pass"]]
    warnings = []
    if slivers:
        first = slivers[0]
        warnings.append(f"{len(slivers)} closed zero-volume fragment(s) (volume < {VOID_MIN_VOLUME_MM3} mm^3, "
                        f"no enclosed air); first fragment bbox {first['bbox_min']}..{first['bbox_max']}")
    return {
        "pass": all(lv["pass"] for lv in levels.values()),
        "failed_checks": failed,
        "levels": levels,
        "voids": voids,
        "warnings": warnings,
        "slivers": slivers,
        "spec_summary": {"topology": l.topology, "cell_mm": a, "twist_deg_per_mm": l.twist_deg_per_mm,
                         "vents": len(v.positions) if v.enabled else 0},
    }
