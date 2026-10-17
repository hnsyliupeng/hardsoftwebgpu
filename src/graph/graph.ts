// Structure graph (task B1, docs/TASK_PLAN.md): a JSON document of nodes and data-flow edges.
//   field      source field: lattice (sc), TPMS (gyroid), or a primitive sphere (test source). No input.
//   transform  one operation applied to its single input field. One input.
//   structure  output node. Exactly one input. A graph has at least one structure node.
// `validateGraph` checks the document; `compileGraph` builds the Field of a structure node.
//
// Transform semantics (x is the world point, M the map, f the input field):
//   rotate   f'(x) = f(R^-1 x)                      R = rotation about an axis through the origin
//   bend     f'(x) = f(B^-1 x)                      B rotates the xy plane by angle k*z (z kept)
//   stretch  f'(x) = f(S^-1 x)                      S = diag(sx, sy, sz)
//   shear    f'(x) = f(H^-1 x)                      x' = x + a*y + b*z, y' = y + c*z, z' = z
//   gradient f'(x) = f(x) - slope*(x_axis - centre) adds a linear isosurface offset (thickness varies)
// Inverse maps are exact. The composed field is not an exact distance field after stretch, shear, bend
// or gradient (its gradient is scaled), so the sampler must be checked against the mesh (see tests).

import type { Bounds, Field } from "../topology/fields.ts";
import { strutLattice, tpmsShell } from "../topology/lattice.ts";
import { compileExpr, checkExpr } from "./expr.ts";
import { fractalField } from "./fractal.ts";

export type Vec3 = [number, number, number];

export type SourceSpec =
  | { type: "sc"; cellSize: number; cells: number; radius: number }
  | { type: "gyroid"; cellSize: number; cells: number; thickness: number }
  | { type: "sphere"; radius: number }
  // Hierarchical (multi-scale, self-similar) SC lattice, C2 of docs/TASK_PLAN.md. Level k has cell
  // cellSize/m^k, cells*m^k cells per axis and radius/m^k, for k = 0..levels-1; the field is the minimum
  // over the levels (union of all struts). Fine struts sit inside the coarse cells.
  | { type: "hierarchical_sc"; cellSize: number; cells: number; radius: number; levels: number; divisor: number }
  // Fractal cube skeleton (C2, recursive substitution): see fractal.ts. Radius at level k is radius * radiusRatio^k.
  | { type: "fractal_cube"; size: number; divisor: number; depth: number; radius: number; radiusRatio: number; tiles?: number };

export type TransformSpec =
  | { op: "rotate"; axis: Vec3; angle: number }
  | { op: "bend"; k: number }
  | { op: "stretch"; factors: Vec3 }
  // Cylinder projection (C1, partial): source (s, t, z) is wrapped onto a cylinder of radius R about z.
  // s is arc length from the phase angle phi0 (s = s0 at phi0), t is the radial offset from R.
  | { op: "wrap"; radius: number; phase: number; s0: number }
  // Conformal log-polar map (C1): w = r0 * exp((x + i y) / scale). Angle-preserving; the local scale is |w|/scale.
  // The source y-extent must stay inside (-pi*scale, pi*scale] so the angle does not wrap.
  | { op: "conformal_log"; r0: number; scale: number }
  | { op: "shear"; a: number; b: number; c: number }
  | { op: "gradient"; axis: "x" | "y" | "z"; slope: number; centre: number }
  // Offset-type density functions (B3): f' = f - g(x). g is a scalar field of the point.
  | { op: "radial"; slope: number; centre: Vec3; radius0: number }
  | { op: "polynomial"; axis: "x" | "y" | "z"; coeffs: number[] }
  | { op: "noise"; amplitude: number; frequency: number; seed: number }
  // Safe arithmetic expression of x, y, z (see expr.ts). g(x) = expression; the offset is f - g.
  | { op: "expr"; text: string }
  // Open infill clip (C3): f' = max(f, sd_shape). Intersection only, so the result has no closed outer skin
  // (struts end open on the shape surface). max of 1-Lipschitz fields is 1-Lipschitz.
  | { op: "clip"; shape: ClipShape };

