// Exact B-Rep strut lattice via the SMLib kernel, with a tessellation check.
// Usage: node --experimental-strip-types scripts/exact_lattice.ts <type> [size=20] [cell=4] [r=0.4] [tol=0.02]
// Prints a JSON record. Does not write mesh files (see the gallery for rendered outputs).
import { loadKernel } from "../src/geometry/brep.ts";
import { buildExactLattice } from "../src/geometry/exact_lattice.ts";

const type = process.argv[2] ?? "sc";
const size = Number(process.argv[3] ?? 20);
const cell = Number(process.argv[4] ?? 4);
const r = Number(process.argv[5] ?? 0.4);
const tol = Number(process.argv[6] ?? 0.02);
const cells = Math.round(size / cell);

const K: any = await loadKernel();
const res = await buildExactLattice(K, { type: type as any, cellSize: cell, cells, radius: r });
const tess = K.tessellate(res.shape, tol);
const P = tess.vertices as ArrayLike<number>, I = tess.triangles as ArrayLike<number>;
let mv = 0;
for (let i = 0; i < I.length; i += 3) {
  const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
  mv += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
}
console.log(JSON.stringify({
  type, size_mm: size, cell_mm: cell, cells, strut_radius_mm: r, mode: res.mode,
  brep_volume_mm3: +res.volume.toFixed(3), brep_area_mm2: +res.area.toFixed(2),
  pieces: res.pieces, mesh_tolerance_mm: tol, mesh_triangles: I.length / 3,
  mesh_volume_mm3: +Math.abs(mv).toFixed(3), time_build_ms: res.timeMs.build, time_bool_ms: res.timeMs.boolean,
}, null, 2));
