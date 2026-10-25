# Structure gallery

> **Resolution set: 192 cells per axis (0.104 mm voxels).** This folder holds the 192-cell run (commit `5befa7f`). **Exception:** `bio_helical_rectfibers` and `bio_helical_cylinfibers` were regenerated with the current fibre code (commit `aff94f9`: fibres reach the envelope corners). The old records predated that change; the cylinder record also had 9 plies while its own unknowns said "default 10 used", so it now has 10 plies. The other 34 designs are unchanged. These two folders also carry `view_top`, `view_front` and `view_side` renders from the current script; the other folders do not have them yet. The 96 and 256 sets already used the current fibre code.
> It has closed exterior skins. Their exterior views were removed (the closed-skin rule); the cut-away views are kept. The 96-cell set is in `examples/structure_gallery_96/`,
> the open 256-cell set is in `examples/structure_gallery_256/`, and the mixed open set is in `examples/structure_gallery_256_mixed_open/`.
> The sets are kept separate and are not merged.


**36 of 36 designs pass every check.** Geometry is sampled on a 192-cell grid across the 20 mm box (0.104 mm voxels). Convergence is checked against a 240-cell grid. Each design is a full run through the pipeline (IntentHarness, TopologyHarness, GeometryHarness, ValidationHarness, RepairHarness).

Each folder holds `design.json` (DesignState, metrics, validation, repair_history, coupling metrics), a copy-executable `design.ts` (`node --experimental-strip-types design.ts`), `screenshot.png` (1600 px cut-away view that shows the internal structure). Exterior views were removed. Regenerate: `node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 192`. `gallery.json` holds every check.

## Checks

| Check | Rule |
|---|---|
| harnesses_ok | all five harnesses report ok |
| single_solid | exactly one connected solid (components of at least 27 grid nodes) |
| watertight | the surface mesh has no open edges |
| volume_mc_agreement | mesh volume at 240 cells vs Monte Carlo occupancy of the field (200 000 samples), within 5 % |
| resolution_convergence | mesh volume at 192 vs 240 cells, within 5 % |
| wall_matches_design | lattices and TPMS: median measured wall vs designed strut diameter or sheet thickness, within 25 % |
| periodicity | TPMS: F(p + a) = F(p) on the periodic core (without the skin), 1e-6 |
| fusion identities | shallow fusions only: union, intersection and zoned identities on samples |
| skin_attached | skinned results contain the core and are one solid |
| design_ts_runs | the emitted design.ts runs and exits 0 |

## Deep coupled structures: five rounds, each a different coupling dimension (192 cells)

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Components | Handles | Coupling evidence | Checks | Status |
|---|---|---|---|---|---|---|---|---|
| `deep_R1_thickness` R1 thickness: gyroid wall set by a cellular foam field | [![deep_R1_thickness](deep_R1_thickness/screenshot.png)](deep_R1_thickness/screenshot.png) | removed (closed skin) | 5199.1 | 1 | 324 | t_min_observed_mm=0.5; t_max_observed_mm=1.2; t_mean_near_foam_walls_mm=1.188; t_mean_in_pockets_mm=0.515 | 6/6 | PASS |
| `deep_R2_nested` R2 nested: Kelvin lattice grown inside tubular pores | [![deep_R2_nested](deep_R2_nested/screenshot.png)](deep_R2_nested/screenshot.png) | removed (closed skin) | 6014.4 | 1 | 4032 | pores=16; pore_infill_solid_fraction=0.4076; lattice_cells=10 | 6/6 | PASS |
| `deep_R3_twist` R3 twist: BCC lattice twisted by a helical angle | [![deep_R3_twist](deep_R3_twist/screenshot.png)](deep_R3_twist/screenshot.png) | removed (closed skin) | 3223.2 | 1 | 703 | twist_total_deg=90; twist_rate_deg_per_mm=4.5; lattice_cells_xy=13; lattice_cells_z=5 | 6/6 | PASS |
| `deep_R4_blend` R4 blend: Kelvin, gyroid and I-WP joined by smooth minima | [![deep_R4_blend](deep_R4_blend/screenshot.png)](deep_R4_blend/screenshot.png) | removed (closed skin) | 4844.5 | 1 | 556 | zone_low_solid_fraction=0.3002; zone_mid_solid_fraction=0.5225; zone_high_solid_fraction=0.4749; blend_radius_mm=1.5 | 6/6 | PASS |
| `deep_R5_hierarchy` R5 hierarchy: gyroid infill in every foam pocket | [![deep_R5_hierarchy](deep_R5_hierarchy/screenshot.png)](deep_R5_hierarchy/screenshot.png) | removed (closed skin) | 7149.6 | 1 | 300 | pocket_fill_fraction=0.3718; solid_fraction=0.824 | 6/6 | PASS |

