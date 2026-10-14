// SDF compiler for feature programs. Convention: f < 0 inside, f > 0 outside (mm).
// Exact closed forms are used for primitives and for box-family targets (box, fillet, offset,
// shell, graded_shell). Other targets use first-order approximations, recorded in `notes`.

import { sdBox, type Field, type Bounds } from "../topology/fields.ts";
import { compileU, parseProfileAssignment } from "../expr/expr.ts";
import { ProgramError, type FeatureProgram, type OpenFace, type ProgramOp, type Vec3 } from "./types.ts";

export interface BoxInfo {
  min: Vec3;
  max: Vec3;
  /** Edge rounding radius (0 = sharp). */
  r: number;
}

interface Node {
  field: Field;
  box: BoxInfo | null;
}

export interface CompiledProgram {
  field: Field;
  /** Per-op description of the SDF construction (exact or approximate). */
  notes: Record<string, string>;
  /** Ops whose SDF is only a first-order approximation of the B-Rep geometry. */
  approximate: string[];
}

const EPS = 1e-9;

function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Rounded box SDF (exact) with half-extents h and corner radius r (r <= min(h)). */
export function sdRoundedBox(x: number, y: number, z: number, box: BoxInfo): number {
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  const hx = (box.max[0] - box.min[0]) / 2 - box.r;
  const hy = (box.max[1] - box.min[1]) / 2 - box.r;
  const hz = (box.max[2] - box.min[2]) / 2 - box.r;
  return sdBox(x - cx, y - cy, z - cz, hx, hy, hz) - box.r;
}

