// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: "BCC lattice 20 mm, 4 mm cell, strut radius 0.5 mm, graded along z from 0.3 mm to 0.9 mm"
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): min over strut capsules of the bcc pattern (distance to segment - r(x))

import { evaluateSpec } from "../../src/evaluate.ts";
import type { DesignSpec } from "../../src/types.ts";

// ---- Parameters ----------------------------------------------------------------------------
const size_mm = 20;
const resolution = 96;
const min_printable_wall_mm = 0.4;
const parameters = {"cell_size_mm":4,"strut_radius_mm":0.5,"seed":42} as const;
const heterogeneity_field = {"rule":"linear","direction":"z","min":0.3,"max":0.9};

// ---- Design specification (IntentHarness output, with the constants above applied) ----------
const spec: DesignSpec = {
  topology: "lattice",
  bio_motif: "lattice:bcc",
  family: "lattice",
  variant: "bcc",
  parameters: { ...parameters },
  heterogeneity_field,
  target_metrics: {"connectivity":true},
  constraints: { size_mm, resolution, min_printable_wall_mm },
  retrieval: {"base_id":"cellular_generic","top_k":[{"id":"cellular_generic","score":4.624},{"id":"tubular_shapesize","score":2.477},{"id":"cellular_sandwich","score":2.134}]},
  confidence: 0.85,
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
