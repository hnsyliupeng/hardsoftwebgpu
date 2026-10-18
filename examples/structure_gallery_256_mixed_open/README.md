# Mixed gallery at 256 cells, open designs (A5)

Entries that mix bio, TPMS, lattice and deep (field-level coupled) structures, re-run with the current code:
no closed envelope skin (`SKIN = 0`, deep and coupled designs `skin_mm: 0`), four cut-away views each.
Resolution 256 cells on the 20 mm box, convergence grid 320.

Field-based (non-exact) renders: these come from the field and surface-nets mesh, not an exact B-Rep. They are labelled as such in the gallery index.

| id | title | group | volume (mm³) | validation | images |
|---|---|---|---|---|---|
| `fusion_gyroid_plus_helical` | Gyroid union helical rectangular fibres | fusion | 7766.338 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_schwarzp_to_gyroid` | Schwarz P below, gyroid above (zoned at mid-height) | fusion | 2179.981 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_kelvin_to_iwp` | Kelvin lattice below, I-WP above (zoned), open (no skin) | fusion | 2205.499 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_bcc_plus_voronoi` | BCC lattice union Voronoi foam | fusion | 6174.205 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_helical_cap_iwp` | Helical plies intersected with I-WP | fusion | 2381.578 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_diamond_plus_lidinoid` | Diamond lattice union Lidinoid, open (no skin) | fusion | 5138.036 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R1_thickness` | R1 thickness: gyroid wall set by a cellular foam field | coupled | 4032.182 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R2_nested` | R2 nested: Kelvin lattice grown inside tubular pores | coupled | 5603.703 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R3_twist` | R3 twist: BCC lattice twisted by a helical angle | coupled | 1419.638 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R4_blend` | R4 blend: Kelvin, gyroid and I-WP joined by smooth minima | coupled | 3509.109 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R5_hierarchy` | R5 hierarchy: gyroid infill in every foam pocket | coupled | 6568.931 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |

## Notes
- The volumes equal the committed `examples/structure_gallery_256` values for the same ids. Those entries were already built with `SKIN = 0`, so the "1 mm skin" wording in their titles was stale. The titles here are corrected.
- Shallow fusions (`fusion_*`) are boolean unions or zones of whole structures. They are kept for variety. The `deep_R*` entries are the field-coupled designs, and the depth of coupling is recorded in `design.json`.
- `deep_R2_nested` is a solid matrix with 16 pores (4×4, r 2 mm, pitch 5 mm), and a Kelvin lattice fills each pore. The flat faces in its cut-away view are that solid matrix, which is the intended design. Checked with `scripts/check_r2_matrix.ts`: matrix solid fraction 1.000 (87,040 samples away from the pores), pore infill solid fraction 0.487 (266,240 samples). The volume is 5603.703 mm³, 1 component.
- Each entry has `design.json` (spec, metrics, repair history, validation) and `design.ts` (copy-executable code).

## Visual check of the main renders (`screenshot.png`, this pass)
The nine entries not inspected before (Kelvin and R2 were checked earlier) were viewed. No fix is claimed from these images; each line lists what is seen.

| id | seen in `screenshot.png` | status |
|---|---|---|
| `deep_R1_thickness` | gyroid-type sheet, jagged rim (sawtooth) | open: rim sawtooth (gyroid) |
| `deep_R3_twist` | BCC-like strut lattice, open | acceptable |
| `deep_R4_blend` | blended sheets, jagged rim | open: rim sawtooth |
| `deep_R5_hierarchy` | large flat faces with pocketed infill | flat faces not yet verified as foam walls |
| `fusion_bcc_plus_voronoi` | flat faces; strut stubs stick out past the box at top and sides | stubs are interior rods seen through the cut-away walls, not protrusions: mesh extent −0.04 to 20.02 mm on each axis (inside the cube to one voxel) |
| `fusion_diamond_plus_lidinoid` | flat faces; strut stubs past the box; jagged rim | stubs as above; plus rim sawtooth (open) |
| `fusion_gyroid_plus_helical` | previous version (helical plate family, solid square plies) had a near-full disc plate over the top face. Re-run with helical rectangular fibres: volume 7766.338 mm³, 1 component, PASS. Slice test: face solid fraction 0.96–0.97 (plate version 1.00 on z faces); the fibre version is also closed on its faces | **not open** by the slice criterion (below); no fix claimed |
| `fusion_helical_cap_iwp` | I-WP-type sheet, jagged rim; one small stray fragment at top | open: rim sawtooth, fragment |
| `fusion_schwarzp_to_gyroid` | gyroid-type sheet, jagged rim | open: rim sawtooth |

Open points carried forward: the helical plate (see `docs/TASK_PLAN.md`), the rim sawtooth on gyroid-based entries, and whether the flat faces in `deep_R5_hierarchy`, `fusion_bcc_plus_voronoi` and `fusion_diamond_plus_lidinoid` are the intended foam walls.

