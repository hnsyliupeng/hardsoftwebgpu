"""Rebuild docs/exact_lattice_status.json from the exact-model records (stdlib only).

Sources:
  examples/exact_lattices_L20/<type>/exact.json   six plain lattices and FBCC (OpenCASCADE B-Rep)
  examples/exact_deep_L20/<name>/exact.json        deep designs (R8)
  examples/exact_lattices_L20/README.md            5 x 5 x 5 block field values (table column)
Nothing is computed here: the script only collects the recorded numbers, so the status file cannot
drift from the models. Run: python3 scripts/make_exact_status.py
"""
import glob
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def field_block_values():
    """Column 'Field (5x5x5 block)' of the lattice README table: type -> mm^3."""
    text = open(os.path.join(ROOT, "examples/exact_lattices_L20/README.md")).read()
    out = {}
    for m in re.finditer(r"^\| (\w+) \| `[^`]+` \| [\d.]+ \| \d+ \| \w+ \| [^|]+ \| ([\d.]+)", text, re.M):
        out[m.group(1).lower()] = float(m.group(2))
    return out


def entry(d, field_mm3, source):
    mesh = d.get("mesh", {})
    rec = {
        "status": "exact at L=20",
        "kernel": d.get("kernel"),
        "brep_volume_mm3": d.get("volume_mm3"),
        "solids": d.get("solids"),
        "is_valid": d.get("is_valid"),
        "faces": d.get("faces"),
        "mesh_volume_mm3": mesh.get("volume_mesh_mm3"),
        "mesh_open_edges": mesh.get("open_edges"),
        "mesh_nonmanifold_edges": mesh.get("nonmanifold_edges"),
        "removed_slivers": d.get("removed_slivers", []),
        "record": source,
    }
    if "mode" in d:
        rec["build_mode"] = d["mode"]
    if "capsule_mc" in d:
        rec["capsule_mc"] = d["capsule_mc"]
    if field_mm3 is not None:
        rec["field_5x5x5_block_mm3"] = field_mm3
    return rec


def main():
    fields = field_block_values()
    types = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "examples/exact_lattices_L20/*/exact.json"))):
        kind = os.path.basename(os.path.dirname(path))
        d = json.load(open(path))
        types[kind] = entry(d, fields.get(kind), os.path.relpath(path, ROOT))
    deep = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "examples/exact_deep_L20/*/exact.json"))):
        name = os.path.basename(os.path.dirname(path))
        d = json.load(open(path))
        deep[name] = entry(d, None, os.path.relpath(path, ROOT))
    status = {
        "module": "python/exact/build_lattice.py, python/exact/build_r8.py",
        "generated_by": "scripts/make_exact_status.py",
        "kernel": "OpenCASCADE (CadQuery 2.8 / OCP 7.8)",
        "parameters": {"size_mm": 20, "cell_mm": 4, "strut_radius_mm": 0.4, "tessellation_tol_mm": 0.02},
        "types": types,
        "deep": deep,
        "superseded": "The earlier SMLib (@classcad/smlibwasm) records and their failure notes are in docs/EXACT_LATTICES.md.",
    }
    out = os.path.join(ROOT, "docs/exact_lattice_status.json")
    with open(out, "w") as f:
        json.dump(status, f, indent=1)
        f.write("\n")
    print(f"wrote {os.path.relpath(out, ROOT)}: {len(types)} lattice types, {len(deep)} deep designs")


if __name__ == "__main__":
    main()
