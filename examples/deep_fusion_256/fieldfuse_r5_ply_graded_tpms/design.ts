// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: "deep fusion triple: twisted helical plies of gyroid with Voronoi-graded thickness"
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): deep fusion (ply_graded_tpms): coupled field, see src/topology/deep.ts

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
  topology: "deep",
  
  
  deep: {"kind":"ply_graded_tpms","plies":10,"twist_deg":18,"seeds":4,"t_min_mm":0.7,"t_max_mm":1} as NonNullable<DesignSpec["deep"]>,
  bio_motif: "deep:ply_graded_tpms",
  family: "deep",
  variant: "ply_graded_tpms",
  parameters: { ...parameters },
  heterogeneity_field,
  target_metrics: {"connectivity":true},
  constraints: { size_mm, resolution, min_printable_wall_mm },
  retrieval: {"base_id":"helical_generic","top_k":[{"id":"helical_generic","score":2.421},{"id":"helical_cylinfibers","score":0},{"id":"helical_noise","score":0}]},
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
