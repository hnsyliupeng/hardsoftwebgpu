"""Geometric reference for the deterministic Bioinspired123D base codes (numpy only).

The reference is evaluated from the upstream Blender code in data/raw/biodataset_basecodes.csv
(lamm-mit/Bioinspired123D, Apache-2.0), with the parameters of each gallery design. Two conventions:

  upstream  the Blender arithmetic as written: plies centred at z = i*t, fibres only at the upstream
            start/pitch positions, fibre half-length 1 (the plate edge), plate and fibre clipped to the
            build cube [-1,1]^2 x [0,2] (1 unit = 10 mm for the 20 mm envelope).
  repo      the conventions of src/bio/families.ts: plies centred at (i+1/2)t, fibre half-length sqrt(2),
            fibres on the upstream grid extended beyond the plate, same clip.

Each convention is evaluated by Monte Carlo over the cube. The repo convention is compared with the
volumes recorded in examples/structure_gallery/bio_*/design.json (those come from the SDF grid, so a few
percent is expected from voxels). Tubular families are exact (hole arithmetic), so they are checked with
the same Monte Carlo for consistency.

Usage: python3 python/validation/bio_reference.py [N=2000000] > docs/bio_validation.json
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MM3_PER_UNIT3 = 1000.0   # 1 unit = 10 mm
GAP = 0.01               # upstream fiber_gap for rectangular fibres


def _chunks(n, size=200_000):
    for start in range(0, n, size):
        yield min(size, n - start)


def helical_volume(kind: str, num_plies: int, rotation_deg: float, convention: str,
                   N: int = 2_000_000, seed: int = 1, zmode: str | None = None,
                   half: float | None = None, grid: str | None = None) -> dict:
    """kind: plate | rect | cyl. Returns the Monte Carlo volume (mm^3) with its one-sigma error.
    convention sets the three choices together; zmode / half / grid override them one at a time
    (used for the decomposition of the upstream-to-repo gap)."""
    t = 2.0 / num_plies
    zmode = zmode or ("upstream" if convention == "upstream" else "repo")
    grid = grid or ("upstream" if convention == "upstream" else "extended")
    if half is None:
        half = 1.0 if (kind == "plate" or convention == "upstream") else math.sqrt(2.0)
    fibre_half = half
    plies = []
    for i in range(num_plies):
        zc = i * t if zmode == "upstream" else (i + 0.5) * t
        theta = math.radians(i * rotation_deg)
        if kind == "plate":
            centres = None
        else:
            pitch = t + GAP if kind == "rect" else t
            n_fib = max(1, int(2.0 / pitch))
            start = -1.0 + pitch / 2.0 + (2.0 - n_fib * pitch) / 2.0 if kind == "rect" else \
                -1.0 + t / 2.0 + (2.0 - n_fib * t) / 2.0
            if grid == "upstream":
                centres = [start + k * pitch for k in range(n_fib)]
            else:
                lim = math.sqrt(2.0) + pitch
                kLo, kHi = math.floor((-lim - start) / pitch), math.ceil((lim - start) / pitch)
                centres = [start + k * pitch for k in range(kLo, kHi + 1)]
        plies.append((zc, theta, centres))

    rng = np.random.default_rng(seed)
    inside_total = 0
    for m in _chunks(N):
        P = rng.random((m, 3)) * np.array([2.0, 2.0, 2.0]) + np.array([-1.0, -1.0, 0.0])
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        inside = np.zeros(m, bool)
        for zc, th, centres in plies:
            c, s = math.cos(th), math.sin(th)
            xr = c * x + s * y          # rotate the point by -theta into the ply frame
            yr = -s * x + c * y
            dz = z - zc
            in_z = np.abs(dz) <= t / 2
            if kind == "plate":
                hit = (np.abs(xr) <= 1.0) & (np.abs(yr) <= 1.0) & in_z
            elif kind == "rect":
                hit = np.zeros(m, bool)
                for yk in centres:
                    hit |= (np.abs(xr) <= fibre_half) & (np.abs(yr - yk) <= t / 2) & in_z
            else:  # cyl: circle of radius t/2 in the (y, z) plane, axis along x
                hit = np.zeros(m, bool)
                for yk in centres:
                    hit |= (np.abs(xr) <= fibre_half) & ((yr - yk) ** 2 + dz ** 2 <= (t / 2) ** 2)
            inside |= hit
        inside_total += int(inside.sum())
    p = inside_total / N
    vol_units = 8.0 * p
    sig_units = 8.0 * math.sqrt(p * (1 - p) / N)
    return {"volume_mm3": round(vol_units * MM3_PER_UNIT3, 2),
            "sigma_mm3": round(sig_units * MM3_PER_UNIT3, 2)}


def tubular_volume(num_tubules: int, radius: float = 0.1, ellipticity: float = 1.0,
                   layer_thickness: float = 0.0, N: int = 2_000_000, seed: int = 2) -> dict:
    """Cube [-1,1]^3 minus the first num_tubules holes of the upstream grid (row-major, ceil(sqrt) columns).
    layer_thickness > 0 gives the cortex case: the hole is reduced to radius - layer_thickness (the shell
    between them is material, as the upstream boolean and join produce)."""
    G = math.ceil(math.sqrt(num_tubules))
    sp = 2.0 / G
    start = -1.0 + sp / 2.0
    holes = [(start + (k % G) * sp, start + (k // G) * sp) for k in range(num_tubules)]
    rx = radius * ellipticity
    ry = radius
    if layer_thickness:
        rx, ry = rx - layer_thickness, ry - layer_thickness
    rng = np.random.default_rng(seed)
    inside_total = 0
    for m in _chunks(N):
        P = rng.random((m, 3)) * 2.0 - 1.0
        x, y = P[:, 0], P[:, 1]
        removed = np.zeros(m, bool)
        for hx, hy in holes:
            removed |= ((x - hx) / rx) ** 2 + ((y - hy) / ry) ** 2 <= 1.0
        inside_total += int((~removed).sum())
    p = inside_total / N
    sig = 8.0 * math.sqrt(p * (1 - p) / N)
    return {"volume_mm3": round(8.0 * p * MM3_PER_UNIT3, 2), "sigma_mm3": round(sig * MM3_PER_UNIT3, 2)}


def gallery_volume(name: str):
    path = os.path.join(ROOT, "examples/structure_gallery", name, "design.json")
    with open(path) as f:
        d = json.load(f)
    return d["metrics"]["volume"], d["design_spec"]["parameters"]


def main():
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 2_000_000
    out = {"method": "Monte Carlo over the 20 mm build cube (1 unit = 10 mm), N=%d per evaluation" % N,
           "sources": ["data/raw/biodataset_basecodes.csv (upstream Blender code)",
                       "examples/structure_gallery/bio_*/design.json (recorded volumes, SDF grid)"],
           "entries": {}, "notes": {}}
    helical = [("bio_helical_generic", "plate"), ("bio_helical_rectfibers", "rect"),
               ("bio_helical_cylinfibers", "cyl")]
    for name, kind in helical:
        rec, par = gallery_volume(name)
        n_plies, rot = int(par["num_plies"]), float(par["rotation"])
        up = helical_volume(kind, n_plies, rot, "upstream", N)
        rp = helical_volume(kind, n_plies, rot, "repo", N)
        decomposition = None
        if kind != "plate":
            # one change at a time, from the upstream arithmetic to the repo convention
            steps = [("upstream arithmetic", dict(zmode="upstream", half=1.0, grid="upstream")),
                     ("+ ply centring (i+1/2)t", dict(zmode="repo", half=1.0, grid="upstream")),
                     ("+ fibre grid extended beyond plate", dict(zmode="repo", half=1.0, grid="extended")),
                     ("+ fibre half-length sqrt(2)", dict(zmode="repo", half=math.sqrt(2.0), grid="extended"))]
            decomposition = []
            for label, kw in steps:
                v = helical_volume(kind, n_plies, rot, "repo", N, **kw)
                decomposition.append({"step": label, **v})
        out["entries"][name] = {
            "params": {"num_plies": n_plies, "rotation_deg": rot},
            "upstream_convention": up, "repo_convention": rp,
            "decomposition": decomposition,
            "recorded_gallery_volume_mm3": round(rec, 1),
            "recorded_vs_repo_pct": round(100 * (rec - rp["volume_mm3"]) / rp["volume_mm3"], 2),
            "upstream_vs_repo_pct": round(100 * (up["volume_mm3"] - rp["volume_mm3"]) / rp["volume_mm3"], 2),
        }
    for name, par_fn in [
        ("bio_tubular_generic", dict()),
        ("bio_tubular_shapesize", dict(ellipticity=1.5, radius=0.1)),
        ("bio_tubular_layers", dict(layer_thickness=0.04)),
    ]:
        rec, par = gallery_volume(name)
        n = int(par["num_tubules"])
        ref = tubular_volume(n, **par_fn, N=N)
        out["entries"][name] = {
            "params": {k: par[k] for k in par if k != "seed"},
            "upstream_convention": ref, "repo_convention": ref,
            "recorded_gallery_volume_mm3": round(rec, 1),
            "recorded_vs_upstream_pct": round(100 * (rec - ref["volume_mm3"]) / ref["volume_mm3"], 2),
        }
    out["notes"] = {
        "bio_cellular_generic": "Fracture Cell (blender/blender-addons object_fracture_cell) in Blender: run in docs/bio_upstream_bpy.jsonl, 20 seeds, seeded via random.seed and mathutils.noise.seed_set. The repo's cellular designs use their own Voronoi RNG, so only distributions are compared.",
        "bio_cellular_sandwich": "same as cellular_generic (upstream run in docs/bio_upstream_bpy.jsonl).",
        "bio_cellular_voronoi": "same as cellular_generic (upstream run in docs/bio_upstream_bpy.jsonl).",
        "bio_cellular_vorosand": "same as cellular_generic (upstream run in docs/bio_upstream_bpy.jsonl).",
    }
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
