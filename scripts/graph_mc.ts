// Resolution-independent volume of a structure-graph field by Monte Carlo (C2 convergence reference).
// Samples points uniformly in the field's bounding box and counts those with f <= 0. Independent of meshing, so it
// separates the mesh error of graph_check from any error in the field itself. Standard error is reported.
// Usage: node --experimental-strip-types scripts/graph_mc.ts <preset.json> [samples=1000000] [seed=11]
// Several seeds can be run in parallel and averaged (the standard error of the mean is the per-run error / sqrt(runs)).
import { readFileSync } from "node:fs";
import { compileGraph, type StructureGraph } from "../src/graph/graph.ts";

const [file, nArg = "1000000", seedArg = "11"] = process.argv.slice(2);
const N = Number(nArg);
const g = JSON.parse(readFileSync(file, "utf8")) as StructureGraph;
const f = compileGraph(g, "out");
const b = f.bounds;
const boxVol = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
let seed = Number(seedArg);
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let inside = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const x = b.min[0] + (b.max[0] - b.min[0]) * rnd();
  const y = b.min[1] + (b.max[1] - b.min[1]) * rnd();
  const z = b.min[2] + (b.max[2] - b.min[2]) * rnd();
  if (f.eval(x, y, z) <= 0) inside++;
}
const p = inside / N;
console.log(JSON.stringify({
  file,
  samples: N,
  seed: Number(seedArg),
  mc_volume_mm3: +(p * boxVol).toFixed(1),
  stderr_mm3: +(Math.sqrt((p * (1 - p)) / N) * boxVol).toFixed(1),
  ms: Date.now() - t0,
}));
