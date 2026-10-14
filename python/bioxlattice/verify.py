"""Independent checks on the exported files (not on the in-memory shape only).

- STEP: re-import with OpenCASCADE, count solids, volume, analytic face types, and check the
  file encodes manifold solids (not shell-based surface models).
- Mesh: watertightness (every undirected edge used by exactly two triangles), Euler characteristic.
"""
from __future__ import annotations

import re
from collections import Counter

import cadquery as cq

from .metrics import face_type_histogram


def verify_step(path: str, expected_volume: float, rel_tol: float = 1e-4) -> dict:
    with open(path, encoding="utf8", errors="replace") as fh:
        text = fh.read()
    n_manifold = len(re.findall(r"MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS", text))
    n_voids = len(re.findall(r"BREP_WITH_VOIDS", text))
    n_sbsm = len(re.findall(r"SHELL_BASED_SURFACE_MODEL", text))
    n_adv = len(re.findall(r"ADVANCED_FACE", text))
    n_cyl = len(re.findall(r"CYLINDRICAL_SURFACE", text))
    wp = cq.importers.importStep(path)
    solids = wp.solids().vals()
    vol = sum(s.Volume() for s in solids)
    hist = face_type_histogram(cq.Compound.makeCompound(solids)) if solids else {}
    rel = abs(vol - expected_volume) / expected_volume if expected_volume else float("inf")
    return {
        "file": path,
        "reimported_solids": len(solids),
        "reimported_volume": round(vol, 3),
        "volume_rel_error": float(f"{rel:.3e}"),
        "volume_ok": rel <= rel_tol,
        "manifold_solid_brep_entities": n_manifold,
        "solids_with_internal_voids": n_voids,
        "shell_based_surface_model_entities": n_sbsm,
        "advanced_face_entities": n_adv,
        "cylindrical_surface_entities": n_cyl,
        "reimported_face_types": hist,
        "editable_brep_ok": n_manifold >= 1 and n_sbsm == 0 and len(solids) == 1,
    }


def mesh_components(verts, tris):
    """Split a triangle mesh into connected components; each has its own Euler characteristic."""
    parent = list(range(len(verts)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j, k in tris:
        for a, b in ((i, j), (j, k)):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
    groups: dict[int, dict] = {}
    for t in tris:
        g = groups.setdefault(find(t[0]), {"tris": [], "verts": set(), "edges": Counter()})
        g["tris"].append(t)
        g["verts"].update(t)
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            g["edges"][(a, b) if a < b else (b, a)] += 1
    out = []
    for g in groups.values():
        xs = [verts[v] for v in g["verts"]]
        lo = [min(p[d] for p in xs) for d in range(3)]
        hi = [max(p[d] for p in xs) for d in range(3)]
        diag = sum((hi[d] - lo[d]) ** 2 for d in range(3)) ** 0.5
        chi = len(g["verts"]) - len(g["edges"]) + len(g["tris"])
        out.append({
            "vertices": len(g["verts"]), "edges": len(g["edges"]), "triangles": len(g["tris"]),
            "euler_characteristic": chi, "genus": (2 - chi) // 2,
            "non_manifold_or_boundary_edges": sum(1 for n in g["edges"].values() if n != 2),
            "bbox_diagonal": round(diag, 4),
        })
    out.sort(key=lambda c: -c["bbox_diagonal"])
    return out


def verify_mesh(verts, tris) -> dict:
    comps = mesh_components(verts, tris)
    bad = sum(c["non_manifold_or_boundary_edges"] for c in comps)
    chi = sum(c["euler_characteristic"] for c in comps)
    used = {v for t in tris for v in t}
    return {
        "vertices": len(used),
        "triangles": len(tris),
        "non_manifold_or_boundary_edges": bad,
        "watertight": bad == 0,
        "components": len(comps),
        "outer_component_genus": comps[0]["genus"] if comps else None,
        "void_component_genus": [c["genus"] for c in comps[1:]],
        "euler_characteristic": chi,
    }