export type ClipShape = { type: "sphere"; centre: Vec3; radius: number } | { type: "box"; min: Vec3; max: Vec3 };

export type GraphNode =
  | { id: string; kind: "field"; source: SourceSpec }
  | { id: string; kind: "transform"; transform: TransformSpec }
  | { id: string; kind: "structure"; name: string };

export interface GraphEdge {
  from: string;
  to: string;
}

export interface StructureGraph {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphIssue {
  code: string;
  message: string;
  node?: string;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

function checkSource(n: GraphNode & { kind: "field" }, issues: GraphIssue[]): void {
  const s = n.source as unknown as Record<string, unknown>;
  const need = (ok: boolean, msg: string) => { if (!ok) issues.push({ code: "bad_param", message: msg, node: n.id }); };
  switch (s?.type) {
    case "sc":
      need(isNum(s.cellSize) && s.cellSize > 0, "sc: cellSize must be > 0");
      need(isNum(s.cells) && Number.isInteger(s.cells) && (s.cells as number) >= 1, "sc: cells must be an integer >= 1");
      need(isNum(s.radius) && s.radius > 0 && s.radius < ((s.cellSize as number) / 2 || 0), "sc: radius must be > 0 and < cellSize/2");
      break;
    case "gyroid":
      need(isNum(s.cellSize) && s.cellSize > 0, "gyroid: cellSize must be > 0");
      need(isNum(s.cells) && Number.isInteger(s.cells) && (s.cells as number) >= 1, "gyroid: cells must be an integer >= 1");
      need(isNum(s.thickness) && s.thickness > 0, "gyroid: thickness must be > 0");
      break;
    case "sphere":
      need(isNum(s.radius) && s.radius > 0, "sphere: radius must be > 0");
      break;
    case "fractal_cube":
      need(isNum(s.size) && s.size > 0, "fractal_cube: size must be > 0");
      need(isNum(s.divisor) && Number.isInteger(s.divisor) && (s.divisor as number) >= 2 && (s.divisor as number) <= 3, "fractal_cube: divisor must be 2 or 3");
      need(isNum(s.depth) && Number.isInteger(s.depth) && (s.depth as number) >= 1 && (s.depth as number) <= 3, "fractal_cube: depth must be an integer 1..3");
      need(isNum(s.radius) && s.radius > 0, "fractal_cube: radius must be > 0");
      need(isNum(s.radiusRatio) && s.radiusRatio > 0 && s.radiusRatio <= 1, "fractal_cube: radiusRatio must be in (0, 1]");
      need(s.tiles === undefined || (isNum(s.tiles) && Number.isInteger(s.tiles) && (s.tiles as number) >= 1 && (s.tiles as number) <= 4), "fractal_cube: tiles must be an integer 1..4 (default 1)");
      need(isNum(s.size) && isNum(s.radius) && (s.radius as number) < ((s.size as number) / Math.pow((s.divisor as number) || 2, (s.depth as number) || 1)), "fractal_cube: radius must be < finest subcube size, size/divisor^depth");
      break;
    case "hierarchical_sc":
      need(isNum(s.cellSize) && s.cellSize > 0, "hierarchical_sc: cellSize must be > 0");
      need(isNum(s.cells) && Number.isInteger(s.cells) && (s.cells as number) >= 1, "hierarchical_sc: cells must be an integer >= 1");
      need(isNum(s.radius) && s.radius > 0 && s.radius < ((s.cellSize as number) / 2 || 0), "hierarchical_sc: radius must be > 0 and < cellSize/2");
      need(isNum(s.levels) && Number.isInteger(s.levels) && (s.levels as number) >= 1 && (s.levels as number) <= 4, "hierarchical_sc: levels must be an integer 1..4");
      need(isNum(s.divisor) && Number.isInteger(s.divisor) && (s.divisor as number) >= 2 && (s.divisor as number) <= 3, "hierarchical_sc: divisor must be 2 or 3");
      break;
    default:
      issues.push({ code: "unknown_source", message: `unknown source type ${String(s?.type)}`, node: n.id });
  }
}

function checkTransform(n: GraphNode & { kind: "transform" }, issues: GraphIssue[]): void {
  const t = n.transform as unknown as Record<string, unknown>;
  const need = (ok: boolean, msg: string) => { if (!ok) issues.push({ code: "bad_param", message: msg, node: n.id }); };
  switch (t?.op) {
    case "rotate":
      need(isVec3(t.axis) && Math.hypot(...(t.axis as Vec3)) > 0, "rotate: axis must be a non-zero 3-vector");
      need(isNum(t.angle), "rotate: angle must be a number (radians)");
      break;
    case "bend":
      need(isNum(t.k), "bend: k must be a number (radians per mm)");
      break;
    case "stretch":
      need(isVec3(t.factors) && (t.factors as Vec3).every((f) => f > 0), "stretch: factors must be positive 3-vector");
      break;
    case "conformal_log":
      need(isNum(t.r0) && (t.r0 as number) > 0, "conformal_log: r0 must be > 0");
      need(isNum(t.scale) && (t.scale as number) > 0, "conformal_log: scale must be > 0");
      break;
    case "wrap":
      need(isNum(t.radius) && (t.radius as number) > 0, "wrap: radius must be > 0");
      need(isNum(t.phase), "wrap: phase must be a number (radians)");
      need(isNum(t.s0), "wrap: s0 must be a number");
      break;
    case "shear":
      need(isNum(t.a) && isNum(t.b) && isNum(t.c), "shear: a, b, c must be numbers");
      break;
    case "gradient":
      need(t.axis === "x" || t.axis === "y" || t.axis === "z", "gradient: axis must be x, y or z");
      need(isNum(t.slope), "gradient: slope must be a number");
      need(isNum(t.centre), "gradient: centre must be a number");
      break;
    case "radial":
      need(isNum(t.slope), "radial: slope must be a number");
      need(isVec3(t.centre), "radial: centre must be a 3-vector");
      need(isNum(t.radius0) && (t.radius0 as number) >= 0, "radial: radius0 must be >= 0");
      break;
    case "polynomial":
      need(t.axis === "x" || t.axis === "y" || t.axis === "z", "polynomial: axis must be x, y or z");
      need(Array.isArray(t.coeffs) && t.coeffs.length >= 1 && t.coeffs.length <= 5 && (t.coeffs as unknown[]).every(isNum), "polynomial: coeffs must be 1 to 5 numbers");
      break;
    case "noise":
      need(isNum(t.amplitude) && (t.amplitude as number) >= 0, "noise: amplitude must be >= 0");
      need(isNum(t.frequency) && (t.frequency as number) > 0, "noise: frequency must be > 0 (cycles per mm)");
      need(isNum(t.seed) && Number.isInteger(t.seed), "noise: seed must be an integer");
      break;
    case "expr": {
      const err = checkExpr(t.text);
      need(err === null, `expr: ${err}`);
      break;
    }
    case "clip": {
      const sh = t.shape as ClipShape | undefined;
      if (sh?.type === "sphere") {
        need(isVec3(sh.centre), "clip: sphere centre must be a 3-vector");
        need(isNum(sh.radius) && sh.radius > 0, "clip: sphere radius must be > 0");
      } else if (sh?.type === "box") {
        need(isVec3(sh.min) && isVec3(sh.max) && sh.min.every((v, i) => v < sh.max[i]), "clip: box min must be < max on every axis");
      } else {
        need(false, "clip: shape must be a sphere or a box");
      }
      break;
    }
    default:
      issues.push({ code: "unknown_transform", message: `unknown transform ${String(t?.op)}`, node: n.id });
  }
}

/** Check a graph document. Returns the list of issues (empty when valid). */
export function validateGraph(g: unknown): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const doc = g as Partial<StructureGraph>;
  if (!doc || typeof doc !== "object") return [{ code: "not_object", message: "graph must be an object" }];
  if (doc.version !== 1) issues.push({ code: "version", message: "version must be 1" });
  if (!Array.isArray(doc.nodes)) return [...issues, { code: "nodes", message: "nodes must be an array" }];
  if (!Array.isArray(doc.edges)) return [...issues, { code: "edges", message: "edges must be an array" }];