Note on `fusion_gyroid_plus_helical` (re-run): the entry now uses `helical_rectfibers` instead of the plate family. Its volume changed from 7419.539 to 7766.338 mm³. The previous render is in git history (commit b38dbfc). A correction: the earlier commit message called the fibre version "open". The slice test shows it is not (faces 0.96–0.97). The plate version is kept as `eval/slice_reference/fusion_gyroid_plus_helical_plate_v1.design.json`.

## Open-face test (slice test, `scripts/slice_test.ts` → `eval/slice_test.tsv`)
The top-down projection cannot show whether a face is closed, because every ply stacks in the same view. The slice test
instead samples the field itself on planes 0.2 mm inside each face (grid 0.1 mm) and reports the solid fraction (share of
points with field < 0). Mean is over z-planes every 0.25 mm, offset so that planes avoid ply interfaces.

Proposed criterion (mine, not yet approved): a face counts as **open** if its solid fraction is ≤ 0.5. Calibration: the BCC lattice
(`deep_R3_twist`) gives 0.13–0.16 on the faces, which is clearly open.

| design | z bottom | z top | x min | x max | y min | y max | mean (z-planes) | open (≤ 0.5)? |
|---|---|---|---|---|---|---|---|---|
| `fusion_gyroid_plus_helical` (plate v1, reference) | 1.000 | 1.000 | 0.689 | 0.686 | 0.683 | 0.688 | 0.926 | no |
| `fusion_gyroid_plus_helical` (fibres, current) | 0.965 | 0.964 | 0.969 | 0.969 | 0.971 | 0.969 | 0.966 | no |
| `deep_R1_thickness` | 0.421 | 0.425 | 0.421 | 0.431 | 0.416 | 0.442 | 0.506 | yes on faces (0.42–0.44); mean 0.51 |
| `deep_R3_twist` | 0.126 | 0.126 | 0.161 | 0.161 | 0.161 | 0.161 | 0.181 | yes |
| `deep_R4_blend` | 0.305 | 0.240 | 0.416 | 0.380 | 0.418 | 0.383 | 0.440 | yes |
| `deep_R5_hierarchy` | 0.703 | 0.705 | 0.690 | 0.721 | 0.675 | 0.746 | 0.822 | no |
| `deep_R2_nested` | 0.756 | 0.681 | 1.000 | 1.000 | 1.000 | 1.000 | 0.706 | no (solid matrix, by design) |
| `fusion_bcc_plus_voronoi` | 0.610 | 0.620 | 0.588 | 0.638 | 0.580 | 0.674 | 0.774 | no |
| `fusion_diamond_plus_lidinoid` | 0.598 | 0.598 | 0.598 | 0.598 | 0.598 | 0.598 | 0.638 | no |
| `fusion_helical_cap_iwp` | 0.240 | 0.240 | 0.145 | 0.145 | 0.145 | 0.145 | 0.296 | yes |
| `fusion_schwarzp_to_gyroid` | 0.155 | 0.259 | 0.217 | 0.217 | 0.215 | 0.215 | 0.273 | yes |
| `fusion_kelvin_to_iwp` | 0.305 | 0.240 | 0.286 | 0.218 | 0.286 | 0.218 | 0.273 | yes |

Reference variants (`eval/slice_reference/`): the gyroid part alone (`gyroid_only`) is 0.259 on every face, so it is open. The union with helical fibres is closed by the helical part. With `helical_cylinfibers` in place of the rectangular fibres, `fusion_gyroid_plus_helical` gives faces 0.70–0.83 and mean 0.85, which is still not open.

Helical base families alone (no fusion, same test): `bio_helical_generic` 1.000 on z faces (plate), `bio_helical_rectfibers`
0.950, `bio_helical_cylinfibers` 0.570 (the most open helical option, still above 0.5).

What this shows:
- The flat faces seen in `deep_R5_hierarchy`, `fusion_bcc_plus_voronoi` and `fusion_diamond_plus_lidinoid` are real solid boundary
  regions (0.6–0.7), not rendering artefacts. They are not open by the criterion.
- `fusion_gyroid_plus_helical` is not open in either version. The helical families are dense on the faces by design, so
  making this entry open needs a change to the helical base density, which is a design decision (not made here).
- `deep_R2_nested` is solid on its sides (matrix, as documented), so it is not open either.
- The face test does not address the rim sawtooth or the strut stubs past the envelope; those remain open.

## Envelope test (`scripts/envelope_test.ts`)
Samples the full 3D shell (0.5 mm) outside the build cube, for the field, and checks the mesh extent. Results: zero solid points outside
the cube for `fusion_bcc_plus_voronoi`, `fusion_diamond_plus_lidinoid`, `fusion_gyroid_plus_helical` and `deep_R3_twist`. The mesh of
`fusion_bcc_plus_voronoi` spans −0.04 to 20.02 mm on each axis (inside the cube to one voxel). The rods in the cut-away render are
interior struts seen through the cut walls, not protrusions. An earlier version sampled only the six face squares and was too narrow.
