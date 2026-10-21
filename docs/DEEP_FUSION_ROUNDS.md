# Deep fusion: five rounds, one coupling dimension each

Each round adds one kind of coupling between structures. The coupling is in the field itself (one structure's geometry depends on another's field), not a boolean union of two finished designs. Every round runs through the full pipeline at **192 cells** (0.104 mm voxels), and every round has its own coupling metric measured on its own field.

Shared settings: 20 mm box, 1 mm envelope skin on every round, convergence at 240 cells, watertight mesh check, `design.ts` runs.

| Round | Dimension | What is coupled | Volume (mm³) | Vol. fraction | Components | Handles | MC / convergence | Coupling evidence |
|---|---|---|---|---|---|---|---|---|
| R1 | Parameter coupling across families | Gyroid wall thickness is set by the distance to a cellular foam field (thick near foam walls, thin in pockets) | 5199.1 | 0.650 | 1 | 324 | MC 0.01 %; conv 0.07 % | wall-adjacent mean t 1.188 mm vs pocket mean t 0.515 mm (t range 0.5–1.2 mm) |
| R2 | Scale nesting | Kelvin lattice grows inside 16 tubular pores | 6014.4 | 0.752 | 1 | 4032 | MC 0.13 %; conv 0.31 % | 16 pores; pore volume 40.8 % solid |
| R3 | Orientation coupling | BCC lattice rotated about z by a helical angle (90° over the 20 mm height) | 3223.2 | 0.403 | 1 | 703 | MC 0.53 %; conv 0.10 % | twist 90° total, 4.5°/mm |
| R4 | Multi-material transition | Kelvin, gyroid and I-WP in three z-zones, joined by smooth minima (no planar seam) | 4844.5 | 0.606 | 1 | 556 | MC 0.15 %; conv 0.19 % | solid fraction per zone 0.3002 / 0.5225 / 0.4749; blend radius 1.5 mm |
| R5 | Hierarchical infill | Gyroid sheet fills the pockets of a cellular foam | 7149.6 | 0.894 | 1 | 300 | MC 0.10 %; conv 0.08 % | pocket fill 37.2 %; solid fraction 0.824 |

> Consolidated table of R6 to R10 at all resolutions, generated from the records: `docs/DEEP_FUSION_INDEX.md`.

## Per-round record

Design status is `PASS` for all five rounds (single solid, watertight, MC, convergence, skin attached, `design.ts` runs). Full checks and the complete DesignState are in `examples/structure_gallery/<id>/design.json`.

### R1: Parameter coupling across families

- Design: `deep_R1_thickness`; screenshots `examples/structure_gallery/deep_R1_thickness/screenshot.png` (cut-away). The exterior view was removed (closed-skin rule); the open A5 versions are in `examples/structure_gallery_256_mixed_open/`.
- Coupling: Gyroid wall thickness is set by the distance to a cellular foam field (thick near foam walls, thin in pockets).
- Measured: wall-adjacent mean t 1.188 mm vs pocket mean t 0.515 mm (t range 0.5–1.2 mm).
- Result: PASS, 6/6 checks; repair history: 0 steps.

### R2: Scale nesting

- Design: `deep_R2_nested`; screenshots `examples/structure_gallery/deep_R2_nested/screenshot.png` (cut-away). The exterior view was removed (closed-skin rule); the open A5 versions are in `examples/structure_gallery_256_mixed_open/`.
- Coupling: Kelvin lattice grows inside 16 tubular pores.
- Measured: 16 pores; pore volume 40.8 % solid.
- Result: PASS, 6/6 checks; repair history: 0 steps.

### R3: Orientation coupling

- Design: `deep_R3_twist`; screenshots `examples/structure_gallery/deep_R3_twist/screenshot.png` (cut-away). The exterior view was removed (closed-skin rule); the open A5 versions are in `examples/structure_gallery_256_mixed_open/`.
- Coupling: BCC lattice rotated about z by a helical angle (90° over the 20 mm height).
- Measured: twist 90° total, 4.5°/mm.
- Result: PASS, 6/6 checks; repair history: 0 steps.

