"""Command line: build a coupled bio-lattice design and verify its exports.

  python -m bioxlattice build [spec.json] OUT_DIR [--name NAME] [--deflection MM]
  python -m bioxlattice verify OUT_DIR

Requires cadquery (see python/requirements.txt). On hosts without libGL, run through
scripts/python_env.sh, which provides a stub libGL that OCP loads but never calls for B-Rep work.
"""
from __future__ import annotations

import argparse
import json
import os
import time

from .build import build
from .exporter import tessellate_merged, write_mesh_bin, write_step, write_stl
from .metrics import part_metrics
from .spec import CoupledSpec
from .verify import verify_mesh, verify_step

PROMPT = ("Coupled bio-inspired lattice: closed 2 mm skin around a BCC strut core, helical twist "
          "of the lattice along z (Bouligand-like) and three depth-graded strut radii, exported as "
          "editable B-Rep STEP with a high-resolution STL.")

CODE_TEMPLATE = '''"""Copy-executable parametric build (run from this folder: python design_code.py).

Needs cadquery 2.8 (see python/requirements.txt). The spec below is the DesignState parameter set.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "python"))
from bioxlattice.spec import CoupledSpec
from bioxlattice.build import build
from bioxlattice.exporter import write_step

SPEC = json.loads(%r)

if __name__ == "__main__":
    spec = CoupledSpec.from_dict(SPEC)
    result = build(spec)
    write_step(result.part, os.path.join(HERE, spec.name + ".step"))
    print("volume_mm3", round(result.part.Volume(), 3), "solids", len(result.part.Solids()))
'''


def cmd_build(args) -> None:
    spec = CoupledSpec.load(args.spec) if args.spec else CoupledSpec()
    if args.name:
        spec.name = args.name
    if args.deflection:
        spec.tessellation.deflection_mm = args.deflection
    spec.validate()
    out = args.out
    os.makedirs(out, exist_ok=True)
    name = spec.name

    t0 = time.perf_counter()
    result = build(spec)
    build_s = time.perf_counter() - t0
    metrics = part_metrics(result, spec)

    step_path = os.path.join(out, f"{name}.step")
    t1 = time.perf_counter()
    write_step(result.part, step_path)
    step_s = time.perf_counter() - t1

    t2 = time.perf_counter()
    verts, tris = tessellate_merged(result.part, spec.tessellation.deflection_mm, spec.tessellation.angular_rad)
    tess_s = time.perf_counter() - t2
    stl_path = os.path.join(out, f"{name}.stl")
    write_stl(stl_path, verts, tris, name)
    write_mesh_bin(os.path.join(out, f"{name}.mesh.bin"), verts, tris)

    spec_json = json.dumps(spec.to_dict(), indent=2)
    with open(os.path.join(out, "design_code.py"), "w", encoding="utf8") as fh:
        fh.write(CODE_TEMPLATE % json.dumps(spec.to_dict()))
    with open(os.path.join(out, "timeline.json"), "w", encoding="utf8") as fh:
        json.dump(result.timeline, fh, indent=2)

    design = {
        "prompt": PROMPT,
        "design_spec": {
            "topology": "hybrid",
            "bio_motif": "helical (Bouligand-like) twist of a strut lattice core inside a closed skin",
            "parameters": spec.to_dict(),
            "heterogeneity_field": {
                "type": "depth_tiered_strut_radius",
                "description": "strut radius chosen by depth below the envelope surface",
                "tier_depths_mm": spec.lattice.tier_depths,
                "tier_radii_mm": spec.lattice.tier_radii,
                "twist_map": f"theta(z) = {spec.lattice.twist_deg_per_mm} deg/mm * z, rotation about Z",
            },
            "coupling_levels": [
                {"level": "L0", "name": "envelope", "kind": "box, filleted vertical edges"},
                {"level": "L1", "name": "skin", "kind": f"boolean cut, {spec.skin.thickness} mm closed wall"},
                {"level": "L2", "name": "lattice core", "kind": f"{spec.lattice.topology} struts, cell {spec.lattice.cell} mm, twisted nodes"},
                {"level": "L3", "name": "graded struts", "kind": "radius by depth tier, fused into L1 by overlap"},
            ],
            "target_metrics": {"min_printable_wall_mm": 0.4},
            "constraints": {"envelope_mm": [spec.envelope.length, spec.envelope.width, spec.envelope.height],
                            "kernel": "OpenCASCADE via CadQuery 2.8 (exact B-Rep)"},
        },
        "code": CODE_TEMPLATE % json.dumps(spec.to_dict()),
        "metrics": {k: metrics[k] for k in ("volume", "surface_area", "min_wall_thickness", "connectivity", "genus")},
        "render_preview": None,
        "repair_history": [],
        "limitations": [
            "min_wall_thickness is a B-Rep proxy (min of skin and 2 x strut radius), not a ray or sphere-fit measurement",
            "twist maps nodes and keeps straight struts between them; it is not an exact helicoid lattice",
            "single-body result is checked for connectivity but the lattice is clipped to the cavity, so struts end on the skin overlap",
            "STL is a tessellation at the given deflection; STEP is exact B-Rep",
            "shell() is not used for the skin because it exports as a shell-based surface model; a boolean cut is used",
        ],
        "unknowns": [
            "printability and mechanical response are not simulated",
            "no Bioinspired123D reference geometry for this family; bio coupling is a parametric choice",
        ],
        "exports": {
            "step": os.path.basename(step_path), "stl": os.path.basename(stl_path),
            "mesh_bin": f"{name}.mesh.bin", "code": "design_code.py", "timeline": "timeline.json",
        },
        "metrics_detail": metrics,
        "lattice": result.lattice,
        "timing_s": {"build": round(build_s, 2), "step_write": round(step_s, 2), "tessellate": round(tess_s, 2)},
    }
    with open(os.path.join(out, "design.json"), "w", encoding="utf8") as fh:
        json.dump(design, fh, indent=2)
    print(f"built {name}: volume {metrics['volume']} mm3, genus {metrics['genus']}, "
          f"solids {'1' if metrics['connectivity'] else 'n'}; build {build_s:.1f}s; "
          f"triangles {len(tris)}", flush=True)
    cmd_verify(argparse.Namespace(out=out, _verts=verts, _tris=tris))


