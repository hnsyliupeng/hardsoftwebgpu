# Structure-graph examples (guide)

All eight examples are **field-based (non-exact)**: each is an implicit field compiled from a JSON
graph in `presets/`, sampled on a grid, meshed with surface nets, and rendered cut-away. None is an exact
B-Rep. Volumes are grid-convergence estimates. Renders are in `examples/graph_presets/` (see its README).

Graph format and transform rules: `docs/STRUCTURE_GRAPH.md`. Chains read left to right: source → transforms → structure.

## Regenerate any example

```
node --experimental-strip-types scripts/graph_check.ts presets/<name>.json <res>     # volume, components
node --experimental-strip-types scripts/render_graph.ts presets/<name>.json <res> examples/graph_presets
```

`graph_check` raises the resolution for transforms that enlarge the bounds (bend, shear, wrap, clip),
so the source spacing is kept; `res` is the source resolution.

## 1. `sc_rotated_gradient` — rotation and linear gradient

- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4) → rotate about (1,1,1) by 0.3 rad → gradient along z (slope 0.02, centre z = 10).
- Shows: a rigid rotation keeps volume (641.0 vs 642.7 mm³ source at res 126, 0 components), and a linear gradient thickens the struts towards the top.
- Result: 740.6 mm³ at res 165, 15 floating components removed (0.27 mm³). The +15 % is the gradient: strut radius goes from 0.2 to 0.6 mm over the height (see STRUCTURE_GRAPH.md).
- Render: `sc_rotated_gradient_{iso,top}.png`.

## 2. `gyroid_bent_sheared` — bend and shear of a TPMS sheet

- Chain: gyroid (cell 4 mm, 5 cells, t 0.8) → bend (k 0.04) → shear (a 0.1).
- Shows: non-isometric maps with Lipschitz normalisation (σ_max); the sheet keeps its topology.
- Result: 4188.1 mm³ at res 299 vs flat source 4196.2 mm³ at res 96 (−0.19 %), 2 components removed.
- Render: `gyroid_bent_sheared_{iso,top}.png`.

## 3. `gyroid_noise_radial` — seeded noise and radial grading

- Chain: gyroid (cell 4 mm, 5 cells, t 0.8) → value noise (amplitude 0.15, frequency 0.2 cycles/mm, seed 7) → radial offset (slope 0.01, centre (10,10,10), radius0 5 mm).
- Shows: two offset-type densities (noise is zero-mean; radial grading is not), with a fixed seed so the result is reproducible.
- Result: 4581.7 mm³ at res 128 vs 4196.7 mm³ source (+9.2 %, from radial thickening); 2 components removed.
- Render: `gyroid_noise_radial_{iso,top}.png`.

## 4. `hierarchical_sc` — two-level self-similar lattice

- Chain: hierarchical SC (cell 4 mm, 5 cells, r 0.4, levels 2, divisor 2) — the union of level 0 (cell 4 mm, r 0.4) and level 1 (cell 2 mm, r 0.2) lattices.
- Shows: multi-scale structure inside a coarse frame (C2).
- Result: 1054.4 mm³ at res 160 vs 643.3 mm³ for one level at res 128. The union volume is not independently verified.
- Render: `hierarchical_sc_{iso,top}.png`.

## 5. `sc_cylinder_wrap` — lattice wrapped onto a cylinder

- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4) → wrap onto a cylinder of radius R = 6 mm.
- Shows: cylinder projection (C1, partial). Tangential stretch makes outer struts thicker (non-isometric).
- Result: 1547.3 mm³ at res 250 vs 609.0 mm³ flat source at res 96; ratio 2.54 is close to the mean Jacobian 2.67 over t ∈ [0, 20].
- Render: `sc_cylinder_wrap_{iso,top}.png`.

## 6. `fractal_cube_d3` — recursive corner substitution

- Chain: fractal cube skeleton (size 24 mm, divisor 2, depth 3, r0 0.6, radius ratio 0.7). Each level draws its cube's 12 edges and recurses into the 8 corner subcubes.
- Shows: recursive substitution (C2), with strut radius shrinking per level.
- Result: 774.2 mm³ at res 240 (753.6 at res 160). A skeleton, not a solid lattice; the union volume is not independently verified.
- Render: `fractal_cube_d3_{iso,top}.png`.

## 7. `graded_infill_sphere` — open graded infill

