// TopologyHarness: DesignSpec -> implicit field (mm) + named bodies + optional exact B-Rep plan.
// Families: bioinspired helical / cellular / tubular (12 base structures), strut lattices
// (SC, BCC, FCC, FBCC, Diamond), TPMS (Gyroid, Schwarz P, Schwarz D), and hybrid unions.

import { buildCoupled } from "./coupled.ts";
import { buildDeepField } from "./deep.ts";
import type { BrepPlan } from "../bio/families.ts";
import { buildBio, toMillimetres, type BioBuild } from "../bio/families.ts";
import { clipToBox, sdBox, sdUnion, type Field } from "./fields.ts";
import { makeHeterogeneity } from "./heterogeneous.ts";
import { strutLattice, tpmsShell, TPMS_EXPR } from "./lattice.ts";
import type { DesignSpec, HarnessResult, HeterogeneityField, LatticeType, TpmsType } from "../types.ts";
import { compileProgramField } from "../program/sdf.ts";
import type { FeatureProgram } from "../program/types.ts";

export interface TopologyBuild {
  field: Field;
  parts: Record<string, Field>;
  smoothPasses: number;
  brep: BrepPlan | null;
  bio: BioBuild | null;
  /** Cells per axis and cell edge for lattice / TPMS families. */
  cells: [number, number, number] | null;
  cellSize: number | null;
  description: string;
  /** Feature program (topology "program"): executed exactly by GeometryHarness. */
  program: FeatureProgram | null;
  /** Per-op SDF construction notes (exact / approximate). */
  programNotes: Record<string, string>;
  /** Ops whose SDF is only approximate (B-Rep remains the reference). */
  programApproximate: string[];
}

export const LATTICE_TYPES: LatticeType[] = ["sc", "bcc", "fcc", "fbcc", "diamond", "kelvin", "bccz"];
export const TPMS_TYPES: TpmsType[] = ["gyroid", "schwarz_p", "schwarz_d", "neovius", "iwp", "lidinoid"];

const DEFAULTS = {
  cell_size_mm: 4,
  strut_radius_factor: 0.1, // strut radius = factor * cell size, when not given
  wall_thickness_factor: 0.12, // TPMS wall = factor * cell size, when not given
};

function cellsFor(sizeMm: number, cellSizeMm: number): { cells: [number, number, number]; cellSize: number } {
  const n = Math.max(1, Math.round(sizeMm / cellSizeMm));
  return { cells: [n, n, n], cellSize: sizeMm / n };
}

