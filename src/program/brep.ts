// Exact path for feature programs: executes the timeline on the smlibwasm B-Rep kernel,
// one kernel call per op, recording volume / area / time after every step.
// Coordinates are absolute (no re-centring); the kernel's Box / Cylinder / Sphere are centred
// on their own origin, so every primitive is placed with Pos(centre).

import { loadKernel, measure, meshOf, type BrepSolid } from "../geometry/brep.ts";
import { gradedCavities, type BoxInfo } from "./sdf.ts";
import { compileU, parseProfileAssignment } from "../expr/expr.ts";
import { ProgramError, type FeatureProgram, type ProgramStep, type Vec3 } from "./types.ts";

export interface BrepProgramResult {
  solid: BrepSolid;
  steps: ProgramStep[];
}

/** Box description (sharp or rounded) tracked alongside each kernel shape, for graded shells. */
interface Tracked {
  shape: any;
  box: BoxInfo | null;
}

export async function executeBrepProgram(prog: FeatureProgram): Promise<BrepProgramResult> {
  const K: any = await loadKernel();
  const { Box, Cylinder, Sphere, Pos, Rectangle, Circle, Polyline, loft, sweep } = K;
  const nodes = new Map<string, Tracked>();
  const steps: ProgramStep[] = [];

  for (const op of prog.ops) {
    const t0 = Date.now();
    let note = "";
    try {
      let tr: Tracked;
      const get = (id: string | undefined): Tracked => {
        if (!id || !nodes.has(id)) throw new ProgramError(op.id, `reference to undefined op "${id}"`);
        return nodes.get(id)!;
      };
      switch (op.op) {
        case "box": {
          const c = op.corner ?? [0, 0, 0];
          const s = op.size;
          const centre: Vec3 = [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2];
          tr = {
            shape: Pos(...centre).mul(Box(s[0], s[1], s[2])),
            box: { min: [c[0], c[1], c[2]], max: [c[0] + s[0], c[1] + s[1], c[2] + s[2]], r: 0 },
          };
          break;
        }
        case "cylinder": {
          const b = op.base ?? [0, 0, 0];
          tr = { shape: Pos(b[0], b[1], b[2] + op.height / 2).mul(Cylinder(op.radius, op.height)), box: null };
          break;
        }
        case "sphere": {
          const c = op.center ?? [0, 0, 0];
          tr = { shape: Pos(...c).mul(Sphere(op.radius)), box: null };
          break;
        }
        case "boolean": {
          const a = get(op.a);
          const b = get(op.b);
          const shape =
            op.kind === "union" ? a.shape.fuse(b.shape) : op.kind === "cut" ? a.shape.cut(b.shape) : a.shape.intersect(b.shape);
          tr = { shape, box: null };
          break;
        }
        case "fillet": {
          const t = get(op.target);
          tr = {
            shape: t.shape.fillet(t.shape.edges(), op.radius),
            box: t.box ? { min: t.box.min, max: t.box.max, r: op.radius } : null,
          };
          note = "all edges rounded";
          break;
        }
        case "shell": {
          const t = get(op.target);
          const open = op.open ?? "none";
          const faces = open === "top" ? [t.shape.faces().top()] : open === "bottom" ? [t.shape.faces().bottom()] : [];
          const shape = t.shape.shell(op.thickness, faces);
          tr = { shape, box: null };
          note = `open=${open}`;
          break;
        }
        case "graded_shell": {
          const t = get(op.target);
          if (!t.box) throw new ProgramError(op.id, "graded_shell needs a box target");
          const expr = compileU(parseProfileAssignment(op.thickness));
          const cavities = gradedCavities(t.box, op, expr);
          let shape = t.shape;
          for (const c of cavities) {
            const b = c.box;
            const centre: Vec3 = [
              (b.min[0] + b.max[0]) / 2,
              (b.min[1] + b.max[1]) / 2,
              (b.min[2] + b.max[2]) / 2,
            ];
            shape = shape.cut(Pos(...centre).mul(Box(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])));
          }
          tr = { shape, box: null };
          note = `${cavities.length} slices`;
          break;
        }
        case "offset": {
          const t = get(op.target);
          const d = op.distance;
          tr = {
            shape: t.shape.offset(d),
            box: t.box ? { min: [t.box.min[0] - d, t.box.min[1] - d, t.box.min[2] - d], max: [t.box.max[0] + d, t.box.max[1] + d, t.box.max[2] + d], r: t.box.r } : null,
          };
          note = "mitred offset (kernel)";
          break;
        }
        case "loft": {
          if (op.ruled === false) throw new ProgramError(op.id, "only ruled lofts are supported");
          const sections = op.sections.map((s) => {
            const c = s.center ?? [0, 0];
            return Pos(c[0], c[1], s.z).mul(Rectangle(s.size[0], s.size[1]));
          });
          tr = { shape: loft(sections, { ruled: true }), box: null };
          note = `${op.sections.length} sections, ruled`;
          break;
        }
        case "sweep": {
          const p0 = op.path[0];
          const profile = Pos(p0[0], p0[1], p0[2]).mul(Circle(op.radius));
          tr = { shape: sweep(profile, Polyline(op.path.map((p) => [p[0], p[1], p[2]])), {}), box: null };
          note = `${op.path.length - 1} segments`;
          break;
        }
        default: {
          throw new ProgramError((op as { id: string }).id, "unknown op");
        }
      }
      nodes.set(op.id, tr);
      const m = measure(tr.shape);
      steps.push({ id: op.id, op: op.op, ok: true, volume: m.volume, area: m.area, ms: Date.now() - t0, note });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      steps.push({ id: op.id, op: op.op, ok: false, volume: null, area: null, ms: Date.now() - t0, note, error: msg });
      const err = e instanceof ProgramError ? e : new ProgramError(op.id, `kernel error: ${msg}`);
      (err as ProgramError & { steps?: ProgramStep[] }).steps = steps;
      throw err;
    }
  }

  const result = nodes.get(prog.result);
  if (!result) throw new ProgramError(null, `result op "${prog.result}" is not defined`);
  const m = measure(result.shape);
  const solid: BrepSolid = {
    shape: result.shape,
    volume: m.volume,
    area: m.area,
    centerOfMass: m.centerOfMass,
    parts: {},
    mesh: meshOf(K, result.shape),
  };
  return { solid, steps };
}
