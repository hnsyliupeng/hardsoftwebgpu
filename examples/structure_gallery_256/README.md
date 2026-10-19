# Structure gallery, 256 cells (open, skin-free)

All designs are open: no closed boundary skin (`SKIN = 0` in `scripts/structure_gallery.ts`). Each design is a 20 mm envelope
sampled on 256 cells per axis (0.078 mm grid). Every design is checked at 256 and again at 320 cells (convergence),
and its volume is compared with a grid-free Monte Carlo estimate (MC) of the implicit field.

Run: `GALLERY_OUT=examples/structure_gallery_256 node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 256`

**Result: 36/36 PASS.** Full run before the fibre fix; the two fibre entries (`bio_helical_rectfibers`, `bio_helical_cylinfibers`) were re-run after it. The fibre change touches only those two designs. The five deep-fusion designs at 256 cells are in
`examples/deep_fusion_256/` (5/5 PASS). Lower resolutions are kept in separate folders: `examples/structure_gallery_96/` (96 cells) and `examples/structure_gallery/` (192 cells). They are not merged; both have closed exterior skins. The open A5 fusion set (11 designs, 256 cells) is in `examples/structure_gallery_256_mixed_open/`.

## Images

Per design: `screenshot.png` (iso cut-away, shows the interior) and `view_top.png`, `view_front.png`, `view_side.png`
(three further cut-away views). There are no exterior skin images in this folder: the closed skin was removed at the user's request.

## Changes in this run (and why)

1. **Strut lattices use the strut diameter (2r) as the wall.** The wall statistic is a 5th percentile of inward ray chords.
   Grazing chords through a cylinder are short, so a 0.8 mm strut measured about 0.33–0.36 mm. The repair then scaled the
   strut radius by a grid-dependent amount, which made the open SC volumes depend on resolution. The chord value is kept as `min_wall_thickness_chord`.
2. **Floating fragments are removed before meshing** (`removeFloatingComponents` in `src/geometry/grid.ts`). A lattice clipped
   by the envelope can leave whole cells that touch the body only outside the box (Kelvin: 15 islands of about 0.5 mm³ each, about 0.6 % of the volume).
   They are reported in the observations. Designs that are already one component are unchanged.
3. **Wall statistic ignores the envelope rim** (`RIM_MARGIN_MM = 0.5` in `src/validation/validate.ts`). Surface samples within 0.5 mm of
   a box face are cut edges, not walls. Without this, open TPMS sheets measured a 5th-percentile chord near 0.30 mm, though the sheets were modelled at 0.7 mm.
4. **Ply walls of two helical deep designs raised** (`fieldfuse_r2` wall 0.7 → 1.1 mm; `fieldfuse_r5` thickness 0.7–1.0 → 1.1–1.4 mm; see `scripts/structure_gallery.ts`). The `deep_R*` coupled designs are unchanged.
   The sheet distance is approximated by |F|/|∇F|, which under-sizes highly curved twisted gyroid sheets: the 5th-percentile chord
   is about 0.4 × the design wall at 0.7 mm. At the new walls the chord floor is met (0.42–0.44 mm), with less margin than the other entries. An exact sheet distance would remove this need.
5. **Helical fibre plies (rectfibers, cylinfibers) reach the envelope corners.** Fibres were half-length 1 (envelope half-width) and their centre grid stopped at the envelope edge, so rotated fibres left notches at the walls. Fibres now have half-length sqrt(2) and the centre grid extends beyond the envelope (fibres outside it are clipped). Unlike plates, a fibre set does not fill the box, so the helix stays visible. Volumes rose (rectfibers 6581.9 → 7616.4 mm³, cylinfibers 5620.8 → 6273.0 mm³) because the corners are now filled; both MC checks pass (< 0.1 %).
6. **Grid offset and `clipSign`** (earlier commits `a2ad9c4`, `d3ce231`): the box clip no longer creates exact-zero ties on the face and the sampling grid has no node on a face or strut plane.

## Known open items

- **Helical plate plies show triangular teeth at the walls** (`bio_helical_generic`, `bio_helical_noise`, `fusion_helical_cap_iwp`, `fusion_gyroid_plus_helical`). Each plate is 2S square and rotates about z, so the corners it leaves uncovered show as notches on the walls. Extending the plate to cover the envelope fills the box (8000 mm³) and removes the helix, so the plate variant was left as is. Open: a decision is needed (accept the notches, or change the plate to fibres).
- Deep R2/R5 ply twist is hard to see at this scale (coupling effect 52–55 %, measured numerically).
- `coupled.ts` core clip still uses `max(field, sdBox)`. This gives the same solid set as `clipSign` (the field differs only outside the envelope), and the designs pass, so it was left unchanged.

## Lattices (periodic)

## Lattices

| id | volume (mm³) | components | min wall (mm) | MC check | 256 vs 320 | result |
|---|---|---|---|---|---|---|
| lattice_sc | 671.758 | 1 | 0.800 | 2.05 % | 0.15 % | PASS |
| lattice_bcc | 1416.194 | 1 | 0.800 | 0.87 % | 0.41 % | PASS |
| lattice_fcc | 1704.208 | 1 | 0.800 | 0.78 % | 0.19 % | PASS |
| lattice_fbcc | 2967.602 | 1 | 0.800 | 0.49 % | 0.13 % | PASS |
| lattice_diamond | 1411.032 | 1 | 0.800 | 0.69 % | 0.29 % | PASS |
| lattice_bccz | 1591.781 | 1 | 0.800 | 0.46 % | 0.33 % | PASS |
| lattice_kelvin | 1569.580 | 1 | 0.800 | 0.73 % | 0.09 % | PASS |

