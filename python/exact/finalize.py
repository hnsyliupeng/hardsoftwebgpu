"""Finalize an exact lattice STEP: drop floating slivers, re-export, tessellate, and record metrics.

Usage: python finalize.py <type> <in.step> <outdir> [min_solid_mm3=1.0]
Writes <outdir>/<type>_L20.step (clean), <outdir>/<type>_L20.mesh (welded triangles for the renderer),
and <outdir>/exact.json. Solids smaller than min_solid_mm3 (corner slivers left by the envelope cut)
are removed and listed; no other geometry is changed.
"""
import json
import os
import sys
from collections import Counter

import cadquery as cq
import numpy as np

from tessellate_step import tessellate_to_mesh


def main():
    kind, src, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    min_vol = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    os.makedirs(outdir, exist_ok=True)
    shape = cq.importers.importStep(src).val()
    solids = shape.Solids()
    keep = [s for s in solids if s.Volume() >= min_vol]
    removed = [{"volume_mm3": round(s.Volume(), 6)} for s in solids if s.Volume() < min_vol]
    clean = keep[0] if len(keep) == 1 else cq.Compound.makeCompound(keep)
    step_out = os.path.join(outdir, f"{kind}_L20.step")
    cq.exporters.export(cq.Workplane().add(clean), step_out)
    mesh_out = os.path.join(outdir, f"{kind}_L20.mesh")
    mesh_info = tessellate_to_mesh(clean, mesh_out, tol=0.02, ang=0.2)
    rec = {
        "type": kind, "kernel": "OpenCASCADE (CadQuery 2.8 / OCP 7.8)", "size_mm": 20, "cell_mm": 4, "strut_radius_mm": 0.4,
        "volume_mm3": round(clean.Volume(), 4), "solids": len(keep), "faces": len(clean.Faces()),
        "is_valid": clean.isValid(), "removed_slivers": removed, "min_solid_mm3": min_vol,
        "mesh": mesh_info,
    }
    json.dump(rec, open(os.path.join(outdir, "exact.json"), "w"), indent=1)
    print(json.dumps(rec))


if __name__ == "__main__":
    main()
