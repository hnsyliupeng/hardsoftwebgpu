// Step A2 check: triangle budget by vertex clustering. Usage: node ... scripts/decimate_check.ts <family> <res> <budget...>
import { strutLattice, tpmsShell } from "../src/topology/lattice.ts";
import { sampleField, surfaceNets } from "../src/geometry/grid.ts";
import { decimateToBudget } from "../src/geometry/decimate.ts";

const family = process.argv[2] ?? "gyroid";
const res = Number(process.argv[3] ?? 192);
const budgets = process.argv.slice(4).map(Number);
const field = family === "sc"
  ? strutLattice({ type: "sc", cellSize: 4, cells: [5, 5, 5], radius: 0.4 })
  : tpmsShell({ type: family as "gyroid", cellSize: 4, cells: [5, 5, 5], thickness: 0.8 });
const mesh = surfaceNets(sampleField(field, res));
for (const b of budgets) {
  const { stats } = decimateToBudget(mesh, b);
  console.log(JSON.stringify({ family, res, ...stats, inputVolumeMm3: +stats.inputVolumeMm3.toFixed(3), outputVolumeMm3: +stats.outputVolumeMm3.toFixed(3), volumeErrPct: +stats.volumeErrPct.toFixed(4), cellMm: +stats.cellMm.toFixed(4), timeMs: stats.timeMs }));
}