## TPMS minimal surfaces

| id | volume (mm³) | components | min wall (mm) | MC check | 256 vs 320 | result |
|---|---|---|---|---|---|---|
| tpms_gyroid | 2361.974 | 1 | 0.480 | 0.29 % | 0.01 % | PASS |
| tpms_schwarz_p | 1846.500 | 1 | 0.490 | 0.60 % | 0.01 % | PASS |
| tpms_schwarz_d | 2871.980 | 1 | 0.471 | 0.32 % | 0.00 % | PASS |
| tpms_neovius | 2763.446 | 1 | 0.479 | 0.51 % | 0.05 % | PASS |
| tpms_iwp | 2655.815 | 1 | 0.472 | 0.41 % | 0.02 % | PASS |
| tpms_lidinoid | 4495.402 | 1 | 0.434 | 0.58 % | 0.13 % | PASS |
| tpms_fischer_koch_s | 3824.714 | 1 | 0.433 | 0.36 % | 0.03 % | PASS |
| tpms_split_p | 3667.497 | 1 | 0.446 | 0.46 % | 0.03 % | PASS |

## Bio-inspired families (Bioinspired123D)

| id | volume (mm³) | components | min wall (mm) | MC check | 256 vs 320 | result |
|---|---|---|---|---|---|---|
| bio_helical_generic | 7165.920 | 1 | 4.000 | 0.00 % | 0.00 % | PASS |
| bio_helical_rectfibers | 7616.441 | 1 | 1.205 | 0.07 % | 0.00 % | PASS |
| bio_helical_cylinfibers | 6272.996 | 1 | 1.869 | 0.05 % | 0.11 % | PASS |
| bio_helical_noise | 7168.368 | 1 | 4.000 | 0.02 % | 0.00 % | PASS |
| bio_cellular_generic | 5765.656 | 1 | 1.649 | 0.20 % | 0.01 % | PASS |
| bio_cellular_voronoi | 5770.893 | 1 | 1.640 | 0.29 % | 0.01 % | PASS |
| bio_cellular_sandwich | 6434.805 | 1 | 1.689 | 0.18 % | 0.01 % | PASS |
| bio_cellular_vorosand | 6443.533 | 1 | 1.733 | 0.31 % | 0.01 % | PASS |
| bio_tubular_generic | 6994.690 | 1 | 1.538 | 0.04 % | 0.00 % | PASS |
| bio_tubular_shapesize | 6492.036 | 1 | 1.309 | 0.01 % | 0.00 % | PASS |
| bio_tubular_layers | 7638.089 | 1 | 1.927 | 0.01 % | 0.00 % | PASS |
| bio_tubular_noise | 6994.690 | 1 | 1.550 | 0.05 % | 0.00 % | PASS |

## Shallow fusions (boolean / zoned)

| id | volume (mm³) | components | min wall (mm) | MC check | 256 vs 320 | result |
|---|---|---|---|---|---|---|
| fusion_gyroid_plus_helical | 7419.539 | 1 | 0.480 | 0.12 % | 0.00 % | PASS |
| fusion_schwarzp_to_gyroid | 2180.736 | 1 | 0.480 | 0.23 % † | n/r ‡ | PASS |
| fusion_kelvin_to_iwp | 2212.687 | 1 | 0.472 | 0.13 % † | n/r ‡ | PASS |
| fusion_bcc_plus_voronoi | 6175.190 | 1 | 0.800 | 0.15 % † | n/r ‡ | PASS |
| fusion_helical_cap_iwp | 2380.508 | 1 | 0.471 | 1.18 % † | n/r ‡ | PASS |
| fusion_diamond_plus_lidinoid | 5107.865 | 1 | 0.435 | 0.26 % † | n/r ‡ | PASS |

## Deep coupled fusion R1–R5 (coupled topology, from the remote branch)

| id | volume (mm³) | components | min wall (mm) | MC check | 256 vs 320 | result |
|---|---|---|---|---|---|---|



Per entry: `<id>/screenshot.png` and `view_*.png` (cut-away), `design.json` (spec, metrics, repair history, limitations), `design.ts` (copy-executable parametric code); all checks in `gallery.json`.

† Dual-contouring mesh (`src/geometry/dualcontour.ts`, 2026-10-19). MC check = |V − V_MC| / V_MC with V_MC from `gallery.json` (`volume_mc_mm3`). The earlier column values for these five were not reproduced from the stored metrics and are replaced.
‡ n/r = not re-run. The 256 vs 320 column for these five is a surface-nets value from before the change and is not recomputed.

## Fused designs: dual-contouring re-run (CPU, 256)
The five fused designs above were re-meshed with manifold dual contouring; the sixth fused design (`fusion_gyroid_plus_bcc`) is in `examples/structure_gallery_256_mixed_open/`. All five PASS. Volume changes against the earlier surface-nets values are at most 0.6 %: schwarz→gyroid 2179.981 → 2180.736; kelvin→iwp 2205.499 → 2212.687; BCC+Voronoi 6174.205 → 6175.190; helical cap 2381.578 → 2380.508; diamond+Lidinoid 5138.036 → 5107.865 (Monte Carlo 5094.4). Non-manifold edges at 96 cells fall from 64 → 0, 488 → 14, 1019 → 53, 113 → 6, 7092 → 483. The residual sub-voxel pinches are documented in `docs/NONMANIFOLD.md`.

