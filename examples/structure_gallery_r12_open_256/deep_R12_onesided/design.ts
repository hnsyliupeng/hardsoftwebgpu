// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: "coupled R12: one-sided gate-set iso-level, net volume coupling"
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): coupled:R12 SDF (family-specific; see src/bio/families.ts)

import { evaluateSpec } from "../../../src/evaluate.ts";
import type { DesignSpec } from "../../../src/types.ts";

// ---- Parameters ----------------------------------------------------------------------------
const size_mm = 20;
const resolution = 256;
const min_printable_wall_mm = 0.4;
const parameters = {} as const;
const heterogeneity_field = null;

// ---- Design specification (IntentHarness output, with the constants above applied) ----------
const spec: DesignSpec = {
  topology: "coupled",
  coupled: {"round":"R12","params":{"skin_mm":0}} as unknown as NonNullable<DesignSpec["coupled"]>,
  
  
  bio_motif: "coupled:R12",
  family: "coupled",
  variant: "R12",
  parameters: { ...parameters },
  heterogeneity_field,
  target_metrics: {"connectivity":true},
  constraints: { size_mm, resolution, min_printable_wall_mm },
  retrieval: {"base_id":"cellular_generic","top_k":[{"id":"cellular_generic","score":0},{"id":"cellular_sandwich","score":0},{"id":"cellular_voronoi","score":0}]},
  confidence: 0.25,
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
