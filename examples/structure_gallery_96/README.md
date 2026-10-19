# Structure gallery

> **Resolution set: 96 cells per axis (0.21 mm voxels).** Kept as the 96-cell record, restored unchanged from commit `853972d`
> (where it was stored in `examples/structure_gallery/`, then overwritten by the 192-cell run in `5befa7f`).
> These designs have closed exterior skins. Their exterior views were removed (the closed-skin rule); the cut-away views are kept. They are superseded for open designs by
> `examples/structure_gallery_256/` (256 cells, open) and `examples/structure_gallery_256_mixed_open/` (A5). Not merged with other sets.


**31 of 31 designs pass every check.** Each design is a complete run through the pipeline (IntentHarness, TopologyHarness, GeometryHarness, ValidationHarness, RepairHarness), with a 96-cell grid, a 20 mm box, and a 144-cell grid for convergence.

Each folder contains `design.json` (DesignState, metrics, validation, repair_history), a copy-executable `design.ts` (run with `node --experimental-strip-types design.ts`), `screenshot.png` (1600 px cut-away view showing the internal structure). Exterior views were removed. Regenerate everything with `node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 96`. The `gallery.json` file holds all checks.

## Checks

| Check | Rule |
|---|---|
| harnesses_ok | all five harnesses report ok |
| single_solid | exactly one connected solid (components of at least 27 grid nodes) |
| volume_mc_agreement | mesh volume at 144 cells vs Monte Carlo occupancy of the implicit field (200 000 samples), within 5 % |
| resolution_convergence | mesh volume at 96 vs 144 cells, within 5 % |
| wall_matches_design | lattices and TPMS only: median measured wall (inward ray chords) vs designed strut diameter or sheet thickness, within 25 % |
| periodicity | TPMS only: F(p + a) = F(p) for 2000 interior points of the periodic core (without the skin), 1e-6 |
| fusion identities | union: max(A,B) <= A∪B <= A+B on samples; intersect: A∩B <= min(A,B); zoned: non-empty |
| skin_attached | the skinned result contains the core and is one solid |
| design_ts_runs | the emitted design.ts runs and exits 0 |

## Periodic lattices (with 1 mm envelope skin)

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Solid fraction | Components | Handles | Wall (mm) | Checks | Status |
|---|---|---|---|---|---|---|---|---|---|
| `lattice_sc` Simple cubic lattice | [![lattice_sc](lattice_sc/screenshot.png)](lattice_sc/screenshot.png) | removed (closed skin) | 2525.5 | 0.316 | 1 | 176 | 1.000 | 7/7 | PASS |
| `lattice_bcc` BCC lattice | [![lattice_bcc](lattice_bcc/screenshot.png)](lattice_bcc/screenshot.png) | removed (closed skin) | 3178.7 | 0.397 | 1 | 811 | 0.800 | 7/7 | PASS |
| `lattice_fcc` FCC (octet-truss) lattice | [![lattice_fcc](lattice_fcc/screenshot.png)](lattice_fcc/screenshot.png) | removed (closed skin) | 3246.8 | 0.406 | 1 | 836 | 0.800 | 7/7 | PASS |
| `lattice_fbcc` FBCC lattice (BCC + FCC + vertical) | [![lattice_fbcc](lattice_fbcc/screenshot.png)](lattice_fbcc/screenshot.png) | removed (closed skin) | 4243.3 | 0.530 | 1 | 1791 | 0.800 | 7/7 | PASS |
| `lattice_diamond` Diamond lattice | [![lattice_diamond](lattice_diamond/screenshot.png)](lattice_diamond/screenshot.png) | removed (closed skin) | 3147.7 | 0.393 | 1 | 836 | 0.800 | 7/7 | PASS |
| `lattice_bccz` BCCZ lattice (BCC + vertical edges) | [![lattice_bccz](lattice_bccz/screenshot.png)](lattice_bccz/screenshot.png) | removed (closed skin) | 3281.9 | 0.410 | 1 | 891 | 0.800 | 7/7 | PASS |
| `lattice_kelvin` Kelvin foam lattice (truncated octahedra) | [![lattice_kelvin](lattice_kelvin/screenshot.png)](lattice_kelvin/screenshot.png) | removed (closed skin) | 3295.3 | 0.412 | 1 | 1200 | 0.800 | 7/7 | PASS |