## Open coupled rounds R6–R12 (skin-free; 96, 192 and 256 cells)

These later coupled rounds are **not** in this folder. Each round has its own folder per resolution, with a README, `gallery.json`, and front/side/top views:

| Round | Structure | 96 | 192 | 256 |
|---|---|---|---|---|
| R6 | gyroid core morphs into a BCC shell | `../structure_gallery_r6_open_96/` | `../structure_gallery_r6_open_192/` | `../structure_gallery_r6_open_256/` |
| R7 | graded gyroid period | `../structure_gallery_r7_open_96/` | `../structure_gallery_r7_open_192/` | `../structure_gallery_r7_open_256/` |
| R8 | BCC strut radius from a gyroid | `../structure_gallery_r8_open_96/` | `../structure_gallery_r8_open_192/` | `../structure_gallery_r8_open_256/` |
| R9 | gated Schwarz D sheet + BCC | `../structure_gallery_r9_open_96/` | `../structure_gallery_r9_open_192/` | `../structure_gallery_r9_open_256/` |
| R10 | gated dominance (sheet and BCC both present) | `../structure_gallery_r10_open_96/` | `../structure_gallery_r10_open_192/` | `../structure_gallery_r10_open_256/` |
| R11 | gate-set iso-level of one gyroid | `../structure_gallery_r11_open_96/` | `../structure_gallery_r11_open_192/` | `../structure_gallery_r11_open_256/` |
| R12 | one-sided gate-set iso-level | `../structure_gallery_r12_open_96/` | `../structure_gallery_r12_open_192/` | `../structure_gallery_r12_open_256/` |

All 21 entries pass every check: single solid, watertight, and MC volume agreeing with the mesh volume. `deep_R9_gated` at 256 cells originally failed the 0.4 mm printability floor (min wall 0.393 mm, no automatic repair for coupled designs). Its sheet wall was raised from 0.5 to 0.6 mm at 256 cells only; min wall is now 0.443 mm, and the design is recorded in `examples/structure_gallery_r9_open_256/README.md`. The renders are in each round's `deep_R*/screenshot.png` and `view_*.png`.

## Periodic lattices (with 1 mm envelope skin)

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Solid fraction | Components | Handles | Wall (mm) | Checks | Status |
|---|---|---|---|---|---|---|---|---|---|
| `lattice_sc` Simple cubic lattice | [![lattice_sc](lattice_sc/screenshot.png)](lattice_sc/screenshot.png) | removed (closed skin) | 2548.2 | 0.319 | 1 | 176 | 1.000 | 8/8 | PASS |
| `lattice_bcc` BCC lattice | [![lattice_bcc](lattice_bcc/screenshot.png)](lattice_bcc/screenshot.png) | removed (closed skin) | 3222.6 | 0.403 | 1 | 811 | 0.800 | 8/8 | PASS |
| `lattice_fcc` FCC (octet-truss) lattice | [![lattice_fcc](lattice_fcc/screenshot.png)](lattice_fcc/screenshot.png) | removed (closed skin) | 3288.6 | 0.411 | 1 | 836 | 0.800 | 8/8 | PASS |
| `lattice_fbcc` FBCC lattice (BCC + FCC + vertical) | [![lattice_fbcc](lattice_fbcc/screenshot.png)](lattice_fbcc/screenshot.png) | removed (closed skin) | 4285.9 | 0.536 | 1 | 1791 | 0.800 | 8/8 | PASS |
| `lattice_diamond` Diamond lattice | [![lattice_diamond](lattice_diamond/screenshot.png)](lattice_diamond/screenshot.png) | removed (closed skin) | 3193.3 | 0.399 | 1 | 836 | 0.800 | 8/8 | PASS |
| `lattice_bccz` BCCZ lattice (BCC + vertical edges) | [![lattice_bccz](lattice_bccz/screenshot.png)](lattice_bccz/screenshot.png) | removed (closed skin) | 3326.0 | 0.416 | 1 | 891 | 0.800 | 8/8 | PASS |
| `lattice_kelvin` Kelvin foam lattice (truncated octahedra) | [![lattice_kelvin](lattice_kelvin/screenshot.png)](lattice_kelvin/screenshot.png) | removed (closed skin) | 3338.9 | 0.417 | 1 | 1200 | 0.800 | 8/8 | PASS |

