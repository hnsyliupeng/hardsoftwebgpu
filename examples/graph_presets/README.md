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
| `sc_cylinder_wrap` | SC, cell 4 mm, r 0.4, 5 cells | wrap onto cylinder R = 6 | 250 (spacing-matched from 96) | 1547.3 | 0 | Source 609.0. Volume ratio 2.54 ≈ mean Jacobian (R+t)/R; struts thicken outward |

## Resolution and convergence
- `res` is the number of grid cells over the largest bounding dimension. Transforms that enlarge the
  bounds (bend, shear, wrap) raise `res` so the source spacing is kept (`graph_check.ts` does this).
- The 96-cell SC rotated value (662 mm³, 108 loose components) is superseded: at spacing-matched
  resolution the loose pieces fall to 15 components and 0.27 mm³.

## Not included here
- No exact B-Rep, no STEP, no closed outer skin. Box-trimmed sheets (gyroid) show trimmed edges, not caps.
- Exact-lattice work is tracked in `docs/EXACT_LATTICES.md`.
