// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: "fusion union: gyroid TPMS with helical plies"
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): fusion (union) of two designs; field = min(A, B)

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
  topology: "fusion",
  
  fusion: {"mode":"union","a":{"topology":"tpms","bio_motif":"tpms:gyroid","family":"tpms","variant":"gyroid","parameters":{"seed":42,"cell_size_mm":5,"wall_thickness_mm":0.5},"heterogeneity_field":null,"target_metrics":{"connectivity":true},"constraints":{"size_mm":20,"min_printable_wall_mm":0.4,"resolution":256},"retrieval":{"base_id":"cellular_generic","top_k":[{"id":"cellular_generic","score":0},{"id":"cellular_sandwich","score":0},{"id":"cellular_voronoi","score":0}]},"confidence":0.85,"unknowns":["Build edge length not given; 20 mm cube assumed.","Printability floor not given; 0.4 mm assumed for the RepairHarness.","Unit cell size not given; 4 mm assumed.","TPMS wall thickness not given; 12% of the period assumed."],"notes":[]},"b":{"topology":"helical","bio_motif":"helical_generic","family":"helical","variant":"helical_generic","parameters":{"num_plies":10,"rotation":10,"seed":42},"heterogeneity_field":null,"target_metrics":{"connectivity":true},"constraints":{"size_mm":20,"min_printable_wall_mm":0.4,"resolution":256},"retrieval":{"base_id":"helical_generic","top_k":[{"id":"helical_generic","score":7.237},{"id":"helical_noise","score":3.567},{"id":"helical_cylinfibers","score":2.594}]},"confidence":0.7,"unknowns":["Build edge length not given; 20 mm cube assumed.","Printability floor not given; 0.4 mm assumed for the RepairHarness."],"notes":[]}} as unknown as NonNullable<DesignSpec["fusion"]>,
  
  bio_motif: "fusion:union",
  family: "fusion",
  variant: "union",
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
