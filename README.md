# hardsoftwebgpu — Bioinspired123D-WASM

A local, CPU-verifiable reproduction of the *Bioinspired123D* generation pipeline
(arXiv 2603.29592), extended with lattice and TPMS structures. Everything runs locally:
no Blender, no Python servers, no cloud LLM, no network at run time.

Pipeline (multi-harness): `IntentHarness → TopologyHarness → GeometryHarness → ValidationHarness → RepairHarness → ExportHarness`.
Every harness returns `observations`, `limitations`, `unknowns` and `evidence`.

## Quick start

```bash
npm install            # Node >= 22.18 (type stripping is used for .ts scripts)
npm test               # 53 node:test cases (topology, geometry, intent, repair, expr, program, viewer, pipeline)
npm run typecheck
npm run run -- "gyroid TPMS wall thickness 0.2 mm, 4 mm cell" gyroid_repair 96
npm run run -- --program rounded_hollow_box rounded_hollow_box 96   # feature timeline example
node --experimental-strip-types artifacts/gyroid_repair/design.ts   # re-run the parametric code
node --experimental-strip-types scripts/selftest.ts                 # 64 CPU checks (artifacts/selftest/report.json)
node --experimental-strip-types scripts/pipeline_bench.ts 48        # 320 prompts through the full chain (CPU)
npm run benchmark      # IntentHarness over eval/benchmark.csv (320 prompts; keyword coverage only)
npm run build:web && npm run serve   # web app on http://0.0.0.0:5173
```

## What is where

| Area | Files |
|---|---|
| Intent (rule-based, EN + ZH) | `src/intent/intent.ts`, `src/intent/retrieval.ts` |
| 12 bio base structures (ported parameter ranges) | `src/bio/catalog.ts`, `src/bio/families.ts` |
| Lattice / TPMS / heterogeneity (LatticeQuery formulas) | `src/topology/lattice.ts`, `src/topology/heterogeneous.ts` |
| Exact B-Rep (smlibwasm) | `src/geometry/brep.ts` |
| Feature timeline (box, cylinder, boolean, fillet, shell, offset, loft, sweep, graded shell) | `src/program/*` |
| Expression law `thickness(u) = …` | `src/expr/expr.ts` |
| Programmatic entry point | `src/api.ts` (`runDesign`) |
| SDF sampling, surface nets, voxel topology | `src/geometry/grid.ts`, `src/geometry/index.ts` |
| Validation, wall thickness by inward rays, preview | `src/validation/*.ts`, `src/render/preview.ts` |
| Repair loop (≤ 5 rounds, full history) | `src/repair/repair.ts` |
| Exports (JSON, STL, glTF, STEP, WebGPU buffers) | `src/export/export.ts` |
| Parametric TypeScript code | `src/codegen/emit.ts` |
| Web app (worker + WebGPU → WebGL2 → CPU preview) | `web/*` |

## Geometry kernels

1. **smlibwasm** (`@classcad/smlibwasm` 0.2.3, exact NURBS): helical and tubular families → volume, area, centre of mass, STEP.
2. **SDF + surface nets** (TypeScript, WASM-free): lattices, TPMS, cellular/Voronoi, and hybrids. Used for validation topology for every design.
3. **Feature timeline**: implemented here in TypeScript on top of smlibwasm (exact B-Rep) and the TypeScript SDF path (cross-check). It is our own implementation, not SolidCraft's code. The SolidCraft repository (a Rust desktop CAD app with a parametric timeline; also called SolveCraft) is **github.com/bherbruck/solidcraft**. It was read for reference only and was not built or used.
4. The Rust/WASM SDF kernel was replaced by the TypeScript SDF kernel (amendment: the Rust toolchain is unreachable in this sandbox).

See `docs/FEATURE_AUDIT.md` for the full requirement checklist with evidence.

## Metrics

`min_wall_thickness` is the 5th percentile of inward-ray chords through the SDF, not the absolute minimum
(the absolute minimum is reported as `min_wall_thickness_absolute`). See the limitations below.

## Known limitations (summary — the full list is in every DesignState)

- IntentHarness is **rule-based**, not an LLM. Benchmark "accuracy" (`npm run benchmark`) is keyword-family coverage only.
- Multi-family prompts generate only the first family. Whole-object rotate/scale is detected but not applied.
- Bio families ignore `heterogeneity_field` (disclosed per design).
- Base-code deviations from upstream Blender: plies in helical plates are slab-centred and fuse into one solid; the tubular cortical sleeve fuses with the matrix, so the minimum wall is the matrix bridge between holes.
- TPMS sheets use the first-order distance |F|/|∇F| − t/2; the absolute wall minimum is junction-dominated.
- SDF resolution is capped by `constraints.resolution` (default 96, h ≈ 0.21 mm for 20 mm); walls below ~3h are reported as under-resolved.
- Genus is the first Betti number of the voxel solid and depends on resolution.
- STEP is only produced for B-Rep designs (helical, tubular).
- The web app's WebGPU and WebGL2 paths were type-checked and bundled but **not executed in a real browser** (no browser in the sandbox). The worker pipeline was executed from the bundle under Node, including the smlibwasm kernel.
- Heavy mesh exports (e.g. the 846k-triangle gyroid, ~90 MB across formats) are written where `OUT_DIR` points.
- Validation does not execute the emitted `design.ts`. The web app runs the pipeline in a Worker; the CLI runs it in-process. Each `design.ts` was executed separately and reproduced its volume.
- The ray-chord wall estimate measures the solid. Fused helical plies therefore report the block thickness, not one ply.
- The 320-prompt full-chain sweep (`scripts/pipeline_bench.ts`) runs at resolution 48. All 320 designs passed every harness with connectivity true.

## Attribution

Parameter ranges and base-code semantics come from `lamm-mit/Bioinspired123D` (Apache-2.0; see
`eval/LICENSE.Bioinspired123D.txt`). Lattice / TPMS formulas are ported from `jalovisko/LatticeQuery`
(formulas only; its headers claim ADML ownership, so no code was copied). The kernel is
`@classcad/smlibwasm` (SMLib, with NVIDIA usd-brep lineage).

## Coupled bio-lattice (exact B-Rep, editable STEP)

A second, high-resolution path built with CadQuery / OpenCASCADE: a 2 mm closed skin, a twisted BCC lattice core, and three depth-graded strut radii. See `docs/COUPLED_LATTICE.md`. Outputs are in `examples/coupled_bio_lattice/`, and the web app's "Coupled bio-lattice" mode loads them.

```
bash scripts/python_env.sh
LD_LIBRARY_PATH=.venv/stubs .venv/bin/python -m unittest discover -s python/tests -p "test_*.py"
```
