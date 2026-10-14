"""Metrics of the built B-Rep: exact OpenCASCADE mass properties and topology counts."""
from __future__ import annotations

import cadquery as cq


def topology_counts(shape: cq.Shape) -> dict:
    return {"vertices": len(shape.Vertices()), "edges": len(shape.Edges()), "faces": len(shape.Faces())}


def genus_info(shape: cq.Shape, deflection: float = 0.05, angular: float = 0.3) -> dict:
    """Genus of the boundary from a watertight triangulation (faces share merged vertices).

    B-Rep V - E + F is not the boundary Euler characteristic when faces have inner wires (holes),
    so chi is counted on the triangles. The outer boundary is the component with the largest
    bounding-box diagonal; every other closed component is an internal void.
    """
    from .exporter import tessellate_merged
    from .verify import mesh_components

    verts, tris = tessellate_merged(shape, deflection, angular)
    comps = mesh_components(verts, tris)
    outer = comps[0]["genus"] if comps else None
    voids = [c["genus"] for c in comps[1:]]
    return {
        "genus": outer,
        "outer_boundary_genus": outer,
        "internal_void_count": len(voids),
        "internal_void_genera": voids,
        "euler_characteristic": sum(c["euler_characteristic"] for c in comps),
        "boundary_components": len(comps),
        "method": f"triangulated boundary (deflection {deflection} mm); genus = (2 - chi) / 2 per closed component",
        "watertight": all(c["non_manifold_or_boundary_edges"] == 0 for c in comps),
    }


def face_type_histogram(shape: cq.Shape) -> dict:
    hist: dict[str, int] = {}
    for f in shape.Faces():
        t = f.geomType()
        hist[t] = hist.get(t, 0) + 1
    return dict(sorted(hist.items()))


def part_metrics(result, spec) -> dict:
    part = result.part
    vol = part.Volume()
    outer_vol = result.outer.Volume()
    skin_vol = result.skin.Volume()
    core_vol = result.core.Volume()
    radii = [r for r in spec.lattice.tier_radii if r > 0]
    used = [r for r, n in zip(spec.lattice.tier_radii, result.lattice["struts_per_tier"]) if n > 0]
    r_min = min(used) if used else 0.0
    wall = min(spec.skin.thickness, 2 * r_min)
    g = genus_info(part)
    hist = face_type_histogram(part)
    analytic = sum(n for t, n in hist.items() if t in ("PLANE", "CYLINDER", "CONE", "SPHERE", "TORUS"))
    total_faces = sum(hist.values())
    com = part.Center()
    bb = part.BoundingBox()
    return {
        "volume": round(vol, 3),
        "surface_area": round(part.Area(), 3),
        "center_of_mass": [round(com.x, 4), round(com.y, 4), round(com.z, 4)],
        "bbox_mm": [round(bb.xlen, 3), round(bb.ylen, 3), round(bb.zlen, 3)],
        "min_wall_thickness": round(wall, 4),
        "min_wall_definition": "min(skin thickness, 2 * smallest used strut radius); B-Rep proxy, not ray-based",
        "connectivity": len(part.Solids()) == 1,
        "genus": g["genus"],
        "euler_characteristic": g["euler_characteristic"],
        "boundary_components": g["boundary_components"],
        "internal_void_count": g["internal_void_count"],
        "internal_void_genera": g["internal_void_genera"],
        "boundary_watertight": g["watertight"],
        "porosity": round(1 - vol / outer_vol, 4),
        "levels": {
            "L0_envelope_volume": round(outer_vol, 3),
            "L1_skin_volume": round(skin_vol, 3),
            "L2_lattice_core_volume": round(core_vol, 3),
            "overlap_skin_core": round(skin_vol + core_vol - vol, 3),
        },
        "face_types": hist,
        "analytic_face_fraction": round(analytic / total_faces, 4) if total_faces else 0.0,
        "strut_radii_mm": radii,
        "topology_counts": topology_counts(part),
    }
