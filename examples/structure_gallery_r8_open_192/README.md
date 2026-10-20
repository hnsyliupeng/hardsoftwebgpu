# R8 radius-coupled lattice (open, 192 cells)

New coupled round **R8** (`src/topology/coupled.ts`, `buildR8`): a BCC strut lattice (4 mm cell) whose strut radius is set
by a gyroid field, r = 0.45 + 0.1 tanh(F), where F is the gyroid value (5 mm period). Struts swell where the sheet is
positive and thin where it is negative, so the two structures are coupled inside one field.
The radius range is 0.359 to 0.540 mm (mean 0.45 mm).
This is a coupling of two structure families; R1 couples a gyroid thickness to a foam field.

Folder: `deep_R8_radius/` (`design.json`, `design.ts`, `screenshot.png` isometric, `view_top.png`, `view_front.png`,
`view_side.png`). The design is open: no closed envelope skin (`skin_mm = 0`); struts reach the box faces.

**View convention.** The front view projects -z to the image vertical, so z increases toward the bottom of the image
(as in R7).

## Result at 192 cells (PASS, 6/6 checks)

| Metric | Value |
|---|---|
| Volume (grid) | 1776.722 mm³ |
| Volume (Monte Carlo) | 1777.6 mm³ |
| Mesh vs Monte Carlo | 0.04 % (240 cells) |
| Convergence | 0.01 % (192 vs 240 cells) |
| Watertight | 0 open edges |
| Connected solid | 1 component |
| Triangles | 1,963,680 |
| Genus (voxel solid) | 660 |
| Min wall, 5th percentile | 0.73 mm (median 0.944 mm); strut diameter 2r from 0.72 to 1.08 mm |

Solid fraction (sampled on the box): 0.224.

## Limits

- The radius correction is first-order: exact where the radius varies slowly on the scale of a strut. The gyroid
  period (5 mm) is much larger than the strut radius (about 0.5 mm), so the approximation is good here; it is not
  verified for faster modulation.
- The wall figure is the 5th percentile of ray chords, which for a strut is about 2r. It is not a certified check.
- SDF-only geometry: no exact B-Rep and no STEP. The mesh is manifold dual contouring of the field.
- Renders are CPU rasterised preview images at 1600 px.