### R4: Multi-material transition

- Design: `deep_R4_blend`; screenshots `examples/structure_gallery/deep_R4_blend/screenshot.png` (cut-away). The exterior view was removed (closed-skin rule); the open A5 versions are in `examples/structure_gallery_256_mixed_open/`.
- Coupling: Kelvin, gyroid and I-WP in three z-zones, joined by smooth minima (no planar seam).
- Measured: solid fraction per zone 0.3002 / 0.5225 / 0.4749; blend radius 1.5 mm.
- Result: PASS, 6/6 checks; repair history: 0 steps.

### R5: Hierarchical infill

- Design: `deep_R5_hierarchy`; screenshots `examples/structure_gallery/deep_R5_hierarchy/screenshot.png` (cut-away). The exterior view was removed (closed-skin rule); the open A5 versions are in `examples/structure_gallery_256_mixed_open/`.
- Coupling: Gyroid sheet fills the pockets of a cellular foam.
- Measured: pocket fill 37.2 %; solid fraction 0.824.
- Result: PASS, 6/6 checks; repair history: 0 steps.

## Limits

- The foam driver in R1 and R5 is a field scaled to about ±0.8 mm, not an exact distance field.
- The fusion between rounds is a field operation (smooth minimum, masks, rotation, pore clipping). It is SDF-only, with no exact B-Rep boolean.
- R4's lower zone (Kelvin) is visually hard to read in the cut-away view; the zone solid fraction (0.30) is the quantitative evidence that it is present.
- The shallow baseline `fusion_gyroid_plus_helical` and the bio helical designs still show stepped plate edges in the 192 renders (see the gallery README). Not fixed in this round.

## Round 6: sheet-to-strut morph (open, added 2026-10-19)

R6 adds a dimension the first five rounds do not have: the structure changes **type** inside one field. A gyroid
sheet fills the core (radius 5.5 mm from the box centre); a BCC strut lattice (4 mm cell, 0.4 mm strut) fills the outer
shell; a smooth radial weight blends the two signed fields over 2 mm. Code: `buildR6` in `src/topology/coupled.ts`;
test: `tests/coupled_r6.test.ts`.

Unlike R1 to R5, R6 is **open** (`skin_mm = 0`, no closed envelope skin), so its lattice reaches the box faces.
Results are in `examples/structure_gallery_r6_open_96/`, `..._192/` and `..._256/` (one README per resolution).

| Cells | Volume (mm³) | MC (mm³) | Mesh vs MC | Convergence | Triangles | Components | Watertight | Result |
|---|---|---|---|---|---|---|---|---|
| 96 | 1464.007 | 1458.56 | 0.59 % | 0.21 % (vs 120) | 466,296 | 1 | 0 open | PASS |
| 192 | 1458.989 | 1458.56 | 0.04 % | 0.01 % (vs 240) | 1,892,868 | 1 | 0 open | PASS |
| 256 | 1457.855 | 1458.56 | 0.05 % | 0.00 % (vs 320) | 3,372,576 | 1 | 0 open | PASS |

Coupling evidence (sampled on the box): solid fraction 0.284 in the core, 0.163 in the morph zone, 0.184 in the shell.
Limits: SDF-only; the morph is a blend of two signed fields, not an exact interpolation of the two surfaces.

## Round 7: graded period (open, added 2026-10-19)

R7 adds scale grading: the gyroid period along z grows from 3 mm at the base to 7 mm at the top (x and y period 5 mm,
wall 0.5 mm). It is a one-dimensional coordinate warp, so the gradient of the warped field is exact. Code: `buildR7` in
`src/topology/coupled.ts`; test: `tests/coupled_r7.test.ts`. This is a single structure with graded scale, not a
coupling between two structures.

Open design (`skin_mm = 0`). Results are in `examples/structure_gallery_r7_open_96/`, `..._192/`, `..._256/`.

