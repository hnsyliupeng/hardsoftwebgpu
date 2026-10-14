// Multi-harness pipeline:
//   IntentHarness -> TopologyHarness -> GeometryHarness -> ValidationHarness -> RepairHarness -> ExportHarness
// Every harness returns { observations, limitations, unknowns, evidence } alongside its payload.

import { parseIntent } from "./intent/intent.ts";
import { evaluateSpec } from "./evaluate.ts";
import { repairDesign, MAX_REPAIR_ROUNDS } from "./repair/repair.ts";
import { emitParametricCode } from "./codegen/emit.ts";
import { exportAll, prepareStep, type ExportBundle } from "./export/export.ts";
import type { DesignSpec, DesignState, HarnessReport, HarnessResult, RepairStep } from "./types.ts";
import type { Validation } from "./validation/validate.ts";

export interface PipelineOptions {
  sizeMm?: number;
  resolution?: number;
  minWallMm?: number;
  maxRepairRounds?: number;
  name?: string;
  exportFiles?: boolean;
}

export interface PipelineResult {
  state: DesignState;
  code: string;
  reports: Record<string, HarnessResult<unknown>>;
  exports: HarnessResult<ExportBundle> | null;
  meshForViewer: { positions: Float32Array; normals: Float32Array; indices: Uint32Array };
  validation: Validation;
  finalSpec: DesignSpec;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

export async function runPipeline(prompt: string, opts: PipelineOptions = {}): Promise<PipelineResult> {
  const intent = parseIntent(prompt);
  const spec: DesignSpec = structuredClone(intent.data);
  if (opts.sizeMm) spec.constraints.size_mm = opts.sizeMm;
  if (opts.resolution) spec.constraints.resolution = opts.resolution;
  if (opts.minWallMm) spec.constraints.min_printable_wall_mm = opts.minWallMm;

  const first = await evaluateSpec(spec);
  const repair = await repairDesign(first, opts.maxRepairRounds ?? MAX_REPAIR_ROUNDS);
  const fin = repair.data.evaluation;
  const finalSpec = fin.spec;
  const m = fin.validation.data.metrics;
  const code = emitParametricCode(finalSpec, prompt);

  const state: DesignState = {
    prompt,
    design_spec: finalSpec,
    code,
    metrics: {
      volume: m.volume,
      surface_area: m.surface_area,
      min_wall_thickness: m.min_wall_thickness,
      connectivity: m.connectivity,
      genus: m.genus,
    },
    render_preview: fin.validation.data.preview.dataUrl,
    repair_history: repair.data.history as RepairStep[],
    limitations: uniq([
      ...intent.limitations,
      ...fin.topology.limitations,
      ...fin.geometry.limitations,
      ...fin.validation.limitations,
      ...repair.limitations,
    ]),
    unknowns: uniq([
      ...intent.unknowns,
      ...fin.topology.unknowns,
      ...fin.geometry.unknowns,
      ...repair.unknowns,
    ]),
  };

  let exports: HarnessResult<ExportBundle> | null = null;
  if (opts.exportFiles !== false) {
    const brep = fin.geometry.data.brep;
    const step = brep ? await prepareStep(brep) : null;
    const stateJson = JSON.stringify(state, null, 2);
    exports = exportAll(opts.name ?? "design", fin.geometry.data.mesh, stateJson, step, !!brep);
  }

  const reports: Record<string, HarnessResult<unknown>> = {
    IntentHarness: intent as HarnessResult<unknown>,
    TopologyHarness: fin.topology as HarnessResult<unknown>,
    GeometryHarness: fin.geometry as HarnessResult<unknown>,
    ValidationHarness: fin.validation as HarnessResult<unknown>,
    RepairHarness: repair as HarnessResult<unknown>,
  };
  if (exports) reports.ExportHarness = exports as HarnessResult<unknown>;

  const mesh = fin.geometry.data.mesh;
  return {
    state,
    code,
    reports,
    exports,
    meshForViewer: { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices },
    validation: fin.validation.data,
    finalSpec,
  };
}

export type { HarnessReport };
