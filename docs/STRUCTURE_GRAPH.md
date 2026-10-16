# Structure graph (Phase B: B1 schema, B2 undo/redo and presets, B3 function nodes)

Code: `src/graph/graph.ts` (types, `validateGraph`, `compileGraph`), `src/graph/history.ts` (`GraphHistory`), `src/graph/presets.ts` (`savePreset`, `loadPreset`).
Presets: `presets/sc_rotated_gradient.json`, `presets/gyroid_bent_sheared.json`.
Tools: `scripts/graph_check.ts` (volume, floating components, spacing-matched resolution), `scripts/render_graph.ts` (cut-away renders).
Tests: `tests/graph.test.ts` (14 tests, all pass).

## Graph
- Node kinds: `field` (source: `sc`, `gyroid`, `sphere`), `transform` (one input), `structure` (terminal, one input, has a name).
- Checks: unique ids, known kinds, parameter ranges, dangling edges, one input per transform/structure, no fan-out, at least one structure, no cycles.

## Transforms (B3)
| op | map (world = M(source)) | note |
|---|---|---|
| rotate | rotation about an axis | isometric, exact |
| bend | xy plane rotated by k·z | non-isometric; normalised (see below) |
| stretch | diag(sx, sy, sz) | normalised |
| shear | x' = x + a·y + b·z, y' = y + c·z | normalised |
| gradient | f − slope·(x_axis − centre) | linear isosurface offset (thickness varies along the axis) |
| radial | f − slope·(|x − centre| − radius0) | radial isosurface offset |
| polynomial | f − Σ aᵢ·x_axisⁱ (up to degree 4) | polynomial offset along one axis |
| noise | f − amplitude·(2n − 1), n = trilinear value noise in [0,1) with smoothstep, seeded hash | deterministic, |offset| < amplitude, Lipschitz ≤ 7·A·F |

Offset-type nodes are not normalised: they change the gradient of the field, so the thickness they produce is an approximation (checked by volume and rendering, not by a distance bound).

Normalisation: for a non-isometric map the composed field f∘M⁻¹ is divided by σ_max of the inverse Jacobian (numerical, power iteration). This keeps a 1-Lipschitz base SDF 1-Lipschitz. Without it the test `bend, stretch and shear keep a sphere SDF 1-Lipschitz` fails.

Not yet implemented from B3: user expression nodes (needs a safe, sandboxed expression parser; not started).

## Hierarchical (multi-scale) SC source (C2, partial)
`{ "type": "hierarchical_sc", cellSize, cells, radius, levels (1..4), divisor (2 or 3) }`.
Level k is an SC lattice with cell cellSize/m^k, cells·m^k per axis and radius/m^k (m = divisor). The field is the minimum over the levels, so the struts are the union of all levels. Test: field = min of the level fields; all levels span the same box.
Scope: this is a self-similar multi-scale union, not a recursive substitution of a scaled copy of the whole structure. A true recursive fractal (substructure per cell, depth d) is not implemented yet.
Preset `presets/hierarchical_sc.json` (2 levels, radii 0.4 and 0.2 mm). At 160 cells: volume 1054.4 mm³ (one SC level at 128 cells: 643.3 mm³), 0 floating components, 17 s. The volume of the union is not checked independently. Render: `examples/graph_presets/hierarchical_sc_iso.png` (200 cells).

## Checks
- Exact inverse maps: f'(M p) = f(p) (rotation), f'(0,0,z) = f(0,0,z) (bend on the axis), f'(Sp)·min(s) = f(p) (stretch), f'(Hp)·σ = f(p) (shear). All tested.
- Bounds of the bent field contain all bent images of the input box (tested).
- History: commit / undo / redo; a new commit clears redo; invalid graphs are rejected without changing state (tested).
- Preset round trip and repository presets validate (tested).

## Results (96/160/200 grids)
| Preset | Structure | Volume (mm³) | Floating components removed | Source volume |
|---|---|---|---|---|
| gyroid_bent_sheared | at 96 cells | 3,659.7 | 0 | 4,196.2 |
| gyroid_bent_sheared | at 160 cells | 4,150.9 | 2 | 4,195.7 |
| gyroid_bent_sheared | at 299 cells (spacing matched) | 4,188.1 | 2 | 4,196.2 |
| sc_rotated_gradient | at 96 cells (spacing matched 299) | 662.3 | 108 (8.5 mm³) | 609.0 |

Finding: `sampleField` spreads `res` cells over the largest bounding dimension. Bend and shear enlarge the bounds (bend: 56 mm for a 20 mm source), so the same `res` gives a coarser spacing. At 96 cells this under-samples the 0.8 mm wall and gave a false −13 %. Matching the source spacing removes it (−0.19 % at 299). `graph_check.ts` does this automatically (`res_transformed`).

Open items:
- The SC preset rotates the lattice inside a rotated clip box. That leaves 108 short floating struts at the cube edges (8.5 mm³), which are removed. A better clip would cut in the source frame and then rotate the mesh, or keep the struts. Not decided.
- Rendered edges show the same sawtooth rim artefact as the earlier gyroid renders (not yet investigated).

| gyroid_noise_radial | at 128 cells | 4,581.7 | 2 (0.26 mm³) | 4,196.7 |

The +9 % in gyroid_noise_radial comes from the radial term (slope 0.01 mm⁻¹ thickens the sheet away from the centre); the noise term is zero-mean. The preset is deliberately heavy; the render shows the thickened sheet.

## Renders
`examples/graph_presets/`: `gyroid_bent_sheared_{iso,top}.png`, `sc_rotated_gradient_{iso,top}.png` (800 px, 2× supersampling, cut-away, 200 cells); `gyroid_noise_radial_{iso,top}.png` (160 cells).
