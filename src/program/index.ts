// Feature-program helpers: validation of the JSON document, the DesignSpec wrapper used by the
// pipeline, the example programs shipped with the web app and the tests, and the repair hook.

import { compileProgramField } from "./sdf.ts";
import { ProgramError, type FeatureProgram, type ProgramOp } from "./types.ts";
import type { DesignSpec } from "../types.ts";

export * from "./types.ts";
export { compileProgramField } from "./sdf.ts";
export { executeBrepProgram } from "./brep.ts";

/** Structural validation of an untrusted JSON document (throws ProgramError with a clear message). */
export function parseProgramJson(text: string): FeatureProgram {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new ProgramError(null, `invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const p = doc as FeatureProgram;
  if (!p || typeof p !== "object" || !Array.isArray(p.ops)) throw new ProgramError(null, "program needs an ops array");
  if (typeof p.name !== "string" || !p.name) throw new ProgramError(null, "program needs a name");
  if (typeof p.result !== "string") throw new ProgramError(null, "program needs a result op id");
  const KNOWN = new Set(["box", "cylinder", "sphere", "boolean", "fillet", "shell", "graded_shell", "offset", "loft", "sweep"]);
  for (const op of p.ops as ProgramOp[]) {
    if (!op || typeof op.id !== "string" || !KNOWN.has(op.op)) throw new ProgramError(op?.id ?? null, `unknown or malformed op "${op?.op}"`);
  }
  // Semantic validation (references, positivity, geometry rules) happens in the SDF compiler.
  compileProgramField(p);
  return p;
}

/** Bounding box of the program's result field (mm). */
export function programBounds(prog: FeatureProgram): { min: [number, number, number]; max: [number, number, number] } {
  return compileProgramField(prog).field.bounds as { min: [number, number, number]; max: [number, number, number] };
}

/** DesignSpec wrapper for a feature program (topology "program"). */
export function makeProgramSpec(prog: FeatureProgram, opts: { resolution?: number; minWallMm?: number } = {}): DesignSpec {
  const b = programBounds(prog);
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  return {
    topology: "program",
    program: prog,
    bio_motif: "",
    family: "program",
    variant: prog.name,
    parameters: {},
    heterogeneity_field: null,
    target_metrics: { connectivity: true },
    constraints: {
      size_mm: Math.max(1, Math.round(size * 1000) / 1000),
      min_printable_wall_mm: opts.minWallMm ?? 0.4,
      resolution: opts.resolution ?? 96,
    },
    retrieval: { base_id: "", top_k: [] },
    confidence: 0.95,
    unknowns: [],
    notes: ["Feature program supplied as JSON (timeline mode); the IntentHarness is bypassed."],
  };
}

/**
 * Repair target for thickness: the first shell / graded_shell op. Returns a copy of the program
 * with that thickness multiplied by `factor`, or null when the program has no wall to thicken.
 */
export function scaleWallThickness(prog: FeatureProgram, factor: number): { program: FeatureProgram; opId: string; from: string; to: string } | null {
  const idx = prog.ops.findIndex((o) => o.op === "shell" || o.op === "graded_shell");
  if (idx < 0) return null;
  const next = structuredClone(prog);
  const op = next.ops[idx];
  if (op.op === "shell") {
    const from = String(op.thickness);
    op.thickness = Math.round(op.thickness * factor * 1000) / 1000;
    return { program: next, opId: op.id, from, to: String(op.thickness) };
  }
  if (op.op === "graded_shell") {
    const from = op.thickness;
    op.thickness = `(${op.thickness.replace(/^\s*(?:thickness|radius|t|r)\s*\(\s*u\s*\)\s*=\s*/i, "")}) * ${Math.round(factor * 1000) / 1000}`;
    return { program: next, opId: op.id, from, to: op.thickness };
  }
  return null;
}

// ---- Example programs (also used by the web app and the CPU self-test) --------------------

export const EXAMPLE_PROGRAMS: Record<string, FeatureProgram> = {
  rounded_hollow_box: {
    name: "rounded_hollow_box",
    result: "cut_hole",
    ops: [
      { id: "blank", op: "box", size: [20, 20, 20] },
      { id: "rounded", op: "fillet", target: "blank", radius: 2 },
      // Kernel limitation: shelling a filleted box with an open face fails (SM_ERR); the closed shell works.
      { id: "hollow", op: "shell", target: "rounded", thickness: 1.5, open: "none" },
      { id: "drill", op: "cylinder", radius: 3, height: 4, base: [10, 10, -1] },
      { id: "cut_hole", op: "boolean", kind: "cut", a: "hollow", b: "drill" },
    ],
  },
  graded_wall_box: {
    name: "graded_wall_box",
    result: "graded",
    ops: [
      { id: "blank", op: "box", size: [24, 24, 24] },
      { id: "graded", op: "graded_shell", target: "blank", thickness: "thickness(u) = 0.6 + 1.4 * u", slices: 8, open: "top" },
    ],
  },
  loft_sweep_stem: {
    name: "loft_sweep_stem",
    result: "stem",
    ops: [
      {
        id: "base",
        op: "loft",
        sections: [
          { z: 0, size: [20, 16] },
          { z: 10, size: [12, 12], center: [0, 0] },
        ],
        ruled: true,
      },
      { id: "rod", op: "sweep", radius: 2, path: [[0, 0, 0], [0, 0, 20], [10, 0, 30]] },
      { id: "stem", op: "boolean", kind: "union", a: "base", b: "rod" },
    ],
  },
  offset_plate: {
    name: "offset_plate",
    result: "grown",
    ops: [
      { id: "plate", op: "box", size: [20, 12, 4] },
      { id: "grown", op: "offset", target: "plate", distance: 1 },
    ],
  },
};