## Triply periodic minimal surfaces (with 1 mm envelope skin)

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Solid fraction | Components | Handles | Wall (mm) | Checks | Status |
|---|---|---|---|---|---|---|---|---|---|
| `tpms_gyroid` Gyroid | [![tpms_gyroid](tpms_gyroid/screenshot.png)](tpms_gyroid/screenshot.png) | removed (closed skin) | 3873.4 | 0.484 | 1 | 324 | 0.482 | 9/9 | PASS |
| `tpms_schwarz_p` Schwarz P (primitive) | [![tpms_schwarz_p](tpms_schwarz_p/screenshot.png)](tpms_schwarz_p/screenshot.png) | removed (closed skin) | 3548.7 | 0.444 | 1 | 109 | 0.496 | 9/9 | PASS |
| `tpms_schwarz_d` Schwarz D (diamond surface) | [![tpms_schwarz_d](tpms_schwarz_d/screenshot.png)](tpms_schwarz_d/screenshot.png) | removed (closed skin) | 4238.6 | 0.530 | 1 | 666 | 0.475 | 9/9 | PASS |
| `tpms_neovius` Neovius | [![tpms_neovius](tpms_neovius/screenshot.png)](tpms_neovius/screenshot.png) | removed (closed skin) | 4128.4 | 0.516 | 1 | 577 | 0.519 | 9/9 | PASS |
| `tpms_iwp` I-WP (wrapped package) | [![tpms_iwp](tpms_iwp/screenshot.png)](tpms_iwp/screenshot.png) | removed (closed skin) | 4082.0 | 0.510 | 1 | 505 | 0.476 | 9/9 | PASS |
| `tpms_lidinoid` Lidinoid | [![tpms_lidinoid](tpms_lidinoid/screenshot.png)](tpms_lidinoid/screenshot.png) | removed (closed skin) | 5426.9 | 0.678 | 1 | 1530 | 0.469 | 9/9 | PASS |

## Bioinspired base structures (Bioinspired123D families)

