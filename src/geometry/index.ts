// GeometryHarness: builds the geometry for a TopologyBuild.
//  * exact path : smlibwasm B-Rep (helical, tubular families) -> STEP / exact volume / tessellation
//  * SDF path   : sampled field -> (optional voxel smoothing) -> surface nets mesh
// The SDF is always produced too, because topology (connectivity, Betti numbers, wall thickness)
// is evaluated on the voxel grid for every design, including the B-Rep ones.

import type { TopologyBuild } from "../topology/index.ts";
import { blurGaussianMm, removeFloatingComponents, sampleField, surfaceNets, type Grid } from "./grid.ts";
import { dualContourManifold } from "./dualcontour.ts";

/** Reference grid (cells per 20 mm envelope edge) that defines the smoothing scale in mm. */
const SMOOTH_REF_CELLS = 256;
import type { Field } from "../topology/fields.ts";
import { buildBrep, type BrepSolid } from "./brep.ts";
import type { DesignSpec, HarnessResult, MeshData } from "../types.ts";
import { executeBrepProgram } from "../program/brep.ts";
import type { ProgramStep } from "../program/types.ts";

export interface GeometryOutput {
  field: Field;
  grid: Grid;
  sdfMesh: MeshData;
  /** Render / export mesh: kernel tessellation for B-Rep designs, otherwise the SDF mesh. */
  mesh: MeshData;
  brep: BrepSolid | null;
  partsBrep: Record<string, { volume: number }>;
  resolution: number;
  /** Timeline execution report (feature programs only). */
  programSteps: ProgramStep[] | null;
}

export async function buildGeometry(build: TopologyBuild, spec: DesignSpec): Promise<HarnessResult<GeometryOutput>> {
  const res = spec.constraints.resolution;
  const observations: string[] = [];
  const limitations: string[] = [];
  const unknowns: string[] = [];
  let grid = sampleField(build.field, res);
  if (build.smoothPasses > 0) {
    // Smoothing scale in mm: the variance of `passes` 3x3x3 box blurs on a 256-cell grid of a 20 mm
    // envelope. Fixed in mm, so the result does not change with the grid (see blurGaussianMm).
    const sigmaMm = Math.sqrt((build.smoothPasses * 2) / 3) * (spec.constraints.size_mm / SMOOTH_REF_CELLS);
    grid = blurGaussianMm(grid, sigmaMm);
    observations.push(`Applied ${build.smoothPasses} smoothing pass(es) as a Gaussian of sigma ${sigmaMm.toFixed(4)} mm (grid-independent).`);
  }
  const floating = removeFloatingComponents(grid);
  grid = floating.grid;
  if (floating.removedComponents > 0)
    observations.push(`Removed ${floating.removedComponents} floating solid fragment(s) not connected to the main body (${floating.removedNodes} nodes, about ${floating.removedVolumeMm3.toFixed(3)} mm^3, clipped by the build envelope).`);
  // Fused designs use manifold dual contouring (src/geometry/dualcontour.ts): surface nets shares one vertex
  // between two sheets that cross in one cell, which gives non-manifold edges at the union creases.
  // Designs that combine structures in one field (fusion, coupled deep fields) use manifold dual contouring; the rest keep surface nets.
  const useDc = spec.topology === "fusion" || spec.topology === "coupled" || spec.topology === "deep";
  const sdfMesh = useDc ? dualContourManifold(grid) : surfaceNets(grid);
  observations.push(
    `SDF sampled on ${grid.nx}x${grid.ny}x${grid.nz} nodes (h = ${grid.h.toFixed(4)} mm); ${useDc ? "manifold dual contouring" : "surface nets"} produced ${sdfMesh.indices.length / 3} triangles.`,
  );
  if (useDc)
    limitations.push("Fused designs use manifold dual contouring; a few pinches narrower than one voxel can still give non-manifold edges (under 0.1 % of the edges at 96 cells, see docs/NONMANIFOLD.md).");
  let brep: BrepSolid | null = null;
  let kernelError: string | null = null;
  if (build.brep) {
    try {
      brep = await buildBrep(build.brep, spec.constraints.size_mm);
      observations.push(
        `Exact B-Rep (smlibwasm): volume ${brep.volume.toFixed(3)} mm^3, area ${brep.area.toFixed(3)} mm^2, ${brep.mesh.indices.length / 3} tessellation triangles.`,
      );
      limitations.push("Kernel tessellation is used for display/STL of B-Rep designs; its tolerance is set by the kernel defaults.");
    } catch (e) {
      // The kernel is WASM and can fail to load (e.g. unsupported runtime). Fall back to the SDF
      // path and say so, instead of failing the whole pipeline.
      kernelError = e instanceof Error ? e.message : String(e);
      limitations.push(`smlibwasm B-Rep kernel unavailable (${kernelError}); SDF mesh used, STEP export disabled.`);
    }
  }
  let programSteps: ProgramStep[] | null = null;
  if (build.program) {
    try {
      const r = await executeBrepProgram(build.program);
      brep = r.solid;
      programSteps = r.steps;
      observations.push(
        `Timeline executed on smlibwasm: ${r.steps.length} ops; final volume ${brep.volume.toFixed(3)} mm^3, area ${brep.area.toFixed(3)} mm^2, ${brep.mesh.indices.length / 3} tessellation triangles.`,
      );
    } catch (e) {
      kernelError = e instanceof Error ? e.message : String(e);
      limitations.push(`Timeline B-Rep execution failed (${kernelError}); SDF mesh used, STEP export disabled.`);
      programSteps = (e as { steps?: ProgramStep[] }).steps ?? [];
    }
  }
  if (!brep) {
    if (!build.brep && !build.program) limitations.push("No exact B-Rep for this design: STL/glTF come from surface nets of the SDF; STEP export is unavailable.");
  }
  limitations.push(`SDF surface resolution is limited to h = ${grid.h.toFixed(4)} mm (constraints.resolution = ${res}); features below ~2h are not resolved.`);
  if (res > 160) unknowns.push("Resolution above 160 per axis may exceed browser memory budgets.");
  return {
    harness: "GeometryHarness",
    ok: true,
    data: {
      field: build.field,
      grid,
      sdfMesh,
      mesh: brep ? brep.mesh : sdfMesh,
      brep,
      partsBrep: brep?.parts ?? {},
      resolution: res,
      programSteps,
    },
    observations,
    limitations,
    unknowns,
    evidence: {
      kernel: brep ? "smlibwasm (SMLib NURBS, WASM)" : "SDF + surface nets (TypeScript)",
      kernel_error: kernelError,
      grid: { nx: grid.nx, ny: grid.ny, nz: grid.nz, h: grid.h, origin: grid.origin },
      smoothing_passes: build.smoothPasses,
      sdf_expression: build.field.expr,
      brep_plan: build.brep,
      program_steps: programSteps,
      program_sdf_notes: build.programNotes,
      program_approximate_ops: build.programApproximate,
      reproducible_params: { family: spec.family, variant: spec.variant, parameters: spec.parameters, size_mm: spec.constraints.size_mm, resolution: res },
    },
  };
}