- Chain: hierarchical SC (cell 8 mm, 3 cells, r 0.5, levels 2) → radial grading (slope 0.01 about (12,12,12), radius0 10 mm; core thinner, rim thicker) → clip to a sphere of radius 10 mm.
- Shows: open infill (C3). The clip is an intersection (max(f, sd)), so struts end open on the sphere; no closed skin.
- Result: 210.5 mm³ at res 240 (201.9 at the coarse grid); 0 components.
- Render: `graded_infill_sphere_{iso,top}.png`. The iso view has small slivers where the cut meets thin strut ends.

## 8. `gyroid_wrap_box` — wrapped TPMS with a box clip

- Chain: gyroid (cell 4 mm, 5 cells, t 0.5) → wrap onto R = 10 mm → clip to the box x, y ∈ [−30, 30], z ∈ [0, 20].
- Shows: a TPMS sheet mapped onto a cylinder and cut open by a box.
- Result: 5727.8 mm³ at res 288 (graph_check) vs 2864.0 mm³ flat source at res 96; ratio 2.00 = mean Jacobian over t ∈ [0, 20]; 3 components (0.05 mm³) removed.
- Render: `gyroid_wrap_box_{iso,top}.png`. Annular sector with holes from the top; open box-cut edges.

## 9. `fractal_tiled_d2` — fractal cubes tiled 2×2×2
- Chain: fractal cube (size 24 mm, divisor 2, depth 2, r0 0.8, ratio 0.7) with `tiles` = 2 → 48 mm extent.
- Shows: C2 tiling. Each tile is the recursive corner-substitution skeleton; shared faces are drawn twice (harmless).
- Volume is not converged to 1 % at the resolutions run (4476.8 at 240, 4533.1 at 320). Field-based (non-exact).
- Render: `fractal_tiled_d2_{iso,top}.png` at res 240.

## 10. `sc_conformal_log` — lattice under an angle-preserving log-polar map
- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4, source box [0, 20]³) → conformal log-polar map w = r0·exp((x + i·y)/s), r0 = 16 mm, s = 20 mm.
- Shows: the conformal case of C1. Cells keep their angles and grow with radius; the field is 1-Lipschitz (constant Λ normalisation).
- Volume: the transformed/source ratio approaches the predicted mean Jacobian 2.044 as resolution rises (2.09 at res 128).
- Render: `sc_conformal_log_{iso,top}.png` at res 128. Field-based (non-exact).

## What is not in these examples

- No exact B-Rep, STEP, or GLB for any of them. Exact lattice work is tracked in `docs/EXACT_LATTICES.md`.
- No closed outer skin (by the no-skin rule). Clip is the only boundary operation.
- No lattice tiling of the fractal. The closed-form Möbius map is in section 11; the discrete harmonic map of a rectangle to a disk is in section 12.
 The log-polar map is implemented; see `docs/STRUCTURE_GRAPH.md`.

## 11. `sc_mobius` — lattice under a Möbius map
- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4, source box [0, 20]³) → Möbius map w = (a·s + b)/(c·s + d) = s/((−0.02 + 0.01i)·s + 1) with s = x + i·y (a = 1, b = 0, c = −0.02 + 0.01i, d = 1), z unchanged.
- Shows: a second conformal case of C1 with a pole outside the box. The far corner is stretched by about 25 in area; the field is 1-Lipschitz (Λ normalisation over the image boundary).
- Numbers: graph_check at res 128 gives 3579.8 mm³ transformed vs 643.3 mm³ source. The Jacobian-weighted Monte Carlo estimate is 3553 mm³.
- Render: `sc_mobius_{iso,top}.png` at res 457. Field-based (non-exact).
- Tests: `tests/mobius.test.ts`.

## 12. `sc_harmonic_disk` — lattice under a discrete harmonic map of a rectangle onto a disk
- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4, source [0, 20]³) → harmonic map of the rectangle [−6, 26]² onto a disk of radius 14 mm (n = 24 cells per side). Clipped to the disk.
- Shows: the general-parameter-plane case of C1 (rectangle to disk, discrete harmonic, piecewise linear). The map is not conformal; the field is 1-Lipschitz with the exact λ = 31.5.
- Numbers: 430.4 mm³ at res_transformed 448 vs Monte Carlo 430.5 mm³.
- Render: `sc_harmonic_disk_{iso,top}.png` at res 448. Field-based (non-exact). The visible outline is the lattice's [0, 20]² cut faces mapped by the harmonic map; the disk itself is not visible.
- Tests: `tests/harmonic.test.ts`.

