// Flat-face test for fused designs.
// Question: the box faces of some fused designs look flat in the renders. Is that flat patch solid material
// that belongs to one component (for example a foam wall cut by the box), or is it a closed skin?
//
// For each fused design file, the union field F = min(A, B) (or the mode in spec.fusion) is evaluated on the six
// face planes (inset from the face by --inset mm). On each plane the solid samples (field < 0) are split into:
//   A-only, B-only, both. The solid share of each component alone is also reported.
// The answer is in the B-only / A-only split: a face that is mostly one component's solid is that component cut by the box.
//
// Usage: node --experimental-strip-types --no-warnings scripts/flat_face_test.ts <design.json>... [--h 0.2] [--inset 0.2]
// Reads design_spec from each file (as written by the gallery). Fusion designs only (spec.fusion.a / spec.fusion.b).
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const files: string[] = [];
let h = 0.2, inset = 0.2;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--h") h = Number(argv[++i]);
  else if (argv[i] === "--inset") inset = Number(argv[++i]);
  else files.push(argv[i]);
}

type F = { eval(x: number, y: number, z: number): number };
type Counts = { n: number; solid: number; aOnly: number; bOnly: number; both: number };

function planeCounts(F_: F, A: F | null, B: F | null, L: number, axis: 0 | 1 | 2, offset: number): Counts {
  const a = (axis + 1) % 3, b = (axis + 2) % 3;
  const p = [0, 0, 0];
  p[axis] = offset;
  const c: Counts = { n: 0, solid: 0, aOnly: 0, bOnly: 0, both: 0 };
  for (let u = h / 2; u < L; u += h) {
    for (let v = h / 2; v < L; v += h) {
      p[a] = u; p[b] = v;
      c.n++;
      const inU = F_.eval(p[0], p[1], p[2]) < 0;
      if (!inU) continue;
      c.solid++;
      const inA = A ? A.eval(p[0], p[1], p[2]) < 0 : false;
      const inB = B ? B.eval(p[0], p[1], p[2]) < 0 : false;
      if (inA && inB) c.both++;
      else if (inA) c.aOnly++;
      else if (inB) c.bOnly++;
    }
  }
  return c;
}

const faces: [string, 0 | 1 | 2, (L: number) => number][] = [
  ["z_bot", 2, () => inset], ["z_top", 2, (L) => L - inset],
  ["x_min", 0, () => inset], ["x_max", 0, (L) => L - inset],
  ["y_min", 1, () => inset], ["y_max", 1, (L) => L - inset],
];

console.log("design\tface\tunion_solid\tA_only_share\tB_only_share\tboth_share\tA_alone_solid\tB_alone_solid");
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const spec: DesignSpec = raw.design_spec ?? raw;
  if (!spec.fusion || !spec.fusion.a || !spec.fusion.b) {
    console.log(`${file}\tskipped: not a two-part fusion design`);
    continue;
  }
  const L = spec.constraints.size_mm;
  const U = buildTopology(spec).data.field as F;
  const A = buildTopology(spec.fusion.a).data.field as F;
  const B = buildTopology(spec.fusion.b).data.field as F;
  const name = file.split("/").slice(-2).join("/");
  for (const [label, axis, pos] of faces) {
    const c = planeCounts(U, A, B, L, axis, pos(L));
    const s = c.solid || 1;
    // Component alone, on the same plane: the share of samples that are solid for that component.
    const aAlone = planeCounts(A, null, null, L, axis, pos(L));
    const bAlone = planeCounts(B, null, null, L, axis, pos(L));
    console.log([
      name, label,
      (c.solid / c.n).toFixed(3),
      (c.aOnly / s).toFixed(3), (c.bOnly / s).toFixed(3), (c.both / s).toFixed(3),
      (aAlone.solid / aAlone.n).toFixed(3), (bAlone.solid / bAlone.n).toFixed(3),
    ].join("\t"));
  }
}