  const byId = new Map<string, GraphNode>();
  for (const n of doc.nodes) {
    if (!n || typeof n.id !== "string" || n.id.length === 0) { issues.push({ code: "id", message: "every node needs a non-empty string id" }); continue; }
    if (byId.has(n.id)) { issues.push({ code: "duplicate_id", message: `duplicate node id ${n.id}`, node: n.id }); continue; }
    byId.set(n.id, n);
    if (n.kind === "field") checkSource(n, issues);
    else if (n.kind === "transform") checkTransform(n, issues);
    else if (n.kind === "structure") { if (typeof n.name !== "string" || !n.name) issues.push({ code: "name", message: "structure needs a name", node: n.id }); }
    else issues.push({ code: "unknown_kind", message: `unknown node kind ${String((n as GraphNode).kind)}`, node: String((n as { id: unknown }).id) });
  }

  const inputs = new Map<string, string[]>();
  const outputs = new Map<string, string[]>();
  for (const e of doc.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) { issues.push({ code: "dangling_edge", message: `edge ${e.from} -> ${e.to} references a missing node` }); continue; }
    (inputs.get(e.to) ?? inputs.set(e.to, []).get(e.to)!).push(e.from);
    (outputs.get(e.from) ?? outputs.set(e.from, []).get(e.from)!).push(e.to);
  }

