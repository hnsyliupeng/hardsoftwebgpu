# Deep fusion gallery, 256 cells (field-level coupling, open)

Five deep-fusion designs, each one implicit field with the parts coupled inside it (`src/topology/deep.ts`, topology `deep`).
Open: no closed skin. All five pass (5/5) in the last run.

Run: `GALLERY_OUT=examples/deep_fusion_256 node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 256 fieldfuse_r1_channel_lattice fieldfuse_r2_ply_tpms fieldfuse_r3_graded_tpms fieldfuse_r4_foam_lattice fieldfuse_r5_ply_graded_tpms`

Coupling effect = % of solid sample points that change when the coupling is removed (naive variant); threshold >= 1 %.
Wall changes for R2 and R5 are described in `examples/structure_gallery_256/README.md` (item 4).

| id | round | volume (mm³) | coupling effect | components | MC check | 256 vs 320 | result |
|---|---|---|---|---|---|---|---|
| fieldfuse_r1_channel_lattice | R1 | 6811.622 | 4.41 % | 1 | 0.97 % | 0.22 % | PASS |
| fieldfuse_r2_ply_tpms | R2 | 4842.371 | 55.22 % | 1 | 0.73 % | 0.13 % | PASS |
| fieldfuse_r3_graded_tpms | R3 | 3128.043 | 13.68 % | 1 | 0.18 % | 0.04 % | PASS |
| fieldfuse_r4_foam_lattice | R4 | 3173.664 | 32.89 % | 1 | 0.18 % | 0.07 % | PASS |
| fieldfuse_r5_ply_graded_tpms | R5 | 5014.835 | 52.06 % | 1 | 0.82 % | 0.13 % | PASS |

Screenshots: `<id>/screenshot.png` and `view_top.png`, `view_front.png`, `view_side.png` (cut-away views). No exterior skin images.
Each folder has `design.json` and a copy-executable `design.ts`.

## Visual notes

- R1: four BCC-lattice channels visible in the cut-away.
- R2 and R5: twisted gyroid sheets; the 18° per-ply twist is not visually obvious at this scale (coupling effect 52–55 % with the new walls, measured numerically).
- R3: gyroid with Voronoi-graded thickness visible.
- R4: Voronoi foam walls with a BCC lattice in every cell visible.