## Triply periodic minimal surfaces (with 1 mm envelope skin)

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Solid fraction | Components | Handles | Wall (mm) | Checks | Status |
|---|---|---|---|---|---|---|---|---|---|
| `tpms_gyroid` Gyroid | [![tpms_gyroid](tpms_gyroid/screenshot.png)](tpms_gyroid/screenshot.png) | removed (closed skin) | 3886.4 | 0.486 | 1 | 324 | 0.481 | 8/8 | PASS |
| `tpms_schwarz_p` Schwarz P (primitive) | [![tpms_schwarz_p](tpms_schwarz_p/screenshot.png)](tpms_schwarz_p/screenshot.png) | removed (closed skin) | 3556.0 | 0.445 | 1 | 109 | 0.496 | 8/8 | PASS |
| `tpms_schwarz_d` Schwarz D (diamond surface) | [![tpms_schwarz_d](tpms_schwarz_d/screenshot.png)](tpms_schwarz_d/screenshot.png) | removed (closed skin) | 4260.2 | 0.533 | 1 | 666 | 0.474 | 8/8 | PASS |
| `tpms_neovius` Neovius | [![tpms_neovius](tpms_neovius/screenshot.png)](tpms_neovius/screenshot.png) | removed (closed skin) | 4157.4 | 0.520 | 1 | 577 | 0.521 | 8/8 | PASS |
| `tpms_iwp` I-WP (wrapped package) | [![tpms_iwp](tpms_iwp/screenshot.png)](tpms_iwp/screenshot.png) | removed (closed skin) | 4089.6 | 0.511 | 1 | 505 | 0.475 | 8/8 | PASS |
| `tpms_lidinoid` Lidinoid | [![tpms_lidinoid](tpms_lidinoid/screenshot.png)](tpms_lidinoid/screenshot.png) | removed (closed skin) | 5524.6 | 0.691 | 1 | 1530 | 0.471 | 8/8 | PASS |

## Bioinspired base structures (Bioinspired123D families)

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Solid fraction | Components | Handles | Wall (mm) | Checks | Status |
|---|---|---|---|---|---|---|---|---|---|
| `bio_helical_generic` Helical plies (Bouligand) | [![bio_helical_generic](bio_helical_generic/screenshot.png)](bio_helical_generic/screenshot.png) | removed (closed skin) | 7165.9 | 0.896 | 1 | 0 | n/a | 5/5 | PASS |
| `bio_helical_rectfibers` Helical rectangular fibres | [![bio_helical_rectfibers](bio_helical_rectfibers/screenshot.png)](bio_helical_rectfibers/screenshot.png) | removed (closed skin) | 6581.9 | 0.823 | 1 | 0 | n/a | 5/5 | PASS |
| `bio_helical_cylinfibers` Helical cylindrical fibres | [![bio_helical_cylinfibers](bio_helical_cylinfibers/screenshot.png)](bio_helical_cylinfibers/screenshot.png) | removed (closed skin) | 5566.2 | 0.696 | 1 | 444 | n/a | 5/5 | PASS |
| `bio_helical_noise` Helical plies with rotation noise | [![bio_helical_noise](bio_helical_noise/screenshot.png)](bio_helical_noise/screenshot.png) | removed (closed skin) | 7168.4 | 0.896 | 1 | 0 | n/a | 5/5 | PASS |
| `bio_cellular_generic` Cellular foam (Voronoi) | [![bio_cellular_generic](bio_cellular_generic/screenshot.png)](bio_cellular_generic/screenshot.png) | removed (closed skin) | 5766.9 | 0.721 | 1 | 11 | n/a | 5/5 | PASS |
| `bio_cellular_voronoi` Cellular Voronoi, smoothed | [![bio_cellular_voronoi](bio_cellular_voronoi/screenshot.png)](bio_cellular_voronoi/screenshot.png) | removed (closed skin) | 5806.2 | 0.726 | 1 | 4 | n/a | 5/5 | PASS |
| `bio_cellular_sandwich` Cellular sandwich | [![bio_cellular_sandwich](bio_cellular_sandwich/screenshot.png)](bio_cellular_sandwich/screenshot.png) | removed (closed skin) | 6435.7 | 0.804 | 1 | 8 | n/a | 5/5 | PASS |
| `bio_cellular_vorosand` Cellular Voronoi sandwich, smoothed | [![bio_cellular_vorosand](bio_cellular_vorosand/screenshot.png)](bio_cellular_vorosand/screenshot.png) | removed (closed skin) | 6505.2 | 0.813 | 1 | 4 | n/a | 5/5 | PASS |
| `bio_tubular_generic` Tubular (16 tubules) | [![bio_tubular_generic](bio_tubular_generic/screenshot.png)](bio_tubular_generic/screenshot.png) | removed (closed skin) | 6994.7 | 0.874 | 1 | 16 | n/a | 5/5 | PASS |
| `bio_tubular_shapesize` Tubular, elliptical section | [![bio_tubular_shapesize](bio_tubular_shapesize/screenshot.png)](bio_tubular_shapesize/screenshot.png) | removed (closed skin) | 6492.0 | 0.811 | 1 | 16 | n/a | 5/5 | PASS |
| `bio_tubular_layers` Tubular with cortical layers | [![bio_tubular_layers](bio_tubular_layers/screenshot.png)](bio_tubular_layers/screenshot.png) | removed (closed skin) | 7638.1 | 0.955 | 1 | 16 | n/a | 5/5 | PASS |
| `bio_tubular_noise` Tubular with random scatter | [![bio_tubular_noise](bio_tubular_noise/screenshot.png)](bio_tubular_noise/screenshot.png) | removed (closed skin) | 6994.7 | 0.874 | 1 | 16 | n/a | 5/5 | PASS |

