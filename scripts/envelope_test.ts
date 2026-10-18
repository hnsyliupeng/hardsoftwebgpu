// Envelope test: is there material outside the build cube [0, L]^3?
// The topology fields are meant to be clipped to the build cube, so material found in a shell just outside the cube is
// a defect (for example struts protruding from the envelope through a face, an edge or a corner).
// This version samples the full 3D shell: every grid point within `shell` mm of the cube that lies outside [0, L]^3.
// (An earlier version sampled only the six face squares and missed edge and corner protrusions.)
//
// Usage: node --experimental-strip-types --no-warnings scripts/envelope_test.ts <design.json>... [--h 0.2] [--shell 0.5]
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const files: string[] = [];
let h = 0.2, shell = 0.5;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--h") h = Number(argv[++i]);
  else if (argv[i] === "--shell") shell = Number(argv[++i]);
  else files.push(argv[i]);
}

type F = { eval(x: number, y: number, z: number): number };

console.log("design\tL\tshell_points\tsolid_outside\tfraction");
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const spec: DesignSpec = raw.design_spec ?? raw;
  const L = spec.constraints.size_mm;
  const f = buildTopology(spec).data.field as F;
  const lo = -shell, hi = L + shell;
  let inside = 0, n = 0;
  for (let x = lo + h / 2; x < hi; x += h) {
    for (let y = lo + h / 2; y < hi; y += h) {
      for (let z = lo + h / 2; z < hi; z += h) {
        const out = x < 0 || x > L || y < 0 || y > L || z < 0 || z > L;
        if (!out) continue;
        n++;
        if (f.eval(x, y, z) < 0) inside++;
      }
    }
  }
  console.log(`${file.split("/").slice(-2).join("/")}\t${L}\t${n}\t${inside}\t${(inside / n).toFixed(5)}`);
}
