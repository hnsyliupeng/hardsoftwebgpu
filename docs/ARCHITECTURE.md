# Architecture

Diagrams use Mermaid (renders on GitHub). Module names match `src/` and `web/` at this commit.

## 1. Pipeline (prompt or program → design, checks, export)

```mermaid
flowchart LR
  P[Prompt or feature program JSON] --> I[IntentHarness<br/>src/intent, src/program]
  I --> T[TopologyHarness<br/>src/topology, src/bio]
  T --> G[GeometryHarness<br/>src/geometry]
  G --> V[ValidationHarness<br/>src/validation]
  V --> R[RepairHarness<br/>src/repair]
  R -->|rounds ≤ 5, history kept| G
  R --> X[ExportHarness<br/>src/export, src/codegen]
  X --> O[(artifacts/name/<br/>design.json, design.ts,<br/>STL, GLB, STEP)]
```

Every harness returns `observations`, `limitations`, `unknowns` and `evidence`. `src/pipeline.ts`
(`runPipeline`) and `src/api.ts` (`runDesign`) run the chain for the CLI and the web worker.

## 2. Geometry: field path and exact path

```mermaid
flowchart TB
  subgraph fieldpath ["Field path (default)"]
    S[Field: bounds, eval, expr<br/>src/topology/fields.ts] --> SM[sampleField / surfaceNets<br/>src/geometry/grid.ts]
    SM --> MI[meshIntegrals, removeFloatingComponents]
  end
  subgraph exactpath ["Exact path"]
    K[smlibwasm kernel<br/>src/geometry/brep.ts] --> SH[B-Rep shapes:<br/>Box, Cylinder, Helix, Lattice, …]
    SH --> TS[K.tessellate tol → mesh]
    SH --> STEP[toStep / toGlb]
  end
  L[Lattices, TPMS, fusion<br/>src/topology/lattice.ts, deep.ts, coupled.ts] --> S
  F[Feature timeline<br/>src/program] --> K
```

## 3. Structure graph

```mermaid
flowchart LR
  subgraph graphjson ["Graph JSON (presets/, editor)"]
    SRC[source<br/>sc, gyroid, sphere,<br/>hierarchical_sc, fractal_cube]
    OFF[offset transforms<br/>gradient, radial, polynomial,<br/>noise, expr]
    MAP[coordinate maps<br/>rotate, bend, stretch,<br/>shear, wrap]
    CLIP[clip: max f, sd_shape]
    OUT[structure]
    SRC --> OFF --> MAP --> CLIP --> OUT
  end
  GJ[graph.ts validateGraph / compileGraph] --> FIELD[Field]
  FIELD --> CHK[scripts/graph_check.ts]
  FIELD --> REN[scripts/render_graph.ts → PNG]
```

Notes:
- Offset transforms are `f − g(x)`. Maps use inverse maps and σ_max (or a constant Λ for `wrap`) for the
  Lipschitz bound. `clip` is an intersection, so it leaves open edges and no closed skin.
- `expr` text is parsed by `src/graph/expr.ts` (a recursive-descent parser, no `eval`).
- `fractal_cube` (`src/graph/fractal.ts`) is a skeleton field with a bucket grid.

## 4. Web app

```mermaid
flowchart LR
  subgraph mainthread ["Browser main thread"]
    UI[web/main.ts<br/>prompt, program, Generate]
    VW[web/viewer.ts<br/>WebGPU → WebGL2 → CPU]
    GP[web/graphPanel.ts<br/>graph editor, sliders]
  end
  subgraph worker ["Web Worker"]
    WK[web/worker.ts] --> PL[src/pipeline.ts runPipeline]
    WK --> PV[src/render/preview.ts rasterisePreview]
    WK --> SML[smlibwasm kernel<br/>dist/web/vendor/smlibwasm]
  end
  subgraph graphbrowser ["Graph (no mesh in the browser)"]
    ED[src/graph/editor.ts<br/>GraphHistory undo/redo] --> PR[src/graph/params.ts<br/>parameter slots]
    ED --> CG[src/graph/graph.ts compileGraph<br/>expression only]
  end
  UI -->|message| WK
  WK -->|mesh, metrics, preview| UI
  UI --> VW
  GP --> ED
  GP --> PR
```

The graph panel edits and compiles graphs, and shows the expression. Meshing a graph happens in the
command-line scripts (`scripts/render_graph.ts`), not in the browser.

## 5. Module dependencies (checked imports)

```mermaid
graph LR
  pipeline[src/pipeline.ts] --> intent[src/intent]
  pipeline --> program[src/program]
  pipeline --> evaluate[src/evaluate.ts]
  pipeline --> repair[src/repair]
  pipeline --> codegen[src/codegen]
  pipeline --> export[src/export]
  worker[web/worker.ts] --> pipeline
  graphPanel[web/graphPanel.ts] --> editor[src/graph/editor.ts]
  graphPanel --> params[src/graph/params.ts]
  editor --> history[src/graph/history.ts]
  editor --> graphLib[src/graph/graph.ts]
  params --> graphLib
  graphLib --> fields[src/topology/fields.ts]
  graphLib --> lattice[src/topology/lattice.ts]
  graphLib --> expr[src/graph/expr.ts]
  graphLib --> fractal[src/graph/fractal.ts]
  lattice --> fields
  lattice --> heterogeneous[src/topology/heterogeneous.ts]
```

The pipeline does not import `src/graph/`. The two paths meet only at `Field` (`src/topology/fields.ts`).

## 6. Build outputs and ignored files

- `dist/web/`: built web app (ignored by git).
- `artifacts/`: CLI outputs (ignored by git).
- `examples/`: committed renders and records (with READMEs). Large STEP and mesh.bin files are not tracked.
