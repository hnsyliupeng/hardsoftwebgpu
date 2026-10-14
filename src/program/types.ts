// Feature program: a JSON timeline of parametric operations (SolidCraft-style feature history).
// The same program is executed twice:
//   * exact path : smlibwasm B-Rep, one kernel call per op (src/program/brep.ts)
//   * SDF path   : signed-distance field per op (src/program/sdf.ts), used for topology,
//                  wall thickness, preview and the B-Rep / SDF volume cross-check.
// Units: millimetres. Coordinates are absolute (the build volume is not re-centred).

export type Vec3 = [number, number, number];
export type OpenFace = "none" | "top" | "bottom";

export interface LoftSection {
  /** Height of the section plane (mm). Sections must have strictly increasing z. */
  z: number;
  /** Rectangle width (x) and depth (y) in mm. */
  size: [number, number];
  /** Section centre in x, y (mm). Default [0, 0]. */
  center?: [number, number];
}

export type ProgramOp =
  | { id: string; op: "box"; size: Vec3; corner?: Vec3 }
  | { id: string; op: "cylinder"; radius: number; height: number; base?: Vec3 }
  | { id: string; op: "sphere"; radius: number; center?: Vec3 }
  | { id: string; op: "boolean"; kind: "union" | "cut" | "intersect"; a: string; b: string }
  /** Rounds every edge of the target (B-Rep); SDF rounds exactly for box targets only. */
  | { id: string; op: "fillet"; target: string; radius: number }
  /** Hollows the target to a wall of `thickness`; `open` removes one face. */
  | { id: string; op: "shell"; target: string; thickness: number; open?: OpenFace }
  /** Heterogeneous wall: thickness(u) with u = (z - zmin) / (zmax - zmin) of a box target, in `slices` steps. */
  | { id: string; op: "graded_shell"; target: string; thickness: string; slices?: number; open?: OpenFace }
  /** Offsets the surface outward (distance > 0) or inward (distance < 0). */
  | { id: string; op: "offset"; target: string; distance: number }
  /** Ruled loft through rectangular sections placed at increasing heights. */
  | { id: string; op: "loft"; sections: LoftSection[]; ruled?: boolean }
  /** Circular profile of `radius` swept along a polyline; the first segment must be vertical. */
  | { id: string; op: "sweep"; radius: number; path: Vec3[] };

export interface FeatureProgram {
  name: string;
  ops: ProgramOp[];
  /** Id of the op whose result is the design. */
  result: string;
}

export interface ProgramStep {
  id: string;
  op: ProgramOp["op"];
  ok: boolean;
  volume: number | null;
  area: number | null;
  ms: number;
  note: string;
  error?: string;
}

export class ProgramError extends Error {
  readonly opId: string | null;
  constructor(opId: string | null, message: string) {
    super(opId ? `program op "${opId}": ${message}` : message);
    this.name = "ProgramError";
    this.opId = opId;
  }
}
