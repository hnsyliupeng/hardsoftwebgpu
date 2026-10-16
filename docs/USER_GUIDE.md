# User guide

This project generates bio-inspired, lattice, TPMS, and fused structures from a text prompt or a JSON
feature program. It checks each result (validation and repair) and exports it. Everything runs locally on
the CPU. No cloud service and no network are needed at run time.

Read `docs/GRAPH_EXAMPLES.md` for the eight graph examples, and `docs/SPEC_GAP_REPORT.md` for what is
not yet implemented. Results marked **field-based (non-exact)** are implicit-field models, not exact B-Rep.

## 1. Install and check

Requirements: Node 22.18 or later. Type stripping runs the `.ts` scripts directly.

```bash
npm ci                       # installs locked dependencies (incl. @classcad/smlibwasm)
npm test                     # 100 node:test cases
npm run typecheck
```

## 2. Generate a design from the command line

```bash
npm run run -- "gyroid TPMS wall thickness 0.2 mm, 4 mm cell" gyroid_repair 96
npm run run -- --program rounded_hollow_box rounded_hollow_box 96
```

Arguments: `"<prompt>" [name] [resolution]`, or `--program <example | file.json> [name] [resolution]`.
Outputs go to `artifacts/<name>/`. The output includes `<name>.design.json` (DesignState, with metrics and
`repair_history`), `design.ts` (copy-executable parametric code), and the mesh and export files in a subfolder. Re-run the code with:

```bash
node --experimental-strip-types artifacts/gyroid_repair/design.ts
```

## 3. Use the web app

```bash
npm run build:web            # bundles dist/web (esbuild, no network)
npm run serve                # serves dist/web on http://0.0.0.0:5173
```

The page has these parts:

- **Prompt or program.** Type a prompt (English or Chinese), or pick a feature program (JSON). The example
  buttons fill the prompt or program.
- **Size, resolution, max repairs, minimum printable wall.** These feed the pipeline. Resolution sets the
  grid for the model and the preview.
- **Generate.** Runs the pipeline in a Web Worker and shows the model in the viewer, with the metrics table,
  the downloads, the timeline, `repair_history`, limitations, unknowns, the parametric code, and the
  DesignState JSON.
- **Structure graph.** An editable JSON graph (source → transforms → structure) with Apply, Undo, and Redo.
  Each valid edit is one undo step; invalid edits are rejected with the reason. The compiled expression is
  shown. Below it, sliders change the scalar parameters (cell size, radius, slope, angle, clip radius, …);
  each slider release is one undo step.

Note: the graph panel edits and compiles graphs. It does not mesh them. To see a graph as a model, render it
from the command line (section 5).

## 4. Read the metrics

- **Volume and area.** From the mesh, with signed-tetrahedra integrals.
- **Floating components.** Count of disconnected pieces. A result with more than one component is a warning,
  and `removeFloatingComponents` may drop small pieces (the removed volume is reported).
- **Minimum wall.** Two estimates: the inward-ray chord (P5) and the design wall (2·r for strut lattices).
  Open designs exclude samples near envelope faces (`excludedNearFaces` is not yet in the metrics).
- **Repair history.** Each repair round lists what changed and why. Repairs can change strut radius or
  shell thickness. They cannot change deep-fusion parameters.
- **Monte Carlo agreement.** Where reported, a second volume estimate; a disagreement above a few percent
  means the grid is too coarse.

## 5. Make and view high-resolution renders

Graph examples (field-based):

```bash
node --experimental-strip-types scripts/graph_check.ts presets/<name>.json <res>
node --experimental-strip-types scripts/render_graph.ts presets/<name>.json <res> examples/graph_presets
```

Fine structure set (1600 px, cut-away, four views):

```bash
node --experimental-strip-types scripts/render_fine.ts 256 1000000 examples/fine_256 sc gyroid schwarz_p
```

Exact B-Rep strut lattice (SC only so far; prints a JSON record):

```bash
node --experimental-strip-types scripts/exact_lattice.ts sc 20 4 0.4 0.02
```

Export one structure to GLB:

```bash
node --experimental-strip-types scripts/export_glb.ts gyroid 96 out/gyroid.glb 1000000
```

## 6. Checks and benchmarks

```bash
node --experimental-strip-types scripts/selftest.ts       # CPU self-test; writes artifacts/selftest/report.json
node --experimental-strip-types scripts/pipeline_bench.ts 48
npm run benchmark                                          # intent routing over 320 prompts (keyword coverage)
```

The benchmark checks routing to the expected bio family, not geometry quality.

## 7. What the tool does not do (yet)

- **Exact models for most lattices.** SC at L = 20 is exact. BCC and diamond are exact only at L = 8; a single
  Kelvin cell is exact, but multi-cell Kelvin builds fail. FCC, FBCC, BCCZ, and all TPMS are field-based.
- **Closed skins are not produced.** Clip and trimming leave open edges (by design).
- **Fusion is deep only in the field path.** Several shallow fusion entries are still boolean unions.
- **Prompt routing.** Cross-domain prompts produce one family, not a fusion. General non-bio prompts are
  forced into a bio family with low confidence (0.25).
- **Helical plate.** The plate notches are documented, not removed.
- **Conformal mapping (C1) and fractal tiling (C2)** are not implemented.
- **Browser click-through of the graph panel** has not been run in this environment.

## 8. Where things are

- `artifacts/` — pipeline outputs (generated, not committed).
- `examples/` — committed renders and records, with README notes for each set.
- `presets/` — structure-graph JSON files.
- `docs/` — specifications, status, and guides (`TASK_PLAN.md` lists the status of each step).
