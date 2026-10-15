// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: "deep fusion hierarchical foam: Voronoi walls with BCC lattice inside each cell"
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): deep fusion (foam_lattice): coupled field, see src/topology/deep.ts

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
  
  
  deep: {"kind":"foam_lattice","seeds":3,"wall_mm":0.8,"lattice_cell_mm":2.5,"lattice_radius_mm":0.25} as NonNullable<DesignSpec["deep"]>,
  bio_motif: "deep:foam_lattice",
  family: "deep",
  variant: "foam_lattice",
  parameters: { ...parameters },
  heterogeneity_field,
  target_metrics: {"connectivity":true},
  constraints: { size_mm, resolution, min_printable_wall_mm },
  retrieval: {"base_id":"cellular_generic","top_k":[{"id":"cellular_generic","score":4.345},{"id":"cellular_sandwich","score":1.854},{"id":"cellular_voronoi","score":1.854}]},
  confidence: 0.6,
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
