# R10 gated dominance (open, 256 cells)

New coupled round **R10** (`src/topology/coupled.ts`, `buildR10`): both phases are present everywhere, and a gyroid gate
decides which one is thick. A Schwarz D sheet (5 mm period) and a BCC strut lattice (4 mm cell) are combined by a smooth
union (0.2 mm). The gate is a gyroid (8 mm period), and the dominance is d = tanh(g / 1 mm):
- sheet thickness t = 0.7 − 0.2 d, so 0.5 to 0.9 mm (thick where the gate is negative);
- strut radius r = 0.4 + 0.1 d, so 0.3 to 0.5 mm (thick where the gate is positive).

**Why no cut.** R9 cut each phase with the gate, and the cut made acute solid wedges that were thinner than the 0.4 mm floor
at 256 cells. R10 has no cut. A union creates only concave creases, which are not thin, so the minimum solid
thickness is set by the design (0.5 mm sheet, 0.6 mm strut diameter).

Folder: `deep_R10_dominance/` (`design.json`, `design.ts`, `screenshot.png` isometric, `view_top.png`, `view_front.png`,
`view_side.png`). Open design: `skin_mm = 0`, no closed envelope skin.

**View convention.** The front view projects -z to the image vertical, so z increases toward the bottom of the image.

**Field-based (non-exact).** SDF-style field, dual-contoured. No exact B-Rep and no STEP.

**Phase split (sampled on the box, 6000 points):** sheet zone (g < 0) 50.5 % of the box: solid fraction 0.605, mean sheet
thickness 0.82 mm, mean strut radius 0.34 mm. Lattice zone (g > 0): solid fraction 0.537, mean sheet thickness 0.58 mm,
mean strut radius 0.46 mm.

**Density.** The union is dense: solid fraction about 0.57, porosity about 0.43. This is a bulk-type structure, not a sparse lattice.

## Result at 256 cells (PASS, 6/6 checks)

| Metric | Value |
|---|---|
| Volume (grid) | 4576.911 mm³ |
| Volume (Monte Carlo) | 4590.0 mm³ |
| Mesh vs Monte Carlo | 0.26 % (mesh at 4578.2 (320)) |
| Convergence | 0.03 % (vs 320) |
| Watertight | 0 open edges |
| Connected solid | 1 component |
| Triangles | 6,331,404 |
| Genus (voxel solid) | 1572 |
| Cavities | 0 |
| Min wall, 5th percentile | 0.482 mm (median 0.753 mm); floor 0.4 mm |

## Limits

- The wall figure is the 5th percentile of inward ray chords, the validator's rule for coupled designs. Not a certified manufacturing check.
- The renders show stepped layers along the envelope faces. The slice test (`scripts/slice_test.ts`, 96 cells) shows that the
  faces are open: the solid fraction on each face plane is 0.49 to 0.51, against about 1.0 for a closed skin, and the mean over
  z-planes is 0.573. The layers are structure cross-sections at the faces, not a skin. The slice test rebuilds the field from `design_spec` on a fixed grid, so 192 and 256 give the same values; this confirms the field, not the 192 and 256 meshes separately.
- The gate is a first-order signed-distance estimate of the gyroid (F / |grad F|).
- Renders are CPU rasterised preview images at 1600 px.
