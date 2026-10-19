# R6 morph (open, 192 cells)

New coupled round **R6** (`src/topology/coupled.ts`, `buildR6`): the structure changes type inside one field.
A gyroid sheet fills the core (radius 5.5 mm from the box centre) and a BCC strut lattice (4 mm cell, strut radius
0.4 mm) fills the outer shell. The two signed fields are blended with a smooth radial weight over a 2 mm transition.
This is a topology (sheet-to-strut) coupling, a dimension not used by R1 to R5.

Folder: `deep_R6_morph/` (`design.json`, `design.ts`, `screenshot.png` isometric, `view_top.png`, `view_front.png`,
`view_side.png`). The design is open: no closed envelope skin (`skin_mm = 0`), so the lattice struts reach the box faces.

## Result at 192 cells (PASS, 6/6 checks)

| Metric | Value |
|---|---|
| Volume (grid) | 1458.989 mm³ |
| Volume (Monte Carlo) | 1458.56 mm³ |
| Mesh vs Monte Carlo | 0.04 % (240 cells) |
| Convergence | 0.01 % (192 vs 240 cells) |
| Watertight | 0 open edges |
| Connected solid | 1 component |
| Triangles | 1,892,868 |
| Genus (voxel solid) | 648 |
| Min wall, 5th percentile | 0.480 mm |

Coupling metrics (sampled on the box, same at every resolution): core solid fraction 0.284, morph-zone 0.163,
shell 0.184 (the gyroid core and the BCC shell differ in solid fraction, so the change of type is measured).

## Limits

- SDF-only geometry: no exact B-Rep and no STEP. The mesh is manifold dual contouring of the field.
- The morph is a blend of two signed fields, not a true level-set interpolation of the two surfaces; it is
  exact only in the sense that the sign of the blended field is the solid.
- Strut and sheet dimensions are the R6 defaults (lattice cell 4 mm, strut 0.4 mm, gyroid cell 5 mm, wall 0.5 mm).
- Renders are CPU rasterised preview images at 1600 px.