> **Cellular entries are a repo-specific Voronoi wall model, not Bioinspired123D geometry.** The upstream cellular codes (Fracture Cell cube plus wireframe, strut thickness 0.2) give 6–2143 mm³ across 20 seeds; the four entries below are 5765–6451 mm³, 3–10× larger. The geometry is unchanged; it is labelled, not replaced (decision 2026-10-22). See `docs/BIOINSPIRED_VALIDATION.md`.

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Solid fraction | Components | Handles | Wall (mm) | Checks | Status |
|---|---|---|---|---|---|---|---|---|---|
| `bio_helical_generic` Helical plies (Bouligand) | [![bio_helical_generic](bio_helical_generic/screenshot.png)](bio_helical_generic/screenshot.png) | removed (closed skin) | 7165.9 | 0.896 | 1 | 0 | n/a | 6/6 | PASS |
| `bio_helical_rectfibers` Helical rectangular fibres | [![bio_helical_rectfibers](bio_helical_rectfibers/screenshot.png)](bio_helical_rectfibers/screenshot.png) | removed (open) | 7733.8 | 0.967 | 1 | 22 | n/a | 6/6 | PASS |
| `bio_helical_cylinfibers` Helical cylindrical fibres | [![bio_helical_cylinfibers](bio_helical_cylinfibers/screenshot.png)](bio_helical_cylinfibers/screenshot.png) | removed (open) | 6275.4 | 0.784 | 1 | 834 | n/a | 6/6 | PASS |
| `bio_helical_noise` Helical plies with rotation noise | [![bio_helical_noise](bio_helical_noise/screenshot.png)](bio_helical_noise/screenshot.png) | removed (closed skin) | 7168.4 | 0.896 | 1 | 0 | n/a | 6/6 | PASS |
| `bio_cellular_generic` Cellular foam (repo Voronoi wall model; not Bioinspired123D geometry) | [![bio_cellular_generic](bio_cellular_generic/screenshot.png)](bio_cellular_generic/screenshot.png) | removed (closed skin) | 5765.4 | 0.721 | 1 | 12 | n/a | 6/6 | PASS |
| `bio_cellular_voronoi` Cellular Voronoi, smoothed (repo Voronoi wall model; not Bioinspired123D geometry) | [![bio_cellular_voronoi](bio_cellular_voronoi/screenshot.png)](bio_cellular_voronoi/screenshot.png) | removed (closed skin) | 5775.1 | 0.722 | 1 | 7 | n/a | 6/6 | PASS |
| `bio_cellular_sandwich` Cellular sandwich (repo Voronoi wall model; not Bioinspired123D geometry) | [![bio_cellular_sandwich](bio_cellular_sandwich/screenshot.png)](bio_cellular_sandwich/screenshot.png) | removed (closed skin) | 6435.5 | 0.804 | 1 | 9 | n/a | 6/6 | PASS |
| `bio_cellular_vorosand` Cellular Voronoi sandwich, smoothed (repo Voronoi wall model; not Bioinspired123D geometry) | [![bio_cellular_vorosand](bio_cellular_vorosand/screenshot.png)](bio_cellular_vorosand/screenshot.png) | removed (closed skin) | 6450.8 | 0.806 | 1 | 5 | n/a | 6/6 | PASS |
| `bio_tubular_generic` Tubular (16 tubules) | [![bio_tubular_generic](bio_tubular_generic/screenshot.png)](bio_tubular_generic/screenshot.png) | removed (closed skin) | 6994.7 | 0.874 | 1 | 16 | n/a | 6/6 | PASS |
| `bio_tubular_shapesize` Tubular, elliptical section | [![bio_tubular_shapesize](bio_tubular_shapesize/screenshot.png)](bio_tubular_shapesize/screenshot.png) | removed (closed skin) | 6492.0 | 0.811 | 1 | 16 | n/a | 6/6 | PASS |
| `bio_tubular_layers` Tubular with cortical layers | [![bio_tubular_layers](bio_tubular_layers/screenshot.png)](bio_tubular_layers/screenshot.png) | removed (closed skin) | 7638.1 | 0.955 | 1 | 16 | n/a | 6/6 | PASS |
| `bio_tubular_noise` Tubular with random scatter | [![bio_tubular_noise](bio_tubular_noise/screenshot.png)](bio_tubular_noise/screenshot.png) | removed (closed skin) | 6994.7 | 0.874 | 1 | 16 | n/a | 6/6 | PASS |

## Shallow fusions (boolean combination of two complete designs; baseline)

