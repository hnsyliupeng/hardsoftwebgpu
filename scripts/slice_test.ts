// Slice test: solid fraction of a design's field on planes through its build box.
// Answers questions the top-down projection cannot: is a face (or a ply) closed in 3D?
// The solid fraction of a plane is the share of its sample points with field < 0 (inside the material).
// A closed face gives about 1.0 on its plane; an open lattice gives a fraction well below 1.
//
// Usage: node --experimental-strip-types --no-warnings scripts/slice_test.ts <design.json>... [--h 0.1] [--inset 0.2] [--step 0.25]
// Reads design_spec from each file (as written by the gallery) and rebuilds the topology field.
// Reports, for the six faces of the cube (plane at `inset` mm inside each face), and the mean over z-planes
// spaced by `step`, offset so that planes do not sit on ply interfaces.
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const files: string[] = [];
let h = 0.1, inset = 0.2, step = 0.25;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--h") h = Number(argv[++i]);
  else if (argv[i] === "--inset") inset = Number(argv[++i]);
  else if (argv[i] === "--step") step = Number(argv[++i]);
  else files.push(argv[i]);
}

type F = { eval(x: number, y: number, z: number): number };

// Solid fraction on the plane coordinate[axis] = offset, over the square interior of the cube.
function planeFraction(f: F, L: number, axis: 0 | 1 | 2, offset: number): number {
  const a = (axis + 1) % 3, b = (axis + 2) % 3;
  const p = [0, 0, 0];
  p[axis] = offset;
  let inside = 0, n = 0;
  for (let u = h / 2; u < L; u += h) {
    for (let v = h / 2; v < L; v += h) {
      p[a] = u;
      p[b] = v;
      n++;
      if (f.eval(p[0], p[1], p[2]) < 0) inside++;
    }
  }
  return inside / n;
}

const pct = (x: number) => x.toFixed(3);
console.log("design\tL\tface_z_bot\tface_z_top\tface_x_min\tface_x_max\tface_y_min\tface_y_max\tmean_z_planes");
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const spec: DesignSpec = raw.design_spec ?? raw;
  const L = spec.constraints.size_mm;
  const f = buildTopology(spec).data.field as F;
  const zb = planeFraction(f, L, 2, inset);
  const zt = planeFraction(f, L, 2, L - inset);
  const xn = planeFraction(f, L, 0, inset);
  const xx = planeFraction(f, L, 0, L - inset);
  const yn = planeFraction(f, L, 1, inset);
  const yx = planeFraction(f, L, 1, L - inset);
  // Planes offset by 0.0137 mm so they do not sit exactly on ply interfaces.
  let sum = 0, cnt = 0;
  for (let z = inset + 0.0137; z < L - inset; z += step) { sum += planeFraction(f, L, 2, z); cnt++; }
  console.log(`${file.split("/").slice(-2).join("/")}\t${L}\t${pct(zb)}\t${pct(zt)}\t${pct(xn)}\t${pct(xx)}\t${pct(yn)}\t${pct(yx)}\t${pct(sum / cnt)}`);
}