  for (const n of byId.values()) {
    const ins = inputs.get(n.id) ?? [];
    if (n.kind === "field" && ins.length > 0) issues.push({ code: "field_input", message: "field nodes take no input", node: n.id });
    if (n.kind === "transform" && ins.length !== 1) issues.push({ code: "arity", message: `transform needs exactly 1 input, has ${ins.length}`, node: n.id });
    if (n.kind === "structure") {
      if (ins.length !== 1) issues.push({ code: "arity", message: `structure needs exactly 1 input, has ${ins.length}`, node: n.id });
      if ((outputs.get(n.id) ?? []).length > 0) issues.push({ code: "structure_output", message: "structure nodes are terminal", node: n.id });
    }
    if (n.kind !== "structure" && (outputs.get(n.id) ?? []).length > 1) issues.push({ code: "fanout", message: "a node may feed one consumer only", node: n.id });
  }
  if (![...byId.values()].some((n) => n.kind === "structure")) issues.push({ code: "no_structure", message: "graph has no structure node" });

  // Cycle check (DFS over input edges).
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const p of inputs.get(id) ?? []) if (visit(p)) return true;
    state.set(id, 2);
    return false;
  };
  for (const id of byId.keys()) if (visit(id)) { issues.push({ code: "cycle", message: `cycle through ${id}`, node: id }); break; }
  return issues;
}

/** Input-chain of a structure node, from the source field to the structure node. */
export function chainOf(g: StructureGraph, structureId: string): GraphNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const from = new Map(g.edges.map((e) => [e.to, e.from]));
  const chain: GraphNode[] = [];
  let cur: string | undefined = structureId;
  while (cur !== undefined) {
    const n = byId.get(cur);
    if (!n) throw new Error(`chainOf: missing node ${cur}`);
    chain.unshift(n);
    cur = from.get(cur);
  }
  return chain;
}

function hierarchicalField(s: Extract<SourceSpec, { type: "hierarchical_sc" }>): Field {
  const levels: Field[] = [];
  for (let k = 0; k < s.levels; k++) {
    const m = Math.pow(s.divisor, k);
    levels.push(strutLattice({ type: "sc", cellSize: s.cellSize / m, cells: [s.cells * m, s.cells * m, s.cells * m], radius: s.radius / m } as never) as Field);
  }
  return {
    bounds: levels[0].bounds,
    eval: (x, y, z) => {
      let v = Infinity;
      for (const f of levels) v = Math.min(v, f.eval(x, y, z));
      return v;
    },
    expr: `min_k<${s.levels} sc(cell=${s.cellSize}/${s.divisor}^k, r=${s.radius}/${s.divisor}^k)`,
  };
}