| Design | Cut-away | Exterior (removed) | Volume (mm³) | Solid fraction | Components | Handles | Wall (mm) | Checks | Status |
|---|---|---|---|---|---|---|---|---|---|
| `fusion_gyroid_plus_helical` Gyroid union helical plies | [![fusion_gyroid_plus_helical](fusion_gyroid_plus_helical/screenshot.png)](fusion_gyroid_plus_helical/screenshot.png) | removed (closed skin) | 7407.4 | 0.926 | 1 | 52 | n/a | 7/7 | PASS |
| `fusion_schwarzp_to_gyroid` Schwarz P below, gyroid above (zoned at mid-height) | [![fusion_schwarzp_to_gyroid](fusion_schwarzp_to_gyroid/screenshot.png)](fusion_schwarzp_to_gyroid/screenshot.png) | removed (closed skin) | 3774.1 | 0.472 | 1 | 270 | n/a | 7/7 | PASS |
| `fusion_kelvin_to_iwp` Kelvin lattice below, I-WP above (zoned), in a 1 mm skin | [![fusion_kelvin_to_iwp](fusion_kelvin_to_iwp/screenshot.png)](fusion_kelvin_to_iwp/screenshot.png) | removed (closed skin) | 3771.7 | 0.471 | 1 | 924 | n/a | 7/7 | PASS |
| `fusion_bcc_plus_voronoi` BCC lattice union Voronoi foam | [![fusion_bcc_plus_voronoi](fusion_bcc_plus_voronoi/screenshot.png)](fusion_bcc_plus_voronoi/screenshot.png) | removed (closed skin) | 6921.3 | 0.865 | 1 | 405 | n/a | 7/7 | PASS |
| `fusion_helical_cap_iwp` Helical plies intersected with I-WP | [![fusion_helical_cap_iwp](fusion_helical_cap_iwp/screenshot.png)](fusion_helical_cap_iwp/screenshot.png) | removed (closed skin) | 2374.8 | 0.297 | 1 | 693 | n/a | 7/7 | PASS |
| `fusion_diamond_plus_lidinoid` Diamond lattice union Lidinoid, 1 mm skin | [![fusion_diamond_plus_lidinoid](fusion_diamond_plus_lidinoid/screenshot.png)](fusion_diamond_plus_lidinoid/screenshot.png) | removed (closed skin) | 5909.3 | 0.739 | 1 | 1989 | n/a | 7/7 | PASS |

## Findings and limits

- **Resolution.** The earlier gallery used a 96-cell grid (0.21 mm voxels), so 0.4 mm struts were about 4 voxels across and the renders looked faceted. It now uses 192 cells (0.104 mm). Strut and sheet features are about 8 voxels across.
- **Surface-mesh bug fixed.** At 192 cells the sampling border was only 2 cells (0.21 mm). Strut caps that extended past the box were truncated there, which left 8335 open edges in one design and a volume error of about 25 %. The border is now at least 1 mm, and a regression test and a watertight check cover it.
- **Envelope skin.** Every periodic or coupled design has a 1 mm solid skin, which is the same rule as before. Without it the clipped structures are several separate solids: raw Kelvin 16 components and raw Lidinoid 3 components (measured before the skin was added).
- **Coupling is measured.** Each coupled design records a coupling metric from its own field: R1 wall thickness near foam walls vs in pockets, R2 pore infill fraction, R3 twist rate, R4 solid fraction per zone, R5 pocket fill fraction. See `docs/DEEP_FUSION_ROUNDS.md`.
- **Shallow fusions remain as a baseline.** The six `fusion_*` designs are boolean combinations of two complete designs. They are not coupled and are kept only for comparison.
- **Tubular noise** has the same volume as the generic tubule block (samples differ in 4.2 % of points, measured in the earlier probe).
- **Helical plies** (bio_helical_*) appear as stepped plate edges in the 192 renders. Their wall-median column is a ray-chord statistic and is not reported as a wall thickness.
- **Bioinspired123D comparison**: `docs/BIOINSPIRED_COMPARISON.md`. All 12 base codes are implemented. Family routing is 270/270 on the single-family benchmark prompts. Cross-domain prompts (36) still route to one family, and the 14 generic non-bio prompts are flagged as unrecognised.
- **Not done here:** printing or FEA validation, and STEP export for these designs.

## Re-run with dual contouring (skin records, 2026-10-19)

The 17 entries with a 1 mm envelope skin (periodic lattices, TPMS, and the two skin fusions) were regenerated with the current mesher. Each one is a fusion (skin ∪ structure), so manifold dual contouring is used (`src/geometry/dualcontour.ts`), not surface nets.

