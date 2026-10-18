// LOD levels for the display path (D2): vertex-clustering decimation to triangle budgets, measured on the
// 1.3 M-triangle icosphere (radius 10 mm). Reports triangles, volume bias, area error and time.
//   node --experimental-strip-types --no-warnings --max-old-space-size=6000 scripts/lod_table.ts
// Output: eval/lod_table.csv
import { writeFileSync } from "node:fs";
import { icosphereMesh } from "../src/geometry/primitives.ts";
import { decimateToBudget } from "../src/geometry/decimate.ts";
import { surfaceArea } from "../src/geometry/measure.ts";

const R = 10;
const full = icosphereMesh(8, R);
const fullArea = surfaceArea(full);
const rows = ["budget,triangles_out,triangles_in,volume_err_pct,area_err_pct,decimate_ms"];
rows.push(["none", full.indices.length / 3, full.indices.length / 3, "0", ((fullArea / (4 * Math.PI * R * R) - 1) * 100).toFixed(4), "0"].join(","));
for (const budget of [1_000_000, 250_000, 50_000]) {
  const { mesh, stats } = decimateToBudget(full, budget);
  const area = surfaceArea(mesh);
  rows.push([budget, mesh.indices.length / 3, stats.inputTriangles ?? full.indices.length / 3, stats.volumeErrPct.toFixed(3), ((area / fullArea - 1) * 100).toFixed(3), stats.timeMs].join(","));
  console.log(rows[rows.length - 1]);
}
writeFileSync("eval/lod_table.csv", rows.join("\n") + "\n");
console.log("wrote eval/lod_table.csv");
