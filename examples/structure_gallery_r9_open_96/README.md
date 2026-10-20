# R9 gated phases (open, 96 cells)

New coupled round **R9** (`src/topology/coupled.ts`, `buildR9`): two structure families interpenetrate inside one
field, gated by a third. A Schwarz D sheet (5 mm period, 0.5 mm wall) fills the side of a gyroid gate surface
(8 mm period) where the gate is negative. A BCC strut lattice (4 mm cell, r = 0.4 mm) fills the side where it is
positive. The two are joined by a rounded phase cut (smooth max) and a smooth union (0.3 mm blend), so there is no planar seam.
This is not a boolean of two finished designs: each phase is clipped by the gate inside the field.

Folder: `deep_R9_gated/` (`design.json`, `design.ts`, `screenshot.png` isometric, `view_top.png`, `view_front.png`,
`view_side.png`). The design is open: no closed envelope skin (`skin_mm = 0`).

**View convention.** The front view projects -z to the image vertical, so z increases toward the bottom of the image
(as in R7 and R8).

**Field-based (non-exact).** Geometry is an SDF-style field meshed by dual contouring. It has no exact B-Rep and no STEP.

**Phase split (sampled on the box, 6000 points):** sheet zone (gate < 0) 50.7 % of the box, with solid fraction 0.349;
lattice zone (gate > 0) 49.3 %, with solid fraction 0.169.

## Result at 96 cells (PASS, 6/6 checks)

| Metric | Value |
|---|---|
| Volume (grid) | 2076.313 mm³ |
| Volume (Monte Carlo) | 2104.9 (MC) / 2090.5 (mesh at 120) mm³ |
| Mesh vs Monte Carlo | 0.69 % |
| Convergence | 0.68 % (vs 120) |
| Watertight | 0 open edges |
| Connected solid | 1 component |
| Triangles | 687,336 |
| Genus (voxel solid) | 1235 |
| Cavities | 15 |
| Min wall, 5th percentile | 0.436 mm (median 0.477 mm); floor 0.4 mm |

## Limits

- The wall figure is the 5th percentile of inward ray chords, the validator's rule for coupled designs. It is not
  a certified manufacturing check. Grazing chords through round struts are short, so the figure is conservative.
- The phase cut is rounded with a 0.3 mm smooth max. The first version used a hard max and gave a wall
  5th percentile of 0.30 mm at 192 cells. Rounding that cut fixed 192. It did not fully fix 256 (see below).
- The gate is a first-order signed-distance estimate of the gyroid (F / |grad F|).
- Renders are CPU rasterised preview images at 1600 px.
