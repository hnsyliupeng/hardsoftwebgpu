// Step A4: high-resolution multi-view renders of the fine set (1600 px, 2x supersampling, cut-away).
// Usage: node --experimental-strip-types scripts/render_fine.ts <res> <budget> <outDir> <family...>
// Writes <outDir>/<family>/screenshot.png (iso) and view_top|front|side.png, plus meta.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strutLattice, tpmsShell } from "../src/topology/lattice.ts";
import { sampleField, surfaceNets, vertexNormals } from "../src/geometry/grid.ts";
import { decimateToBudget } from "../src/geometry/decimate.ts";
import { cutAway, shotPng, VIEWS } from "../src/render/cutaway.ts";
import type { Field } from "../src/topology/fields.ts";

const [resArg, budgetArg, outDir, ...families] = process.argv.slice(2);
const res = Number(resArg), budget = Number(budgetArg);
const SIZE = 1600, SS = 2;
const fieldOf = (f: string): Field =>
  f === "sc"
    ? strutLattice({ type: "sc", cellSize: 4, cells: [5, 5, 5], radius: 0.4 })
    : tpmsShell({ type: f as "gyroid" | "schwarz_p", cellSize: 4, cells: [5, 5, 5], thickness: 0.8 });

for (const family of families) {
  const t0 = Date.now();
  const raw = surfaceNets(sampleField(fieldOf(family), res));
  const full = { ...raw, normals: vertexNormals(raw.positions, raw.indices) };
  const { mesh, stats } = decimateToBudget(full, budget);
  const dir = join(outDir, family);
  mkdirSync(dir, { recursive: true });
  const times: Record<string, number> = {};
  for (const [name, view] of Object.entries(VIEWS)) {
    const t = Date.now();
    const file = name === "iso" ? "screenshot.png" : `view_${name}.png`;
    writeFileSync(join(dir, file), shotPng(cutAway(mesh, view), SIZE, SS, view));
    times[name] = Date.now() - t;
  }
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ family, res, budget, size_px: SIZE, supersample: SS, views: Object.keys(VIEWS), display_triangles: stats.outputTriangles, full_triangles: stats.inputTriangles, display_volume_error_pct: +stats.volumeErrPct.toFixed(4), render_ms: times, total_ms: Date.now() - t0 }, null, 2));
  console.log(JSON.stringify({ family, res, display_triangles: stats.outputTriangles, render_ms: times, total_ms: Date.now() - t0 }));
}