| Cells | Volume (mm³) | MC (mm³) | Mesh vs MC | Convergence | Triangles | Components | Wall p5 (mm) | Result |
|---|---|---|---|---|---|---|---|---|
| 96 | 2378.648 | 2403.28 | 0.62 % | 0.41 % (vs 120) | 721,748 | 1 | 0.469 | PASS |
| 192 | 2398.134 | 2403.28 | 0.12 % | 0.10 % (vs 240) | 2,912,720 | 1 | 0.470 | PASS |
| 256 | 2400.894 | 2403.28 | 0.04 % | 0.06 % (vs 320) | 5,167,684 | 1 | 0.470 | PASS |

Limits: a first version that warped x and y as well gave a wall of 0.31 mm (not printable under the 0.4 mm floor). That
map is not conformal, so the distance estimate was wrong. The z-only warp replaces it. The front view projects -z, so
z increases downward in `view_front.png`.

## Round 8: strut radius set by a gyroid field (open, added 2026-10-19)

R8 couples two structure families inside one field: a BCC strut lattice (4 mm cell) whose strut radius is
r = 0.45 + 0.1 tanh(F), with F the gyroid value (5 mm period). Struts swell where the sheet is positive and thin where
it is negative. Radius range 0.359 to 0.540 mm. Code: `buildR8` in `src/topology/coupled.ts`; test: `tests/coupled_r8.test.ts`.
The radius correction is first order (exact for radius that varies slowly compared with the strut).

Open design (`skin_mm = 0`). Results are in `examples/structure_gallery_r8_open_96/`, `..._192/`, `..._256/`.

| Cells | Volume (mm³) | MC (mm³) | Mesh vs MC | Convergence | Triangles | Components | Wall p5 (mm) | Result |
|---|---|---|---|---|---|---|---|---|
| 96 | 1785.015 | 1777.6 | 0.52 % | 0.11 % (vs 120) | 481,668 | 1 | 0.734 | PASS |
| 192 | 1776.722 | 1777.6 | 0.04 % | 0.01 % (vs 240) | 1,963,680 | 1 | 0.734 | PASS |
| 256 | 1775.331 | 1777.6 | 0.12 % | 0.00 % (vs 320) | 3,501,516 | 1 | 0.734 | PASS |

## Round 9: interpenetrating phases gated by a gyroid (open, added 2026-10-20)

R9 couples two structure families that share one box. A Schwarz D sheet (5 mm period, 0.5 mm wall) fills the
side of a gyroid gate surface (8 mm period) where the gate is negative. A BCC strut lattice (4 mm cell,
r = 0.4 mm) fills the side where it is positive. Each phase is clipped by the gate inside the field, using a rounded
phase cut (smooth max) and a smooth union (0.3 mm blend). This is not a boolean of two finished designs.
Code: `buildR9` in `src/topology/coupled.ts`; test: `tests/coupled_r9.test.ts`. Field-based (non-exact); open design (`skin_mm = 0`).
Results are in `examples/structure_gallery_r9_open_96/`, `..._192/`, `..._256/`.

| Cells | Volume (mm³) | MC (mm³) | Mesh vs MC | Convergence | Triangles | Components | Wall p5 (mm) | Result |
|---|---|---|---|---|---|---|---|---|
| 96 | 2076.313 | 2104.9 | 0.69 % | 0.68 % (vs 120) | 687,336 | 1 | 0.436 | PASS |
| 192 | 2097.054 | 2104.9 | 0.27 % | 0.11 % (vs 240) | 2,794,824 | 1 | 0.407 | PASS |
| 256 | 2099.035 | 2104.9 | 0.21 % | 0.07 % (vs 320) | 4,959,420 | 1 | 0.393 | **FAIL** (wall floor 0.4 mm) |

Phase split (sampled on the box): sheet zone 50.7 % of the box with solid fraction 0.349; lattice zone 49.3 % with 0.169.