## 13. `sc_harmonic_ellipse` — lattice under a discrete harmonic map of an ellipse onto a disk
- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4, source [0, 20]³) → harmonic map of the ellipse centred (10, 10) with semi-axes (12, 8) onto a disk of radius 14 mm (n = 16 rings). Clipped to the disk.
- Shows: the smooth (corner-free) parameter domain of C1. λ stays bounded (2.77) where the rectangle version grows with n (the square corners are singular for any map to a disk).
- Numbers: 908.9 mm³ at res_transformed 336 vs Monte Carlo 911.6 mm³ (−0.30 %), 0 components removed.
- Render: `sc_harmonic_ellipse_{iso,top}.png` at res 240. Field-based (non-exact). The top view shows a swirl with cut faces at the disk edge.
- Tests: `tests/harmonic.test.ts`.

## 14. `sc_sphere_shell` — lattice projected onto a sphere patch
- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4, source [0, 20]³) → surface projection onto a sphere of radius 16 mm (x = arc length in φ, y = arc length in θ from θ0 = 1.0, z = normal offset, so the shell is 20 mm thick).
- Shows: the sphere case of the surface projection. λ = 1.2852 (exact).
- Numbers: 1724.2 mm³ mesh (res_transformed 515) vs weighted Monte Carlo 1720.0 mm³ (+0.24 %), 0 components removed.
- Render: `sc_sphere_shell_{iso,top}.png` at res 240. Field-based (non-exact).
- Tests: `tests/surface.test.ts`.

## 15. `sc_torus_shell` — lattice projected onto a torus patch
- Chain: SC lattice → surface projection onto a torus with major radius 40 mm and minor radius 10 mm (v0 = −1.0; the shell runs from tube radius 10 to 30 mm).
- Shows: the torus case of the surface projection. The outer side of the torus, so λ = 1 (exact).
- Numbers: 1935.3 mm³ mesh (res_transformed 618) vs weighted Monte Carlo 1932.5 mm³ (+0.14 %), 0 components removed.
- Render: `sc_torus_shell_{iso,top}.png` at res 240. Field-based (non-exact).
- Tests: `tests/surface.test.ts`.

## 16. `sc_ellipsoid_shell` — lattice projected onto an ellipsoid patch
- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4, source [0, 20]³) → parametric projection onto the ellipsoid a = 24, b = 18, c = 14 mm (u0 = −0.4, v0 = 0.9, du = dv = 0.04; z = normal offset, 20 mm thick).
- Shows: the first general parametric surface (Newton inverse, sampled λ = 1.8213, no closed form for the inverse).
- Numbers: 961.95 mm³ mesh (res_transformed 412) vs Jacobian-weighted Monte Carlo 944.8 ± 5.7 mm³ (+1.8 %), 0 components removed.
- Render: `sc_ellipsoid_shell_{iso,top}.png` at res 240. Field-based (non-exact).
- Tests: `tests/parametric.test.ts`.

## 17. `sc_saddle_sheet` — lattice projected onto a saddle sheet
- Chain: SC lattice → parametric projection onto the saddle z = 0.02 (u² − v²), u, v in [−10, 10] mm (z = normal offset).
- Shows: the saddle case. The sampled λ = 5.10 is conservative (finite differences give 3.88), so the map is compressive near the sheet's steep edges.
- Numbers: 578.02 mm³ mesh (res_transformed 427) vs Jacobian-weighted Monte Carlo 569.4 ± 3.1 mm³ (+1.5 %), 0 components removed.
- Render: `sc_saddle_sheet_{iso,top}.png` at res 240. Field-based (non-exact). The top view is a cut-away of the upper half (z ≥ 9.3 mm), whose footprint is about 2.5 : 1; this matches the picture (see docs/STRUCTURE_GRAPH.md). The iso view looks like a curved lattice sheet.
- Tests: `tests/parametric.test.ts`.

## 18. `sc_superellipse_disk` — lattice under a harmonic map of a superellipse onto a disk
- Chain: SC lattice (cell 4 mm, 5 cells, r 0.4, source [0, 20]³) → discrete harmonic map of the superellipse |x−10|/12|⁴ + |y−10|/8|⁴ ≤ 1 onto the disk of radius 14 mm, n = 16, clipped to the disk.
- Shows: a corner-free parameter domain that is squarer than the ellipse of example 13. λ = 3.0754 (exact, piecewise affine), which converges in n; the domain is inscribed 2n-gon.
- Numbers: 810.2 mm³ mesh (res_transformed 336) vs Jacobian-weighted Monte Carlo 801.2 ± 6.1 mm³ (+1.1 %), 0 components removed.
- Render: `sc_superellipse_disk_{iso,top}.png` at res 240 (839 k triangles). Field-based (non-exact). The top view shows a swirl whose outline follows the squarer domain; the iso view is the swirl extruded over z ∈ [0, 20], with cut faces at the disk edge.
- Tests: `tests/superellipse.test.ts`.
