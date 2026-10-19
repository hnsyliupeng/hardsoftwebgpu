# R7 graded gyroid (open, 96 cells)

New coupled round **R7** (`src/topology/coupled.ts`, `buildR7`): a gyroid whose period grows along z, from 3 mm at the
base to 7 mm at the top. x and y keep a 5 mm period, so the lattice is anisotropic. The wall stays 0.5 mm.
The grading is a one-dimensional coordinate warp; the gradient of the warped field is exact, so the wall is not distorted.
This is scale grading of a single structure. It is not a coupling between two structures.

Folder: `deep_R7_grading/` (`design.json`, `design.ts`, `screenshot.png` isometric, `view_top.png`, `view_front.png`,
`view_side.png`). The design is open: no closed envelope skin (`skin_mm = 0`); the sheet reaches the box faces.

**View convention.** The front view projects -z to the image vertical, so z increases toward the bottom of the image.
The 3 mm cells are therefore at the top of `view_front.png`, and the 7 mm cells at the bottom. The same holds for the
other front and side views in the gallery.

## Result at 96 cells (PASS, 6/6 checks)

| Metric | Value |
|---|---|
| Volume (grid) | 2378.648 mm³ |
| Volume (Monte Carlo) | 2403.28 mm³ |
| Mesh vs Monte Carlo | 0.62 % (120 cells) |
| Convergence | 0.41 % (96 vs 120 cells) |
| Watertight | 0 open edges |
| Connected solid | 1 component |
| Triangles | 721,748 |
| Genus (voxel solid) | 525 |
| Min wall, 5th percentile | 0.469 mm (median 0.481 mm; design 0.5 mm) |

Solid fraction by height (sampled on the box, same at every resolution): bottom third 0.330, middle third 0.300,
top third 0.300.

Grading check (numerical, independent of the render): a vertical line at x = 13.1 mm, y = 4.4 mm has 7 sign changes of
the field in z = 0 to 6 mm and 4 in z = 14 to 20 mm. The predicted number of periods is 1.68 (bottom) and 0.94 (top),
a ratio of 1.8; the measured ratio is 1.75.

## Limits

- SDF-only geometry: no exact B-Rep and no STEP. The mesh is manifold dual contouring of the field.
- The period grading is along z only. x and y periods are fixed at 5 mm, so cells are not similar in all directions.
- Renders are CPU rasterised preview images at 1600 px.
