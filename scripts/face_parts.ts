// Face parts test: which part of a fusion fills the box faces?
// For a fusion design (fusion.a and fusion.b), reports on each of the six box faces (plane at --inset mm inside the face)
// the solid fraction of the whole field and of each part alone (field < 0). Information only; no criterion applied.
//
// Usage: node --experimental-strip-types --no-warnings scripts/face_parts.ts <design.json> [--h 0.1] [--inset 0.2]
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const file = argv[0];
let h = 0.1, inset = 0.2;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--h") h = Number(argv[++i]);
  else if (argv[i] === "--inset") inset = Number(argv[++i]);
}

type F = { eval(x: number, y: number, z: number): number };
const raw = JSON.parse(readFileSync(file, "utf8"));
const spec: DesignSpec = raw.design_spec ?? raw;
const L = spec.constraints.size_mm;
const fus = spec.fusion as unknown as { a: DesignSpec; b: DesignSpec };
const total = buildTopology(spec).data.field as F;
const fa = buildTopology(fus.a).data.field as F;
const fb = buildTopology(fus.b).data.field as F;

// Six faces: plane coordinate fixed at inset or L - inset, the other two coordinates sampled on a grid.
const faces: { name: string; p: (u: number, v: number) => [number, number, number] }[] = [
  { name: "x0", p: (u, v) => [inset, u, v] },
  { name: "x1", p: (u, v) => [L - inset, u, v] },
  { name: "y0", p: (u, v) => [u, inset, v] },
  { name: "y1", p: (u, v) => [u, L - inset, v] },
  { name: "z0", p: (u, v) => [u, v, inset] },
  { name: "z1", p: (u, v) => [u, v, L - inset] },
  // Interior reference (not a face): plane at mid-height, offset to avoid ply interfaces. Compare with the faces.
  { name: "mid_z", p: (u, v) => [u, v, L / 2 + 0.05] },
];

console.log("design\tface\ttotal\tpart_a\tpart_b");
for (const face of faces) {
  let nT = 0, nA = 0, nB = 0, n = 0;
  for (let u = h / 2; u < L; u += h) {
    for (let v = h / 2; v < L; v += h) {
      const [x, y, z] = face.p(u, v);
      n++;
      if (total.eval(x, y, z) < 0) nT++;
      if (fa.eval(x, y, z) < 0) nA++;
      if (fb.eval(x, y, z) < 0) nB++;
    }
  }
  console.log(`${file.split("/").slice(-2).join("/")}\t${face.name}\t${(nT / n).toFixed(3)}\t${(nA / n).toFixed(3)}\t${(nB / n).toFixed(3)}`);
}
