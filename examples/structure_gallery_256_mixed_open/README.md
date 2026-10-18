# Mixed gallery at 256 cells, open designs (A5)

Entries that mix bio, TPMS, lattice and deep (field-level coupled) structures, re-run with the current code:
no closed envelope skin (`SKIN = 0`, deep and coupled designs `skin_mm: 0`), four cut-away views each.
Resolution 256 cells on the 20 mm box, convergence grid 320.

Field-based (non-exact) renders: these come from the field and surface-nets mesh, not an exact B-Rep. They are labelled as such in the gallery index.

| id | title | group | volume (mm³) | validation | images |
|---|---|---|---|---|---|
| `fusion_gyroid_plus_bcc` | Gyroid union BCC lattice (open partner) | fusion | 3374.646 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
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
- The volumes equal the committed `examples/structure_gallery_256` values for the same ids, except `fusion_gyroid_plus_bcc`, which is new. Those older entries were already built with `SKIN = 0`, so the "1 mm skin" wording in their titles was stale. The titles here are corrected.
- Shallow fusions (`fusion_*`) are boolean unions or zones of whole structures. They are kept for variety. The `deep_R*` entries are the field-coupled designs, and the depth of coupling is recorded in `design.json`.
- `deep_R2_nested` is a solid matrix with 16 pores (4×4, r 2 mm, pitch 5 mm), and a Kelvin lattice fills each pore. Its flat faces are that solid matrix, which is the intended design. Checked with `scripts/check_r2_matrix.ts`: matrix solid fraction 1.000, pore infill solid fraction 0.487. Volume 5603.703 mm³, 1 component.
- Each entry has `design.json` (spec, metrics, repair history, validation) and `design.ts` (copy-executable code).

## Replacement of `fusion_gyroid_plus_helical` (decision 2026-10-18)
The helical part was dense on its faces (fibre version 0.96–0.97, cylinder-fibre variant 0.70–0.83), so the entry was closed by its helical part. The user chose an open partner. The entry is now `fusion_gyroid_plus_bcc` (gyroid union BCC lattice, cell 4 mm, strut radius 0.4 mm): volume 3374.646 mm³, 1 component, PASS. The old helical entry was removed from the gallery and its folder deleted; it remains in git history (commit 43cc9b2 and earlier).

## Openness: judged from the renders (decision 2026-10-18)
The user decided that openness is judged from the renders, with no numeric criterion. The solid fractions below are information only. The proposed 0.5 threshold was not adopted.

## Visual check of the main renders (`screenshot.png`)
Each entry's main render was inspected. No fix is claimed unless stated.

| id | seen in `screenshot.png` | status |
|---|---|---|
| `fusion_gyroid_plus_bcc` | open gyroid–lattice structure, no plate; jagged rim | rim sawtooth (open) |
| `deep_R1_thickness` | gyroid-type sheet, jagged rim (sawtooth) | open: rim sawtooth (gyroid) |
| `deep_R3_twist` | BCC-like strut lattice, open | acceptable |
| `deep_R4_blend` | blended sheets, jagged rim | open: rim sawtooth |
| `deep_R5_hierarchy` | large flat faces with pocketed infill | flat faces: solid boundary (0.7 on faces), intended as foam walls not verified |
| `fusion_bcc_plus_voronoi` | flat faces; strut rods appear past the box at top and sides | rods are interior, seen through the cut-away walls; mesh extent −0.04 to 20.02 mm (inside the cube to one voxel) |
| `fusion_diamond_plus_lidinoid` | flat faces; strut rods past the box; jagged rim | rods as above; plus rim sawtooth (open) |
| `fusion_helical_cap_iwp` | I-WP-type sheet, jagged rim; one small stray fragment at top | open: rim sawtooth, fragment |
| `fusion_schwarzp_to_gyroid` | gyroid-type sheet, jagged rim | open: rim sawtooth |

Open points carried forward: the rim sawtooth on gyroid-based entries, and whether the flat faces in `deep_R5_hierarchy`, `fusion_bcc_plus_voronoi` and `fusion_diamond_plus_lidinoid` are the intended foam walls.

## Solid fractions on the box faces (information only)
Slice test (`scripts/slice_test.ts` → `eval/slice_test.tsv`): planes 0.2 mm inside each face, grid 0.1 mm, solid fraction = share of points with field < 0. Mean over z-planes every 0.25 mm. These are not used as a pass/fail criterion.

| design | z bottom | z top | x min | x max | y min | y max | mean (z-planes) |
|---|---|---|---|---|---|---|---|
| `fusion_gyroid_plus_bcc` | 0.354 | 0.354 | 0.354 | 0.354 | 0.354 | 0.354 | 0.422 |
| `deep_R1_thickness` | 0.421 | 0.425 | 0.421 | 0.431 | 0.416 | 0.442 | 0.506 |
| `deep_R3_twist` | 0.126 | 0.126 | 0.161 | 0.161 | 0.161 | 0.161 | 0.181 |
| `deep_R4_blend` | 0.305 | 0.240 | 0.416 | 0.380 | 0.418 | 0.383 | 0.440 |
| `deep_R5_hierarchy` | 0.703 | 0.705 | 0.690 | 0.721 | 0.675 | 0.746 | 0.822 |
| `deep_R2_nested` | 0.756 | 0.681 | 1.000 | 1.000 | 1.000 | 1.000 | 0.706 |
| `fusion_bcc_plus_voronoi` | 0.610 | 0.620 | 0.588 | 0.638 | 0.580 | 0.674 | 0.774 |
| `fusion_diamond_plus_lidinoid` | 0.598 | 0.598 | 0.598 | 0.598 | 0.598 | 0.598 | 0.638 |
| `fusion_helical_cap_iwp` | 0.240 | 0.240 | 0.145 | 0.145 | 0.145 | 0.145 | 0.296 |
| `fusion_schwarzp_to_gyroid` | 0.155 | 0.259 | 0.217 | 0.217 | 0.215 | 0.215 | 0.273 |
| `fusion_kelvin_to_iwp` | 0.305 | 0.240 | 0.286 | 0.218 | 0.286 | 0.218 | 0.273 |

Superseded helical reference (not in the gallery any more): the rectangular-fibre fusion had faces 0.96–0.97, the cylinder-fibre variant 0.70–0.83, and the plate version 1.00 on z faces. The gyroid alone (`eval/slice_reference/gyroid_only.design.json`) is 0.259 on every face. Helical base families alone: `bio_helical_generic` 1.000 on z faces (plate), `bio_helical_rectfibers` 0.950, `bio_helical_cylinfibers` 0.570.

## Envelope test (`scripts/envelope_test.ts`)
Samples the full 3D shell (0.5 mm) outside the build cube, for the field, and checks the mesh extent. Zero solid points outside the cube for `fusion_bcc_plus_voronoi`, `fusion_diamond_plus_lidinoid`, `fusion_gyroid_plus_helical` (superseded) and `deep_R3_twist`. The mesh of `fusion_bcc_plus_voronoi` spans −0.04 to 20.02 mm on each axis. The rods in the cut-away render are interior struts seen through the cut walls, not protrusions.
