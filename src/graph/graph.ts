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

export type Vec3 = [number, number, number];

export type SourceSpec =
  | { type: "sc"; cellSize: number; cells: number; radius: number }
  | { type: "gyroid"; cellSize: number; cells: number; thickness: number }
  | { type: "sphere"; radius: number };

export type TransformSpec =
  | { op: "rotate"; axis: Vec3; angle: number }
  | { op: "bend"; k: number }
  | { op: "stretch"; factors: Vec3 }
  | { op: "shear"; a: number; b: number; c: number }
  | { op: "gradient"; axis: "x" | "y" | "z"; slope: number; centre: number }
  // Offset-type density functions (B3): f' = f - g(x). g is a scalar field of the point.
  | { op: "radial"; slope: number; centre: Vec3; radius0: number }
  | { op: "polynomial"; axis: "x" | "y" | "z"; coeffs: number[] }
  | { op: "noise"; amplitude: number; frequency: number; seed: number };

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

function sourceField(s: SourceSpec): Field {
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
      return null; // offset-type: handled as f - g(x), not a coordinate map
  }
}

/** Offset-type density functions: f' = f - g(x). */
export function isOffset(t: TransformSpec): boolean {
  return t.op === "gradient" || t.op === "radial" || t.op === "polynomial" || t.op === "noise";
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
    case "shear":
      return [p[0] + t.a * p[1] + t.b * p[2], p[1] + t.c * p[2], p[2]];
    case "gradient":
    case "radial":
    case "polynomial":
    case "noise":
      return p; // offset-type: no coordinate change
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
