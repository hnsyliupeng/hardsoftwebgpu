// Programmatic entry point: one call from a prompt or a feature program to the DesignState.
// Everything runs on the CPU, with no network access and no GPU.
//
//   import { runDesign } from "./src/api.ts";
//   const { state, code } = await runDesign({ prompt: "gyroid TPMS wall thickness 0.2 mm, 4 mm cell" });

import { runPipeline, type PipelineOptions, type PipelineResult } from "./pipeline.ts";
import { parseProgramJson } from "./program/index.ts";
import type { FeatureProgram } from "./program/types.ts";
import type { DesignState } from "./types.ts";

export interface DesignRequest {
  /** Natural-language prompt (IntentHarness). Ignored when `program` is given. */
  prompt?: string;
  /** Feature program as an object or as JSON text (timeline mode). */
  program?: FeatureProgram | string;
  sizeMm?: number;
  resolution?: number;
  minWallMm?: number;
  /** 0..5 repair rounds (default 5). */
  maxRepairRounds?: number;
  /** Name for the export files (default: the program name or "design"). */
  name?: string;
  /** Build the STL / glTF / STEP / JSON / WebGPU buffers (default true). */
  exportFiles?: boolean;
}

export interface DesignResult {
  state: DesignState;
  code: string;
  result: PipelineResult;
}

export async function runDesign(req: DesignRequest): Promise<DesignResult> {
  let program: FeatureProgram | undefined;
  if (req.program !== undefined) {
    program = typeof req.program === "string" ? parseProgramJson(req.program) : req.program;
  }
  if (!program && !req.prompt) throw new Error("runDesign needs a prompt or a feature program");
  const opts: PipelineOptions = {
    sizeMm: req.sizeMm,
    resolution: req.resolution,
    minWallMm: req.minWallMm,
    maxRepairRounds: req.maxRepairRounds,
    name: req.name ?? program?.name ?? "design",
    exportFiles: req.exportFiles,
    program,
  };
  const result = await runPipeline(req.prompt ?? `feature program ${program?.name}`, opts);
  return { state: result.state, code: result.code, result };
}
