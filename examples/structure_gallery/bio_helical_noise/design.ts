// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: "helical noise irregular rotation"
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): helical_noise SDF (family-specific; see src/bio/families.ts)

import { evaluateSpec } from "../../../src/evaluate.ts";
import type { DesignSpec } from "../../../src/types.ts";

// ---- Parameters ----------------------------------------------------------------------------
const size_mm = 20;
const resolution = 96;
const min_printable_wall_mm = 0.4;
const parameters = {"num_plies":10,"rotation":10,"noise":5,"seed":42} as const;
const heterogeneity_field = null;

// ---- Design specification (IntentHarness output, with the constants above applied) ----------
const spec: DesignSpec = {
  topology: "helical",
  
  bio_motif: "helical_noise",
  family: "helical",
  variant: "helical_noise",
  parameters: { ...parameters },
  heterogeneity_field,
  target_metrics: {"connectivity":true},
  constraints: { size_mm, resolution, min_printable_wall_mm },
  retrieval: {"base_id":"helical_noise","top_k":[{"id":"helical_noise","score":7.229},{"id":"helical_generic","score":4.094},{"id":"helical_cylinfibers","score":1.901}]},
  confidence: 0.7,
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
