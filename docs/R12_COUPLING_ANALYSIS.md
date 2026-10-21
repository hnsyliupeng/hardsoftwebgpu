# R12 coupling analysis: one-sided gate-set iso-level

Question: R11 showed that a symmetric gate only moves material around (`docs/R11_COUPLING_ANALYSIS.md`). Does a one-sided
gate (level from 0 to 0.35) change the total solid, and does the gate add anything beyond the mean level?

Method: `scripts/r12_coupling_analysis.ts` (N = 40,000 deterministic points, 20 mm box). Three fields: R12; a uniform control at the
mean level (0.175, no gate dependence); a uniform control at 0 (the symmetric baseline). Output: `docs/r12_coupling_analysis_output.txt`.

| Region | R12 | Uniform mean 0.175 | Uniform 0 |
|---|---|---|---|
| Whole box | 55.61 % | 55.59 % | 49.93 % |
| Gate-negative zone (g < 0) | 52.81 % | 55.52 % | 49.84 % |
| Gate-positive zone (g > 0) | 58.37 % | 55.66 % | 50.02 % |

Interpretation:
1. **The one-sided gate changes the total volume**: +5.7 points over the symmetric baseline (55.6 % against 49.9 %).
2. **The total is set by the mean level.** The uniform control at the mean level gives the same whole-box fraction (55.59 % vs
   55.61 %). The gate itself adds no volume beyond the mean level.
3. **The gate adds spatial grading around the mean.** The gate-negative side is 2.7 points below the uniform control and the
   gate-positive side is 2.7 points above it. Both are many standard errors (about 0.35 points per zone).
4. So the coupling is real, but its volume effect is a uniform offset. A gate that changes volume beyond a uniform parameter would
   need a non-local or topology-changing mechanism. That is not what R12 does.

Limits: field-level analysis, not the mesh. The formulas are copied from `buildR12`; keep them in sync if the round changes.
