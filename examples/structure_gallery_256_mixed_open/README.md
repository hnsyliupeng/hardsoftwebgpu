# Mixed gallery at 256 cells, open designs (A5)

Entries that mix bio, TPMS, lattice and deep (field-level coupled) structures, re-run with the current code:
no closed envelope skin (`SKIN = 0`, deep and coupled designs `skin_mm: 0`), four cut-away views each.
Resolution 256 cells on the 20 mm box, convergence grid 320.

Field-based (non-exact) renders: these come from the field and surface-nets mesh, not an exact B-Rep. They are labelled as such in the gallery index.

| id | title | group | volume (mm³) | validation | images |
|---|---|---|---|---|---|
| `fusion_gyroid_plus_bcc` | Gyroid union BCC lattice (open partner) | fusion | 3376.501 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_schwarzp_to_gyroid` | Schwarz P below, gyroid above (zoned at mid-height) | fusion | 2180.736 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_kelvin_to_iwp` | Kelvin lattice below, I-WP above (zoned), open (no skin) | fusion | 2212.687 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_bcc_plus_voronoi` | BCC lattice union Voronoi foam | fusion | 6175.190 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_helical_cap_iwp` | Helical plies intersected with I-WP | fusion | 2380.508 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `fusion_diamond_plus_lidinoid` | Diamond lattice union Lidinoid, open (no skin) | fusion | 5107.865 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R1_thickness` | R1 thickness: gyroid wall set by a cellular foam field | coupled | 4028.944 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R2_nested` | R2 nested: Kelvin lattice grown inside tubular pores | coupled | 5595.032 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R3_twist` | R3 twist: BCC lattice twisted by a helical angle | coupled | 1437.257 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R4_blend` | R4 blend: Kelvin, gyroid and I-WP joined by smooth minima | coupled | 3507.187 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |
| `deep_R5_hierarchy` | R5 hierarchy: gyroid infill in every foam pocket | coupled | 6563.376 | PASS (6/6) | screenshot.png, view_top.png, view_front.png, view_side.png |

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
| `deep_R5_hierarchy` | large flat faces with pocketed infill | flat faces are foam walls cut by the box, as designed (`scripts/face_origin.ts`: walls are 79% of the face solid; the rest is gyroid in pockets) |
| `fusion_bcc_plus_voronoi` | flat faces (foam walls: 91% of the face solid, `scripts/face_origin.ts`); strut rods appear past the box at top and sides | rods are interior, seen through the cut-away walls; mesh extent −0.04 to 20.02 mm (inside the cube to one voxel) |
| `fusion_diamond_plus_lidinoid` | flat faces; strut rods past the box; jagged rim | rods as above; plus rim sawtooth (open) |
| `fusion_helical_cap_iwp` | I-WP-type sheet, jagged rim; one small stray fragment at top | open: rim sawtooth, fragment |
| `fusion_schwarzp_to_gyroid` | gyroid-type sheet, jagged rim | open: rim sawtooth |

Open points carried forward: the rim sawtooth on gyroid-based entries (cause identified, see the section below; no fix chosen). The flat faces in `deep_R5_hierarchy` and `fusion_bcc_plus_voronoi` are foam walls cut by the box, as designed. `fusion_diamond_plus_lidinoid` flat faces: the Lidinoid network cut by the box, not a skin (`scripts/face_parts.ts`: faces 0.598 solid, the same at all six faces; Lidinoid alone 0.520 on faces; mid-height plane 0.544). The faces are only slightly denser than the bulk.

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

## Rim sawtooth (`scripts/rim_period.ts`)
Cause: the periodic TPMS sheet is clipped by the box faces, so its cut edge at the boundary repeats along the edge. The
strip profile (solid fraction along one box edge, 0.6 mm strip, 0.2 mm inside the face) swings between 0 and 1 with
peaks about 2.4–2.5 mm apart (8 peaks in 20 mm): `gyroid_only` 2.436 mm, `deep_R1_thickness` 2.471 mm. That spacing is
far larger than the 0.078 mm voxel size, so it is not a meshing artefact. It is a geometric consequence of clipping the
sheet to the box. The gyroid cell in these designs is 5 mm (`design_spec.fusion.a.parameters.cell_size_mm`), so a half-cell is 2.5 mm, which matches the measured 2.44–2.47 mm. (An earlier draft of this note wrongly said 4 mm, which is the BCC cell.) Whether to trim the edge or leave it is a design decision, not made here.

