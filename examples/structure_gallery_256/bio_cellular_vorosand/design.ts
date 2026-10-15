// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: "cellular voronoi sandwich smooth"
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): cellular_vorosand SDF (family-specific; see src/bio/families.ts)

import { evaluateSpec } from "../../../src/evaluate.ts";
import type { DesignSpec } from "../../../src/types.ts";

// ---- Parameters ----------------------------------------------------------------------------
const size_mm = 20;
const resolution = 256;
const min_printable_wall_mm = 0.4;
const parameters = {"thickness":0.2,"smoothlevel":3,"size":0.2,"seed":42} as const;
const heterogeneity_field = null;

// ---- Design specification (IntentHarness output, with the constants above applied) ----------
const spec: DesignSpec = {
  topology: "cellular",
  
  
  
  bio_motif: "cellular_vorosand",
  family: "cellular",
  variant: "cellular_vorosand",
  parameters: { ...parameters },
  heterogeneity_field,
  target_metrics: {"connectivity":true},
  constraints: { size_mm, resolution, min_printable_wall_mm },
  retrieval: {"base_id":"cellular_vorosand","top_k":[{"id":"cellular_vorosand","score":8.286},{"id":"cellular_voronoi","score":6.093},{"id":"cellular_sandwich","score":5.266}]},
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