/** Signed distance to a finite cylinder with flat caps, from a to b (segment axis), radius r. */
export function sdCappedSegment(p: Vec3, a: Vec3, b: Vec3, r: number): number {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(ba[0], ba[1], ba[2]);
  const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const s = (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (L || 1); // axial coordinate
  const px = pa[0] - (s / (L || 1)) * ba[0];
  const py = pa[1] - (s / (L || 1)) * ba[1];
  const pz = pa[2] - (s / (L || 1)) * ba[2];
  const rad = Math.hypot(px, py, pz);
  const dr = rad - r;
  const dz = Math.abs(s - L / 2) - L / 2;
  return Math.min(Math.max(dr, dz), 0) + Math.hypot(Math.max(dr, 0), Math.max(dz, 0));
}

function ensureNodeOf(nodes: Map<string, Node>, id: string | undefined, opId: string): Node {
  if (!id || !nodes.has(id)) throw new ProgramError(opId, `reference to undefined op "${id}"`);
  return nodes.get(id)!;
}

function needPositive(opId: string, name: string, v: number): void {
  if (!Number.isFinite(v) || v <= 0) throw new ProgramError(opId, `${name} must be a positive number (got ${v})`);
}

/** Compile a validated program to a single SDF field. Throws ProgramError on invalid input. */
export function compileProgramField(prog: FeatureProgram): CompiledProgram {
  const nodes = new Map<string, Node>();
  const notes: Record<string, string> = {};
  const approximate: string[] = [];
  if (!Array.isArray(prog.ops) || prog.ops.length === 0) throw new ProgramError(null, "program has no ops");

  for (const op of prog.ops) {
    if (nodes.has(op.id)) throw new ProgramError(op.id, "duplicate op id");
    let node: Node;
    switch (op.op) {
      case "box": {
        const corner = op.corner ?? [0, 0, 0];
        op.size.forEach((s, i) => needPositive(op.id, `size[${i}]`, s));
        const box: BoxInfo = {
          min: [corner[0], corner[1], corner[2]],
          max: [corner[0] + op.size[0], corner[1] + op.size[1], corner[2] + op.size[2]],
          r: 0,
        };
        node = { field: boxField(box, `box ${op.size.join("x")} at ${corner.join(",")}`), box };
        notes[op.id] = "exact: sdBox";
        break;
      }
      case "cylinder": {
        needPositive(op.id, "radius", op.radius);
        needPositive(op.id, "height", op.height);
        const b = op.base ?? [0, 0, 0];
        const a: Vec3 = [b[0], b[1], b[2]];
        const top: Vec3 = [b[0], b[1], b[2] + op.height];
        node = { field: segField(a, top, op.radius, `cylinder r=${op.radius} h=${op.height} base=${b.join(",")}`), box: null };
        notes[op.id] = "exact: capped cylinder";
        break;
      }
      case "sphere": {
        needPositive(op.id, "radius", op.radius);
        const c = op.center ?? [0, 0, 0];
        const r = op.radius;
        node = {
          field: {
            bounds: { min: [c[0] - r, c[1] - r, c[2] - r], max: [c[0] + r, c[1] + r, c[2] + r] },
            expr: `|p - (${c.join(",")})| - ${r}`,
            eval: (x, y, z) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r,
          },
          box: null,
        };
        notes[op.id] = "exact: sphere";
        break;
      }
      case "boolean": {
        const a = ensureNodeOf(nodes, op.a, op.id);
        const b = ensureNodeOf(nodes, op.b, op.id);
        const fa = a.field;
        const fb = b.field;
        if (op.kind === "union") {
          node = {
            field: {
              bounds: unionBounds(fa.bounds, fb.bounds),
              expr: `min(${fa.expr} , ${fb.expr})`,
              eval: (x, y, z) => Math.min(fa.eval(x, y, z), fb.eval(x, y, z)),
            },
            box: null,
          };
        } else if (op.kind === "intersect") {
          node = {
            field: {
              bounds: intersectBounds(fa.bounds, fb.bounds),
              expr: `max(${fa.expr} , ${fb.expr})`,
              eval: (x, y, z) => Math.max(fa.eval(x, y, z), fb.eval(x, y, z)),
            },
            box: null,
          };
        } else if (op.kind === "cut") {
          node = {
            field: {
              bounds: fa.bounds,
              expr: `max(${fa.expr} , -(${fb.expr}))`,
              eval: (x, y, z) => Math.max(fa.eval(x, y, z), -fb.eval(x, y, z)),
            },
            box: null,
          };
        } else {
          throw new ProgramError(op.id, `unknown boolean kind "${String((op as { kind: string }).kind)}"`);
        }
        notes[op.id] = "exact: min / max / -max for union / intersect / cut";
        break;
      }
      case "fillet": {
        const t = ensureNodeOf(nodes, op.target, op.id);
        needPositive(op.id, "radius", op.radius);
        if (t.box) {
          const half = Math.min(...t.box.min.map((v, i) => (t.box!.max[i] - v) / 2));
          if (op.radius >= half - 1e-9) throw new ProgramError(op.id, `radius ${op.radius} must be smaller than the half-size ${half}`);
          const box: BoxInfo = { min: t.box.min, max: t.box.max, r: op.radius };
          node = { field: boxField(box, `rounded box r=${op.radius}`), box };
          notes[op.id] = "exact: rounded box (sdRoundedBox)";
        } else {
          node = { field: t.field, box: null };
          notes[op.id] = "approximate: SDF not rounded for non-box targets (B-Rep is rounded)";
          approximate.push(op.id);
        }
        break;
      }
      case "shell": {
        const t = ensureNodeOf(nodes, op.target, op.id);
        needPositive(op.id, "thickness", op.thickness);
        const open = op.open ?? "none";
        if (t.box) {
          const { min, max, r } = t.box;
          if (2 * op.thickness >= Math.min(max[0] - min[0], max[1] - min[1], max[2] - min[2])) {
            throw new ProgramError(op.id, "thickness must be below half of the smallest box dimension");
          }
          const cavityBox: BoxInfo = {
            min: [min[0] + op.thickness, min[1] + op.thickness, open === "bottom" ? min[2] - 1 : min[2] + op.thickness],
            max: [max[0] - op.thickness, max[1] - op.thickness, open === "top" ? max[2] + 1 : max[2] - op.thickness],
            r: Math.max(0, r - op.thickness),
          };
          node = { field: shelledBoxField(t.box, cavityBox, `shell t=${op.thickness} open=${open}`), box: null };
          notes[op.id] = "exact: box minus inset box (sdRoundedBox)";
        } else {
          const tf = t.field;
          const cav = openingCavity(tf.bounds, op.thickness, open);
          node = {
            field: {
              bounds: tf.bounds,
              expr: `max(${tf.expr} , -min(${tf.expr} + ${op.thickness}, cavity_ext))`,
              eval: (x, y, z) => {
                const f = tf.eval(x, y, z);
                return Math.max(f, -Math.min(f + op.thickness, cav(x, y, z)));
              },
            },
            box: null,
          };
          notes[op.id] = "approximate: offset-by-t of the field (exact only for box targets)";
          approximate.push(op.id);
        }
        break;
      }
      case "graded_shell": {
        const t = ensureNodeOf(nodes, op.target, op.id);
        if (!t.box) throw new ProgramError(op.id, "graded_shell needs a box target (box / fillet / offset / shell of a box)");
        const expr = parseOrThrow(op.id, op.thickness);
        const cavities = gradedCavities(t.box, op, expr);
        const outer = t.field;
        const wallT = cavities.map((c) => c.t);
        const cavField = (x: number, y: number, z: number): number => {
          let d = Infinity;
          for (const c of cavities) d = Math.min(d, sdRoundedBox(x, y, z, c.box));
          return d;
        };
        node = {
          field: {
            bounds: outer.bounds,
            expr: `max(${outer.expr} , -min_k(sdBox_k))  [k=${cavities.length} slices, t(u)=${op.thickness}]`,
            eval: (x, y, z) => Math.max(outer.eval(x, y, z), -cavField(x, y, z)),
          },
          box: null,
        };
        notes[op.id] = `exact staircase: ${cavities.length} slices, t from ${Math.min(...wallT).toFixed(3)} to ${Math.max(...wallT).toFixed(3)} mm`;
        break;
      }
      case "offset": {
        const t = ensureNodeOf(nodes, op.target, op.id);
        if (!Number.isFinite(op.distance)) throw new ProgramError(op.id, "distance must be finite");
        const d = op.distance;
        if (t.box) {
          const min: Vec3 = [t.box.min[0] - d, t.box.min[1] - d, t.box.min[2] - d];
          const max: Vec3 = [t.box.max[0] + d, t.box.max[1] + d, t.box.max[2] + d];
          const r = t.box.r;
          if (min.some((v, i) => v >= max[i])) throw new ProgramError(op.id, "inward offset removes the whole solid");
          const box: BoxInfo = { min, max, r: Math.max(0, r) };
          node = { field: boxField(box, `offset box d=${d}`), box };
          notes[op.id] = "exact: sharp offset of a box (matches the mitred B-Rep offset)";
        } else {
          const tf = t.field;
          node = {
            field: {
              bounds: d > 0 ? { min: tf.bounds.min.map((v) => v - d) as Vec3, max: tf.bounds.max.map((v) => v + d) as Vec3 } : tf.bounds,
              expr: `${tf.expr} - (${d})`,
              eval: (x, y, z) => tf.eval(x, y, z) - d,
            },
            box: null,
          };
          notes[op.id] = "approximate: rounded offset f - d (B-Rep offset is mitred)";
          approximate.push(op.id);
        }
        break;
      }
      case "loft": {
        const secs = op.sections;
        if (!Array.isArray(secs) || secs.length < 2) throw new ProgramError(op.id, "loft needs at least two sections");
        if (op.ruled === false) throw new ProgramError(op.id, "only ruled lofts are supported (smooth loft is not implemented)");
        for (let i = 0; i < secs.length; i++) {
          const s = secs[i];
          needPositive(op.id, `sections[${i}].size[0]`, s.size[0]);
          needPositive(op.id, `sections[${i}].size[1]`, s.size[1]);
          if (i > 0 && !(s.z > secs[i - 1].z)) throw new ProgramError(op.id, "section heights must strictly increase");
        }
        const z0 = secs[0].z;
        const z1 = secs[secs.length - 1].z;
        const at = (z: number) => {
          let i = 0;
          while (i < secs.length - 2 && z > secs[i + 1].z) i++;
          const a = secs[i];
          const b = secs[i + 1];
          const w = Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z)));
          const ca = a.center ?? [0, 0];
          const cb = b.center ?? [0, 0];
          return {
            hx: (a.size[0] + (b.size[0] - a.size[0]) * w) / 2,
            hy: (a.size[1] + (b.size[1] - a.size[1]) * w) / 2,
            cx: ca[0] + (cb[0] - ca[0]) * w,
            cy: ca[1] + (cb[1] - ca[1]) * w,
          };
        };
        const bounds: Bounds = { min: [Infinity, Infinity, z0], max: [-Infinity, -Infinity, z1] };
        for (const s of secs) {
          const c = s.center ?? [0, 0];
          bounds.min[0] = Math.min(bounds.min[0], c[0] - s.size[0] / 2);
          bounds.max[0] = Math.max(bounds.max[0], c[0] + s.size[0] / 2);
          bounds.min[1] = Math.min(bounds.min[1], c[1] - s.size[1] / 2);
          bounds.max[1] = Math.max(bounds.max[1], c[1] + s.size[1] / 2);
        }
        node = {
          field: {
            bounds,
            expr: `max(|x-cx(z)|-hx(z), |y-cy(z)|-hy(z), z0-z, z-z1)  ruled loft through ${secs.length} sections`,
            eval: (x, y, z) => {
              const p = at(Math.min(z1, Math.max(z0, z)));
              return Math.max(Math.abs(x - p.cx) - p.hx, Math.abs(y - p.cy) - p.hy, z0 - z, z - z1);
            },
          },
          box: null,
        };
        notes[op.id] = "exact for ruled planar sections (bounding-plane SDF, sign-exact)";
        break;
      }
      case "sweep": {
        needPositive(op.id, "radius", op.radius);
        if (!Array.isArray(op.path) || op.path.length < 2) throw new ProgramError(op.id, "sweep path needs at least two points");
        const p0 = op.path[0];
        const p1 = op.path[1];
        if (Math.abs(p1[0] - p0[0]) > EPS || Math.abs(p1[1] - p0[1]) > EPS) {
          throw new ProgramError(op.id, "the first path segment must be vertical (circular profile lies in the XY plane)");
        }
        const segs: [Vec3, Vec3][] = [];
        for (let i = 0; i + 1 < op.path.length; i++) {
          const a = op.path[i];
          const b = op.path[i + 1];
          if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < EPS) throw new ProgramError(op.id, "zero-length path segment");
          segs.push([a, b]);
        }
        const r = op.radius;
        const bmin = [Infinity, Infinity, Infinity];
        const bmax = [-Infinity, -Infinity, -Infinity];
        for (const p of op.path) {
          for (let k = 0; k < 3; k++) {
            bmin[k] = Math.min(bmin[k], p[k] - r);
            bmax[k] = Math.max(bmax[k], p[k] + r);
          }
        }
        node = {
          field: {
            bounds: { min: bmin as Vec3, max: bmax as Vec3 },
            expr: `min_i sdCappedCylinder(p, seg_i, r=${r})`,
            eval: (x, y, z) => {
              let d = Infinity;
              for (const [a, b] of segs) d = Math.min(d, sdCappedSegment([x, y, z], a, b, r));
              return d;
            },
          },
          box: null,
        };
        notes[op.id] = "approximate: union of flat-capped cylinders (joints overlap; B-Rep sweep is mitred)";
        approximate.push(op.id);
        break;
      }
      default: {
        const never: never = op;
        throw new ProgramError((never as ProgramOp).id, "unknown op");
      }
    }
    nodes.set(op.id, node);
  }
  const result = nodes.get(prog.result);
  if (!result) throw new ProgramError(null, `result op "${prog.result}" is not defined`);
  return { field: result.field, notes, approximate };
}