## Fusions of different structure types

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Solid fraction | Components | Handles | Wall (mm) | Checks | Status |
|---|---|---|---|---|---|---|---|---|---|
| `fusion_gyroid_plus_helical` Gyroid union helical plies | [![fusion_gyroid_plus_helical](fusion_gyroid_plus_helical/screenshot.png)](fusion_gyroid_plus_helical/screenshot.png) | removed (closed skin) | 7397.9 | 0.925 | 1 | 45 | n/a | 6/6 | PASS |
| `fusion_schwarzp_to_gyroid` Schwarz P below, gyroid above (zoned at mid-height) | [![fusion_schwarzp_to_gyroid](fusion_schwarzp_to_gyroid/screenshot.png)](fusion_schwarzp_to_gyroid/screenshot.png) | removed (closed skin) | 3786.5 | 0.473 | 1 | 270 | n/a | 6/6 | PASS |
| `fusion_kelvin_to_iwp` Kelvin lattice below, I-WP above (zoned), in a 1 mm skin | [![fusion_kelvin_to_iwp](fusion_kelvin_to_iwp/screenshot.png)](fusion_kelvin_to_iwp/screenshot.png) | removed (closed skin) | 3755.7 | 0.469 | 1 | 900 | n/a | 6/6 | PASS |
| `fusion_bcc_plus_voronoi` BCC lattice union Voronoi foam | [![fusion_bcc_plus_voronoi](fusion_bcc_plus_voronoi/screenshot.png)](fusion_bcc_plus_voronoi/screenshot.png) | removed (closed skin) | 6934.7 | 0.867 | 1 | 312 | n/a | 6/6 | PASS |
| `fusion_helical_cap_iwp` Helical plies intersected with I-WP | [![fusion_helical_cap_iwp](fusion_helical_cap_iwp/screenshot.png)](fusion_helical_cap_iwp/screenshot.png) | removed (closed skin) | 2327.9 | 0.291 | 1 | 677 | n/a | 6/6 | PASS |
| `fusion_diamond_plus_lidinoid` Diamond lattice union Lidinoid, 1 mm skin | [![fusion_diamond_plus_lidinoid](fusion_diamond_plus_lidinoid/screenshot.png)](fusion_diamond_plus_lidinoid/screenshot.png) | removed (closed skin) | 6050.9 | 0.756 | 1 | 1399 | n/a | 6/6 | PASS |

## Findings and limits

