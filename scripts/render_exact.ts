// Renders an exact (OpenCASCADE) tessellated lattice: iso + top/front/side cut-away views, 1600 px, 2x supersampling,
// the same renderer and view set as scripts/render_fine.ts.
// Input: a binary mesh written by python/exact/tessellate_step.py (uint32 nv, nt; float32 positions; uint32 indices).
// Usage: node --experimental-strip-types scripts/render_exact.ts <mesh> <outDir> [budget=0 (no decimation)]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vertexNormals } from "../src/geometry/grid.ts";
import { decimateToBudget } from "../src/geometry/decimate.ts";
import { cutAway, shotPng, VIEWS } from "../src/render/cutaway.ts";

const [meshPath, outDir, budgetArg] = process.argv.slice(2);
const budget = Number(budgetArg ?? 0);
const SIZE = 1600, SS = 2;

const buf = readFileSync(meshPath);
const nv = buf.readUInt32LE(0), nt = buf.readUInt32LE(4);
const positions = new Float32Array(new Uint8Array(buf.buffer, buf.byteOffset + 8, nv * 3 * 4).slice().buffer);
const indices = new Uint32Array(new Uint8Array(buf.buffer, buf.byteOffset + 8 + nv * 12, nt * 3 * 4).slice().buffer);

let mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array } = {
  positions, normals: vertexNormals(positions, indices), indices,
};
let decimated = false;
if (budget > 0 && nt > budget) {
  mesh = decimateToBudget(mesh as any, budget).mesh as any;
  decimated = true;
}

mkdirSync(outDir, { recursive: true });
const times: Record<string, number> = {};
for (const [name, view] of Object.entries(VIEWS)) {
  const t = Date.now();
  const file = name === "iso" ? "screenshot.png" : `view_${name}.png`;
  writeFileSync(join(outDir, file), shotPng(cutAway(mesh, view), SIZE, SS, view));
  times[name] = Date.now() - t;
}
const meta = { mesh: meshPath, size_px: SIZE, supersample: SS, views: Object.keys(VIEWS),
  input_triangles: nt, render_triangles: mesh.indices.length / 3, decimated, render_ms: times };
writeFileSync(join(outDir, "render_meta.json"), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta));
