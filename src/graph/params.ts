// Parameter slots of a structure graph (D1): scalar parameters with safe ranges, for sliders.
// DOM-free. A new value is clamped to its range (integers rounded), applied to a copy of the graph,
// and validated; the input graph is never mutated.
import { validateGraph, type StructureGraph, type GraphIssue } from "./graph.ts";

export interface ParamSlot {
  nodeId: string;
  field: string; // "source.radius", "transform.slope", ...
  value: number;
  min: number;
  max: number;
  integer: boolean;
}

type Range = { min: number; max: number; integer?: boolean };

// Editable fields by node kind. Only scalars with a physically sensible range are exposed.
const SOURCE_RANGES: Record<string, Record<string, Range>> = {
  sc: { cellSize: { min: 1, max: 40 }, cells: { min: 1, max: 8, integer: true }, radius: { min: 0.05, max: 5 } },
  gyroid: { cellSize: { min: 1, max: 40 }, cells: { min: 1, max: 8, integer: true }, thickness: { min: 0.05, max: 5 } },
  sphere: { radius: { min: 0.5, max: 50 } },
  hierarchical_sc: {
    cellSize: { min: 1, max: 40 },
    cells: { min: 1, max: 6, integer: true },
    radius: { min: 0.05, max: 5 },
    levels: { min: 1, max: 4, integer: true },
    divisor: { min: 2, max: 3, integer: true },
  },
  fractal_cube: {
    size: { min: 5, max: 100 },
    divisor: { min: 2, max: 3, integer: true },
    depth: { min: 1, max: 3, integer: true },
    radius: { min: 0.05, max: 5 },
    radiusRatio: { min: 0.1, max: 1 },
  },
};

const TRANSFORM_RANGES: Record<string, Record<string, Range>> = {
  rotate: { angle: { min: -Math.PI, max: Math.PI } },
  bend: { k: { min: -0.5, max: 0.5 } },
  shear: { a: { min: -1, max: 1 }, b: { min: -1, max: 1 }, c: { min: -1, max: 1 } },
  gradient: { slope: { min: -0.1, max: 0.1 }, centre: { min: -50, max: 50 } },
  radial: { slope: { min: -0.1, max: 0.1 }, radius0: { min: 0, max: 50 } },
  polynomial: {},
  noise: { amplitude: { min: 0, max: 1 }, frequency: { min: 0.05, max: 2 } },
  wrap: { radius: { min: 1, max: 100 } },
  expr: {},
  clip: { "shape.radius": { min: 0.5, max: 100 } },
};

function rangesFor(node: { kind: string; source?: { type: string }; transform?: { op: string } }): Record<string, Range> {
  if (node.kind === "field" && node.source) return SOURCE_RANGES[node.source.type] ?? {};
  if (node.kind === "transform" && node.transform) return TRANSFORM_RANGES[node.transform.op] ?? {};
  return {};
}

/** The editable scalar parameters of a graph, with their current values and ranges. */
export function paramSlots(g: StructureGraph): ParamSlot[] {
  const out: ParamSlot[] = [];
  for (const n of g.nodes) {
    const ranges = rangesFor(n as never);
    const holder = (n.kind === "field" ? (n as { source?: object }).source : (n as { transform?: object }).transform) as Record<string, unknown> | undefined;
    if (!holder) continue;
    const prefix = n.kind === "field" ? "source" : "transform";
    for (const [key, r] of Object.entries(ranges)) {
      const path = key.split(".");
      let obj: unknown = holder;
      for (const p of path.slice(0, -1)) obj = (obj as Record<string, unknown> | undefined)?.[p];
      const v = (obj as Record<string, unknown> | undefined)?.[path[path.length - 1]];
      if (typeof v !== "number") continue;
      out.push({ nodeId: n.id, field: `${prefix}.${key}`, value: v, min: r.min, max: r.max, integer: !!r.integer });
    }
  }
  return out;
}

/** Clamp to range, round integers. */
export function clampParam(slot: { min: number; max: number; integer?: boolean }, value: number): number {
  if (!Number.isFinite(value)) throw new Error("parameter value must be a finite number");
  const v = Math.min(slot.max, Math.max(slot.min, value));
  return slot.integer ? Math.round(v) : v;
}

/**
 * Set one slot on a copy of the graph. Returns the new graph and its validation issues (empty if valid).
 * The input is not mutated. Unknown slots throw.
 */
export function setParam(
  g: StructureGraph,
  nodeId: string,
  field: string,
  value: number,
): { graph: StructureGraph; issues: GraphIssue[]; value: number } {
  const slot = paramSlots(g).find((s) => s.nodeId === nodeId && s.field === field);
  if (!slot) throw new Error(`no editable parameter ${nodeId}.${field}`);
  const v = clampParam(slot, value);
  const copy = structuredClone(g);
  const node = copy.nodes.find((n) => n.id === nodeId) as unknown as Record<string, unknown>;
  const [prefix, ...rest] = field.split(".");
  const holder = node[prefix === "source" ? "source" : "transform"] as Record<string, unknown>;
  let obj: Record<string, unknown> = holder;
  for (const p of rest.slice(0, -1)) obj = obj[p] as Record<string, unknown>;
  obj[rest[rest.length - 1]] = v;
  return { graph: copy, issues: validateGraph(copy), value: v };
}
