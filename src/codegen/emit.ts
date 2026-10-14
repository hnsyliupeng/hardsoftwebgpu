// GeometryHarness code output: a self-contained TypeScript parametric program that rebuilds the
// final (post-repair) design through the same kernels. Run from the project root with Node >= 22.18:
//   node --experimental-strip-types artifacts/<name>/design.ts

import type { DesignSpec } from "../types.ts";

export function emitParametricCode(spec: DesignSpec, prompt: string, importPath = "../../src/evaluate.ts"): string {
  const h = spec.heterogeneity_field;
  const sdf = describeSdf(spec);
  const prog = spec.program
    ? `// ---- Feature program (SolidCraft-style timeline; executed in order on smlibwasm) ----------\nconst program = ${JSON.stringify(spec.program, null, 2)} as const;\n\n`
    : "";
  return `// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: ${JSON.stringify(prompt)}
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): ${sdf}

import { evaluateSpec } from "${importPath}";
import type { DesignSpec } from "${importPath.replace("evaluate.ts", "types.ts")}";

${prog}// ---- Parameters ----------------------------------------------------------------------------
const size_mm = ${spec.constraints.size_mm};
const resolution = ${spec.constraints.resolution};
const min_printable_wall_mm = ${spec.constraints.min_printable_wall_mm};
const parameters = ${JSON.stringify(spec.parameters)} as const;
const heterogeneity_field = ${h ? JSON.stringify(h) : "null"};

// ---- Design specification (IntentHarness output, with the constants above applied) ----------
const spec: DesignSpec = {
  topology: ${JSON.stringify(spec.topology)},${spec.program ? "\n  program: program as unknown as NonNullable<DesignSpec[\"program\"]>," : ""}
  ${spec.coupled ? `coupled: ${JSON.stringify(spec.coupled)} as unknown as NonNullable<DesignSpec["coupled"]>,` : ""}
  ${spec.fusion ? `fusion: ${JSON.stringify(spec.fusion)} as unknown as NonNullable<DesignSpec["fusion"]>,` : ""}
  bio_motif: ${JSON.stringify(spec.bio_motif)},
  family: ${JSON.stringify(spec.family)},
  variant: ${JSON.stringify(spec.variant)},
  parameters: { ...parameters },
  heterogeneity_field,
  target_metrics: ${JSON.stringify(spec.target_metrics)},
  constraints: { size_mm, resolution, min_printable_wall_mm },
  retrieval: ${JSON.stringify(spec.retrieval)},
  confidence: ${spec.confidence},
  unknowns: [],
  notes: [],
};

// ---- Harness chain: TopologyHarness -> GeometryHarness -> ValidationHarness -----------------
const ev = await evaluateSpec(spec);
const m = ev.validation.data.metrics;
console.log(JSON.stringify({
  volume_mm3: m.volume,
  surface_area_mm2: m.surface_area,
  min_wall_thickness_mm: m.min_wall_thickness,
  connectivity: m.connectivity,
  genus: m.genus,
  center_of_mass_mm: m.center_of_mass,
  volume_source: m.volume_source,
  porosity: m.porosity,
  timeline_steps: ev.geometry.data.programSteps,
}, null, 2));
`;
}

function describeSdf(spec: DesignSpec): string {
  switch (spec.topology) {
    case "program":
      return "feature timeline: per-op SDF (sdRoundedBox / capped cylinder / min-max booleans / inset shells / ruled loft / capped sweep); see src/program/sdf.ts";
    case "tpms":
      return `|F(x,y,z)| - t/2 with F = ${spec.variant} implicit (see TPMS_EXPR in src/topology/lattice.ts)`;
    case "lattice":
      return `min over strut capsules of the ${spec.variant} pattern (distance to segment - r(x))`;
    case "hybrid":
      return `min(strut lattice SDF, ${spec.bio_motif} SDF)`;
    case "fusion":
      return `fusion (${spec.fusion?.mode}) of two designs; field = ${spec.fusion?.mode === "zoned" ? "min(max(A, z - zc - o/2), max(B, zc - o/2 - z))" : spec.fusion?.mode === "intersect" ? "max(A, B)" : "min(A, B)"}`;
    default:
      return `${spec.bio_motif} SDF (family-specific; see src/bio/families.ts)`;
  }
}
