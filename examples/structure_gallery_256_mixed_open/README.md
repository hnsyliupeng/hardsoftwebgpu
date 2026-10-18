# Mixed gallery at 256 cells, open designs (A5)

Entries that mix bio, TPMS, lattice and deep (field-level coupled) structures, re-run with the current code:
no closed envelope skin (`SKIN = 0`, deep and coupled designs `skin_mm: 0`), four cut-away views each.
Resolution 256 cells on the 20 mm box, convergence grid 320.

Field-based (non-exact) renders: these come from the field and surface-nets mesh, not an exact B-Rep. They are labelled as such in the gallery index.

| id | title | group | volume (mm³) | validation | images |
|---|---|---|---|---|---|
| `fusion_gyroid_plus_helical` | Gyroid union helical plies | fusion | 7419.539 | PASS (7/7) | screenshot.png, view_top.png, view_front.png, view_side.png |
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
- Open issue, not resolved: in `deep_R2_nested/screenshot.png` the cut-away view shows flat box-like walls and a flat floor around the helical pillars. The R2 code (`src/topology/deep.ts`, `plyTpms`) builds plies and has no rim or base term, so these faces are either a solid base slab left by the coupling or a cut-away capping artefact. Not yet checked. The volume (5603.703 mm³, 1 component) is unchanged from the earlier run, so the geometry is the same as before.
- Each entry has `design.json` (spec, metrics, repair history, validation) and `design.ts` (copy-executable code).
