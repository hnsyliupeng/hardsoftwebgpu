# Structure gallery, 256 cells

All 36 designs from the gallery re-run at 256 cells per 20 mm envelope (0.078 mm voxels). Earlier 96/192-cell results remain in `examples/structure_gallery/`.
Run: `GALLERY_OUT=examples/structure_gallery_256 node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 256`

**Result: 34/36 PASS.**

## Failing entries

- `bio_cellular_voronoi`: volume_mc_agreement: mesh at 320 6357.0 vs MC 5753.9 mm3 (10.48 %); resolution_convergence: 256 px-grid 5770.9 vs 320 6357.0 mm3 (9.22 %)
- `bio_cellular_vorosand`: volume_mc_agreement: mesh at 320 6913.1 vs MC 6423.0 mm3 (7.63 %); resolution_convergence: 256 px-grid 6443.6 vs 320 6913.1 mm3 (6.79 %)

Cause (diagnosed): the cellular `smoothlevel` step is a voxel-count 3x3x3 box blur. With 3 passes the blurred surface changes with grid size (256: 5771 mm³, 18 cavities; 320: 6357 mm³, 26 cavities), while with 1 pass both grids agree (6355 mm³). The 320 convergence mesh therefore disagrees with the 256 design, not because the 256 mesh is under-resolved. Fix: define the smoothing kernel in mm, not in voxels. Not yet changed.

## Periodic lattices

| id | volume (mm³) | comps | wall median (mm) | result |
|---|---|---|---|---|
| lattice_sc | 2551.04 | 1 | 1 | PASS |
| lattice_bcc | 3227.353 | 1 | 0.8 | PASS |
| lattice_fcc | 3293.223 | 1 | 0.8 | PASS |
| lattice_fbcc | 4289.788 | 1 | 0.8 | PASS |
| lattice_diamond | 3198.997 | 1 | 0.8 | PASS |
| lattice_bccz | 3330.879 | 1 | 0.8 | PASS |
| lattice_kelvin | 3338.998 | 1 | 0.8 | PASS |

## TPMS minimal surfaces

| id | volume (mm³) | comps | wall median (mm) | result |
|---|---|---|---|---|
| tpms_gyroid | 3870.229 | 1 | 0.4826 | PASS |
| tpms_schwarz_p | 3545.124 | 1 | 0.4964 | PASS |
| tpms_schwarz_d | 4233.704 | 1 | 0.4752 | PASS |
| tpms_neovius | 4125.775 | 1 | 0.5188 | PASS |
| tpms_iwp | 4079.734 | 1 | 0.4753 | PASS |
| tpms_lidinoid | 5410.97 | 1 | 0.4682 | PASS |

## Bio-inspired families (Bioinspired123D)

| id | volume (mm³) | comps | wall median (mm) | result |
|---|---|---|---|---|
| bio_helical_generic | 7165.92 | 1 | 20 | PASS |
| bio_helical_rectfibers | 6581.917 | 1 | 2 | PASS |
| bio_helical_cylinfibers | 5551.36 | 1 | 2.2222 | PASS |
| bio_helical_noise | 7168.368 | 1 | 20 | PASS |
| bio_cellular_generic | 5765.064 | 1 | 4.3517 | PASS |
| bio_cellular_voronoi | 5770.9 | 1 | 4.3555 | FAIL |
| bio_cellular_sandwich | 6433.949 | 1 | 4.6488 | PASS |
| bio_cellular_vorosand | 6443.594 | 1 | 4.5133 | FAIL |
| bio_tubular_generic | 6994.69 | 1 | 16.2928 | PASS |
| bio_tubular_shapesize | 6492.036 | 1 | 4.6184 | PASS |
| bio_tubular_layers | 7638.089 | 1 | 20 | PASS |
| bio_tubular_noise | 6994.69 | 1 | 6.8278 | PASS |

## Shallow fusions (boolean / zoned)

| id | volume (mm³) | comps | wall median (mm) | result |
|---|---|---|---|---|
| fusion_gyroid_plus_helical | 7408.095 | 1 | 18.6655 | PASS |
| fusion_schwarzp_to_gyroid | 3772.03 | 1 | 0.4949 | PASS |
| fusion_kelvin_to_iwp | 3770.729 | 1 | 0.8 | PASS |
| fusion_bcc_plus_voronoi | 6918.161 | 1 | 3.1176 | PASS |
| fusion_helical_cap_iwp | 2379.264 | 1 | 0.4743 | PASS |
| fusion_diamond_plus_lidinoid | 5888.089 | 1 | 0.5091 | PASS |

## Deep coupled fusion, R1-R5 (192 cells in the remote branch; re-run at 256 here)

| id | volume (mm³) | comps | wall median (mm) | result |
|---|---|---|---|---|
| deep_R1_thickness | 5195.338 | 1 | 1 | PASS |
| deep_R2_nested | 6004.542 | 1 | 1 | PASS |
| deep_R3_twist | 3228.384 | 1 | 0.8659 | PASS |
| deep_R4_blend | 4836.578 | 1 | 1 | PASS |
| deep_R5_hierarchy | 7144.075 | 1 | 2.1095 | PASS |

Per entry: `<id>/screenshot.png` (cut-away), `<id>/screenshot_exterior.png` (closed skin), `design.json`, `design.ts` (copy-executable), with all checks in `gallery.json`.