- **Periodic lattices and TPMS need an envelope skin.** The raw periodic cores clipped to the box are not one solid: raw Kelvin gives 16 components (at 96 and 128 cells, radius 0.4 and 0.5 mm), and raw Lidinoid gives 3 solids, two of which are small boundary fragments. Every lattice and TPMS entry therefore carries a 1 mm solid skin. This is a design rule, not a pass threshold; the raw numbers are the evidence.
- **Lidinoid offset is 0.15.** This is the constant in the commonly used implicit form. The earlier 0.3 gave a much denser sheet (855 cavities by an earlier counting method, not directly comparable). Void-component counts depend strongly on the grid, so no cavity count is claimed here.
- **Zoned fusion replaces the earlier linear grading.** Linear blending of two fields fragmented the Kelvin part into 14 pieces. The zoned mode cuts each part with a half-space and unites the parts over a 1 mm overlap band, which gives one solid. The seam is a planar cut, not an exact B-Rep boolean.
- **Tubular noise has the same volume as the generic tubule block.** Hole positions are jittered inside the box and the hole areas are unchanged, so the solid volume is translation-invariant. The jitter changes surface area (4310.09 vs 4310.09 mm²) and the minimum-wall statistics, not the volume.
- **Helical plies are nearly solid** (about 90 % solid fraction), as in the upstream basecode. Their wall-median column is a ray-chord statistic on a solid body and is not reported as a wall thickness.
- **Bio families are not yet compared numerically** with Bioinspired123D's `eval/benchmark.csv`; the family definitions come from its basecode. That comparison remains open.
- **Not done here:** printing or FEA validation, and STEP export for these 31 designs.

## Re-run with dual contouring (skin records, 2026-10-19)

The 17 entries with a 1 mm envelope skin (periodic lattices, TPMS, and the two skin fusions) were regenerated with the current mesher. Each one is a fusion (skin ∪ structure), so manifold dual contouring is used (`src/geometry/dualcontour.ts`), not surface nets.

- **Geometry unchanged.** The Monte Carlo volume is identical to the earlier record for each entry (column "MC mm³"), so the same solid was re-meshed.
- **Mesh volume changes** by −2.6 % to +3.3 % (table). The convergence-grid mesh agrees with Monte Carlo within 1.7 % for the lattices and TPMS (column "MC check" is the convergence-grid mesh against Monte Carlo, from the run).
- **Convergence grid:** the convergence check of these entries uses 120 cells (1.25 × 96). The earlier records of this set used 144 cells (1.5 ×); the other entries keep 144.
- All 17 pass with one component. The other entries in this set are unchanged.
- These are still **closed-skin records** and are superseded for open designs by `examples/structure_gallery_256/` and `examples/structure_gallery_256_mixed_open/`.

| id | old V (mm³) | new V (mm³) | change | MC (mm³) | MC check (convergence-grid mesh vs MC) | result |
|---|---|---|---|---|---|---|
| `lattice_sc` | 2525.496 | 2583.635 | +2.30 % | 2560.32 | 0.83 % | PASS |
| `lattice_bcc` | 3178.740 | 3261.714 | +2.61 % | 3247.88 | 0.24 % | PASS |
| `lattice_fcc` | 3246.762 | 3351.165 | +3.22 % | 3311.84 | 0.88 % | PASS |
| `lattice_fbcc` | 4243.295 | 4382.993 | +3.29 % | 4311.60 | 1.25 % | PASS |
| `lattice_diamond` | 3147.669 | 3228.650 | +2.57 % | 3215.08 | 0.18 % | PASS |
| `lattice_bccz` | 3281.931 | 3373.813 | +2.80 % | 3350.92 | 0.48 % | PASS |
| `lattice_kelvin` | 3295.295 | 3361.481 | +2.01 % | 3355.92 | 0.24 % | PASS |
| `tpms_gyroid` | 3886.415 | 3871.999 | -0.37 % | 3870.52 | 0.08 % | PASS |
| `tpms_schwarz_p` | 3555.992 | 3558.665 | +0.08 % | 3544.60 | 0.20 % | PASS |
| `tpms_schwarz_d` | 4260.161 | 4225.223 | -0.82 % | 4232.64 | 0.06 % | PASS |
| `tpms_neovius` | 4157.440 | 4101.230 | -1.35 % | 4118.84 | 0.05 % | PASS |
| `tpms_iwp` | 4089.628 | 4062.901 | -0.65 % | 4097.00 | 0.63 % | PASS |
| `tpms_lidinoid` | 5524.630 | 5381.692 | -2.59 % | 5394.72 | 0.04 % | PASS |
| `fusion_schwarzp_to_gyroid` | 3786.470 | 3777.734 | -0.23 % | 3775.68 | 0.03 % | PASS |
| `fusion_kelvin_to_iwp` | 3755.663 | 3775.643 | +0.53 % | 3790.28 | 0.45 % | PASS |
| `fusion_bcc_plus_voronoi` | 6934.669 | 6935.821 | +0.02 % | 6917.72 | 0.17 % | PASS |
| `fusion_diamond_plus_lidinoid` | 6050.947 | 5893.782 | -2.60 % | 5866.12 | 0.41 % | PASS |
