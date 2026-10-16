// Undo / redo over structure-graph snapshots (task B2). Each committed graph is stored as a JSON
// snapshot, so later edits cannot change earlier states. Only valid graphs can be committed.
import { validateGraph, type StructureGraph } from "./graph.ts";

export class GraphHistory {
  private past: string[] = [];
  private future: string[] = [];
  private current: string;
  private readonly limit: number;

  constructor(initial: StructureGraph, limit = 100) {
    this.limit = limit;
    const issues = validateGraph(initial);
    if (issues.length) throw new Error(`initial graph invalid: ${issues.map((i) => i.code).join(", ")}`);
    this.current = JSON.stringify(initial);
  }

  /** The current graph (a fresh copy). */
  get present(): StructureGraph {
    return JSON.parse(this.current) as StructureGraph;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Make g the current state. Clears the redo stack. Throws (and changes nothing) if g is invalid. */
  commit(g: StructureGraph): void {
    const issues = validateGraph(g);
    if (issues.length) throw new Error(`commit rejected: ${issues.map((i) => i.code + ":" + i.message).join("; ")}`);
    const snap = JSON.stringify(g);
    if (snap === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = snap;
    this.future = [];
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.current);
    this.current = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.current);
    this.current = next;
    return true;
  }
}
