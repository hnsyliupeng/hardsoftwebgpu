# R8 exact B-Rep: BCC strut radius set by a gyroid field (L = 20 mm)

**Exact model (OpenCASCADE B-Rep).** A deep (field-coupled) design: the strut radius of a BCC lattice is set by a gyroid field,
r(p) = 0.45 + 0.1 · tanh(F(p)), with F = sinX cosY + sinY cosZ + sinZ cosX and X = 2π·x/5 mm (`src/topology/coupled.ts`, `buildR8`).

## How the exact model is built
- Each BCC strut (cell 4 mm, 1728 struts over the envelope with margin) is a **ruled loft** through 5 circles. The radius is
  sampled from the gyroid at the sample points along the strut and is piecewise linear along the axis.
- Each node has a sphere of radius r(node) · 1.002.
- All tools are fused per z-layer (7 layers), layers are unioned, and the result is intersected with the 20 mm cube.
- Script: `python/exact/build_r8.py`; checks: `python/exact/check_r8_mc.py`; finalize and mesh: `python/exact/finalize.py`.

## Checks
| Item | Value |
|---|---|
| B-Rep volume | 1775.615 mm³ |
| Solids / valid | 1 / yes |
| Faces | 4646 |
| Mesh (welded) | 725,613 vertices, 1,453,862 triangles; 0 open edges, 0 non-manifold edges |
| Mesh volume | 1767.778 mm³ (−0.44 % vs B-Rep: chord error at tessellation tolerance 0.02 mm; thicker struts than the plain lattices) |
| Monte Carlo, piecewise-frustum model (same geometry as the B-Rep, N = 1e5) | 1791 ± 11 mm³ (B-Rep is 1.5σ below) |
| Monte Carlo, field definition (full lattice, no 5³ block limit, N = 1e5) | 1783 ± 11 mm³ (B-Rep is 0.7σ below) |
| Field reference in the gallery (256 cells, 5³ block) | 1775.331 mm³ |
| L = 8 test (single block) | B-Rep 108.19 mm³ vs frustum MC 107.79 ± 0.66 mm³ |

The field reference and the exact value agree to 0.02 %. For the plain BCC lattice the same block-limit effect was about 1 %
(`examples/exact_lattices_L20/README.md`), so this agreement here is partly coincidence and not a general result.

## Method notes (what went wrong first)
- A first build used one cone per sub-segment. The layer fuse returned an **incomplete solid without an error**: the result had
  two pieces with about 1 mm of lattice missing at z ≈ 10 mm (volume 1613.5 mm³, 9 % low). The Monte Carlo checks showed
  that the defect was in the B-Rep and not in the model. Coincident caps between adjacent cones caused it.
  One ruled loft per strut (no internal caps) fixed it.
- A single fuse over 12 layer solids segfaulted, so the layers are unioned one at a time.
- The fused result is checked by its piece count and the Monte Carlo volume. A volume check alone would have missed the
  two-piece failure only if the difference were small.

## Renders (1600 px, 2× supersampling, cut-away views)
- `screenshot.png` (iso), `view_top.png`, `view_front.png`, `view_side.png`, `render_meta.json`.
- The thicker and thinner struts follow the gyroid modulation (about ±0.1 mm around 0.45 mm).

## Limitations
- The radius is sampled at nsub = 4 points per strut and interpolated linearly. The field evaluates r at every point, so the
  exact model differs from the field by about 1 % (frustum MC vs field MC: 1791 vs 1783, within 1σ).
- Piecewise-linear radius is an approximation of the field's radius profile; it is not exact to the field at every point.
- No skin (open lattice). STEP file in `artifacts/exact_deep_L20/` (gitignored, not committed).
- Mesh is tessellated at 0.02 mm; the mesh volume is 0.44 % below the B-Rep.
