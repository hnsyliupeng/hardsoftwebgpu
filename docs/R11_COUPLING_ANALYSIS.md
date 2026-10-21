# R11 coupling analysis: gate-set iso-level

Question: does the gate in R11 change the total solid, or only redistribute it? R11 sets the iso-level of one gyroid:
solid where F < c(g), c(g) = 0.35 tanh(g / 1.5 mm).

Method: `scripts/r11_coupling_analysis.ts` (N = 40,000 uniform points, deterministic seed). Control = R11 with
`level_amp = 0` (a fixed level of 0, the 50 % gyroid). Output: `docs/r11_coupling_analysis_output.txt`.

| Region | R11 solid | Control solid |
|---|---|---|
| Whole box | 50.05 % | 49.79 % |
| Sheet zone (g < 0) | 44.33 % | 49.88 % |
| Lattice zone (g > 0) | 55.78 % | 49.71 % |

Interpretation:
1. The gate redistributes material: about −5.5 points on the gate-negative side and +6.1 points on the gate-positive side.
   With about 20,000 points per zone, the standard error is about 0.35 points, so these shifts are significant.
2. The whole-box change is 0.26 points, within noise. The gate is symmetric (tanh is odd, and the two zones are almost equal in
   size), so the net volume change averages to zero.
3. Same result as R10 (`docs/R10_COUPLING_ANALYSIS.md`). Both rounds couple the gate to local material in an odd way.
   A net volume or density change needs an asymmetric gate, for example one whose zone fractions differ from 50/50, or a
   response that is not odd in g. That is the next design question, not a result of this analysis.

Limits: field-level analysis, not the mesh. The formulas are copied from `buildR11`; keep them in sync if the round changes.
