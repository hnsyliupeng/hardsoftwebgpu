# Deep analysis: what the deep-fusion and exact-lattice results show (2026-10-21)

Scope: the deep-fusion records R1–R12 (`docs/DEEP_FUSION_INDEX.md`), their coupling analyses
(`docs/R10_…`, `R11_…`, `R12_COUPLING_ANALYSIS.md`), and the exact B-Rep lattices (`docs/EXACT_LATTICES.md`,
`examples/exact_lattices_L20/`). Numbers are taken from the committed records; nothing here is a new trial.

## 1. Main finding: the gate-coupled rounds are graded parameters, not volume-changing interaction

Every gate-coupled round R9–R12 was meant to make one structure's geometry depend on another's field.
The coupling analyses show what that dependence actually does to the material:

| Round | Gate effect on the whole box | Control | Reading |
|---|---|---|---|
| R10 | solid 57.31 % | fixed-thickness control 57.19 % | moves ≈3 points between zones, total unchanged |
| R11 | solid 50.05 % | fixed-level control 49.79 % | symmetric gate, moves ≈6 points, total unchanged |
| R12 | solid 55.61 % | uniform level at the mean 0.175: 55.59 % | total set by the mean level; the gate adds only spatial grading (±2.7 points around the mean) |

So, in volume terms, a gate adds no information beyond the mean parameter it sits on. R12 changed the total
(+5.7 points over the symmetric baseline), but a uniform control at the same mean reproduces it. The gate contributes
the spatial distribution, not the amount.

