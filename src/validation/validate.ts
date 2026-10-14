// ValidationHarness: evaluates the geometry (volume, area, centre of mass, minimum wall thickness,
// connectivity, handles / genus) and produces the low-resolution preview used by the rule critic.

import { meshIntegrals, occupancy, voxelTopology, type Grid } from "../geometry/grid.ts";
import { rayWallThickness } from "./thickness.ts";
import type { GeometryOutput } from "../geometry/index.ts";
import { rasterisePreview } from "../render/preview.ts";
import type { DesignMetrics, DesignSpec, HarnessResult } from "../types.ts";

export interface Validation {
  metrics: DesignMetrics;
  preview: { dataUrl: string; coverage: number; width: number };
  criticFlags: string[];
}

export function validate(geo: GeometryOutput, spec: DesignSpec): HarnessResult<Validation> {
  const observations: string[] = [];
  const limitations: string[] = [];
  const unknowns: string[] = [];
  const grid: Grid = geo.grid;
  const L = spec.constraints.size_mm;
  const h = grid.h;

  const mesh = meshIntegrals(geo.sdfMesh);
  const occ = occupancy(grid);
  const topo = voxelTopology(grid, occ);
  const wall = rayWallThickness(geo.field, geo.sdfMesh, h);

  const brep = geo.brep;
  const volume = brep ? brep.volume : mesh.volume;
  const area = brep ? brep.area : mesh.area;
  const com = brep ? brep.centerOfMass : mesh.centroid;
  const volumeSource: "brep-exact" | "sdf-mesh" = brep ? "brep-exact" : "sdf-mesh";

  let relErr: number | null = null;
  if (brep) {
    relErr = Math.abs(brep.volume - mesh.volume) / Math.max(1e-12, Math.abs(brep.volume));
    observations.push(`Cross-check: exact B-Rep volume ${brep.volume.toFixed(3)} mm^3 vs SDF surface-net volume ${mesh.volume.toFixed(3)} mm^3 (relative error ${(relErr * 100).toFixed(2)} %).`);
    if (relErr > 0.05) limitations.push(`B-Rep and SDF volumes differ by ${(relErr * 100).toFixed(1)} % (> 5 %): check the family's SDF against its B-Rep plan.`);
  }
  // Volume fraction is relative to the bounding box of the field (equals L^3 for cube-built designs).
  const fb = geo.field.bounds;
  const cube = (fb.max[0] - fb.min[0]) * (fb.max[1] - fb.min[1]) * (fb.max[2] - fb.min[2]);
  const volumeFraction = volume / cube;

  observations.push(`Volume ${volume.toFixed(3)} mm^3 (${volumeSource}), surface area ${area.toFixed(3)} mm^2, volume fraction ${(volumeFraction * 100).toFixed(2)} % of the field bounding box ${(fb.max[0]-fb.min[0]).toFixed(2)} x ${(fb.max[1]-fb.min[1]).toFixed(2)} x ${(fb.max[2]-fb.min[2]).toFixed(2)} mm (porosity ${((1 - volumeFraction) * 100).toFixed(2)} %).`);
  observations.push(`Centre of mass (${com.map((v) => v.toFixed(3)).join(", ")}) mm.`);
  observations.push(
    `Topology on the ${grid.nx}x${grid.ny}x${grid.nz} grid: ${topo.components} solid component(s) of at least 27 nodes, ${topo.cavities} cavity(ies), Euler characteristic ${topo.euler}, handles (b1) ${topo.handles}.`,
  );
  if (topo.slivers > 0)
    observations.push(`${topo.slivers} sub-voxel sliver component(s) (< 27 nodes, typically clipped at the build boundary) excluded from connectivity.`);
  observations.push(
    `Local wall thickness (inward ray chords over ${wall.chords} surface samples): robust minimum (5th percentile) ${wall.p5.toFixed(3)} mm, absolute minimum ${wall.min.toFixed(3)} mm, median ${wall.median.toFixed(3)} mm.`,
  );

  // The reported min_wall_thickness is the 5th percentile of the chord distribution: the absolute
  // minimum is set by single junction / meshing samples (e.g. TPMS saddles) and does not track
  // the design parameter. Both values are reported.
  const minWall = wall.p5;
  const floorWall = spec.constraints.min_printable_wall_mm;
  if (minWall < 3 * h) limitations.push(`Minimum wall ${minWall.toFixed(3)} mm is under-resolved (3h = ${(3 * h).toFixed(3)} mm); increase constraints.resolution to confirm it.`);
  limitations.push("Genus is the first Betti number of the voxel solid (independent handles); it depends on the grid resolution.");
  limitations.push("Connectivity counts components of at least 27 grid nodes; smaller slivers are reported in observations and not repaired.");
  limitations.push(`min_wall_thickness = 5th percentile of inward-ray chords (absolute minimum reported separately); entry/exit error about ±h/2 = ±${(h / 2).toFixed(3)} mm; ${wall.unresolvedBelowVoxel} sub-voxel chords discarded. Not a certified manufacturing check.`);

  // Preview + rule-based critic (replaces the upstream VLM critic with explicit rules).
  const preview = rasterisePreview(geo.mesh, 128);
  const criticFlags: string[] = [];
  if (preview.coverage < 0.02) criticFlags.push("preview nearly empty");
  if (preview.coverage > 0.9) criticFlags.push("preview nearly filled");
  if (!topo.components) criticFlags.push("no solid found");
  if (topo.components > 1) criticFlags.push(`${topo.components} disconnected components`);
  if (minWall > 0 && minWall < floorWall) criticFlags.push(`minimum wall ${minWall.toFixed(3)} mm below printable floor ${floorWall} mm`);
  observations.push(`Critic flags: ${criticFlags.length ? criticFlags.join("; ") : "none"}.`);
  observations.push(`Preview ${preview.width}x${preview.width}, solid coverage ${(preview.coverage * 100).toFixed(1)} %.`);

  const metrics: DesignMetrics = {
    volume,
    surface_area: area,
    min_wall_thickness: minWall,
    connectivity: topo.components === 1,
    genus: topo.handles,
    center_of_mass: [com[0], com[1], com[2]],
    volume_source: volumeSource,
    volume_fraction: volumeFraction,
    porosity: 1 - volumeFraction,
    min_wall_thickness_absolute: wall.min,
    min_wall_thickness_median: wall.median,
    components: topo.components,
    cavities: topo.cavities,
    euler_characteristic: topo.euler,
    triangles: geo.mesh.indices.length / 3,
    bbox_mm: mesh.bbox,
    brep_vs_sdf_volume_rel_err: relErr,
    preview_coverage: preview.coverage,
  };
  return {
    harness: "ValidationHarness",
    ok: topo.components > 0,
    data: { metrics, preview: { dataUrl: preview.dataUrl, coverage: preview.coverage, width: preview.width }, criticFlags },
    observations,
    limitations,
    unknowns,
    evidence: {
      reproducible_params: { family: spec.family, variant: spec.variant, parameters: spec.parameters, size_mm: L, resolution: grid.nx },
      grid: { nx: grid.nx, ny: grid.ny, nz: grid.nz, h },
      raw_topology: topo,
      wall_chords: wall.chords,
      brep_volume: brep?.volume ?? null,
      sdf_mesh_volume: mesh.volume,
    },
  };
}
