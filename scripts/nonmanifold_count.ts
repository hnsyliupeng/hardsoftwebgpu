// Counts non-manifold edges in the surface-nets mesh of a design, at several grid resolutions.
// An edge shared by exactly 2 triangles is manifold; 1 is open; 3 or more is non-manifold.
//
// Usage: node --experimental-strip-types --no-warnings scripts/nonmanifold_count.ts <design.json> [res ...]
// Default resolutions: 96 128 160.
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import { sampleField, surfaceNets } from "../src/geometry/grid.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const file = argv[0];
const resList = argv.length > 1 ? argv.slice(1).map(Number) : [96, 128, 160];

const raw = JSON.parse(readFileSync(file, "utf8"));
const spec: DesignSpec = raw.design_spec ?? raw;
const field = buildTopology(spec).data.field;

console.log("design\tres\ttriangles\topen_edges\tmanifold_edges\tnonmanifold_edges\tmax_faces_per_edge");
for (const res of resList) {
  const g = sampleField(field, res);
  const m = surfaceNets(g);
  const idx = m.indices;
  const count = new Map<number, number>();
  // Edge key: pair of vertex ids packed into one number (ids < 2^26 for these meshes).
  const key = (a: number, b: number) => (a < b ? a * 67108864 + b : b * 67108864 + a);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const k of [key(a, b), key(b, c), key(c, a)]) count.set(k, (count.get(k) ?? 0) + 1);
  }
  let open = 0, manifold = 0, nonman = 0, maxF = 0;
  for (const c of count.values()) {
    if (c === 1) open++;
    else if (c === 2) manifold++;
    else nonman++;
    if (c > maxF) maxF = c;
  }
  console.log(`${file.split("/").slice(-2).join("/")}\t${res}\t${idx.length / 3}\t${open}\t${manifold}\t${nonman}\t${maxF}`);
}