function sourceField(s: SourceSpec): Field {
  if (s.type === "fractal_cube") return fractalField(s);
  if (s.type === "hierarchical_sc") return hierarchicalField(s);
  if (s.type === "sc") return strutLattice({ type: "sc", cellSize: s.cellSize, cells: [s.cells, s.cells, s.cells], radius: s.radius } as never) as Field;
  if (s.type === "gyroid") return tpmsShell({ type: "gyroid", cellSize: s.cellSize, cells: [s.cells, s.cells, s.cells], thickness: s.thickness } as never) as Field;
  const r = s.radius;
  return {
    bounds: { min: [-r, -r, -r], max: [r, r, r] } as Bounds,
    eval: (x, y, z) => Math.hypot(x, y, z) - r,
    expr: `sphere(r=${r})`,
  };
}

/** Inverse of a transform map (x world -> x source). Exact for every op. */
function inverseMap(t: TransformSpec): ((p: Vec3) => Vec3) | null {
  switch (t.op) {
    case "rotate": {
      // Rotation matrix R (Rodrigues); the inverse is its transpose.
      const [ax, ay, az] = t.axis;
      const n = Math.hypot(ax, ay, az);
      const x = ax / n, y = ay / n, z = az / n;
      const c = Math.cos(t.angle), s = Math.sin(t.angle), C = 1 - c;
      const R = [
        [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
        [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
        [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
      ];
      return (p) => [
        R[0][0] * p[0] + R[1][0] * p[1] + R[2][0] * p[2],
        R[0][1] * p[0] + R[1][1] * p[1] + R[2][1] * p[2],
        R[0][2] * p[0] + R[1][2] * p[1] + R[2][2] * p[2],
      ];
    }
    case "bend":
      // Forward: rotate the xy plane by k*z. Inverse: rotate back by -k*z (z unchanged).
      return (p) => {
        const th = -t.k * p[2], c = Math.cos(th), s = Math.sin(th);
        return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
      };
    case "stretch":
      return (p) => [p[0] / t.factors[0], p[1] / t.factors[1], p[2] / t.factors[2]];
    case "conformal_log":
      return conformalLog(t).inverse;
    case "wrap":
      return (p) => {
        const r = Math.hypot(p[0], p[1]);
        const phi = wrapAngle(Math.atan2(p[1], p[0]) - t.phase);
        return [t.radius * phi + t.s0, r - t.radius, p[2]];
      };
    case "shear":
      // Forward: x' = x + a*y + b*z, y' = y + c*z. Inverse: solve from the top.
      return (p) => {
        const z = p[2], y = p[1] - t.c * z, x = p[0] - t.a * y - t.b * z;
        return [x, y, z];
      };
    case "gradient":
    case "radial":
    case "polynomial":
    case "noise":
    case "expr":
    case "clip":
      return null; // offset-type or field op: handled in compileGraph, not a coordinate map
  }
}

/** Offset-type density functions: f' = f - g(x). */
export function isOffset(t: TransformSpec): boolean {
  return t.op === "gradient" || t.op === "radial" || t.op === "polynomial" || t.op === "noise" || t.op === "expr";
}

// Deterministic value noise in [0, 1): hash of integer lattice corners, trilinear with smoothstep.
function hash3(i: number, j: number, k: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const v = (di: number, dj: number, dk: number) => hash3(xi + di, yi + dj, zi + dk, seed);
  const x00 = v(0, 0, 0) + (v(1, 0, 0) - v(0, 0, 0)) * sx;
  const x10 = v(0, 1, 0) + (v(1, 1, 0) - v(0, 1, 0)) * sx;
  const x01 = v(0, 0, 1) + (v(1, 0, 1) - v(0, 0, 1)) * sx;
  const x11 = v(0, 1, 1) + (v(1, 1, 1) - v(0, 1, 1)) * sx;
  const y0 = x00 + (x10 - x00) * sy, y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}

/** The scalar g(x) of an offset-type transform. */
export function offsetFunction(t: TransformSpec): (p: Vec3) => number {
  switch (t.op) {
    case "gradient": {
      const a = { x: 0, y: 1, z: 2 }[t.axis];
      return (p) => t.slope * (p[a] - t.centre);
    }
    case "radial":
      return (p) => t.slope * (Math.hypot(p[0] - t.centre[0], p[1] - t.centre[1], p[2] - t.centre[2]) - t.radius0);
    case "polynomial": {
      const a = { x: 0, y: 1, z: 2 }[t.axis];
      return (p) => {
        let acc = 0, pw = 1;
        for (const c of t.coeffs) { acc += c * pw; pw *= p[a]; }
        return acc;
      };
    }
    case "expr": {
      const fn = compileExpr(t.text);
      return (p) => fn(p[0], p[1], p[2]);
    }
    case "noise":
      // amplitude * (2 n - 1), n in [0, 1): the offset is in (-amplitude, amplitude).
      return (p) => t.amplitude * (2 * valueNoise(p[0] * t.frequency, p[1] * t.frequency, p[2] * t.frequency, t.seed) - 1);
    default:
      throw new Error(`offsetFunction: ${t.op} is not an offset transform`);
  }
}

function offsetExpr(t: TransformSpec): string {
  switch (t.op) {
    case "gradient": return `${t.slope}*(${t.axis}-${t.centre})`;
    case "radial": return `${t.slope}*(|x-${t.centre.join(",")}|-${t.radius0})`;
    case "polynomial": return `poly_${t.axis}[${t.coeffs.join(",")}]`;
    case "noise": return `${t.amplitude}*(2*valueNoise(${t.frequency}*x,seed=${t.seed})-1)`;
    case "expr": return `(${t.text})`;
    default: return t.op;
  }
}

/**
 * Bounds of the transformed field: the axis-aligned box of the forward-mapped sample grid over the input
 * box. Exact for linear maps (rotate, stretch, shear) at the corners; for bend it is a grid estimate, so
 * a 4x4x4 sample grid is used and the caller should check the sampled field (see tests).
 */
function transformBounds(b: Bounds, t: TransformSpec): Bounds {
  if (isOffset(t)) return b;
  if (t.op === "clip") {
    const sb = clipBounds(t.shape);
    const min = [0, 1, 2].map((a) => Math.max(b.min[a], sb.min[a])) as Vec3;
    const max = [0, 1, 2].map((a) => Math.min(b.max[a], sb.max[a])) as Vec3;
    if (min.some((v, a) => v >= max[a])) throw new Error("clip: the shape does not overlap the field bounds");
    return { min, max } as Bounds;
  }
  if (t.op === "conformal_log") {
    // The image of the box lies in the square of half-width r0 * exp(x_max / scale).
    const R = t.r0 * Math.exp(b.max[0] / t.scale);
    return { min: [-R, -R, b.min[2]], max: [R, R, b.max[2]] } as Bounds;
  }
  if (t.op === "wrap") {
    const rOut = t.radius + Math.max(Math.abs(b.min[1]), Math.abs(b.max[1]));
    return { min: [-rOut, -rOut, b.min[2]], max: [rOut, rOut, b.max[2]] } as Bounds;
  }
  if (t.op === "bend") {
    // Rotation about z keeps |xy| and z, so the xy extent is a disc of the largest input radius.
    const R = Math.hypot(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), Math.max(Math.abs(b.min[1]), Math.abs(b.max[1])));
    return { min: [-R, -R, b.min[2]], max: [R, R, b.max[2]] } as Bounds;
  }
  const steps = 4;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= steps; i++)
    for (let j = 0; j <= steps; j++)
      for (let k = 0; k <= steps; k++) {
        const p: Vec3 = [
          b.min[0] + ((b.max[0] - b.min[0]) * i) / steps,
          b.min[1] + ((b.max[1] - b.min[1]) * j) / steps,
          b.min[2] + ((b.max[2] - b.min[2]) * k) / steps,
        ];
        const q = forwardMap(t, p);
        for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], q[a]); max[a] = Math.max(max[a], q[a]); }
      }
  return { min, max } as Bounds;
}

