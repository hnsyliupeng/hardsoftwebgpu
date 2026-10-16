# Structure graph (Phase B: B1 schema, B2 undo/redo and presets, B3 function nodes)

Code: `src/graph/graph.ts` (types, `validateGraph`, `compileGraph`), `src/graph/history.ts` (`GraphHistory`), `src/graph/presets.ts` (`savePreset`, `loadPreset`).
Presets: `presets/sc_rotated_gradient.json`, `presets/gyroid_bent_sheared.json`.
Tools: `scripts/graph_check.ts` (volume, floating components, spacing-matched resolution), `scripts/render_graph.ts` (cut-away renders).
Tests: `tests/graph.test.ts` (16 tests) and `tests/expr.test.ts` (3 tests), all pass.

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

## Cylinder projection (C1, partial)
`{ "op": "wrap", "radius": R, "phase": φ0, "s0": s0 }`: source (s, t, z) is wrapped onto a cylinder of radius R about z: world = ((R+t) cos(φ0 + (s−s0)/R), (R+t) sin(φ0 + (s−s0)/R), z). Inverse: s = s0 + R·wrap(φ − φ0), t = r − R.
- Normalisation: a constant Λ = max(1, R/(R + t_min)) (not a pointwise σ, which would break the Lipschitz bound through the product term f·∇(1/σ)). Λ = 1 when the source starts at t ≥ 0, as in the presets.
- Domain: rr = R + t must stay > 0 (the map is singular on the axis). The graph compiler rejects R + t_min ≤ 0.
- Not volume preserving: the Jacobian is (R+t)/R, so outer material is stretched tangentially and struts thicken with radius. This is a property of wrapping, not an error; a constant strut diameter would need a per-strut radius correction (not done).
- Tests: the source sphere's zero set maps onto the cylinder (forward/inverse consistency); 1-Lipschitz inside the domain (R = 20, sphere radius 5).
- Preset `presets/sc_cylinder_wrap.json`: SC lattice (cell 4, 5 cells, r 0.4) wrapped on R = 6, a curved sector of about 190°. At graph_check res 96 (spacing-matched to 250): volume 1547.3 mm³ vs flat source 609.0 mm³ (ratio 2.54, close to the mean Jacobian 2.67 over t ∈ [0, 20]), 0 floating components. Render: `examples/graph_presets/sc_cylinder_wrap_iso.png`.
- Not done from C1: conformal (harmonic) mapping on a parameter plane; general surface projection.

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

## Spacing-matched results (latest)
- `sc_rotated_gradient`: at source res 126 the source gives 642.7 mm³. Rotation only (no gradient) gives 641.0 mm³ at res 165 with 0 floating components (−0.3 %). Adding `gradient` (z, slope 0.02, centre 10) gives 740.6 mm³ with 15 components (0.27 mm³) removed. The +15 % is a real effect of the offset, not a grid artefact: the offset changes the strut radius from 0.2 mm (z = 0) to 0.6 mm (z = 20). A zero-mean radius swing δ adds E[δ²] to r² (≈ +8 % here), and node regions add the rest. A Monte-Carlo check of the z-slab occupancy confirms the top-heavy thickening (no-gradient 664 vs gradient 788 in the MC estimate). The earlier 96-cell value (662 mm³, 108 loose components) is superseded.
- Renders are labelled field-based (non-exact) in `examples/graph_presets/README.md`.

## Expression node (B3, done)
`{ "op": "expr", "text": "0.03*(x*y - z) + sin(z)" }` is an offset-type transform: f' = f − g(x), with g the expression.
- Parser (`src/graph/expr.ts`): recursive descent, no `eval`, no property access. Allowed: numbers, `x`, `y`, `z`, `pi`, `e`, `+ - * / ^`, unary minus, parentheses, `sin cos tan abs sqrt exp log` (1 argument), `min max` (2 arguments). Text limited to 300 characters. Anything else is rejected at validation with an `expr:` message.
- Own-property lookup for names, so `constructor`, `__proto__` and similar are rejected (found by the test suite).
- Tests (`tests/expr.test.ts`, 3 tests): precedence and associativity, functions, rejection of 17 unsafe or malformed strings, exact f' = f − g in a compiled graph.
- Not guaranteed 1-Lipschitz: the expression's gradient is not bounded by the compiler. Keep |∇g| small (or check with a sampler) when the result is used as a distance field.

## Fractal cube skeleton (C2, recursive substitution, done for one cube)
`{ "type": "fractal_cube", "size": 24, "divisor": 2, "depth": 3, "radius": 0.6, "radiusRatio": 0.7 }` (source).
- Level k cube (size s/d^k) draws its 12 edges as struts of radius r0·ratio^k, then recurses into the 8 corner subcubes of size s/d^(k+1) (divisor 2 or 3; the corners of a d-subdivision). Depth 1..3.
- Strut counts: 12, 108, 876 for depth 1, 2, 3 (d = 2). Corner subcubes share edges with their parent, so the union is smaller than the sum of strut volumes.
- Field: min over struts of (distance − radius), with a bucket grid (27-bucket neighbourhood). Exact where the value is below T = w − r0 (w = finest subcube size). Validation requires r0 < size/divisor^depth. The field is 1-Lipschitz.
- Tests (`tests/fractal.test.ts`, 4 tests): strut counts and radius ratios; bucket field equals brute force on 400 random points; exact on level-0 edge and cube-centre values; Lipschitz; graph validation.
- Preset `presets/fractal_cube_d3.json`. graph_check: 753.6 mm³ at res 160, 774.2 mm³ at res 240 (+2.7 %, 0 components). The finest struts are about 0.4 mm across, so res 240 is used for the render. The union volume is not independently verified (same status as C2 hierarchical).
- Not done: tiling the fractal over a lattice of cubes, and a generator other than the corner-subcube rule. Those belong to a later C2 step.

## Open graded infill in a shell-like region (C3, partial)
- New transform `{ "op": "clip", "shape": { "type": "sphere", "centre": [...], "radius": R } }` or `{ "type": "box", "min": [...], "max": [...] }`. The field becomes f' = max(f, sd_shape): an intersection, so the struts end open on the shape surface and there is no closed outer skin (per the user's rule against closed boundary skins). max of 1-Lipschitz fields stays 1-Lipschitz. Sphere and box distances are exact; validation rejects bad shapes and a shape that does not overlap the field bounds raises at compile.
- Preset `presets/graded_infill_sphere.json`: two-level hierarchical SC (cell 8 mm, 3 cells, radius 0.5, levels 2, divisor 2), radial grading (slope 0.01 about (12, 12, 12), radius0 10 mm: core struts thinner, rim thicker), then clip to a sphere of radius 10 mm.
- graph_check: 201.9 mm³ at the coarse grid and 210.5 mm³ at the finer one (+4 %), 0 floating components. The fine struts are about 0.5 mm across, so the finer grid is the reference.
- Render: `examples/graph_presets/graded_infill_sphere_{iso,top}.png`. The iso view shows the struts ending open on the sphere, with small sliver fragments where the cut meets thin strut ends.
- Not done: a true closed-shell infill (not wanted per the no-skin rule), and a non-sphere clip used together with a lattice tiling.
- Tests: `tests/clip.test.ts` (4 tests): exact max(f, sd) inside and outside; exact box distance in the face and corner regions; 1-Lipschitz; validation, bounds and the no-overlap error.
