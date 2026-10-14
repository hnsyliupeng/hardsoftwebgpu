# Feature audit — Bioinspired123D-WASM (CPU-verified)

Scope: every requirement from the project brief, checked against the code, the automated tests and the
CPU self-test. Everything below was run in CPU-only mode (no GPU, no browser, no network).

Verdict: all functional requirements are implemented and verified on the CPU. Four items are
**partial** and are called out explicitly: the WebGPU/WebGL2 paths are not executed in a browser,
the Blender base codes are reproduced only in outline, repair priority 3 (code structure) is not
automated, and the validation harness does not itself execute the emitted `design.ts`.

## How to reproduce

```bash
npm test                                   # 53 node:test cases (topology, geometry, intent, repair, expr, program, viewer, pipeline)
npx tsc --noEmit -p tsconfig.json         # type check
node --experimental-strip-types --no-warnings scripts/selftest.ts    # 64 checks, writes artifacts/selftest/report.json
node --experimental-strip-types --no-warnings scripts/pipeline_bench.ts 48   # 320 prompts through the full chain
npm run build:web                          # dist/web bundle (served by npm run serve)
```

Evidence files: `artifacts/selftest/report.json`, `artifacts/pipeline_benchmark/{summary,rows}.json`,
`artifacts/<design>/design.ts` (copy-executable; each prints its metrics), `artifacts/<design>/*.design.json`.