def cmd_verify(args) -> None:
    out = args.out
    design = json.load(open(os.path.join(out, "design.json"), encoding="utf8"))
    name = design["design_spec"]["parameters"]["name"]
    step_v = verify_step(os.path.join(out, f"{name}.step"), design["metrics"]["volume"])
    verts = getattr(args, "_verts", None)
    tris = getattr(args, "_tris", None)
    if verts is None:
        verts, tris = _read_mesh_bin(os.path.join(out, f"{name}.mesh.bin"))
    mesh_v = verify_mesh(verts, tris)
    result = {"step": step_v, "mesh": mesh_v,
              "pass": bool(step_v["volume_ok"] and step_v["editable_brep_ok"] and mesh_v["watertight"])}
    with open(os.path.join(out, "verify.json"), "w", encoding="utf8") as fh:
        json.dump(result, fh, indent=2)
    print("verify:", json.dumps({"pass": result["pass"], "step_solids": step_v["reimported_solids"],
                                  "step_volume_rel_error": step_v["volume_rel_error"],
                                  "editable_brep_ok": step_v["editable_brep_ok"],
                                  "watertight": mesh_v["watertight"], "triangles": mesh_v["triangles"]}), flush=True)


def _read_mesh_bin(path):
    import struct
    with open(path, "rb") as fh:
        nv, nt = struct.unpack("<II", fh.read(8))
        verts = [struct.unpack("<3f", fh.read(12)) for _ in range(nv)]
        tris = [struct.unpack("<3I", fh.read(12)) for _ in range(nt)]
    return verts, tris


def main() -> None:
    ap = argparse.ArgumentParser(prog="bioxlattice")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("spec", nargs="?", default=None)
    b.add_argument("out")
    b.add_argument("--name", default=None)
    b.add_argument("--deflection", type=float, default=None)
    v = sub.add_parser("verify")
    v.add_argument("out")
    args = ap.parse_args()
    if args.cmd == "build":
        cmd_build(args)
    else:
        cmd_verify(args)


if __name__ == "__main__":
    main()