Consequence for the claim. The rounds are real field-level couplings (the geometry of one phase is evaluated
inside the other's field, and the coupling was measured), but the measured effect on volume is a parameter change.
The report should say "spatially graded coupling", not "volume-changing deep fusion". A gate that changes the amount of
material beyond a uniform parameter needs a non-local or topology-changing mechanism. None has been built or tested.

## 2. R1–R5 are not comparable with R6–R12

R1–R5 (`docs/DEEP_FUSION_ROUNDS.md`, top table) were built at 192 cells with closed skins, and their "coupling evidence" is a
different statistic (for example R2 pore solid 40.8 %, R3 twist 90° over 20 mm, R5 pocket fill 37.2 %). R6–R12 are open designs
(`skin_mm = 0`) with the index's wall, component and genus metrics. Closed-skin renders were removed on the user's
instruction, so R1–R5 should not be presented next to R6–R12 as the same kind of result.

The coupling percentage used to rank R1–R5 (4.41 % for R1, 55.22 % for R2, …) is a field statistic with no baseline control.
The R10–R12 analyses added the control, and that control is what showed the total is unchanged.

## 3. What "PASS" means, and what it does not

PASS (`scripts/structure_gallery.ts`) means: the five harnesses run, one connected solid, watertight mesh, field vs mesh volume
within the stated tolerance, and the wall p5 at or above 0.4 mm. The record:

- Wall is the 5th percentile of inward ray chords (`docs/DEEP_FUSION_INDEX.md`). It is a chord statistic. It is **not** a
  certified manufacturing check. Values for R6–R10 cluster at 0.43–0.48 mm, close to the 0.4 mm floor. R11 and R12 are thicker
  (1.26–1.47 mm) because their iso-level is set to 0.35.
- MC vs field and convergence agreement (0.00–0.7 %) show that the field and the mesh agree with each other. They do not show
  that the geometry is the intended structure.
- The only external comparison is routing against Bioinspired123D (`docs/BIOINSPIRED_COMPARISON.md`): 270/270 single-family prompts
  route correctly, 36 cross-domain prompts collapse to one family (no fusion is produced), and 14 general non-bio prompts are
  forced into bio families at confidence 0.25. That is a classification check, not a geometry comparison.
- Slice tests (faces open, 0.49–0.51 solid fraction on the face planes) were done for R10 at 96 cells only. The 192/256
  statements rest on the field.

Failing record: R9 at 256 (wall p5 0.393 mm, `harnesses_ok` failed). Three fixes were tried and rejected: a hard cut (fails at
192 and 256), a 0.6 mm blend (fails at 256, volume shifts about 4 %), and a morphological opening (removes too much material,
91 min run). The thin walls are acute wedges at the gate cut: 2,294 of 2,513 thin samples lie within 0.3 mm of the gate.
R9 is recorded as a failure and not accepted. R10 avoids the cut, which is why it passes.

## 4. Exact vs field geometry

The field-based renders of the gallery and the exact B-Rep models do not describe the same object at the boundary.

- Cause: `strutLattice` (`src/topology/lattice.ts`) evaluates only the cells of the 5×5×5 block. Struts from neighbouring cells
  that enter the box are missing from the field.
- Size of the effect at L = 20 (exact vs field-256 reference): BCC +0.8 %, Diamond +1.2 %, FCC −0.5 %, BCCZ +0.5 %, Kelvin +5.1 %,
  SC −1.2 %. The Kelvin gap is the largest because its struts are long relative to the cell.
- The Kelvin field volume in the block is 1594.6 mm³ at 128 cells and 1592.5 mm³ at 192 cells; the exact model is 1649.9 mm³.
  An independent capsule Monte Carlo gives 1643.0 ± 5.9 mm³, so the exact model follows its strut definition.

Exact status at L = 20, cell 4 mm, r 0.4 mm (`examples/exact_lattices_L20/`):

| Type | Exact B-Rep | Notes |
|---|---|---|
| SC | yes, 663.473 mm³ | matches SMLib 663.433 |
| BCC | yes, 1427.713 mm³ | MC 1425.2 ± 3.1 |
| FCC | yes, 1695.565 mm³ | no independent MC run |
| BCCZ | yes, 1599.111 mm³ | no independent MC run |
| Diamond | yes, 1427.399 mm³ | MC 1431.4 ± 5.6; 4 slivers of 0.078 mm³ removed |
| Kelvin | yes, 1649.866 mm³ | MC 1643.0 ± 5.9 |
| FBCC | **no** | `bad_alloc` in a 324-strut layer, also with half-cell layers |
| R8 (deep: BCC with gyroid-set radius) | yes, 1775.615 mm³ | piecewise-linear radius per strut (ruled lofts); MC agrees within 1.5σ |
| TPMS (gyroid, Schwarz P/D, Fischer–Koch S, Split P) | no | no exact route in this pipeline |

The exact models do not yet cover the deep-fusion designs at all. The index still says that exact B-Rep and STEP are not
available for any R-round design.

## 5. Process and reproducibility risks

- The sandbox was reset repeatedly (more than 20 recovery points are recorded under /home/user/recovery_local*). Each reset discarded untracked and ignored files. The `artifacts/`
  STEP and mesh files of the exact lattices were lost in the last reset. They can be rebuilt (about 3 min per type).
  The local OCCT venv was also lost. `scripts/python_env.sh` recreates it from `python/requirements.txt`.
- A single OCCT boolean over the whole BCC L = 20 lattice used more than 3.8 GB and froze the machine. The layered build
  (`python/exact/build_lattice.py`) is the only route that has been run. Chunked fuses of compounds gave wrong solids
  (BCC L = 8 cell: 18 solids instead of 1), so the layered build uses one call per layer.
- Closed-skin `screenshot_exterior.png` files reappear as untracked files after resets. They were removed each time.

## 6. Open items, in order of importance

1. **Reframe the deep-fusion claim** in the final report: R9–R12 are graded couplings whose total volume is set by the
   mean parameter. Do not describe them as volume-changing fusion.
2. **Exact models for deep designs.** Correction: R10 is not a feasible exact target. It contains a Schwarz D TPMS sheet, and the
   exact route has no representation for TPMS sheets. The feasible deep target is the strut-based R8 (BCC with gyroid-set
   radius). R8 is now built as an exact B-Rep (`examples/exact_deep_L20/r8_radius_gyroid/`, 1775.615 mm³, field reference
   1775.331 mm³). It is the only R-round with a strut-only geometry.
3. **FBCC**: an exact model is missing. The next approach is not another SMLib variant. Either split the boolean further by
   node, or accept a field-based FBCC with a label.
4. **R9 at 256** remains a failure. The rounds that followed avoided its cut, so it is recorded and not reopened.
5. **Helical plate teeth, skin removal at 256, the six boolean shallow-fusion entries, cross-domain and non-bio routing**: still open,
   as listed in the session notes. Each needs a decision or a larger piece of work; none has been resolved by these results.
6. **Validation depth**: the only external check is routing. A geometry comparison against Bioinspired123D output (or an
   independent print-quality check of the wall) has not been done.
