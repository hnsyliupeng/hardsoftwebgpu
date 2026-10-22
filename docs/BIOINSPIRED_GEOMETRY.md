# Geometric validation against Bioinspired123D (base codes)

Reference: `lamm-mit/Bioinspired123D` (Apache-2.0), file `data/raw/biodataset_basecodes.csv` (the Blender Python of the base codes). The upstream code was run as written in headless Blender (`bpy` 5.0.1). No upstream code is copied into this repository.

This replaces the routing-only check in `docs/BIOINSPIRED_COMPARISON.md` for the base codes that can be checked. The routing check (270 of 270 single-family prompts correct) is a separate result.

## Summary

| Base code | Upstream run in Blender (mm³) | Repo model (recorded, 192 cells, mm³) | Repo vs upstream |
|---|---|---|---|
| `helical_generic` | 6765.9 | 7165.9 | +5.9 % (ply centring, see below) |
| `helical_rectfibers` | 6221.9 | 7733.8 | +24 % (ply centring, fibre grid, fibre length) |
| `helical_cylinfibers` | 5283.5 | 6275.4 | +19 % (same three changes) |
| `tubular_generic` | 7001.1 (call corrected, see below) | 6994.7 | −0.09 % (Blender 32-sided cylinders) |
| `tubular_shapesize` | 6501.7 | 6492.0 | −0.15 % (Blender 32-sided cylinders) |
| `tubular_layers` | 7640.4 | 7638.1 | −0.03 % (Blender 32-sided cylinders) |
| `helical_noise` (3 seeds) | 6699 / 6751 / 6731 | 7168.4 (one draw) | consistent in distribution, see below |
| `tubular_noise` | 7001.1 | 6994.7 | identical volume for any noise (holes do not overlap or clip) |
| `cellular_*` (4 designs) | not run | 5765–6451 | add-on missing, see below |

The repo's helical plate and fibre conventions are documented deviations from upstream (below). The tubular base codes agree with upstream to within Blender's cylinder faceting.

## Method

- **Upstream run.** `python/validation/run_upstream_bpy.py` fills the template placeholders with `str.format`, seeds Python's `random` with the seed, executes the code unchanged in headless `bpy`, and intersects the resulting mesh with the build envelope (`[-1,1]^2 × [0,2]` for the helical plies, `[-1,1]^3` for the tubular cube; 1 unit = 10 mm). Volume is the divergence-theorem sum over the clipped faces. Driver: `python/validation/run_upstream_all.sh`. Output: `docs/bio_upstream_bpy.jsonl`.
- **Independent reference.** `python/validation/bio_reference.py` evaluates the same arithmetic in numpy (Monte Carlo, N = 2·10⁶, one-sigma errors). It has an `upstream` and a `repo` convention. Output: `docs/bio_validation.json`.
- **Repo values.** `examples/structure_gallery/bio_*/design.json`, `metrics.volume`, 192-cell SDF mesh.

For the two plate/fibre cases without circular cross-sections, Blender agrees with the independent reference:

| Case | Blender | Reference (MC, upstream arithmetic) |
|---|---|---|
| `helical_generic` | 6765.9 | 6764.5 ± 2.0 |
| `helical_rectfibers` | 6221.9 | 6221.1 ± 2.4 |

## Blender's cylinders have 32 sides

Blender's default cylinder has 32 sides. Its cross-section area is `f = (32/2π)·sin(2π/32) = 0.993587` of a circle. With this factor, the analytic upstream volumes match the Blender runs:

| Case | Analytic (32-sided) | Blender run |
|---|---|---|
| `tubular_generic` | 8000 − 1005.31·f = 7001.14 | 7001.14 |
| `tubular_shapesize` | 8000 − 1507.96·f = 6501.71 | 6501.71 |
| `tubular_layers` | 8000 − 361.9·f = 7640.41 | 7640.41 |
| `helical_cylinfibers` (MC 5317.0 · f) | 5282.9 | 5283.48 |

The repo uses exact circles, so its tubular volumes sit about 0.1 % below the Blender values. This is faceting, not a model difference.

## Differences in the repo's model (fibre and ply conventions)

The repo convention (`src/bio/families.ts`) differs from the upstream arithmetic in three steps. Measured one change at a time (MC, `docs/bio_validation.json`, `decomposition`, N = 2·10⁶):

| Step | Rect (mm³) | Cyl (mm³) |
|---|---|---|
| upstream arithmetic | 6221.1 | 5317.0 |
| + ply centring `(i+½)t` (instead of `i·t`) | 6580.0 (+5.8 %) | 5632.4 (+5.9 %) |
| + fibre grid extended beyond the plate | 7217.4 (+9.7 %) | 5956.0 (+5.8 %) |
| + fibre half-length √2 (instead of 1) | 7615.4 (+5.5 %) | 6283.2 (+5.5 %) |

