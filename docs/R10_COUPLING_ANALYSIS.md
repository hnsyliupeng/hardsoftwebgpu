# R10 coupling analysis: what the gate actually does

Question: R10 places a Schwarz D sheet and a BCC lattice in one field, and a gyroid gate sets which phase is thick.
Does the gate change the solid, or only redistribute it? Is R10 more than a fixed-thickness union?

Method: `scripts/r10_coupling_analysis.ts` (N = 40,000 uniform points, 20 mm box, deterministic seed).
Control = R10 with `radius_amp_mm = 0` and `sheet_amp_mm = 0`, which is a union of a 0.7 mm sheet and 0.4 mm
struts with no gate dependence. "Alone" columns evaluate one phase by itself with the same thickness or radius
as in R10. Output: `docs/r10_coupling_analysis_output.txt`.

## Result

| Region | R10 solid | Control solid | Status differs | Sheet alone | Lattice alone |
|---|---|---|---|---|---|
| Whole box | 57.31 % | 57.19 % | 6.80 % | - | - |
| Sheet zone (g < 0, n = 19,902) | 60.44 % | 57.02 % | 6.35 % | 52.97 % | 14.35 % |
| Lattice zone (g > 0, n = 20,098) | 54.21 % | 57.34 % | 7.25 % | 40.48 % | 21.72 % |

Statistical uncertainty: about 0.35 percentage points per zone fraction, about 0.5 for a zone difference.

## What this means

1. **The gate redistributes material; it does not change the total.** The whole-box solid fraction is the same as the
   control within noise (0.12 points). The gate moves about +3.4 points of solid into the sheet zone and removes about
   3.1 points from the lattice zone. That is about 6 to 7 standard errors in each zone.
2. **About 7 % of the box changes status.** The coupling is real and visible at the point level, not just in the averages.
   It is also the only place where R10 differs from a plain union.
3. **The dominance is partial.** In the lattice zone the sheet still fills 40 % of the points, and in the sheet zone the
   lattice still fills 14 %. "Lattice dominant" means the lattice is relatively thicker, not that the sheet is absent.
   Describing R10 as a sharp gated switch would overstate it.
4. **The wall is set by the design values.** The sheet minimum is 0.5 mm and the strut minimum diameter is 0.6 mm. The
   measured 5th-percentile chord (0.482 to 0.484 mm) is within the voxel error of the 0.5 mm sheet minimum (about ±0.04 mm at
   256 cells). R10 has no acute solid wedges, which was the R9 failure mode.

## Implication for the claims

- R10 is a field-coupled structure in which a gyroid gate changes local thickness and redistributes about 3 % of the box between
  the two phases. It is not a boolean of two finished designs.
- The total volume and porosity are almost the same as a plain union at fixed thickness. If a design goal is to change
  density or volume with the gate, R10 does not do that; the gate only changes where the material sits.
- A stronger test of coupling would compare against a second control with the gate applied to a different quantity (for example,
  the gate applied only to strut radius). That was not done.

## Limits

- Field-level analysis (SDF and Monte Carlo sampling), not the mesh. The gate in the analysis is the first-order estimate
  F / |grad F|, as in `buildR10`.
- The formulas for the alone-phase columns repeat `buildR10`. They must be kept in sync if `buildR10` changes.
