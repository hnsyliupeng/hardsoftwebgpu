// Render a structure-graph preset: cut-away iso view and top view (task B3 visual check).
// Usage: node --experimental-strip-types scripts/render_graph.ts <preset.json> <res> <outDir>
// Pass a resolution that keeps the source grid spacing (see graph_check.ts: res_transformed).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPreset } from "../src/graph/presets.ts";
import { compileGraph, structureIds, type StructureGraph } from "../src/graph/graph.ts";
import { sampleField, surfaceNets, vertexNormals, removeFloatingComponents } from "../src/geometry/grid.ts";
import { cutAway, shotPng, VIEWS } from "../src/render/cutaway.ts";

const [file, resArg = "128", outDir = "render_graph"] = process.argv.slice(2);
const g: StructureGraph = loadPreset(file);
const id = structureIds(g)[0];
const field = compileGraph(g, id);
const grid = removeFloatingComponents(sampleField(field, Number(resArg))).grid;
const raw = surfaceNets(grid);
const mesh = { ...raw, normals: vertexNormals(raw.positions, raw.indices) };
mkdirSync(outDir, { recursive: true });
for (const view of ["iso", "top"] as const) {
  const v = VIEWS[view];
  const base = file.split("/").pop()!.replace(/\.json$/, "");
  writeFileSync(join(outDir, `${base}_${view}.png`), shotPng(cutAway(mesh, v), 800, 2, v));
}
console.log(JSON.stringify({ preset: file, id, triangles: mesh.indices.length / 3, res: Number(resArg), out: outDir }));