## 1. Requirement checklist

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| R1 | Reproduce the Bioinspired123D pipeline (IntentHarness → TopologyHarness → GeometryHarness → ValidationHarness → RepairHarness → ExportHarness) | Done, with deviations | `src/pipeline.ts`; full-chain sweep: 320/320 prompts, 0 exceptions, all six harnesses ok for 320/320 (`artifacts/pipeline_benchmark/summary.json`) | Blender is not used. IntentHarness is rule-based (EN + ZH), not an LLM, so the paper's 60 % accuracy is not reproduced or compared. Keyword coverage in `npm run benchmark` is tautological and is not an accuracy figure. |
| R2 | 12 bio base-code families ported (helical ×4, cellular ×4, tubular ×4) | Done (parameters ported, geometry approximated) | `src/bio/catalog.ts`, `src/bio/families.ts`; selftest helical/tubular/cellular rows | Helical plies are slab-centred and fuse into one solid. The tubular cortex fuses with the matrix (no annular sleeve). Voronoi uses an analytic F3−F1 strut field, not Blender fracturing. |
| R3 | Lattice types: Simple Cubic, BCC, FCC, Diamond, Gyroid, Schwarz P, Schwarz D, FBCC | Done | `src/topology/lattice.ts` (`sc`, `bcc`, `fcc`, `fbcc`, `diamond`, `gyroid`, `schwarz_p`, `schwarz_d`); selftest "lattice *" and "tpms *" rows, all pipeline ok | Other LatticeQuery types were not ported. Diamond = 16 bonds. Schwarz D uses a sum-of-products approximation. FBCC = BCC + FCC + vertical z-edges. |
| R4 | Heterogeneous thickness and porosity as a function or SDF field (LatticeQuery `heterogeneous_lattice` style) | Done for lattice and TPMS | `src/topology/heterogeneous.ts`; rules `linear`, `sin`, `parabola`, `expr`; selftest "heterogeneity *" rows (1879–4157 mm³) and "porosity target" (2 repairs) | The `sin` rule uses a normalised phase sin(2πu), which differs from LatticeQuery's raw-index form. Bio families ignore `heterogeneity_field` (disclosed in the spec). |
| R5 | `thickness(u) = expr` user law | Done | `src/expr/expr.ts` (tokenizer, parser, finite-on-probe-grid check, clamp to [min, max]); `tests/expr.test.ts`; `tests/pipeline.test.ts` | Parse accepts a trailing `along z` clause. Non-finite laws such as `1/u` are rejected at u = 0. |
| R6 | Porosity target as a design parameter | Done | `src/repair/repair.ts` (priority-1 action scales strut radius or sheet thickness); porosity test in `tests/pipeline.test.ts` (target 0.80 → measured 0.808 after 2 accepted rounds) | Porosity is measured from the solid fraction (1 − volume fraction) on the validation grid. |
| R7 | Feature timeline ops: boolean, fillet, shell, offset, loft, sweep, heterogeneous thickness | Done (see §2) | `src/program/{types,brep,sdf,index}.ts`; `tests/program.test.ts` (17 tests) and `tests/expr.test.ts` (6 tests); selftest "per example program" | Executed twice: exact B-Rep (smlibwasm) and SDF. Chamfer is excluded (an unresolved mismatch with the hand estimate, see §4). |
| R8 | Every harness returns `observations`, `limitations`, `unknowns`, `evidence` | Done | Selftest checks every harness report in every family (64/64 checks); `tests/pipeline.test.ts` checks the four fields on each report | `evidence` carries reproducible parameters, the SDF expression or the code snippet. |
| R9 | Strict DesignState: `prompt`, `design_spec`, `code`, `metrics {volume, surface_area, min_wall_thickness, connectivity, genus}`, `render_preview`, `repair_history`, `limitations`, `unknowns` | Done | Selftest asserts the exact key set for every family; `artifacts/*/*.design.json` | `design_spec` also carries `family`, `variant`, `confidence`, `retrieval`, `notes`. `center_of_mass` and the other extra metrics are in the validation metrics, not in the strict five. |
| R10 | `design_spec` includes topology (tubular / helical / cellular / lattice / tpms / hybrid), bio_motif, parameters, heterogeneity_field, target_metrics, constraints | Done | `artifacts/gyroid_repair/gyroid_repair.design.json` (`topology: "tpms"`, `bio_motif: "tpms:gyroid"`, `heterogeneity_field`, `target_metrics`, `constraints`) | |
| R11 | ValidationHarness returns volume, surface_area, center_of_mass, min_wall_thickness, connectivity, genus, low-res preview | Done | `src/validation/validate.ts`; emitted `design.ts` prints the same metrics; `render_preview` in DesignState | Wall thickness is the 5th percentile of inward-ray chords; the absolute minimum is reported alongside it. |
| R12 | Validation runs the generated code in a CPU Worker | **Partial** | Web app: `web/worker.ts` runs the whole pipeline in a Worker. CLI and tests: in-process. The emitted `design.ts` was executed as a separate process and reproduced the volume exactly for all six artifacts. | The ValidationHarness does not itself execute the emitted file. |
| R13 | RepairHarness: up to 5 rounds against validation feedback; priority parameters → topology parameters → code structure; full repair_history | Done for priorities 1–2 | `MAX_REPAIR_ROUNDS = 5`; `artifacts/gyroid_repair` (2 accepted rounds: 0.20→0.32→0.43 mm, p5 wall 0.209→0.311→0.411 mm); helical default plies no longer repaired after the occupancy fix (§3) | Priority 3 is reported as a limitation when reached, not automated. Each round changes one parameter (greedy, no search). |
| R14 | ExportHarness: parametric JSON, STL, STEP (if supported), glTF, WebGPU-loadable mesh | Done | `src/export/export.ts`; `artifacts/rounded_hollow_box/` (JSON, STL, STEP, glTF, `.webgpu.vertices.bin`, `.webgpu.indices.bin`); `artifacts/helix_demo/` likewise | STEP is produced only for B-Rep designs (helical, tubular, B-Rep programs). Exported STEP files were not re-imported into another CAD tool. |
| R15 | Copy-executable parametric code (TypeScript or Rust macros) | Done (TypeScript) | `artifacts/*/design.ts`; each was executed and reproduced its reported volume (see §5) | Rust macros are not generated. Every `design.ts` imports `evaluateSpec` and embeds the design spec as constants. Program designs embed the feature-program JSON in the spec, so the timeline runs through the same entry point. |
| R16 | Default printable wall floor 0.4 mm (accepted amendment) | Done | `DEFAULT_MIN_WALL_MM = 0.4` in `src/intent/intent.ts`; gyroid_repair triggers repair at p5 0.209 mm < 0.4 mm | |
| R17 | Kernel: smlibwasm for exact B-Rep (priority a); SolidCraft-style timeline (b); SDF evaluator for TPMS/FRep (c) | Done | B-Rep: helical, tubular, program ops. SDF: lattice, TPMS, cellular, hybrid. Timeline: `src/program/*`, implemented in TypeScript on top of smlibwasm. | Surface nets (a dual method) is used for meshing. It is not dual contouring and has no feature preservation. |
| R18 | Rust/WASM SDF kernel | Replaced (amendment) | TypeScript SDF kernel. Rust toolchain unreachable (`static.rust-lang.org`, `sh.rustup.rs`). | Accepted by the user. |
| R19 | SolidCraft / SolveCraft parametric timeline | Not used; repository named | The timeline here is our own TypeScript implementation. No SolidCraft code was built or used. | The correct repository is **github.com/bherbruck/solidcraft** (Rust desktop CAD with a parametric timeline; read only, not built or used here). |
| R20 | Fully local: no cloud APIs, no Blender, no external servers, no non-local resources | Done | `grep -rn "fetch(\|XMLHttpRequest\|WebSocket\|https\?://" src web scripts` finds no runtime network calls; smlibwasm is served from `dist/web/vendor/` | |
| R21 | All functions tested in CPU-only mode | Done | `npm test` 53/53; selftest 64/64; 320-prompt sweep | |
| R22 | Web app: WebGPU → WebGL2 → CPU fallback | **Partial** | `chooseBackend` tests (`tests/viewer.test.ts`, 4 cases, incl. forced CPU); bundle built; worker executed under Node with the built code | No browser exists in the sandbox, so WebGPU and WebGL2 rendering were not executed. |
| R23 | Review of the full feature checklist (this document plus test evidence) | Done | this file | |

