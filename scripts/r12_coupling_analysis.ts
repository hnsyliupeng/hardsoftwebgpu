// Coupling analysis for R12 (one-sided gate-set iso-level).
// Three fields, same N deterministic points in the 20 mm box:
//   R12           : level c(g) from 0 (gate far negative) to 0.35 (gate far positive)
//   uniform mean  : fixed level 0.175 (the mean of R12's range, no gate dependence)
//   uniform zero  : fixed level 0 (the symmetric baseline, 50 % solid)
// If R12 differs from the uniform-mean control, the spatial gating matters beyond the total shift.
//   node --experimental-strip-types --no-warnings scripts/r12_coupling_analysis.ts [N=40000]
import { buildCoupled } from "../src/topology/coupled.ts";
import { tpmsValueGrad } from "../src/topology/lattice.ts";

const L = 20;
const N = Number(process.argv[2] ?? 40000);
const base = { gyroid_cell_mm: 5, gate_cell_mm: 8, level_width_mm: 1.5, skin_mm: 0 };
const r12 = buildCoupled({ round: "R12", params: { ...base, level_lo: 0, level_hi: 0.35 } } as any, L).field;
const meanCtl = buildCoupled({ round: "R12", params: { ...base, level_lo: 0.175, level_hi: 0.175 } } as any, L).field;
const zeroCtl = buildCoupled({ round: "R12", params: { ...base, level_lo: 0, level_hi: 0 } } as any, L).field;
const kG = (2 * Math.PI) / 8;
const gate = (x: number, y: number, z: number) => {
  const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as any, kG * x, kG * y, kG * z);
  return F / (Math.hypot(gx, gy, gz) * kG + 1e-12);
};
let seed = 2025;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
type Acc = { n: number; r12: number; mean: number; zero: number };
const zone = { neg: { n: 0, r12: 0, mean: 0, zero: 0 } as Acc, pos: { n: 0, r12: 0, mean: 0, zero: 0 } as Acc };
const all: Acc = { n: 0, r12: 0, mean: 0, zero: 0 };
for (let i = 0; i < N; i++) {
  const x = rnd() * L, y = rnd() * L, z = rnd() * L;
  const g = gate(x, y, z);
  const a = r12.eval(x, y, z) < 0, b = meanCtl.eval(x, y, z) < 0, c = zeroCtl.eval(x, y, z) < 0;
  const acc = g < 0 ? zone.neg : zone.pos;
  for (const t of [acc, all]) { t.n++; if (a) t.r12++; if (b) t.mean++; if (c) t.zero++; }
}
const p = (k: number, n: number) => (100 * k / n).toFixed(2) + " %";
const show = (name: string, t: Acc) => console.log(`${name} (n = ${t.n}): R12 ${p(t.r12, t.n)} | uniform mean 0.175 ${p(t.mean, t.n)} | uniform zero ${p(t.zero, t.n)}`);
console.log(`N = ${N}, box ${L} mm`);
show("whole box", all);
show("gate-negative zone (g < 0)", zone.neg);
show("gate-positive zone (g > 0)", zone.pos);
