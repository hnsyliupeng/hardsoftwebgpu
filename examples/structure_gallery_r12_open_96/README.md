# R12 one-sided gate-set iso-level (open, 96 cells)

New coupled round **R12** (`src/topology/coupled.ts`, `buildR12`): one gyroid whose iso-level is set by a **one-sided** gate
field. The solid is where F < c(g), and c(g) runs from 0 (gate far negative) to 0.35 (gate far positive), with
c(g) = 0.35 (1 + tanh(g / 1.5 mm)) / 2. The gyroid period is 5 mm, and g is a gyroid gate with an 8 mm period.
Open design (`skin_mm = 0`), field-based (non-exact), no exact B-Rep or STEP.

**What the gate does (measured, `docs/R12_COUPLING_ANALYSIS.md`).** The whole-box solid fraction is 55.6 %. The symmetric
baseline (uniform level 0) is 49.9 %. A uniform control at the mean level (0.175) also gives 55.6 %. So **the total is set by the
mean level**, which is a uniform parameter. The gate adds spatial grading around that mean: the gate-negative side is 52.8 % solid
and the gate-positive side is 58.4 % (uniform control 55.5 % and 55.7 %). The one-sided gate produces a net volume change, but
the gate itself adds no volume beyond the mean level.

**Void channels (measured, `docs/r12_void_check_output.txt`, 96 cells).** Void p5 2.01 mm, minimum 1.44 mm.

Folder: `deep_R12_onesided/` (`design.json`, `design.ts`, `screenshot.png` isometric, `view_top.png`, `view_front.png`,
`view_side.png`).

**View convention.** The front view projects -z to the image vertical, so z increases toward the bottom of the image.

## Result at 96 cells (PASS, 6/6 checks)

| Metric | Value |
|---|---|
| Volume (grid) | 4446.540 mm³ (volume fraction 0.5558) |
| Mesh vs Monte Carlo | mesh at 120 4448.2 vs MC 4463.6 mm3 (0.34 %) |
| Convergence | 96 px-grid 4446.5 vs 120 4448.2 mm3 (0.04 %) |
| Watertight | 0 open edges |
| Connected solid | 1 component |
| Triangles | 412,560 |
| Genus (voxel solid) | 245 |
| Cavities | 0 |
| Min wall, 5th percentile | 1.264 mm (median 2.567 mm); floor 0.4 mm |

## Limits

- Wall p5 is a chord statistic on the solid. It is not a certified manufacturing check.
- The void check is a separate analysis (96 cells); the gallery validator does not check void channels.
- The gate's effect beyond the mean level is spatial grading only (see the coupling analysis).
- The level field is a first-order distance estimate, (F - c) / |grad F|; the gradient of c(g) is neglected, which is accurate
  because the gate varies over 8 mm, much more slowly than the 5 mm labyrinth.
- Renders are CPU rasterised preview images at 1600 px.