/** Conformal log-polar map and its inverse (C1). Exported for tests. */
export function conformalLog(t: { r0: number; scale: number }): { forward: (p: Vec3) => Vec3; inverse: (p: Vec3) => Vec3 } {
  const r0 = t.r0, s = t.scale;
  return {
    forward: (p) => {
      const m = r0 * Math.exp(p[0] / s), th = p[1] / s;
      return [m * Math.cos(th), m * Math.sin(th), p[2]];
    },
    inverse: (p) => [s * Math.log(Math.hypot(p[0], p[1]) / r0), s * Math.atan2(p[1], p[0]), p[2]],
  };
}

/** Angle wrapped into (-pi, pi]. */
function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

/** Forward map (source point -> world point), the inverse of inverseMap. */
function forwardMap(t: TransformSpec, p: Vec3): Vec3 {
  switch (t.op) {
    case "rotate": {
      // World = R * source; R is the transpose of the matrix used by the inverse, so apply the
      // inverse of the inverse with the opposite angle.
      const back = inverseMap({ op: "rotate", axis: t.axis, angle: -t.angle })!;
      return back(p);
    }
    case "bend": {
      const th = t.k * p[2], c = Math.cos(th), s = Math.sin(th);
      return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
    }
    case "stretch":
      return [p[0] * t.factors[0], p[1] * t.factors[1], p[2] * t.factors[2]];
    case "conformal_log":
      return conformalLog(t).forward(p);
    case "wrap": {
      const phi = t.phase + (p[0] - t.s0) / t.radius, rr = t.radius + p[1];
      return [rr * Math.cos(phi), rr * Math.sin(phi), p[2]];
    }
    case "shear":
      return [p[0] + t.a * p[1] + t.b * p[2], p[1] + t.c * p[2], p[2]];
    case "gradient":
    case "radial":
    case "polynomial":
    case "noise":
    case "expr":
    case "clip":
      return p; // offset-type or field op: no coordinate change
  }
}