/** Staircase cavities of a graded shell: one box per slice, each with its own wall thickness t(u). */
export function gradedCavities(
  box: BoxInfo,
  op: { id: string; slices?: number; open?: OpenFace },
  expr: { eval(v: { u: number }): number },
): { box: BoxInfo; t: number }[] {
  const slices = op.slices ?? 8;
  if (!Number.isInteger(slices) || slices < 1 || slices > 64) throw new ProgramError(op.id, "slices must be an integer 1..64");
  const { min, max } = box;
  const H = max[2] - min[2];
  const out: { box: BoxInfo; t: number }[] = [];
  for (let k = 0; k < slices; k++) {
    const z0 = min[2] + (k * H) / slices;
    const z1 = min[2] + ((k + 1) * H) / slices;
    const u = (k + 0.5) / slices;
    const th = expr.eval({ u });
    if (!(th > 0)) throw new ProgramError(op.id, `thickness(u=${u.toFixed(3)}) = ${th} must be positive`);
    if (2 * th >= Math.min(max[0] - min[0], max[1] - min[1])) throw new ProgramError(op.id, `thickness ${th.toFixed(3)} too large for the box`);
    const lo = k === 0 && op.open === "bottom" ? min[2] - 1 : Math.max(z0, min[2] + th);
    const hi = k === slices - 1 && op.open === "top" ? max[2] + 1 : Math.min(z1, max[2] - th);
    if (hi <= lo) continue;
    out.push({ box: { min: [min[0] + th, min[1] + th, lo], max: [max[0] - th, max[1] - th, hi], r: 0 }, t: th });
  }
  return out;
}