- **Geometry unchanged.** The Monte Carlo volume is identical to the earlier record for each entry (column "MC mm³"), so the same solid was re-meshed.
- **Mesh volume changes** by −0.5 % to +1.5 % (table). The convergence-grid mesh agrees with Monte Carlo within 0.9 % for the lattices and TPMS (column "MC check" is the convergence-grid mesh against Monte Carlo, from the run).
- **Convergence grid:** the convergence grid is 240 cells (1.25 × 192), as in the earlier records of this set.
- All 17 pass with one component. The other entries in this set are unchanged.
- These are still **closed-skin records** and are superseded for open designs by `examples/structure_gallery_256/` and `examples/structure_gallery_256_mixed_open/`.

| id | old V (mm³) | new V (mm³) | change | MC (mm³) | MC check (convergence-grid mesh vs MC) | result |
|---|---|---|---|---|---|---|
| `lattice_sc` | 2548.246 | 2579.468 | +1.23 % | 2560.32 | 0.63 % | PASS |
| `lattice_bcc` | 3222.569 | 3245.313 | +0.71 % | 3247.88 | 0.14 % | PASS |
| `lattice_fcc` | 3288.637 | 3337.283 | +1.48 % | 3311.84 | 0.61 % | PASS |
| `lattice_fbcc` | 4285.909 | 4348.760 | +1.47 % | 4311.60 | 0.68 % | PASS |
| `lattice_diamond` | 3193.251 | 3217.133 | +0.75 % | 3215.08 | 0.02 % | PASS |
| `lattice_bccz` | 3326.041 | 3355.936 | +0.90 % | 3350.92 | 0.06 % | PASS |
| `lattice_kelvin` | 3338.867 | 3364.133 | +0.76 % | 3355.92 | 0.42 % | PASS |
| `tpms_gyroid` | 3873.450 | 3877.896 | +0.11 % | 3870.52 | 0.18 % | PASS |
| `tpms_schwarz_p` | 3548.741 | 3552.340 | +0.10 % | 3544.60 | 0.16 % | PASS |
| `tpms_schwarz_d` | 4238.583 | 4239.209 | +0.01 % | 4232.64 | 0.17 % | PASS |
| `tpms_neovius` | 4128.389 | 4126.247 | -0.05 % | 4118.84 | 0.21 % | PASS |
| `tpms_iwp` | 4081.980 | 4082.548 | +0.01 % | 4097.00 | 0.31 % | PASS |
| `tpms_lidinoid` | 5426.899 | 5400.608 | -0.48 % | 5394.72 | 0.15 % | PASS |
| `fusion_schwarzp_to_gyroid` | 3774.098 | 3779.645 | +0.15 % | 3775.68 | 0.06 % | PASS |
| `fusion_kelvin_to_iwp` | 3771.658 | 3786.411 | +0.39 % | 3790.28 | 0.00 % | PASS |
| `fusion_bcc_plus_voronoi` | 6921.332 | 6923.221 | +0.03 % | 6917.72 | 0.05 % | PASS |
| `fusion_diamond_plus_lidinoid` | 5909.288 | 5882.532 | -0.45 % | 5866.12 | 0.25 % | PASS |

## Deep designs (`deep_R1`–`deep_R5`): dual-contouring re-run (2026-10-19)

The five deep designs (`topology: coupled`) were regenerated with manifold dual contouring. Geometry is unchanged: the Monte Carlo volume (column "MC") is the same as in the earlier record for each design, to within 0.01 %. These are the closed-skin records of this set (1 mm skin, as before). The skin is what makes the 192 volumes larger than the 256 open ones.

| id | old V (mm³) | new V (mm³) | change | MC (mm³) | MC check (convergence-grid mesh vs MC) | result |
|---|---|---|---|---|---|---|
| `deep_R1_thickness` | 5199.139 | 5187.740 | -0.22 % | 5195.84 | 0.12 % | PASS |
| `deep_R2_nested` | 6014.357 | 5996.522 | -0.30 % | 6003.08 | 0.35 % | PASS |
| `deep_R3_twist` | 3223.177 | 3241.994 | +0.58 % | 3243.6 | 0.10 % | PASS |
| `deep_R4_blend` | 4844.500 | 4831.751 | -0.26 % | 4842.6 | 0.14 % | PASS |
| `deep_R5_hierarchy` | 7149.637 | 7138.611 | -0.15 % | 7136.08 | 0.03 % | PASS |
