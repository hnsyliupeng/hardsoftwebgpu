# Deep fusion gallery, 256 cells (field-level coupling)

Five deep-fusion designs, each a single implicit field with the parts coupled inside it (`src/topology/deep.ts`, topology `deep`).
Run: `GALLERY_OUT=examples/deep_fusion_256 node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 256 fieldfuse_r1_channel_lattice fieldfuse_r2_ply_tpms fieldfuse_r3_graded_tpms fieldfuse_r4_foam_lattice fieldfuse_r5_ply_graded_tpms`

Coupling effect = % of solid sample points that change when the coupling is removed (naive variant); threshold >= 1 %.

| id | round | volume (mm³) | coupling effect | components | all checks |
|---|---|---|---|---|---|
| fieldfuse_r1_channel_lattice | R1 | 6723.88 | 4.41 % | 1 | PASS |
| fieldfuse_r2_ply_tpms | R2 | 4747.498 | 44.89 % | 1 | PASS |
| fieldfuse_r3_graded_tpms | R3 | 4409.438 | 7.61 % | 1 | PASS |
| fieldfuse_r4_foam_lattice | R4 | 3146.903 | 32.89 % | 1 | PASS |
| fieldfuse_r5_ply_graded_tpms | R5 | 4921.382 | 43.75 % | 1 | PASS |

Screenshots: `<id>/screenshot.png` (cut-away, shows interior) and `<id>/screenshot_exterior.png` (closed exterior skin). Each folder has `design.json` and a copy-executable `design.ts`.

## Visual notes

- R1: four BCC-lattice channels visible in the cut-away.
- R2 and R5: gyroid sheets visible; the 18° per-ply twist is not visually obvious at this scale (the coupling effect is 44–45 %, measured numerically).
- R3: gyroid with Voronoi-graded thickness visible.
- R4: Voronoi foam walls with a BCC lattice in every cell visible.
- Exterior views are closed by the 1 mm skin, so they look like solid cubes; use the cut-away image.
