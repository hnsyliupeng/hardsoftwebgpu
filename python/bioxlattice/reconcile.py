"""Align design.json with the final structural report (run after run_checks).

design.json is written before the structural checks, so its void count comes from the raw closed
components. The structural gate is the authority: it counts only sealed components of at least
VOID_MIN_VOLUME_MM3 as voids and lists zero-volume closed fragments as warnings. This module copies
those results into design.json, rewrites the zone-dependent description text, and records repairs.
"""
from __future__ import annotations

import json
import os


def _zone_text(zones: list[dict]) -> str:
    parts = [f"z[{z['z0']:g},{z['z1']:g}] {z['topology']} {z['cell']:g} mm, twist {z['twist_deg_per_mm']:g} deg/mm, "
             f"radius x{z['radius_scale']:g}" for z in zones]
    return "; ".join(parts)


def reconcile_design(out_dir: str, repair_history: list[dict] | None = None) -> dict:
    design_path = os.path.join(out_dir, "design.json")
    report_path = os.path.join(out_dir, "structural_tests.json")
    with open(design_path, encoding="utf8") as fh:
        design = json.load(fh)
    with open(report_path, encoding="utf8") as fh:
        report = json.load(fh)

    voids = report.get("voids", [])
    slivers = report.get("slivers", [])
    metrics = design["metrics_detail"]
    metrics["internal_void_count"] = len(voids)
    metrics["internal_void_volumes_mm3"] = [round(v["volume_mm3"], 6) for v in voids]
    metrics["zero_volume_fragments"] = len(slivers)

    lim = [l for l in design["limitations"] if "internal void(s) remain" not in l]
    if voids:
        lim.append(f"{len(voids)} sealed air pocket(s) >= 1e-3 mm^3 remain; see structural_tests.json voids[]")
    if slivers:
        lim.append(f"{len(slivers)} closed zero-volume fragment(s) on cavity edges (no enclosed air); "
                   "reported as warnings; they pass the watertight check")
    design["limitations"] = lim

    lattice = design["lattice"]
    zones = lattice.get("zones") or []
    if zones:
        spec = design["design_spec"]["parameters"]["lattice"]
        spec["topology"] = "multi-zone"
        spec["zones_summary"] = _zone_text(zones)
        design["design_spec"]["topology"] = "multi-zone bio-lattice"
        design["design_spec"]["bio_motif"] = ("zone-graded lattice core: topology, cell size, twist rate and radius "
                                             "scale change by z band; twist continuous across zones")
        design["prompt"] = ("Multi-zone coupled bio-lattice in a 40 x 40 x 20 mm envelope with a 2 mm skin, 4 bottom vents "
                            f"and depth-graded struts. Zones: {_zone_text(zones)}.")
        for lvl in design["design_spec"]["coupling_levels"]:
            if lvl["level"] == "L2":
                lvl["kind"] = "zone-graded lattice (see zones), twisted nodes"
        design["design_spec"]["parameters"]["lattice"]["twist_map"] = "per-zone theta(z), continuous across zone interfaces"
        design["design_spec"]["heterogeneity_field"]["twist_map"] = "per-zone theta(z), continuous across zone interfaces"
    if repair_history is not None:
        design["repair_history"] = repair_history

    with open(design_path, "w", encoding="utf8") as fh:
        json.dump(design, fh, indent=2)
    return {"internal_void_count": len(voids), "zero_volume_fragments": len(slivers)}