/**
 * Largest singular value of the Jacobian of the inverse map at p (central differences, then power
 * iteration on J^T J). For a 1-Lipschitz input field, dividing by this value keeps the composed field
 * 1-Lipschitz: the conservative distance bound under a non-isometric map.
 */
function sigmaMaxOfInverse(inv: (p: Vec3) => Vec3, p: Vec3): number {
  const h = 1e-5;
  const J: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // J[row][col]
  for (let c = 0; c < 3; c++) {
    const a = [p[0], p[1], p[2]] as Vec3, b = [p[0], p[1], p[2]] as Vec3;
    a[c] += h;
    b[c] -= h;
    const fa = inv(a), fb = inv(b);
    for (let r = 0; r < 3; r++) J[r][c] = (fa[r] - fb[r]) / (2 * h);
  }
  // M = J^T J, power iteration.
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let r = 0; r < 3; r++) M[i][j] += J[r][i] * J[r][j];
  let v = [1, 1, 1];
  let lambda = 0;
  for (let it = 0; it < 30; it++) {
    const w = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) w[i] += M[i][j] * v[j];
    const n = Math.hypot(w[0], w[1], w[2]);
    if (n === 0) return 0;
    lambda = n;
    v = [w[0] / n, w[1] / n, w[2] / n];
  }
  return Math.sqrt(lambda);
}

/** Axis-aligned bounds of a clip shape. */
export function clipBounds(sh: ClipShape): Bounds {
  if (sh.type === "sphere") {
    const c = sh.centre, R = sh.radius;
    return { min: [c[0] - R, c[1] - R, c[2] - R], max: [c[0] + R, c[1] + R, c[2] + R] } as Bounds;
  }
  return { min: [...sh.min], max: [...sh.max] } as Bounds;
}

/** Signed distance to a clip shape (negative inside): exact for the sphere and the box. */
export function clipDistance(sh: ClipShape, p: Vec3): number {
  if (sh.type === "sphere") return Math.hypot(p[0] - sh.centre[0], p[1] - sh.centre[1], p[2] - sh.centre[2]) - sh.radius;
  const q = [0, 1, 2].map((a) => {
    const c = (sh.min[a] + sh.max[a]) / 2, h = (sh.max[a] - sh.min[a]) / 2;
    return Math.abs(p[a] - c) - h;
  });
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0);
}

