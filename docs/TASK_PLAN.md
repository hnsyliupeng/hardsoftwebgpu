# Task plan: full Bioinspired Metamaterials app (step by step)

Each step has an acceptance check. A step is done only when its check passes and the result is committed.

## Phase A: fine modelling of all lattices, TPMS and bio-hybrids

- A1. Narrow-band sparse sampler for the SDF path (`src/geometry/sparse.ts`).
      Check: SC and Gyroid at 256 give the same volume as dense sampling (within 0.01 %);
      a 512 run completes and its time is recorded.
- A2. Benchmark table for 256 / 384 / 512 across lattice, TPMS and one bio family (`docs/benchmark.json`).
- A3. GLB export (`src/export/glb.ts`) from the mesh; round-trip read check.
- A4. Multi-view high-resolution renders for the fine set (existing `rasterisePreview`).
- A5. Mixed bio + TPMS + lattice gallery entries at the fine resolution.

## Phase B: structure graph and editing

- B1. Structure graph JSON schema (nodes: structure, field, transform; edges: data flow) with TypeScript types and validation.
- B2. Undo / redo over graph snapshots; preset save / load (JSON files in `presets/`).
- B3. Function nodes: density gradient (linear, polynomial, radial, noise, user expression), torsion, rotation, bend / stretch / shear.

## Phase C: mapping, fractal, hierarchy, infill

- C1. Conformal mapping (2D harmonic map on a parameter plane) and arbitrary surface projection.
- C2. Fractal generator (recursive substructure with scale ratio and depth).
- C3. Multi-level (hierarchical) structures and porous infill inside a shell.

## Phase D: interactive app and performance

- D1. Parameter panel bound to the graph (sliders, expression input).
- D2. WebGPU compute path for field evaluation; instancing for repeated cells; LOD.
- D3. Sections, measurement, benchmark at 1e5 to 1e6 faces.

## Phase E: documentation and examples

- E1. User guide and developer guide; architecture diagram (Mermaid).
- E2. Source analysis reports (Bioinspired123D, microgen, usd-brep, smlibpy, LatticeQuery, cadquery) with licence notes.
- E3. At least 8 examples that combine structures, gradients and mappings.

## Status

| Step | Status |
|---|---|
| B1 | done: structure graph schema, validation, compile (src/graph/graph.ts, tests/graph.test.ts). See docs/STRUCTURE_GRAPH.md |
| B2 | partial: undo/redo over snapshots (src/graph/history.ts) and preset save/load (presets/). UI not yet wired |
| B3 | partial: rotate, bend, stretch, shear (Lipschitz-normalised); linear, radial, polynomial and noise offsets. Expression node not yet done (needs a safe parser) |
| C2 | partial: hierarchical (multi-scale) SC source, union of levels with divisor 2 or 3 (src/graph/graph.ts, presets/hierarchical_sc.json). Recursive substitution not done. See docs/STRUCTURE_GRAPH.md |
| C1 | partial: cylinder projection (wrap transform, constant Lipschitz normalisation, zero-set and Lipschitz tests, render). Conformal harmonic mapping not done. See docs/STRUCTURE_GRAPH.md |
| A1 | done: sparse sampler matches dense volume (SC, gyroid at 256). Saving 39% for SC, ~0% for TPMS. See docs/SPARSE_SAMPLING.md |
| A3 | done: GLB writer/reader, round trip test, glTF validator 0 errors on display and full meshes. See docs/GLB_EXPORT.md |
| A4 | partial: src/render/cutaway.ts (shared cut-away + supersampled PNG), scripts/render_fine.ts, examples/fine_256 (sc, gyroid, schwarz_p, 1600 px, 4 views). Exact-B-Rep renders still pending (see Phase B/exact). |
| A2 | done: benchmark + display budget 1 M triangles (vertex clustering, volume bias <=0.7 %). See docs/MESH_BUDGET.md. Previous note: mesh budget. Triangles grow as res^2 (gyroid 256 = 5.9 M), so decide decimation/LOD before 384/512 benchmarks |
