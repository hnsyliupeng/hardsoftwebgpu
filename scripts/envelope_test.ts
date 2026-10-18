// Envelope test: is there material outside the build cube [0, L]^3?
// The topology fields are meant to be clipped to the build cube, so any material found in a shell just outside
// the cube is a defect (for example strut stubs protruding from the envelope).
// Samples a shell of thickness `shell` mm outside each face on a grid of `h` mm and reports the solid fraction.
//
// Usage: node --experimental-strip-types --no-warnings scripts/envelope_test.ts <design.json>... [--h 0.1] [--shell 0.5]
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const files: string[] = [];
let h = 0.1, shell = 0.5;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--h") h = Number(argv[++i]);
  else if (argv[i] === "--shell") shell = Number(argv[++i]);
  else files.push(argv[i]);
}

type F = { eval(x: number, y: number, z: number): number };

// Solid fraction on a face shell: plane coordinate[axis] = offset, over the square [0, L]^2 in the other axes.
function faceShell(f: F, L: number, axis: 0 | 1 | 2, offset: number): number {
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

console.log("design\tL\toutside_neg_x\toutside_pos_x\toutside_neg_y\toutside_pos_y\toutside_neg_z\toutside_pos_z");
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const spec: DesignSpec = raw.design_spec ?? raw;
  const L = spec.constraints.size_mm;
  const f = buildTopology(spec).data.field as F;
  // Shell centred just outside each face: midpoint of [-shell, 0) and (L, L+shell].
  const vals = [
    faceShell(f, L, 0, -shell / 2), faceShell(f, L, 0, L + shell / 2),
    faceShell(f, L, 1, -shell / 2), faceShell(f, L, 1, L + shell / 2),
    faceShell(f, L, 2, -shell / 2), faceShell(f, L, 2, L + shell / 2),
  ];
  console.log(`${file.split("/").slice(-2).join("/")}\t${L}\t${vals.map((v) => v.toFixed(4)).join("\t")}`);
}
