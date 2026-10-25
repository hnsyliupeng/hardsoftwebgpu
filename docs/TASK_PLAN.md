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
| B-exact | partial: exact OpenCASCADE B-Rep (python/exact/, CadQuery 2.8, layer mode: one boolean per z-layer; cell mode for FBCC: per-cell fuse with fuzzy 1e-4 mm, then layer union). Done and rendered at L = 20 mm, cell 4 mm, r 0.4 mm: SC 663.473, BCC 1427.713, FCC 1695.565, BCCZ 1599.111, Diamond 1427.399 (4 slivers removed), Kelvin 1649.866, FBCC 2956.604 mm³ (per-cell build) (examples/exact_lattices_L20/, each valid, one solid, watertight mesh). Deep design R8 (BCC, radius from gyroid, ruled-loft struts): 1775.615 mm³, Monte Carlo agrees within 1.5σ (examples/exact_deep_L20/r8_radius_gyroid/). Not exact: TPMS types and R1–R7, R9–R12 (TPMS sheets or closed skins). Field values differ from exact by 0.02–5 % because strutLattice uses only the 5³ cell block. STEP files are in artifacts/ and not committed. |
| B1 | done: structure graph schema, validation, compile (src/graph/graph.ts, tests/graph.test.ts). See docs/STRUCTURE_GRAPH.md |
| B2 | done (editor and panel): undo/redo over snapshots (src/graph/history.ts), editor controller (src/graph/editor.ts, tests/editor.test.ts, 3 tests), panel in the web app (web/graphPanel.ts, Structure graph section). Presets save/load in presets/. Browser click-through not run (no browser in the sandbox); build and served markup checked |
| B3 | done: rotate, bend, stretch, shear (Lipschitz-normalised); linear, radial, polynomial, noise and safe expression offsets (src/graph/expr.ts, no eval; tests/expr.test.ts) |
| E1 | done (drafted; second-reader review pending): docs/USER_GUIDE.md, docs/DEVELOPER_GUIDE.md, docs/ARCHITECTURE.md (Mermaid, checked imports; diagrams not rendered in a Mermaid viewer here). README links to all guides. Not yet reviewed by a second reader |
| E2 | done: source reports and licence table (docs/SOURCE_REPORTS.md), licences checked via GitHub API, PyPI and npm this session. Corrects the earlier LatticeQuery 'conflict' note (Apache-2.0). microgen is GPL-3.0: concept reference only. CadQuery licence still to confirm (NOASSERTION on GitHub) |
| E3 | partial: eight field-based graph examples in examples/graph_presets/ (README labels them non-exact), each combining transforms. Written guide per example in docs/GRAPH_EXAMPLES.md (chain, numbers, commands). Not a user guide (E1) |
| D1 | partial: parameter sliders bound to the graph (src/graph/params.ts, tests/params.test.ts, web/graphPanel.ts). Ranges per parameter; integer parameters rounded; each release is one undo step. Expression input is the expr node text in the JSON, not a separate box. Browser click-through not run |
| C3 | partial: open graded infill: clip transform (sphere/box, f' = max(f, sd), no closed skin) with radial grading, presets/graded_infill_sphere.json, tests/clip.test.ts. Closed shell infill not done (no-skin rule). See docs/STRUCTURE_GRAPH.md |
| C2 | partial: hierarchical SC (union of levels, presets/hierarchical_sc.json); fractal cube skeleton with recursive corner-subcube substitution, depth 1..3 (src/graph/fractal.ts, tests/fractal.test.ts, presets/fractal_cube_d3.json). Tiling of the fractal cube (`tiles` 1..4, `fractal_tiled_d2`, tests) done, volume not converged to 1 % (see STRUCTURE_GRAPH). Other generators and non-cubic tilings not done. See docs/STRUCTURE_GRAPH.md |
| C1 | partial: cylinder projection (wrap), angle-preserving log-polar conformal map (`conformal_log`, 5 tests), and closed-form Möbius conformal map (`mobius`, 8 tests, `presets/sc_mobius.json`; volume checked by Jacobian-weighted Monte Carlo to 0.75 %). `conformal_log` Lambda now uses max(1, sup) (z-direction fix; shipped output unchanged). Not done: discrete harmonic map on arbitrary parameter planes, general surface projection. See docs/STRUCTURE_GRAPH.md |
| A1 | done: sparse sampler matches dense volume (SC, gyroid at 256). Saving 39% for SC, ~0% for TPMS. See docs/SPARSE_SAMPLING.md |
| D2 | partial: instanced SC field (src/topology/instanced.ts, 5 tests), WGSL compute kernel generated from the same table (parsed with wgsl_reflect, not run on a GPU), GPU runner with CPU fallback (web/compute/scField.ts), LOD table (eval/lod_table.csv: 50k triangles at volume err 0.045 %). Viewer does not call the compute path. See docs/COMPUTE_LOD.md |
| D3 | partial: CPU sections (src/geometry/section.ts, half-open crossing, oriented segments), measurement (measure.ts), icosphere benchmark at 82k / 328k / 1.3M triangles (eval/section_bench.csv, errors 0.0005–0.008 %), 5 tests. Viewer panel added (plane, outline, area, volume; compiled, not browser-checked). Design-mesh benchmark done (3 closed sphere-clipped designs, 76 k–1.9 M triangles, 0 open edges; section error −0.9 % to −5 % at the highest resolutions, graded design under-resolved). See docs/SECTIONS.md |
| A5 | non-manifold edges (docs/NONMANIFOLD.md): 0 in each part alone. Fused designs now meshed with manifold dual contouring (src/geometry/dualcontour.ts; user decision): gyroid+BCC 3897 → 135 non-manifold edges at 96; diamond+Lidinoid 7092 → 483 at 96, 588 at 256. Residual sub-voxel pinches not resolved. Six A5 fused and five open-256 fused entries regenerated (all PASS, volumes within 0.6 %); closed 96/192 fusion records still surface nets. Flat-face check: flat box-face patches are foam/TPMS walls cut by the box, not a skin (scripts/flat_face_test.ts) | done: resolution sets kept separate: 96 cells in examples/structure_gallery_96/ (31 entries, restored from 853972d; closed skins, exterior views removed), 192 in examples/structure_gallery/ (36, closed skins, exterior views removed), 256 open in examples/structure_gallery_256/ (38) and mixed open in examples/structure_gallery_256_mixed_open/ (11). 11 mixed entries re-run open at 256 (SKIN=0), 11/11 PASS, 4 views each, examples/structure_gallery_256_mixed_open/. Field-based, not exact B-Rep. deep_R2 flat faces: solid matrix by design (scripts/check_r2_matrix.ts). Render check of the nine (see README). fusion_gyroid_plus_helical replaced by fusion_gyroid_plus_bcc (gyroid union BCC lattice, user-chosen open partner; 3374.646 mm³, 1 component, PASS; render inspected). Helical version superseded (faces 0.96–0.97). No numeric open criterion (user decision: judge by renders). Rim sawtooth: geometric (periodic TPMS sheet cut by the box; gyroid cell 5 mm, half-cell 2.5 mm, measured peaks 2.44–2.47 mm; scripts/rim_period.ts), not a meshing artefact; no fix chosen. Open: flat faces in deep_R5 / bcc_voronoi are foam walls cut by the box, as designed (scripts/face_origin.ts); diamond_lidinoid faces: Lidinoid network cut by the box, not a skin (faces 0.598 vs mid-height 0.544; scripts/face_parts.ts). |
| A3 | done: GLB writer/reader, round trip test, glTF validator 0 errors on display and full meshes. See docs/GLB_EXPORT.md |
| A4 | partial: src/render/cutaway.ts (shared cut-away + supersampled PNG), scripts/render_fine.ts, examples/fine_256 (sc, gyroid, schwarz_p, 1600 px, 4 views). Exact-B-Rep renders: done for six plain lattices and R8 (see row B-exact and examples/exact_lattices_L20/, examples/exact_deep_L20/). |
| A2 | done: benchmark + display budget 1 M triangles (vertex clustering, volume bias <=0.7 %). See docs/MESH_BUDGET.md. Previous note: mesh budget. Triangles grow as res^2 (gyroid 256 = 5.9 M), so decide decimation/LOD before 384/512 benchmarks |
