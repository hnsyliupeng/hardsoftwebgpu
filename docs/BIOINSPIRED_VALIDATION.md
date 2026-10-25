# Bioinspired123D validation: status per base code

Reference: `lamm-mit/Bioinspired123D`, base codes in `data/raw/biodataset_basecodes.csv`. Details, numbers and reproduction commands: `docs/BIOINSPIRED_GEOMETRY.md`. Machine-readable results: `docs/bio_validation.json` (independent reference) and `docs/bio_upstream_bpy.jsonl` (upstream code run in Blender, all 12 base codes).

## Status per base code

| Base code | Upstream (Blender run) | Independent reference | Repo (recorded) | Status |
|---|---|---|---|---|
| `helical_generic` | 6765.9 mm³ | 6764.5 ± 2.0 | 7165.9 | Upstream matched. Repo differs by ply centring (documented). |
| `helical_rectfibers` | 6221.9 mm³ | 6221.1 ± 2.4 | 7733.8 | Upstream matched. Repo differs by ply centring, fibre grid and length (documented; kept by user decision). |
| `helical_cylinfibers` | 5283.5 mm³ (32-sided cylinders) | 5317.0 ± 2.7 (exact circles) | 6275.4 | Upstream matched after faceting factor 0.9936. Repo differs as above. |
| `helical_noise` | 6699–6751 mm³ (seeds 1–3) | −0.56 % expected, sd 28 mm³ | 7168.4 (one draw) | Matched in distribution. Not the same realisation. |
| `tubular_generic` | 7001.1 mm³ (call corrected, see below) | 6996.7 (exact circles) | 6994.7 | Matched after faceting factor. |
| `tubular_shapesize` | 6501.7 mm³ | 6493.0 (exact circles) | 6492.0 | Matched after faceting factor. |
| `tubular_layers` | 7640.4 mm³ | 7638.4 (exact circles) | 7638.1 | Matched after faceting factor. |
| `tubular_noise` | 7001.1 mm³ | invariant to noise | 6994.7 | Matched. Volume does not change with the hole jitter. |
| `cellular_generic` | 5.9–1507 mm³ (20 seeds, median 152) | — | 5765.4 | **Runs; does not match.** Repo model is a Voronoi wall model, labelled as such (decision 2026-10-22). |
| `cellular_voronoi` | 433–703 mm³ (20 seeds, median 530) | — | 5775.1 | **Runs; does not match** (same model, labelled). |
| `cellular_sandwich` | 1603–1997 mm³ (20 seeds, median 1703) | — | 6435.5 | **Runs; does not match** (same model, labelled). |
| `cellular_vorosand` | 1854–2143 mm³ (20 seeds, median 2001) | — | 6450.8 | **Runs; does not match** (same model, labelled). |

**Matched** means the Blender run of the upstream code and the independent reference agree within the stated errors, after the 32-sided cylinder factor where a cylinder is present. The repo's helical values are not the upstream arithmetic; see `docs/BIOINSPIRED_GEOMETRY.md` for the three documented changes.

**Cellular.** The upstream cellular codes break a cube with the Fracture Cell add-on and apply a wireframe modifier (strut thickness 0.2). The voronoi and vorosand variants add a subdivision modifier; the sandwich and vorosand variants add top and bottom slabs. The upstream volume is therefore a thin strut network. The repo's cellular designs are solid Voronoi walls with a different thickness definition, and their volumes are 3–10× larger. This is a real geometric difference, not a measurement error: the measurement path is the same one that matches the helical and tubular codes exactly. The repo's cellular designs are a repo-specific Voronoi wall model. They are labelled that way in the gallery, and must not be described as reproducing Bioinspired123D cellular geometry. Decision (2026-10-22): the user chose to keep the model and relabel it. No geometry change.

## Known upstream issues

- `tubular_generic`: the code defines `create_tubules()` with no parameters and calls it with `tubule_count`. It raises `TypeError` as published. The geometry check used the corrected call only.
- Cellular codes need the `object_fracture_cell` add-on. It is not in the `bpy` 5.0.1 wheel. For this check it was taken from the `blender/blender-addons` GitHub mirror (version 0.2, the pre-extension code). The extension version 0.2.1 is hosted on projects.blender.org, which the sandbox cannot reach.
- The Fracture Cell random noise uses Blender's C-side RNG, which Python's `random.seed` does not control. The runner also seeds it (`mathutils.noise.seed_set`). Same seed then gives the same volume in separate processes (checked: seed 1 gives 190.51 mm³ twice).

## Corrected in this round

- The Blender measurement first copied the base mesh and applied only the envelope clip. Modifiers placed before the clip (wireframe, subdivision) were skipped. The first cellular numbers (volumes up to 5000 mm³) came from that bug. The runner now measures the evaluated mesh, with all modifiers applied. The helical and tubular values did not change after the fix (checked on all rows).

## Routing

Routing is a separate check, in `docs/BIOINSPIRED_COMPARISON.md`: 270 of 270 single-family prompts route to the correct family. Cross-domain prompts (36) route to one family and are not fused. General non-bio prompts (14) are flagged with confidence 0.25.

## Open items

1. Cellular: decided (2026-10-22). Keep the Voronoi wall model and label it (done in the gallery README). Changing to the upstream wireframe definition is not planned unless the user asks.
2. The repo's helical noise design is one random draw. It is not the upstream realisation.

## Environment

- Blender run: `bpy` 5.0.1 for Python 3.11 in `/home/user/venv_bpy`, with no-op stub libraries in `/home/user/bpy_stubs` (built by `python/validation/build_bpy_stubs.py` from the undefined symbols of bpy's shared libraries) for missing X11/GL/xkb libraries. The stubs are never called; they only let the module load without a display or GPU.
- Fracture Cell add-on: copied to `/home/user/bpy_addons/addons/object_fracture_cell`, found through `BLENDER_USER_SCRIPTS=/home/user/bpy_addons`.
- Independent reference: `.venv` (numpy), `python/validation/bio_reference.py`.
- Driver for the Blender runs: `python/validation/run_upstream_all.sh <Bioinspired123D checkout>`.
