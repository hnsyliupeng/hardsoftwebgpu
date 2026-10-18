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
| `fusion_bcc_plus_voronoi` | flat faces; strut stubs stick out past the box at top and sides | open: stubs beyond envelope to check |
| `fusion_diamond_plus_lidinoid` | flat faces; strut stubs past the box; jagged rim | open: as above, plus rim sawtooth |
| `fusion_gyroid_plus_helical` | previous version (helical plate family, solid square plies) had a near-full disc plate over the top face. Re-run with helical rectangular fibres: volume 7766.338 mm³, 1 component, PASS. The new `view_top.png` still shows no background through the face, as do the other helical entries (0.00 % in `bio_helical_rectfibers`), so top-view coverage is not a test of closure | **unverified:** top-face closure in 3D not measured (needs a slice test) |
| `fusion_helical_cap_iwp` | I-WP-type sheet, jagged rim; one small stray fragment at top | open: rim sawtooth, fragment |
| `fusion_schwarzp_to_gyroid` | gyroid-type sheet, jagged rim | open: rim sawtooth |

Open points carried forward: the helical plate (see `docs/TASK_PLAN.md`), the rim sawtooth on gyroid-based entries, and whether the flat faces in `deep_R5_hierarchy`, `fusion_bcc_plus_voronoi` and `fusion_diamond_plus_lidinoid` are the intended foam walls.

Note on `fusion_gyroid_plus_helical` (re-run): the entry now uses `helical_rectfibers` instead of the plate family, because plate plies are solid squares that close the top face. Its volume changed from 7419.539 to 7766.338 mm³. The previous render is in git history (commit b38dbfc).
