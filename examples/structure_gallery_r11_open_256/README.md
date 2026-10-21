# R11 gate-set iso-level (open, 256 cells)

New coupled round **R11** (`src/topology/coupled.ts`, `buildR11`): one gyroid whose iso-level is set by a gate field.
The solid is where F < c(g), with c(g) = 0.35 tanh(g / 1.5 mm), where F is the gyroid value (5 mm period) and g is a
gyroid gate (8 mm period). On the gate-negative side the level is -0.35, which gives less solid. On the gate-positive side
the level is +0.35, which gives more solid. The level stays inside the gyroid's range, so the labyrinth stays connected and
no acute wedge is cut. Open design (`skin_mm = 0`), field-based (non-exact), no exact B-Rep or STEP.

**What the gate does (measured).** Against a fixed-level control (amplitude 0), the gate moves material between zones but
leaves the whole-box solid fraction unchanged: sheet zone 44.3 % solid vs 49.9 % control; lattice zone 55.8 % vs 49.7 %;
whole box 50.05 % vs 49.79 %. The gate is symmetric, so the odd tanh response averages to zero over the box. A net volume change
needs an asymmetric gate. See `docs/R11_COUPLING_ANALYSIS.md` (`docs/r11_coupling_analysis_output.txt`).

**Void channels (measured).** The complement (void) chord check gives void p5 2.06 mm and minimum 1.46 mm at 96 cells
(`docs/r11_void_check_output.txt`). The validator's wall check measures solid walls only, so this check was run separately.

Folder: `deep_R11_level/` (`design.json`, `design.ts`, `screenshot.png` isometric, `view_top.png`, `view_front.png`,
`view_side.png`).

**View convention.** The front view projects -z to the image vertical, so z increases toward the bottom of the image.

## Result at 256 cells (PASS, 6/6 checks)

| Metric | Value |
|---|---|
| Volume (grid) | 3999.632 mm³ |
| Volume (Monte Carlo) | 4012.3 mm³ |
| Mesh vs Monte Carlo | 0.31 % (mesh at 3999.8 (320)) |
| Convergence | 0.00 % (vs 320) |
| Watertight | 0 open edges |
| Connected solid | 1 component |
| Triangles | 2,915,172 |
| Genus (voxel solid) | 245 |
| Cavities | 0 |
| Min wall, 5th percentile | 1.403 mm (median 2.465 mm); floor 0.4 mm |

## Limits

- Wall p5 is a chord statistic on the solid. It is not a certified manufacturing check.
- The void check is a separate analysis (96 cells); the gallery validator does not check void channels.
- The level field is a first-order distance estimate, (F - c) / |grad F|; the gradient of c(g) is neglected, which is accurate
  because the gate varies over 8 mm, much more slowly than the 5 mm labyrinth.
- Renders are CPU rasterised preview images at 1600 px.
