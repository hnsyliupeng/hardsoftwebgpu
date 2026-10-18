// Rim period test: is the sawtooth along a box edge periodic at the TPMS cell size (geometry), or not (meshing)?
// Samples the field in a strip just inside one box edge (x in [0, strip], z = inset) and computes the solid fraction
// along y. Counts local maxima of that profile and reports their mean spacing. For a gyroid with a 4 mm cell, geometric
// teeth should repeat at about 4 mm; a meshing artefact would not follow the cell size.
//
// Usage: node --experimental-strip-types --no-warnings scripts/rim_period.ts <design.json> [--h 0.05] [--strip 0.6] [--inset 0.2]
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const file = argv[0];
let h = 0.05, strip = 0.6, inset = 0.2;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--h") h = Number(argv[++i]);
  else if (argv[i] === "--strip") strip = Number(argv[++i]);
  else if (argv[i] === "--inset") inset = Number(argv[++i]);
}

type F = { eval(x: number, y: number, z: number): number };
const raw = JSON.parse(readFileSync(file, "utf8"));
const spec: DesignSpec = raw.design_spec ?? raw;
const L = spec.constraints.size_mm;
const f = buildTopology(spec).data.field as F;

// Solid fraction of the strip at each y (strip along x from 0 to `strip`, plane z = inset).
const ys: number[] = [];
const prof: number[] = [];
for (let y = h / 2; y < L; y += h) {
  let inside = 0, n = 0;
  for (let x = h / 2; x < strip; x += h) {
    n++;
    if (f.eval(x, y, inset) < 0) inside++;
  }
  ys.push(y);
  prof.push(inside / n);
}

// Smooth with a 5-sample moving average, then count local maxima above the mean.
const sm = prof.map((_, i) => {
  let s = 0, c = 0;
  for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < prof.length) { s += prof[k]; c++; }
  return s / c;
});
const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
const peaks: number[] = [];
for (let i = 1; i < sm.length - 1; i++) if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > mean) peaks.push(ys[i]);
const gaps = peaks.slice(1).map((p, i) => p - peaks[i]);
const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : NaN;
console.log(`${file.split("/").slice(-2).join("/")}\tL=${L}\tpeaks=${peaks.length}\tmean_spacing_mm=${meanGap.toFixed(3)}\tprofile_mean=${mean.toFixed(3)}\tprofile_min=${Math.min(...sm).toFixed(3)}\tprofile_max=${Math.max(...sm).toFixed(3)}`);
