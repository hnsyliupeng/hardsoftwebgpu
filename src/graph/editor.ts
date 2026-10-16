// Editing controller for the structure graph (B2). DOM-free so it can be tested in Node; the web panel
// (web/graphPanel.ts) only renders its state. Every accepted edit goes through GraphHistory, so an
// invalid graph is never committed and undo / redo always return to a valid state.
import { GraphHistory } from "./history.ts";
import { compileGraph, structureIds, validateGraph, type StructureGraph } from "./graph.ts";

export type ApplyResult =
  | { ok: true; structure: string; expr: string }
  | { ok: false; error: string };

export class GraphEditor {
  private readonly history: GraphHistory;

  constructor(initial: StructureGraph) {
    this.history = new GraphHistory(initial);
  }

  /** Pretty JSON of the current (valid) graph. */
  get text(): string {
    return JSON.stringify(this.history.present, null, 2);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /**
   * Parse, validate and compile the edited text. A valid graph becomes the current state (one undo step);
   * an invalid one is rejected and the current state is kept.
   */
  apply(text: string): ApplyResult {
    let g: StructureGraph;
    try {
      g = JSON.parse(text) as StructureGraph;
    } catch (e) {
      return { ok: false, error: `JSON: ${(e as Error).message}` };
    }
    const issues = validateGraph(g);
    if (issues.length) return { ok: false, error: issues.map((i) => `${i.code}: ${i.message}`).join("; ") };
    const structure = structureIds(g)[0];
    if (structure === undefined) return { ok: false, error: "graph has no structure node" };
    let expr: string;
    try {
      expr = compileGraph(g, structure).expr;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    try {
      this.history.commit(g);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return { ok: true, structure, expr };
  }

  undo(): boolean {
    return this.history.undo();
  }

  redo(): boolean {
    return this.history.redo();
  }
}

/** Starter graph for the editor: the graded open infill (C3), the same as presets/graded_infill_sphere.json. */
export const STARTER_GRAPH: StructureGraph = {
  version: 1,
  nodes: [
    { id: "lat", kind: "field", source: { type: "hierarchical_sc", cellSize: 8, cells: 3, radius: 0.5, levels: 2, divisor: 2 } },
    { id: "grad", kind: "transform", transform: { op: "radial", slope: 0.01, centre: [12, 12, 12], radius0: 10 } },
    { id: "clip", kind: "transform", transform: { op: "clip", shape: { type: "sphere", centre: [12, 12, 12], radius: 10 } } },
    { id: "out", kind: "structure", name: "graded_infill_sphere" },
  ],
  edges: [
    { from: "lat", to: "grad" },
    { from: "grad", to: "clip" },
    { from: "clip", to: "out" },
  ],
};
