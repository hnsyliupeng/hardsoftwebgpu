# Gap report: Bioinspired Metamaterials WebGPU app spec vs. current repository

Date: 2026-10-16. Branch: arena/fd777792-hardsoftwebgpu. Measured on `b50b6a5`.

## What exists

| Area | Status | Where |
|---|---|---|
| Bioinspired families (12 base codes, routing) | Implemented, 270/270 single-family routing | `src/bio/`, `docs/bioinspired_comparison.json` |
| Lattices (SC, BCC, FCC, FBCC, Diamond, BCCZ, Kelvin) | Field-based (SDF) | `src/topology/lattice.ts` |
| TPMS (Gyroid, Schwarz P/D, Neovius, IWP, Lidinoid, Fischer-Koch S, Split P) | Field-based | `src/topology/lattice.ts` |
| Deep coupled fusion (field-level) | Implemented (R1-R5) | `src/topology/deep.ts`, `coupled.ts` |
| Validation + repair harness | Implemented | `src/validation/`, `src/repair/` |
| Export | STL, STEP (via smlibwasm), USD(Z) partial | `src/export/` |
| WebGPU viewer | Present, WebGPU -> WebGL2 -> CPU fallback | `web/viewer.ts`, `web/main.ts` |
| Density gradient / torsion / twist | Partial (heterogeneity field, twist in deep.ts) | `src/topology/heterogeneous.ts`, `deep.ts` |
| Exact B-Rep (OpenCASCADE via CadQuery) | Exact at 20 mm: SC, BCC, FCC, BCCZ, diamond, Kelvin, FBCC (7 types), and the deep design R8. TPMS not exact. | `python/exact/`, `examples/exact_lattices_L20/`, `docs/exact_lattice_status.json` |

## What is missing (spec section)

| Spec item | Gap |
|---|---|
| 3.1 Fractal structures | None (0 hits) |
| 3.1 Hierarchical / multi-scale | Partial: 2 mentions, no general multi-level graph |
| 3.2 Conformal mapping | None (0 hits) |
| 3.2 Arbitrary surface mapping | None |
| 3.2 Rotation along a path, local non-rigid deformation fields | None |
| 3.2 Function-driven density, general SDF/scalar input | Partial (fixed heterogeneity rules) |
| 3.3 Multi-material / multi-region | None |
| 3.4 Live preview, sections, measurement, LOD / instancing / compute shaders | Viewer exists; no compute-shader generation, no LOD |
| 3.5 GLB / GLTF export, parameter file export | GLB 0 hits; parameter file partial |
| 5.1 Serializable structure graph, undo/redo, presets | Design model is JSON (DesignState); no graph editor, no undo/redo |
| 5.2 Expression trees hot-reloaded | `src/expr` exists; not wired to the UI |
| 6.1 microgen comparison | Not cloned or analysed (no microgen hits) |
| 6.1 Repo analysis reports for usd-brep, smlibpy, LatticeQuery, cadquery | Partial (earlier notes in session memory; no formal report in repo) |
| 7 Performance benchmark at 1e5-1e6 faces | Not measured |
| 8 Docs: user + developer docs, 8-10 examples | README exists; examples exist (structure gallery, 38 entries) |

## Blocking issue for "all lattices and TPMS exact"

The earlier SMLib route was robust only for SC at 20 mm (its failures and jitter tests are in `docs/EXACT_LATTICES.md`). The OpenCASCADE route builds the seven plain types at 20 mm; FBCC needed a per-cell build with a fuzzy fuse tolerance. TPMS has no closed-form B-Rep and would need NURBS approximation or a high-resolution mesh.

## Proposed phasing

- Phase A (near term): high-resolution field meshing for all lattices and TPMS (512 to 640 cells on WebGPU compute or in the Worker), GLB and OBJ export, multi-view renders, and validation of volume against the exact SC reference.
- Phase B: structure graph (JSON DSL) with undo/redo and presets; function nodes for density, torsion, rotation and deformation; multi-material regions.
- Phase C: conformal and surface mapping; fractal and hierarchical generators; infill.
- Phase D: performance work (instancing, LOD, compute-shader generation) and benchmarks.
- Phase E: exact B-Rep for the remaining lattice types, if the kernel can be made robust, or a CadQuery/OCC backend.