**Status.** The 256 design fails the RepairHarness wall check: its 5th-percentile wall is 0.393 mm, below the 0.4 mm
printability floor. The figure falls with resolution (0.436 → 0.407 → 0.393 mm), so it is not converging, and the
thin spots are not yet located. The first version (hard phase cut) gave 0.30 mm at 192 cells. The rounded cut fixed 192
but not 256. This round is therefore open: the 256 result is not accepted as printable.

**Diagnosis.** `scripts/r9_wall_diagnostic.ts` runs the validator's chord routine on surface samples. At 192 cells, 2294 of
the 2513 chords below 0.4 mm (91 %) lie within 0.3 mm of the gate surface. These are acute wedges where the sheet or the lattice
is cut by the gate at a shallow angle. A BCC lattice control gives 0.800 mm everywhere, so the method is not the cause.

**Trial.** A larger phase-cut radius (blend 0.6 mm) at 256 gave wall p5 0.388 mm (worse) and changed the volume by about 4 %.
It was reverted. The committed 0.3 mm result stands.

**Opening trial (rejected).** A band-limited morphological opening (cube half-width 0.2 mm, sampled at 0.2 mm, in the gate band
|g| 0.3–0.6 mm) was run at 256. It removed far too much material: volume 1521.9 mm³ (was 2099.0), wall p5 0.122 mm,
genus 12,912, 7,560 cavities, and a 91-minute run; the design.ts check timed out. The 0.2 mm sampling is too coarse for
a 0.5 mm sheet, so the operator erodes the sheet wherever the samples miss it. The code was reverted; nothing is committed for it.

**Status.** R9 at 256 is not resolved. Remaining option: redesign so that the phases do not meet at shallow angles
(a change to R9's concept). Not implemented.

## Round 10: gated dominance, both phases present (open, added 2026-10-20)

R10 places a Schwarz D sheet and a BCC strut lattice in the same field, and does not cut either one. A gyroid gate
(8 mm) sets the dominance d = tanh(g / 1 mm). The sheet thickness is 0.7 − 0.2 d (0.5 to 0.9 mm), and the strut radius
is 0.4 + 0.1 d (0.3 to 0.5 mm). The phases are joined by a smooth union (0.2 mm). Code: `buildR10` in `src/topology/coupled.ts`;
test: `tests/coupled_r10.test.ts`. Field-based (non-exact); open design (`skin_mm = 0`).

**Why R10 exists.** R9 cut each phase with the gate. That made acute solid wedges at the cut, and at 256 cells their wall was
below the 0.4 mm floor. R10 has no cut: a union creates only concave creases, which are not thin, so the thinnest solid is the
design value (0.5 mm sheet, 0.6 mm strut diameter). R9 is kept, with its 256 failure documented.

| Cells | Volume (mm³) | MC (mm³) | Mesh vs MC | Convergence | Triangles | Components | Wall p5 (mm) | Result |
|---|---|---|---|---|---|---|---|---|
| 96 | 4565.762 | 4590.0 | 0.37 % | 0.15 % (vs 120) | 872,364 | 1 | 0.484 | PASS |
| 192 | 4575.031 | 4590.0 | 0.28 % | 0.05 % (vs 240) | 3,548,052 | 1 | 0.484 | PASS |
| 256 | 4576.911 | 4590.0 | 0.26 % | 0.03 % (vs 320) | 6,331,404 | 1 | 0.482 | PASS |

Solid fraction about 0.57 (porosity about 0.43).

**Coupling analysis.** `docs/R10_COUPLING_ANALYSIS.md`: against a fixed-thickness control, the gate leaves the whole-box solid fraction unchanged (57.31 % vs 57.19 %) and moves about 3 points of solid from the lattice zone to the sheet zone. The dominance is partial, not a switch. Slice test at 96 cells (`scripts/slice_test.ts`): face-plane solid fraction
0.49 to 0.51 on all six faces (a closed skin would be about 1.0), so the faces are open. The stepped layers in the renders are
structure cross-sections, not a skin. The slice test rebuilds the field from `design_spec` on a fixed grid, so 192 and 256 give the same values; this confirms the field, not the 192 and 256 meshes separately.
