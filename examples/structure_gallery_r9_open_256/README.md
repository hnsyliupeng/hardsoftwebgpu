# R9 gated phases (open, 256 cells)

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

## Result at 256 cells (**FAIL, 5/6 checks**: RepairHarness (wall floor))

| Metric | Value |
|---|---|
| Volume (grid) | 2099.035 mm³ |
| Volume (Monte Carlo) | 2104.9 (MC) / 2100.4 (mesh at 320) mm³ |
| Mesh vs Monte Carlo | 0.21 % |
| Convergence | 0.07 % (vs 320) |
| Watertight | 0 open edges |
| Connected solid | 1 component |
| Triangles | 4,959,420 |
| Genus (voxel solid) | 1181 |
| Cavities | 0 |
| Min wall, 5th percentile | 0.393 mm (median 0.478 mm); floor 0.4 mm |

**Status: FAIL.** The 5th-percentile wall is 0.393 mm, below the 0.4 mm printability floor. The value falls with
resolution (0.436 at 96, 0.407 at 192, 0.393 at 256), so it is not converging, and the thin spots are not located.
The field still gives one watertight solid, and the mesh agrees with Monte Carlo to 0.21 %. This design is not
accepted as printable. The fix is not yet found. A larger phase-cut radius (0.6 mm) was tested and did not help (p5 0.388 mm).

**Diagnosis (added 2026-10-20, `scripts/r9_wall_diagnostic.ts`).** The thin samples are at the gate interface. At 192
cells, 2294 of the 2513 chords below 0.4 mm (91 %) lie within 0.3 mm of the gate surface. Where the sheet or the
lattice is cut by the gate at a shallow angle, the solid forms an acute wedge, and a wedge tip stays thin unless the
rounding radius is comparable to the wedge length. A BCC lattice control with the same routine gives 0.800 mm everywhere, so the
method is not the cause.
**Trial that did not work.** Raising the blend from 0.3 to 0.6 mm at 256 gave wall p5 0.388 mm (worse) and changed the
volume by about 4 %. It was reverted; the committed 0.3 mm result stands.

## Limits

- The wall figure is the 5th percentile of inward ray chords, the validator's rule for coupled designs. It is not
  a certified manufacturing check. Grazing chords through round struts are short, so the figure is conservative.
- The phase cut is rounded with a 0.3 mm smooth max. The first version used a hard max and gave a wall
  5th percentile of 0.30 mm at 192 cells. Rounding that cut fixed 192. It did not fully fix 256 (see below).
- The gate is a first-order signed-distance estimate of the gyroid (F / |grad F|).
- Renders are CPU rasterised preview images at 1600 px.