- **Ply centring.** Upstream centres plate `i` at `z = i·t`, so the bottom half of the first ply lies below the envelope and only about 9.5 plies are inside the box. The repo centres plies in the box (full coverage). The gallery `limitations` record this.
- **Fibre grid and half-length.** These come from commit `aff94f9` ("Helical fibre plies reach the envelope corners"). In upstream, the fibres are 2 units long and the grid stops at the plate, so the corners of the rotated plates are left with notches. The repo fills them on purpose. This is a deliberate departure, not a conversion error. It is the open decision below.

## Ply count of the cylinder design

The old 192-cell cylinder record had 9 plies, while its own unknowns said the stated default of 10 was used. The record was regenerated at the stated default. Both the gallery design (`num_plies: 10`) and the JSON entry use 10 plies, so the comparison is at 10 plies (upstream 5317.0 vs repo 6283.2). An earlier plan to add a 9-ply comparison (upstream 5209.6 at N = 2·10⁶, seed 1) is not needed for the gallery design.

## Stale gallery records (found and corrected)

- The two fibre designs in `examples/structure_gallery/` (192 set) were generated in commit `5befa7f`, before `aff94f9`. Their recorded values match the earlier fibre convention (upstream fibre grid, plies centred at `(i+½)t`, half-length 1), not the current code (`python/validation/fibre_hypothesis.py`).
- Both designs were regenerated on the current code: `node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 192 bio_helical_rectfibers`, and the same for `bio_helical_cylinfibers`. Both pass with one component. The 96 and 256 sets already used the current fibre code. The README rows and header note the change.
- Recorded rect volume (7733.8) is 1.6 % above the field MC (7615.4). The mesh is 1.6 % above because the 0.1 mm gaps between bars are about one voxel at 192 cells (0.104 mm).

## Upstream code issues found

- **`tubular_generic` does not run as published.** The code defines `def create_tubules():` (no parameters) and calls `create_tubules(tubule_count)`. Blender raises `TypeError`. For the geometry check, only the call was changed to `create_tubules()`. The result is recorded with `call_fixed: true`.

## Noise variants (distribution, not realisation)

- `helical_noise`: the upstream template draws `random.uniform(−noise, noise)` per ply, with no seed in the code. The runner seeds Python's `random` (seeds 1, 2, 3), giving 6699, 6751 and 6731 mm³. The expected volume with ±5° rotation noise is 7121 mm³, with standard deviation 28 mm³ per draw (`python/validation/helical_noise_check.py`, exact per-ply clip areas, 3000 draws). That is −0.56 % from the noise-free 7161 mm³ on the same grid. The upstream draws agree with this. The repo's recorded design (seed 42, a different random stream) is 7168.4 mm³, about 1.7 standard deviations above the expected value. That is plausible for one draw, but it is not the same realisation as upstream.
- `tubular_noise`: the hole positions move by up to ±0.07 units. Holes do not overlap and stay inside the cube, so the volume does not depend on the noise. Blender gives 7001.14 mm³ for seed 1, the same as `tubular_generic`. The repo's recorded `tubular_noise` is also unchanged from `tubular_generic`.

## Not run: cellular base codes

The four cellular base codes use Blender's Fracture Cell operator, which the upstream code calls as `bpy.ops.object.add_fracture_cell_objects`. The `bpy` 5.0.1 wheel does not contain the add-on: the run fails with "Add-on not loaded: object_fracture_cell" and "Calling operator ... could not be found". The record is in `docs/bio_upstream_bpy.jsonl` (status `not run`). Running them would need a Blender build that ships the add-on. The upstream random Voronoi also needs fixed seeds before realisations can be compared. The repo's cellular designs therefore cannot be compared with upstream geometry at present.

## Decision needed

The repo convention is a complete fibre lattice. The upstream arithmetic has notched corners. The choice is:

1. **Keep** the repo convention (current). The fibre families are 18–24 % denser than upstream. This is documented here as a deliberate departure.
2. **Revert** the fibre families to the upstream arithmetic (notched corners, about 15–20 % less volume), and keep the repo convention as an option.

Either is a change in `src/bio/families.ts` plus regeneration of the fibre designs in each set. Option 1 needs no code change.

## Reproduce

```
.venv/bin/python python/validation/bio_reference.py 2000000 > docs/bio_validation.json
.venv/bin/python python/validation/fibre_hypothesis.py 1000000
.venv/bin/python python/validation/helical_noise_check.py 10 10 5 3000
bash python/validation/run_upstream_all.sh /tmp/refs/Bioinspired123D > docs/bio_upstream_bpy.jsonl
```

The Blender run needs `bpy` installed for Python 3.11 (`/home/user/venv_bpy`, `pip install bpy`). Its missing shared libraries (libXrender, libXi, libXfixes, libICE, libSM, libxkbcommon, and GLX/EGL symbols) were covered by no-op stub libraries built with `gcc` in `/home/user/bpy_stubs`. The stubs are not called in these runs: they exist only so that the module loads without a display or GPU.