## Diamond + Lidinoid faces (`scripts/face_parts.ts`)
Each of the six faces is 0.598 solid (inset 0.2 mm, h 0.1 mm). The Lidinoid part alone is 0.520 on the faces and the diamond part 0.163. The mid-height plane (offset 0.05 mm) is 0.544, so the faces are only about 0.05 denser than the bulk. This is the periodic network cut by the box, not a closed skin. Whether the render reads as open is a judgement from the render, as set by the user.

## Re-run check (CPU, 256 cells)
All 11 designs were re-run with the current code (`scripts/structure_gallery.ts 256`, output in a scratch folder inside the repository and then copied). All 11 PASS. Every volume and every render (44 PNG files) is identical to the committed values. The only changes in the files are:
- `gallery.json` and each `design.json` now carry `min_wall_excluded_near_faces` (samples within 0.5 mm of the faces excluded from the wall metric; 690 to 1,987 per design).
- Two `design.json` / `design.ts` files (`fusion_kelvin_to_iwp`, `fusion_diamond_plus_lidinoid`) had a stale prompt and title that still said "with skin" / "1 mm skin". They now say open, as in `gallery.json`.

## Fused designs: manifold dual contouring (CPU re-run at 256)
The six fused designs (`topology: fusion`) are now meshed with manifold dual contouring (`src/geometry/dualcontour.ts`) instead of surface nets, because surface nets gave non-manifold edges at the union creases. All six re-run and PASS. Their volumes change by at most 0.6 %:
- `fusion_gyroid_plus_bcc` 3374.646 → 3376.501 mm³; `fusion_schwarzp_to_gyroid` 2179.981 → 2180.736; `fusion_kelvin_to_iwp` 2205.499 → 2212.687; `fusion_bcc_plus_voronoi` 6174.205 → 6175.190; `fusion_helical_cap_iwp` 2381.578 → 2380.508; `fusion_diamond_plus_lidinoid` 5138.036 → 5107.865 (Monte Carlo 5094.4).
- Non-manifold edges at 96 cells, before → after: gyroid+BCC 3897 → 135; schwarz→gyroid 64 → 0; kelvin→iwp 488 → 14; BCC+Voronoi 1019 → 53; helical cap 113 → 6; diamond+lidinoid 7092 → 483. Open edges stay 0. The residual pinches are narrower than one voxel (see `docs/NONMANIFOLD.md`).
- The other five entries use surface nets, unchanged.

## Flat faces on the box sides (checked 2026-10-19)
Some renders show flat patches on the box faces. `scripts/flat_face_test.ts` splits the solid samples on each face plane (0.2 mm inside the face, grid 0.2 mm) by component. Results (fraction of solid samples on the face):
- `fusion_bcc_plus_voronoi`: foam-only 0.74–0.81, BCC-only 0.07–0.11, shared 0.11–0.14. Foam alone covers 0.52–0.63 of each face.
- `fusion_diamond_plus_lidinoid`: Lidinoid-only 0.74; diamond-only 0.12; shared 0.14. Lidinoid alone covers 0.53 of each face.
So the flat patches are wall sheets of the foam or TPMS part, cut by the box. They are not a skin added by the generator: the fusion specs use `SKIN = 0`. Face solid share is about 0.6–0.7, so the faces are not closed. `deep_R5_hierarchy` is built as a single field, not as a two-part fusion, so this split was not run on it.

## Deep designs (`deep_R1`–`deep_R5`): dual-contouring re-run (2026-10-19)
The five deep designs (`topology: coupled`) are now meshed with manifold dual contouring, like the fused designs. Their geometry is unchanged: the Monte Carlo volume is identical to the earlier record for each. Volume changes against the earlier surface-nets values are −0.15 % (R2) to +1.24 % (R3, now 1437.257 mm³, against Monte Carlo 1441.96 mm³; the earlier 1419.638 was 1.5 % below it). The table above has the new volumes. Surface-nets non-manifold edges at 96 cells fall as follows: R1 39 → 0; R2 3444 → 928; R3 940 → 0; R4 566 → 9; R5 1369 → 63.

