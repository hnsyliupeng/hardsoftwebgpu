# Open (skin-free) gallery: status

The user asked to remove the closed boundary (the 1 mm envelope skin, which makes exterior views a solid cube)
and to show multiple viewpoints. This folder still holds the **validated closed-skin results** (36/36 PASS),
because the open re-run is not finished.

Code on the branch (committed):
- `SKIN = 0` in `scripts/structure_gallery.ts`, deep and coupled designs default `skin_mm: 0`; no exterior image.
- Four cut-away views per design (`screenshot.png` iso, `view_top`, `view_front`, `view_side`) in the script.
- `clipSign` in `src/topology/fields.ts`: `max(v, d)` gave exactly 0 on box faces, so face-aligned struts flipped sign with resolution.
- Sampling grid offset of 0.3719 h in `src/geometry/grid.ts` (no node on a face or strut plane).

Open results so far (256 cells, 20 mm):
- PASS: lattice_bcc, lattice_fcc (1.2 % between 256 and 320 after the grid offset), lattice_fbcc, lattice_diamond, lattice_bccz.
- FAIL: lattice_sc. Mesh 256 = 1046 mm³ agrees with the grid-free Monte Carlo (1020 mm³, 2.5 %); mesh 320 = 1121 mm³ (10 % off). Both meshes are watertight and consistently oriented, so the 320 mesh disagrees with the field, cause not yet found.
- FAIL: lattice_kelvin (16 components), tpms_gyroid (2 components). Raw sheets clipped by the box are not one solid without the skin.
- Not yet run: lattice_sc validation of the wall gate (median ray chord 1.28 mm vs design 0.8 mm), the remaining TPMS, all fusions, bio, deep and coupled designs.

Options: (a) keep the skin for periodic designs and remove only the exterior image (current validated state);
(b) open designs with per-design connectivity repair, accepting multi-component results where they occur;
(c) keep working on the 320-mesh/field disagreement first.

## Root cause of the open-lattice mismatch (found)

The SC mismatch was not a meshing or field bug. The surface-nets mesh of the field matches Monte Carlo
(256 cells: field 656 mm³ from the grid, 664 mm³ by MC, mesh 673 mm³ signed volume).

The RepairHarness changes the design. The wall check uses the 5th percentile of inward ray chords. Chords
through a cylinder include grazing rays, so for a 0.8 mm strut the p5 chord is about 0.33–0.36 mm, below the
0.4 mm floor. The repair then scales the strut radius, and the target depends on the grid:
- 128 cells: radius 0.4 -> 0.463 mm
- 256 cells: radius 0.4 -> 0.508 mm
So the volume jump (1046 vs 1121 mm³) comes from a different repaired design at each resolution.

The closed-skin gallery was not affected: none of its lattices were repaired (only bio_helical_cylinfibers).

Fix needed (not done): the wall metric for strut lattices should measure strut diameter (2r) or a local
medial-axis thickness, not the p5 ray chord. Then re-run the open designs.