## 2. Timeline operations (feature programs)

Each op was checked against an analytic value (exact B-Rep) and against the SDF path.

| Op | Check | Result |
|---|---|---|
| `box` | volume of a 20 mm cube | 8000 (exact) |
| `cylinder` | through-hole cut removes π r² h | tested (`tests/program.test.ts`) |
| `sphere` | — | exists in the op set; no dedicated test yet (covered only indirectly through SDF primitives) |
| `boolean` union / intersect | inclusion–exclusion on overlapping boxes | tested |
| `boolean` cut | through-hole volume | tested (cylinder cut) |
| `fillet` (all edges, r = 2 on a 20 mm cube) | analytic | 7804.696 (smlibwasm) |
| `shell` (open top, t = 2) | analytic | 3392 (open), 3904 (closed) |
| `offset` (+1 / −2 on a 20 mm cube) | analytic | 10648 / 4096 |
| `loft` (ruled, similar sections) | Simpson integration of the section area (the closed form applies only to similar sections) | tested |
| `sweep` (circular profile on a polyline) | analytic | tested |
| `graded_shell` (heterogeneous wall, thickness 0.6 + 1.4u, 8 slices, open top) | independent Python value | 3169.45 (matches) |
| Example programs (B-Rep vs SDF volume) | `rounded_hollow_box` 2860.062 (−0.02 %), `graded_wall_box` 3169.450 (−0.00 %), `loft_sweep_stem` 2570.046 (−0.36 %), `offset_plate` 1848.000 (−0.11 %) | selftest, all within 1.5 % |

Limitations of the timeline:
- `fillet` in the SDF path is exact only for box-family targets. Non-box targets are approximations.
- `offset` in the SDF path is `f − d` (rounded corners). The B-Rep offset is mitred. The two differ at corners.
- `shell` after `fillet` with an open face fails in the kernel (SM_ERR) even at r = 1, t = 1.5. Use a closed shell after fillet, or shell first. This is a kernel limitation.
- `loft` sections must have strictly increasing z. An undefined section throws.
- `chamfer` is not exposed (see §4).

## 3. Fixes found during the audit

