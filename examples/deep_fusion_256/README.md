# Deep fusion gallery, 256 cells (field-level coupling, open)

Five deep-fusion designs, each one implicit field with the parts coupled inside it (`src/topology/deep.ts`, topology `deep`).
Open: no closed skin. All five pass (5/5) in the last run (2026-10-26). That run regenerated `design.json`, `design.ts` and `gallery.json`; volumes, coupling effects and MC checks are unchanged from the 2026-10-19 run. The metadata changed: the earlier files carried an intent-parse artefact ("No structure keyword recognised", confidence 0.1) from the placeholder prompt `deep fusion <kind>`. Those specs are author-supplied, so `unknowns` is now empty, `retrieval` is `none` and confidence is 1 (`scripts/structure_gallery.ts`, `deepSpec` and `coupledSpec`). Meshed with manifold dual contouring (topology `deep`); the earlier surface-nets volumes differed by up to 0.7 % (R4 3173.664 → 3195.419); the MC check and 256 vs 320 columns are from the same run.

Run: `GALLERY_OUT=examples/deep_fusion_256 node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 256 fieldfuse_r1_channel_lattice fieldfuse_r2_ply_tpms fieldfuse_r3_graded_tpms fieldfuse_r4_foam_lattice fieldfuse_r5_ply_graded_tpms`

Coupling effect = % of solid sample points that change when the coupling is removed (naive variant); threshold >= 1 %.
Wall changes for R2 and R5 are described in `examples/structure_gallery_256/README.md` (item 4).

| id | round | volume (mm³) | coupling effect | components | MC check | 256 vs 320 | result |
|---|---|---|---|---|---|---|---|
| fieldfuse_r1_channel_lattice | R1 | 6818.270 | 4.41 % | 1 | 1.04 % | 0.25 % | PASS |
| fieldfuse_r2_ply_tpms | R2 | 4837.038 | 55.22 % | 1 | 0.68 % | 0.07 % | PASS |
| fieldfuse_r3_graded_tpms | R3 | 3126.870 | 13.68 % | 1 | 0.16 % | 0.02 % | PASS |
| fieldfuse_r4_foam_lattice | R4 | 3195.419 | 32.89 % | 1 | 0.65 % | 0.14 % | PASS |
| fieldfuse_r5_ply_graded_tpms | R5 | 5008.981 | 52.06 % | 1 | 0.76 % | 0.07 % | PASS |

Screenshots: `<id>/screenshot.png` and `view_top.png`, `view_front.png`, `view_side.png` (cut-away views). No exterior skin images.
Each folder has `design.json` and a copy-executable `design.ts`.

## Visual notes

- R1: four BCC-lattice channels visible in the cut-away.
- R2 and R5: twisted gyroid sheets; the 18° per-ply twist is not visually obvious at this scale (coupling effect 52–55 % with the new walls, measured numerically).
- R3: gyroid with Voronoi-graded thickness visible.
- R4: Voronoi foam walls with a BCC lattice in every cell visible.
