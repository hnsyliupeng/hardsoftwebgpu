// Shared evaluation used by the pipeline and by RepairHarness: topology -> geometry -> validation.

import { buildTopology, type TopologyBuild } from "./topology/index.ts";
import { buildGeometry, type GeometryOutput } from "./geometry/index.ts";
import { validate, type Validation } from "./validation/validate.ts";
import type { DesignSpec, HarnessResult } from "./types.ts";

export interface Evaluation {
  spec: DesignSpec;
  topology: HarnessResult<TopologyBuild>;
  geometry: HarnessResult<GeometryOutput>;
  validation: HarnessResult<Validation>;
  ms: number;
}

export async function evaluateSpec(spec: DesignSpec): Promise<Evaluation> {
  const t0 = Date.now();
  const topology = buildTopology(spec);
  const geometry = await buildGeometry(topology.data, spec);
  const validation = validate(geometry.data, spec);
  return { spec, topology, geometry, validation, ms: Date.now() - t0 };
}

