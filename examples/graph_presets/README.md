# Structure-graph presets: field-based renders (NOT exact B-Rep)

**Label: field-based (non-exact).** Every model in this folder is built from an implicit field
(signed-distance or level-set expression compiled from `presets/*.json`), sampled on a grid,
meshed with surface nets, and cut away for display. None of these models is an exact B-Rep.
Volumes are grid-convergence estimates (see the resolution column), not exact CAD volumes.

Each preset has an `_iso.png` (cut-away isometric) and a `_top.png` (cut-away top view), rendered
with `scripts/render_graph.ts <preset> <res> examples/graph_presets`.

| Preset | Source | Transforms | Render res | Volume (mm³) | Floating comps removed | Notes |
|---|---|---|---|---|---|---|
| `sc_rotated_gradient` | SC, cell 4 mm, r 0.4, 5 cells | rotate (1,1,1), 0.3 rad; gradient z, slope 0.02 | 165 (spacing-matched) | 740.6 | 15 (0.27 mm³) | Gradient alone adds ~+15 % (see STRUCTURE_GRAPH.md) |
| `sc_rotated_gradient` (no gradient) | same | rotate only | 165 | 641.0 | 0 | Source at 126: 642.7 (rotation is volume-preserving to 0.3 %) |
| `gyroid_bent_sheared` | Gyroid, t 0.8 | bend, shear | 299 | 4188.1 | 2 (0.07 mm³) | Source at 96: 4196.2 |
| `gyroid_noise_radial` | Gyroid, t 0.8 | radial offset, seeded value noise | 128 | 4581.7 | 2 (0.26 mm³) | +9.2 % vs source 4196.7 (radial thickening; noise zero-mean) |
| `hierarchical_sc` | SC levels 1–4, divisor 2/3 | field = min over levels | 160 | 1054.4 | 0 | One SC level at 128: 643.3 |
| `fractal_cube_d3` | Fractal cube skeleton, size 24, depth 3, d 2, r0 0.6, ratio 0.7 | recursive corner substitution | 240 | 774.2 (160: 753.6) | 0 | Strut-skeleton (wireframe), not a solid lattice; union volume not independently verified |
| `graded_infill_sphere` | Hierarchical SC (2 levels, cell 8, r 0.5) + radial grading, clipped to sphere R 10 | radial offset, sphere clip | 240 | 210.5 (coarse grid: 201.9) | 0 | Open infill: struts end on the sphere, no closed skin |
| `gyroid_wrap_box` | Gyroid (cell 4 mm, 5 cells, t 0.5) wrapped on R = 10, clipped to box x,y ±30, z 0..20 | wrap, box clip | 240 (graph_check 96 → 288) | 5727.8 (flat source 2864.0 at 96) | 3 (0.05 mm³) | Ratio 2.00 = mean Jacobian (R+t)/R for t in [0, 20]; open sheet with box-cut edges, no closed skin |
| `sc_cylinder_wrap` | SC, cell 4 mm, r 0.4, 5 cells | wrap onto cylinder R = 6 | 250 (spacing-matched from 96) | 1547.3 | 0 | Source 609.0. Volume ratio 2.54 ≈ mean Jacobian (R+t)/R; struts thicken outward |

## Resolution and convergence
- `res` is the number of grid cells over the largest bounding dimension. Transforms that enlarge the
  bounds (bend, shear, wrap) raise `res` so the source spacing is kept (`graph_check.ts` does this).
- The 96-cell SC rotated value (662 mm³, 108 loose components) is superseded: at spacing-matched
  resolution the loose pieces fall to 15 components and 0.27 mm³.

## Not included here
- No exact B-Rep, no STEP, no closed outer skin. Box-trimmed sheets (gyroid) show trimmed edges, not caps.
- Exact-lattice work is tracked in `docs/EXACT_LATTICES.md`.
