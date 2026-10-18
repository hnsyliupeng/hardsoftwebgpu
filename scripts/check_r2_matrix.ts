// Check of the coupled R2 design (deep_R2_nested): is the matrix solid between the pores, and is each pore
// filled only inside its pore? Samples the field on a grid over the 20 mm box.
//   node --experimental-strip-types --no-warnings scripts/check_r2_matrix.ts
import { buildCoupled } from "../src/topology/coupled.ts";

const L = 20;
const build = buildCoupled({ round: "R2" }, L);
const f = build.field;

// Pore centres for pitch 5, n = 4 at (2.5, 7.5, 12.5, 17.5), radius 2 mm.
const centres: [number, number][] = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) centres.push([2.5 + 5 * i, 2.5 + 5 * j]);
const inPore = (x: number, y: number) => centres.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 2);

// Matrix samples: away from the pores (distance > 0.6 mm from every pore wall), inside the box.
let matrixN = 0, matrixSolid = 0;
let poreN = 0, poreSolid = 0;
const h = 0.25;
for (let x = h / 2; x < L; x += h) for (let y = h / 2; y < L; y += h) for (let z = h / 2; z < L; z += h) {
  const dPore = Math.min(...centres.map(([cx, cy]) => Math.abs(Math.hypot(x - cx, y - cy) - 2)));
  const v = f.eval(x, y, z);
  if (inPore(x, y)) {
    poreN++;
    if (v < 0) poreSolid++;
  } else if (dPore > 0.6) {
    matrixN++;
    if (v < 0) matrixSolid++;
  }
}
const out = {
  matrix_samples: matrixN,
  matrix_solid_fraction: +(matrixSolid / matrixN).toFixed(4),
  pore_samples: poreN,
  pore_solid_fraction: +(poreSolid / poreN).toFixed(4),
};
console.log(JSON.stringify(out, null, 2));
