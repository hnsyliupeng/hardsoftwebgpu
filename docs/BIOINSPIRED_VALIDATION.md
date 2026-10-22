# Bioinspired123D validation: status per base code

Reference: `lamm-mit/Bioinspired123D`, base codes in `data/raw/biodataset_basecodes.csv`. Details, numbers and reproduction commands: `docs/BIOINSPIRED_GEOMETRY.md`. Machine-readable results: `docs/bio_validation.json` (independent reference) and `docs/bio_upstream_bpy.jsonl` (upstream code run in Blender).

## Status per base code

| Base code | Upstream (Blender run) | Independent reference | Repo (recorded) | Status |
|---|---|---|---|---|
| `helical_generic` | 6765.9 mm³ | 6764.5 ± 2.0 | 7165.9 | Upstream matched. Repo differs by ply centring (documented). |
| `helical_rectfibers` | 6221.9 mm³ | 6221.1 ± 2.4 | 7733.8 | Upstream matched. Repo differs by ply centring, fibre grid and length (documented, open decision). |
| `helical_cylinfibers` | 5283.5 mm³ (32-sided cylinders) | 5317.0 ± 2.7 (exact circles) | 6275.4 | Upstream matched after faceting factor 0.9936. Repo differs as above. |
| `helical_noise` | 6699–6751 mm³ (seeds 1–3) | −0.56 % expected, sd 28 mm³ | 7168.4 (one draw) | Matched in distribution. Not the same realisation (upstream is unseeded). |
| `tubular_generic` | 7001.1 mm³ (call corrected, see below) | 6996.7 (exact circles) | 6994.7 | Matched after faceting factor. |
| `tubular_shapesize` | 6501.7 mm³ | 6493.0 (exact circles) | 6492.0 | Matched after faceting factor. |
| `tubular_layers` | 7640.4 mm³ | 7638.4 (exact circles) | 7638.1 | Matched after faceting factor. |
| `tubular_noise` | 7001.1 mm³ | invariant to noise | 6994.7 | Matched. Volume does not change with the hole jitter. |
| `cellular_generic` | not run | not run | 5765.4 | Blocked: Fracture Cell add-on not in the bpy 5.0.1 wheel. |
| `cellular_sandwich` | not run | not run | 6435.5 | Blocked, as above. |
| `cellular_voronoi` | not run | not run | 5775.1 | Blocked, as above. |
| `cellular_vorosand` | not run | not run | 6450.8 | Blocked, as above. |

**Matched** means the Blender run of the upstream code and the independent reference agree within the stated errors, after the 32-sided cylinder factor where a cylinder is present. The repo's recorded values are not the upstream arithmetic for the helical families; see `docs/BIOINSPIRED_GEOMETRY.md` for the three documented changes and their size.

## Known upstream issues

- `tubular_generic`: the code defines `create_tubules()` with no parameters and calls it with `tubule_count`. It raises `TypeError` as published. The geometry check used the corrected call only.
- Cellular base codes: need Blender's Fracture Cell add-on, which the `bpy` 5.0.1 wheel does not contain.

## Routing

Routing is a separate check, in `docs/BIOINSPIRED_COMPARISON.md`: 270 of 270 single-family prompts route to the correct family. Cross-domain prompts (36) route to one family and are not fused. General non-bio prompts (14) are flagged with confidence 0.25.

## Open items

1. Fibre convention: decided by the user (2026-10-22): keep the repo convention. The fibre families stay 18–24 % above upstream, documented as a deliberate departure in `docs/BIOINSPIRED_GEOMETRY.md`. No code change.
2. Cellular base codes: not run. Needs a Blender build with the add-on, and fixed seeds for a realisation-level comparison.
3. The repo's helical noise design is one random draw. It is not the upstream realisation.

## Environment

- Blender run: `bpy` 5.0.1 for Python 3.11 in `/home/user/venv_bpy`, with no-op stub libraries in `/home/user/bpy_stubs` for missing X11/GL libraries. The stubs are never called; they only let the module load without a display.
- Independent reference: `.venv` (numpy), `python/validation/bio_reference.py`.
- Driver for the Blender runs: `python/validation/run_upstream_all.sh <Bioinspired123D checkout>`.