function parseOrThrow(opId: string, text: string): { eval(v: { u: number }): number } {
  try {
    return compileU(parseProfileAssignment(text));
  } catch (e) {
    throw new ProgramError(opId, `thickness expression: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function intersectBounds(a: Bounds, b: Bounds): Bounds {
  const min = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])] as Vec3;
  const max = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])] as Vec3;
  if (min.some((v, i) => v > max[i])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

function boxField(box: BoxInfo, label: string): Field {
  return {
    bounds: { min: box.min, max: box.max },
    expr: `sdRoundedBox(p; min=${box.min.join(",")}, max=${box.max.join(",")}, r=${box.r}) [${label}]`,
    eval: (x, y, z) => sdRoundedBox(x, y, z, box),
  };
}

function segField(a: Vec3, b: Vec3, r: number, label: string): Field {
  return {
    bounds: {
      min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2])],
      max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2])],
    },
    expr: `sdCappedCylinder(p; a=${a.join(",")}, b=${b.join(",")}, r=${r}) [${label}]`,
    eval: (x, y, z) => sdCappedSegment([x, y, z], a, b, r),
  };
}

/** Cavity for a shell of a box: inset box, open faces extended beyond the outer surface. */
function shelledBoxField(outer: BoxInfo, cavity: BoxInfo, label: string): Field {
  return {
    bounds: { min: outer.min, max: outer.max },
    expr: `max(sdRoundedBox(outer), -sdRoundedBox(cavity)) [${label}; cavity min=${cavity.min.join(",")} max=${cavity.max.join(",")}]`,
    eval: (x, y, z) => Math.max(sdRoundedBox(x, y, z, outer), -sdRoundedBox(x, y, z, cavity)),
  };
}

/** Extension box for open faces of a generic shell (the cavity continues through the opening). */
function openingCavity(b: Bounds, t: number, open: string): (x: number, y: number, z: number) => number {
  if (open === "none") return () => Infinity;
  const min: Vec3 = [b.min[0] + t, b.min[1] + t, open === "bottom" ? b.min[2] - 1 : b.min[2] + t];
  const max: Vec3 = [b.max[0] - t, b.max[1] - t, open === "top" ? b.max[2] + 1 : b.max[2] - t];
  const box: BoxInfo = { min, max, r: 0 };
  return (x, y, z) => sdRoundedBox(x, y, z, box);
}
