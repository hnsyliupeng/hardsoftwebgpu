// Compares the surface-nets extractor, the manifold dual-contouring extractor and DC followed by pinch split on the same grid.
// Reports triangles, open edges, non-manifold edges, signed volume and time.
//
// Usage: node --experimental-strip-types --no-warnings scripts/compare_extractors.ts <design.json> [res ...]
// Default resolutions: 96 128.
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import { sampleField, surfaceNets, meshIntegrals, type Grid } from "../src/geometry/grid.ts";
import { dualContourManifold } from "../src/geometry/dualcontour.ts";
import { splitPinchVertices } from "../src/geometry/pinch.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const file = argv[0];
const resList = argv.length > 1 ? argv.slice(1).map(Number) : [96, 128];

function edgeStats(idx: Uint32Array) {
  const count = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * 67108864 + b : b * 67108864 + a);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const k of [key(a, b), key(b, c), key(c, a)]) count.set(k, (count.get(k) ?? 0) + 1);
  }
  let open = 0, nonman = 0;
  for (const c of count.values()) {
    if (c === 1) open++;
    else if (c > 2) nonman++;
  }
  return { open, nonman };
}

const raw = JSON.parse(readFileSync(file, "utf8"));
const spec: DesignSpec = raw.design_spec ?? raw;
const field = buildTopology(spec).data.field;

console.log("design\tres\textractor\ttriangles\topen_edges\tnonmanifold_edges\tvolume_mm3\tseconds");
for (const res of resList) {
  const g = sampleField(field, res);
  for (const [name, fn] of [["surface_nets", surfaceNets], ["manifold_dc", dualContourManifold], ["manifold_dc_split", (gr: Grid) => splitPinchVertices(dualContourManifold(gr)).mesh]] as const) {
    const t0 = Date.now();
    const m = fn(g);
    const secs = (Date.now() - t0) / 1000;
    const { open, nonman } = edgeStats(m.indices);
    const vol = meshIntegrals(m).volume;
    console.log(`${file.split("/").slice(-2).join("/")}\t${res}\t${name}\t${m.indices.length / 3}\t${open}\t${nonman}\t${vol.toFixed(3)}\t${secs.toFixed(2)}`);
  }
}
