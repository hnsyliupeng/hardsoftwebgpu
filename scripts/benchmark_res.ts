// Step A2: resolution benchmark on the SDF path (dense sampling, surface nets, volume, memory).
// Usage: node --experimental-strip-types scripts/benchmark_res.ts <family> <res...>
// family: sc | gyroid | schwarz_p. Prints one JSON row per resolution.
import { strutLattice, tpmsShell } from "../src/topology/lattice.ts";
import { sampleField, surfaceNets, meshIntegrals } from "../src/geometry/grid.ts";
import type { Field } from "../src/topology/fields.ts";

const family = process.argv[2] ?? "gyroid";
const resList = process.argv.slice(3).map(Number);
const fieldOf = (f: string): Field =>
  f === "sc"
    ? strutLattice({ type: "sc", cellSize: 4, cells: [5, 5, 5], radius: 0.4 })
    : tpmsShell({ type: f as "gyroid" | "schwarz_p", cellSize: 4, cells: [5, 5, 5], thickness: 0.8 });
const field = fieldOf(family);
for (const res of resList) {
  const t0 = Date.now();
  const g = sampleField(field, res);
  const tSample = Date.now() - t0;
  const t1 = Date.now();
  const mesh = surfaceNets(g);
  const tSurf = Date.now() - t1;
  const t2 = Date.now();
  const vol = Math.abs(meshIntegrals(mesh).volume);
  const tInt = Date.now() - t2;
  const mem = process.memoryUsage();
  console.log(JSON.stringify({
    family, res, nodes: g.nx * g.ny * g.nz, triangles: mesh.indices.length / 3, vertices: mesh.positions.length / 3,
    volume_mm3: +vol.toFixed(3), sample_ms: tSample, surface_ms: tSurf, integrals_ms: tInt,
    rss_mb: Math.round(mem.rss / 1048576), heap_mb: Math.round(mem.heapUsed / 1048576),
  }));
}