/** Build the Field of a structure node. Throws if the graph is invalid. */
export function compileGraph(g: StructureGraph, structureId: string): Field {
  const issues = validateGraph(g);
  if (issues.length) throw new Error(`invalid graph: ${issues.map((i) => i.code + ":" + i.message).join("; ")}`);
  const chain = chainOf(g, structureId);
  const src = chain[0];
  if (src.kind !== "field") throw new Error("chain must start at a field node");
  let field: Field = sourceField(src.source);
  for (const n of chain.slice(1)) {
    if (n.kind !== "transform") continue;
    const t = n.transform;
    const inner = field;
    if (t.op === "clip") {
      const sh = t.shape;
      field = {
        bounds: transformBounds(inner.bounds, t),
        eval: (x, y, z) => Math.max(inner.eval(x, y, z), clipDistance(sh, [x, y, z])),
        expr: `max(${inner.expr}, sd_${sh.type})`,
      };
      continue;
    }
    if (isOffset(t)) {
      const g = offsetFunction(t);
      field = {
        bounds: inner.bounds,
        eval: (x, y, z) => inner.eval(x, y, z) - g([x, y, z]),
        expr: `(${inner.expr}) - ${offsetExpr(t)}`,
      };
      continue;
    }
    const inv = inverseMap(t)!;
    const b = transformBounds(inner.bounds, t);
    if (t.op === "conformal_log") {
      // Conformal: the inverse Jacobian has norm scale/|w|, largest at the smallest radius in the source box.
      // Lambda = sup |D inverse| = scale / (r0 * exp(x_min / scale)). Dividing by it keeps the field 1-Lipschitz,
      // and the zero set is unchanged.
      const xMin = (inner.bounds as { min: number[] }).min[0];
      const lambda = t.scale / (t.r0 * Math.exp(xMin / t.scale));
      field = {
        bounds: b,
        eval: (x, y, z) => {
          const q = inv([x, y, z]);
          return inner.eval(q[0], q[1], q[2]) / lambda;
        },
        expr: `(${inner.expr}) o conformal_log(r0=${t.r0}, s=${t.scale}) / ${lambda.toFixed(4)}`,
      };
      continue;
    }
    if (t.op === "wrap") {
      // Wrap: the stretch rr/R varies strongly with radius, so a pointwise division by sigma(x) would add
      // a product term f*grad(1/sigma) that breaks the Lipschitz bound. Use a constant instead:
      // Lambda = sup over the source box of max(1, R/rr) = max(1, R/(R + t_min)). Rr = R + t_min must be > 0.
      const tMin = (inner.bounds as { min: number[] }).min[1];
      if (t.radius + tMin <= 0) throw new Error(`wrap: radius ${t.radius} + source t_min ${tMin} must be > 0`);
      const lambda = Math.max(1, t.radius / (t.radius + tMin));
      field = {
        bounds: b,
        eval: (x, y, z) => {
          const q = inv([x, y, z]);
          return inner.eval(q[0], q[1], q[2]) / lambda;
        },
        expr: `(${inner.expr}) o wrap(R=${t.radius}) / ${lambda.toFixed(4)}`,
      };
      continue;
    }
    // Rotation is isometric (sigma = 1), so it is not normalised.
    const normalise = t.op !== "rotate";
    field = {
      bounds: b,
      eval: (x, y, z) => {
        const q = inv([x, y, z]);
        const v = inner.eval(q[0], q[1], q[2]);
        return normalise ? v / sigmaMaxOfInverse(inv, [x, y, z]) : v;
      },
      expr: `(${inner.expr}) o ${t.op}${normalise ? " / sigma_max" : ""}`,
    };
  }
  return field;
}

/** Structure node ids of a graph. */
export function structureIds(g: StructureGraph): string[] {
  return g.nodes.filter((n) => n.kind === "structure").map((n) => n.id);
}
