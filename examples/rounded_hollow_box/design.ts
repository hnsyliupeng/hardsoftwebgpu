// Bioinspired123D-WASM parametric design (final state after RepairHarness).
// Prompt: "feature program rounded_hollow_box"
// Run from the project root:  node --experimental-strip-types artifacts/<name>/design.ts
// Edit the constants below and re-run to regenerate geometry and metrics.
// SDF (reference): feature timeline: per-op SDF (sdRoundedBox / capped cylinder / min-max booleans / inset shells / ruled loft / capped sweep); see src/program/sdf.ts

import { evaluateSpec } from "../../src/evaluate.ts";
import type { DesignSpec } from "../../src/types.ts";

// ---- Feature program (SolidCraft-style timeline; executed in order on smlibwasm) ----------
const program = {
  "name": "rounded_hollow_box",
  "result": "cut_hole",
  "ops": [
    {
      "id": "blank",
      "op": "box",
      "size": [
        20,
        20,
        20
      ]
    },
    {
      "id": "rounded",
      "op": "fillet",
      "target": "blank",
      "radius": 2
    },
    {
      "id": "hollow",
      "op": "shell",
      "target": "rounded",
      "thickness": 1.5,
      "open": "none"
    },
    {
      "id": "drill",
      "op": "cylinder",
      "radius": 3,
      "height": 4,
      "base": [
        10,
        10,
        -1
      ]
    },
    {
      "id": "cut_hole",
      "op": "boolean",
      "kind": "cut",
      "a": "hollow",
      "b": "drill"
    }
  ]
} as const;

// ---- Parameters ----------------------------------------------------------------------------
const size_mm = 20;
const resolution = 96;
const min_printable_wall_mm = 0.4;
const parameters = {} as const;
const heterogeneity_field = null;

// ---- Design specification (IntentHarness output, with the constants above applied) ----------
const spec: DesignSpec = {
  topology: "program",
  program: program as unknown as NonNullable<DesignSpec["program"]>,
  bio_motif: "",
  family: "program",
  variant: "rounded_hollow_box",
  parameters: { ...parameters },
  heterogeneity_field,
  target_metrics: {"connectivity":true},
  constraints: { size_mm, resolution, min_printable_wall_mm },
  retrieval: {"base_id":"","top_k":[]},
  confidence: 0.95,
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