| Area | Problem | Fix | Evidence |
|---|---|---|---|
| Occupancy (`src/geometry/grid.ts`) | Strict `f < 0` split touching plies at a node plane, giving a false two-component helical and an unnecessary 10→9 ply repair. | Closed-set rule: a node is solid if `f ≤ 1e-9·h`. | Helical default now 1 component, genus 0, wall 4.00 at res 48/96/128, 0 repairs. Regression test in `tests/topology.test.ts`. |
| Slivers (`grid.ts`, `validate.ts`) | A 2-voxel sliver on the build boundary counted as a second component and triggered an unnecessary thickening. | Only components of ≥ 27 nodes (`SIGNIFICANT_VOXELS`) count; slivers are reported as an observation and a limitation. | Sandwich at res 96: 1 component, 0 repairs. Regression test in `tests/topology.test.ts`. |
| Expression law | Non-finite laws (e.g. `1/u`) were accepted. | `compileExpr` probes the law on a grid and rejects non-finite values; output is clamped to [min, max]. | `tests/expr.test.ts`. |
| Porosity metric | Porosity needed to be a measured quantity that repair can target. | Reported from the validation grid as 1 − volume fraction; the repair loop targets this value. | Porosity test (0.808 for target 0.80). |
| Heterogeneity range under repair | When a repair thickens a heterogeneous lattice, the min/max range must move with the base radius. | Repair actions for radius and thickness parameters set `scalesHetero`, so the range is scaled with the base value. | Selftest "heterogeneity expr" (827.4 mm³) and the porosity repair. |
| Trailing clause parsing | `thickness(u) = … along z` absorbed "along z" into the expression. | `extractProfileExpression` returns the longest compiling prefix and the rest as `rest`. | `tests/pipeline.test.ts`. |
| Program JSON | The generated code had to carry the feature program so that it can be re-run. | `emitParametricCode` writes the program JSON into `design.ts` as a constant and passes it in the spec. | `artifacts/rounded_hollow_box/design.ts` reproduces 2860.062. |
| Viewer backend | No way to force a backend for CPU verification. | `chooseBackend(env, force?)` and `createViewer(canvas, mesh, force?)`; `?backend=cpu` in the page. | `tests/viewer.test.ts`. |
| Emitted code location | Code written two levels too shallow failed to import `../../src`. | Output directory fixed to `artifacts/<name>/`. | Selftest 30/30 before the report-field checks. |

## 4. Open items and unresolved questions

- **Chamfer**: smlibwasm `chamfer(2)` on a 20 mm cube gives 7562.67, not the hand estimate 7605.33. Unresolved, so chamfer is excluded from the timeline.
- **Wall-limit text**: the limitation strings say "features below ~2h are not resolved" (`src/geometry/index.ts`) and "under-resolved below 3h" (`src/validation/validate.ts`). An earlier note asked for about 0.1h. That was not confirmed and has not been changed.
- **Helical wall metric**: the plies are fused into one solid, so the ray-chord wall estimate measures the block (about 16 mm for 5 plies), not one ply (about 4 mm).
- **Genus** depends on resolution. The sandwich design gives genus 8 at res 96 in the current run.
- **TPMS absolute wall** is junction-dominated (about 1.2h), so the reported metric is p5.
- **Regular-grid lattice volume** aliases for thin struts. Use grid ≥ 120³ or a seeded Monte Carlo check.
- **Gyroid at 0.2 mm** is sub-voxel at res 64. Use res ≥ 96. The ASCII STL at res 96 is about 200 MB, so mesh exports go to `OUT_DIR` outside the workspace.
- **Benchmark accuracy**: not measured. Only intent coverage was measured.
- **Full-chain sweep** runs at res 48, which is coarse. Walls are reported at that resolution.

## 5. Artifact checks

Each regenerated `artifacts/<name>/design.ts` was executed with `node --experimental-strip-types` and printed the same volume as the pipeline:

| Artifact | Pipeline volume (mm³) | `design.ts` volume (mm³) | Repairs |
|---|---|---|---|
| `gyroid_repair` (res 96) | 2482.846 | 2482.846 | 2 accepted |
| `helix_demo` (res 96) | 7165.920 | 7165.920 | 0 |
| `tubular_demo` (res 96) | 7638.089 | 7638.089 | 0 |
| `sandwich_demo` (res 96) | 6435.743 | 6435.743 | 0 |
| `bcc_graded` (res 96) | 2859.747 | 2859.747 | 0 |
| `rounded_hollow_box` (res 96) | 2860.062 | 2860.062 | 0 |

Meshes too large for the workspace (gyroid STL, sandwich and BCC meshes) were written to `/tmp/work/meshes/` and are not in the repository.
