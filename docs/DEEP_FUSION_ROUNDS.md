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