function numberParam(spec: DesignSpec, key: string, fallback: number): number {
  const v = spec.parameters[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function latticeField(spec: DesignSpec, type: LatticeType, het: HeterogeneityField | null): { field: Field; cells: [number, number, number]; cellSize: number } {
  const L = spec.constraints.size_mm;
  const { cells, cellSize } = cellsFor(L, numberParam(spec, "cell_size_mm", DEFAULTS.cell_size_mm));
  const radius = numberParam(spec, "strut_radius_mm", DEFAULTS.strut_radius_factor * cellSize);
  const field = strutLattice({ type, cellSize, cells, radius, heterogeneity: het });
  return { field: clipToBox(field, L), cells, cellSize };
}

function tpmsFieldFor(spec: DesignSpec, type: TpmsType, het: HeterogeneityField | null): { field: Field; cells: [number, number, number]; cellSize: number } {
  const L = spec.constraints.size_mm;
  const { cells, cellSize } = cellsFor(L, numberParam(spec, "cell_size_mm", DEFAULTS.cell_size_mm));
  const thickness = numberParam(spec, "wall_thickness_mm", DEFAULTS.wall_thickness_factor * cellSize);
  const field = tpmsShell({ type, cellSize, cells, thickness, heterogeneity: het });
  return { field, cells, cellSize };
}

export function buildTopology(spec: DesignSpec): HarnessResult<TopologyBuild> {
  const observations: string[] = [];
  const limitations: string[] = [];
  const unknowns: string[] = [...spec.unknowns];
  const L = spec.constraints.size_mm;
  const het = spec.heterogeneity_field;
  let build: TopologyBuild;

  if (spec.topology === "helical" || spec.topology === "tubular" || spec.topology === "cellular") {
    const bio = buildBio(spec.bio_motif, spec.parameters as Record<string, number>, numberParam(spec, "seed", 42));
    const field = toMillimetres(bio.baseField, L);
    const parts: Record<string, Field> = {};
    for (const [k, f] of Object.entries(bio.parts)) parts[k] = toMillimetres(f, L);
    build = {
      field,
      parts,
      smoothPasses: bio.smoothPasses,
      brep: bio.brep,
      bio,
      cells: null,
      cellSize: null,
      description: `${bio.base.id} (${bio.base.description})`,
      program: null,
      programNotes: {},
      programApproximate: [],
    };
    observations.push(`Resolved base structure ${bio.base.id}: ${JSON.stringify(bio.params)} (seed ${bio.seed}).`);
    if (bio.clamped.length) observations.push(`Parameters clamped to benchmark ranges: ${bio.clamped.join("; ")}.`);
    if (bio.defaulted.length) unknowns.push(`Parameters not given, defaults used: ${bio.defaulted.join(", ")}.`);
    limitations.push(...bio.notes);
    if (!bio.brep) limitations.push("No exact B-Rep plan for this family; geometry is SDF-only (mesh export, no STEP).");
    if (het) limitations.push("heterogeneity_field is not applied to bioinspired base families (their own parameters define the variation).");
  } else if (spec.topology === "lattice") {
    const type = (LATTICE_TYPES as string[]).includes(spec.variant) ? (spec.variant as LatticeType) : "bcc";
    const r = latticeField(spec, type, het);
    build = {
      field: r.field,
      parts: {},
      smoothPasses: 0,
      brep: null,
      bio: null,
      cells: r.cells,
      cellSize: r.cellSize,
      program: null,
      programNotes: {},
      programApproximate: [],
      description: `${type.toUpperCase()} strut lattice, ${r.cells.join("x")} cells of ${r.cellSize.toFixed(3)} mm`,
    };
    observations.push(`Strut lattice ${type} with ${r.cells.join("x")} cells, cell edge ${r.cellSize.toFixed(4)} mm (build edge ${L} mm).`);
    limitations.push("Strut lattices are SDF-only (capsule unions); exact STEP export is not generated for them.");
    if (het) limitations.push("Heterogeneous radius is evaluated per cell along the chosen axis (piecewise constant per cell).");
  } else if (spec.topology === "tpms") {
    const type = (TPMS_TYPES as string[]).includes(spec.variant) ? (spec.variant as TpmsType) : "gyroid";
    const r = tpmsFieldFor(spec, type, het);
    build = {
      field: r.field,
      parts: {},
      smoothPasses: 0,
      brep: null,
      bio: null,
      cells: r.cells,
      cellSize: r.cellSize,
      program: null,
      programNotes: {},
      programApproximate: [],
      description: `${type} TPMS sheet, period ${r.cellSize.toFixed(3)} mm`,
    };
    observations.push(`TPMS ${type}: F = ${TPMS_EXPR[type]}; period ${r.cellSize.toFixed(4)} mm, ${r.cells.join("x")} periods.`);
    limitations.push("TPMS sheets use the first-order distance |F|/|grad F| - t/2 (not an exact Euclidean SDF); accurate near the sheet.");
    limitations.push("TPMS geometry is SDF-only; STL/glTF are produced by surface nets, STEP is not available.");
  } else if (spec.topology === "program") {
    if (!spec.program) throw new Error("topology \"program\" requires spec.program");
    const compiled = compileProgramField(spec.program);
    build = {
      field: compiled.field,
      parts: {},
      smoothPasses: 0,
      brep: null,
      bio: null,
      cells: null,
      cellSize: null,
      program: spec.program,
      programNotes: compiled.notes,
      programApproximate: compiled.approximate,
      description: `feature program "${spec.program.name}" (${spec.program.ops.length} timeline ops, result ${spec.program.result})`,
    };
    observations.push(`Timeline ops: ${spec.program.ops.map((o) => `${o.id}:${o.op}`).join(" -> ")}.`);
    for (const [id, note] of Object.entries(compiled.notes)) observations.push(`SDF ${id}: ${note}.`);
    limitations.push("SDF sign convention per op is listed in observations; approximate ops are reported in the limitations below.");
    if (compiled.approximate.length) {
      limitations.push(`SDF approximation for ops ${compiled.approximate.join(", ")}: the B-Rep is the reference; the cross-check reports the deviation.`);
    }
    limitations.push("Feature programs: all coordinates are absolute millimetres; the kernel is smlibwasm (no re-centring).");
  } else if (spec.topology === "coupled") {
    // Deep coupling: one structure's geometry is driven by another's field (src/topology/coupled.ts).
    if (!spec.coupled) throw new Error("topology \"coupled\" requires spec.coupled");
    const c = buildCoupled(spec.coupled, L);
    build = {
      field: c.field,
      parts: {},
      smoothPasses: 0,
      brep: null,
      bio: null,
      cells: null,
      cellSize: null,
      program: null,
      programNotes: {},
      programApproximate: [],
      description: c.description,
    };
    observations.push(...c.observations);
    observations.push(`Coupling metrics: ${JSON.stringify(c.coupling_metrics)}.`);
    observations.push(`Resolved coupled parameters: ${JSON.stringify(c.resolved_params)}.`);
    limitations.push(...c.limitations);
  } else if (spec.topology === "deep") {
    // Deep fusion (src/topology/deep.ts): the parts are coupled inside one field.
    if (!spec.deep) throw new Error('topology "deep" requires spec.deep');
    const d = buildDeepField(spec.deep, L);
    build = {
      field: d.field,
      parts: {},
      smoothPasses: 0,
      brep: null,
      bio: null,
      cells: null,
      cellSize: null,
      program: null,
      programNotes: {},
      programApproximate: [],
      description: d.description,
    };
    observations.push(...d.observations);
    limitations.push(...d.limitations);
  } else if (spec.topology === "fusion") {
    // Fusion of two complete designs. Each part is built by the same TopologyHarness with the
    // parent's size and constraints, so the parts stay in one coordinate frame (mm, box [0, L]^3).
    if (!spec.fusion) throw new Error("topology \"fusion\" requires spec.fusion");
    const fa = buildTopology(spec.fusion.a).data;
    const fbb = spec.fusion.b ? buildTopology(spec.fusion.b).data : null;
    const mode = spec.fusion.mode;
    const fbA = fa.field;
    const fbB = fbb ? fbb.field : fbA;
    let field: Field;
    if (!fbb) {
      field = fbA;
    } else if (mode === "union") {
      field = { bounds: { min: [0, 0, 0], max: [L, L, L] }, expr: `min( A , B )  [A: ${fbA.expr}] [B: ${fbB.expr}]`, eval: (x, y, z) => Math.min(fbA.eval(x, y, z), fbB.eval(x, y, z)) };
    } else if (mode === "intersect") {
      field = { bounds: { min: [0, 0, 0], max: [L, L, L] }, expr: `max( A , B )  [A: ${fbA.expr}] [B: ${fbB.expr}]`, eval: (x, y, z) => Math.max(fbA.eval(x, y, z), fbB.eval(x, y, z)) };
    } else {
      // zoned: A keeps the region z <= zc + o/2 and B keeps z >= zc - o/2 (zc = L/2, o = overlap band).
      // Each part is cut by its own half-space with max(), and the two parts are united with min().
      const zc = L / 2;
      const o = spec.fusion.overlap_mm ?? 1.0;
      field = {
        bounds: { min: [0, 0, 0], max: [L, L, L] },
        expr: `min( max(A, z - (zc + o/2)) , max(B, (zc - o/2) - z) ), zc=${zc} mm, overlap ${o} mm  [A: ${fbA.expr}] [B: ${fbB.expr}]`,
        eval: (x, y, z) => Math.min(Math.max(fbA.eval(x, y, z), z - (zc + o / 2)), Math.max(fbB.eval(x, y, z), zc - o / 2 - z)),
      };
    }
    if (spec.fusion.skin_mm && spec.fusion.skin_mm > 0) {
      // Closed skin of thickness t on the envelope [0, L]^3: |d + t/2| - t/2 with d the box distance.
      const t = spec.fusion.skin_mm;
      const core = field;
      const skinField: Field = {
        bounds: { min: [0, 0, 0], max: [L, L, L] },
        expr: `|sdBox(p) + t/2| - t/2, t=${t} mm (envelope skin)`,
        eval: (x, y, z) => Math.abs(sdBox(x - L / 2, y - L / 2, z - L / 2, L / 2, L / 2, L / 2) + t / 2) - t / 2,
      };
      field = {
        bounds: { min: [0, 0, 0], max: [L, L, L] },
        expr: `min( core , skin )  [core: ${core.expr}] [skin: ${skinField.expr}]`,
        eval: (x, y, z) => Math.min(core.eval(x, y, z), skinField.eval(x, y, z)),
      };
      observations.push(`Envelope skin ${t} mm unioned with the fused core so that every strut is attached to the envelope.`);
    }
    build = {
      field,
      parts: { A: fbA, B: fbB },
      smoothPasses: 0,
      brep: null,
      bio: null,
      cells: null,
      cellSize: null,
      program: null,
      programNotes: {},
      programApproximate: [],
      description: fbb ? `fusion (${mode}): [${fa.description}] with [${fbb.description}]` : `${fa.description} with envelope skin`,
    };
    observations.push(fbb ? `Fusion ${mode} of two designs: A = ${fa.description}; B = ${fbb.description}.` : `Single design with envelope skin: ${fa.description}.`);
    limitations.push("Fusion geometry is SDF-only. Zoned fusion cuts each part with a half-space and unites them over an overlap band; the seam is a planar cut, not an exact B-Rep boolean.");
  } else {
    // hybrid: union of a strut/TPMS lattice and a bioinspired base structure (both in mm).
    const variant = spec.variant.includes(":") ? spec.variant.split(":")[1] : spec.variant;
    const latticeType = (LATTICE_TYPES as string[]).includes(variant) ? (variant as LatticeType) : "bcc";
    const lat = latticeField(spec, latticeType, het);
    const bio = buildBio(spec.bio_motif, spec.parameters as Record<string, number>, numberParam(spec, "seed", 42));
    const bioField = toMillimetres(bio.baseField, L);
    const field: Field = {
      bounds: { min: [0, 0, 0], max: [L, L, L] },
      expr: `min( ${lat.field.expr} , ${bioField.expr} )`,
      eval: (x, y, z) => sdUnion(lat.field.eval(x, y, z), bioField.eval(x, y, z)),
    };
    build = {
      field,
      parts: { lattice: lat.field, bio: bioField },
      smoothPasses: bio.smoothPasses,
      brep: null,
      bio,
      cells: lat.cells,
      cellSize: lat.cellSize,
      program: null,
      programNotes: {},
      programApproximate: [],
      description: `hybrid: ${latticeType} lattice union ${bio.base.id}`,
    };
    observations.push(`Hybrid union of ${latticeType} lattice and ${bio.base.id}.`);
    limitations.push("Hybrid geometry is SDF-only (union of fields); no exact B-Rep.");
  }

  const evidence = {
    reproducible_params: { family: spec.family, variant: spec.variant, parameters: spec.parameters, size_mm: L, heterogeneity: het, program: spec.program ?? null },
    sdf_expression: build.field.expr,
    source_refs: [
      "Bioinspired123D base codes (lamm-mit/Bioinspired123D, Apache-2.0)",
      "LatticeQuery lattice topologies and heterogeneous rules (jalovisko/LatticeQuery, Apache-2.0)",
      "smlibwasm / SMLib NURBS kernel (awv-informatik/smlibpy MIT; NVIDIA usd-brep Apache-2.0)",
    ],
  };
  return {
    harness: "TopologyHarness",
    ok: true,
    data: build,
    observations: [build.description, ...observations],
    limitations,
    unknowns,
    evidence,
  };
}
