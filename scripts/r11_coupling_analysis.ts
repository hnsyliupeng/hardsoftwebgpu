// Coupling analysis for R11 (gate-set iso-level): R11 vs fixed-level control (level_amp 0), N = 40000 deterministic points.
// Usage: node --experimental-strip-types --no-warnings scripts/r11_coupling_analysis.ts
import { buildCoupled } from "../src/topology/coupled.ts";
import { tpmsValueGrad } from "../src/topology/lattice.ts";
const L = 20, N = 40000;
const P = { gyroid_cell_mm: 5, level_c0: 0, level_amp: 0.35, gate_cell_mm: 8, level_width_mm: 1.5, skin_mm: 0 };
const r11 = buildCoupled({ round: "R11", params: { ...P } } as any, L).field;
const ctl = buildCoupled({ round: "R11", params: { ...P, level_amp: 0 } } as any, L).field;
const kG = 2 * Math.PI / 8;
const gate = (x: number, y: number, z: number) => { const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as any, kG * x, kG * y, kG * z); return F / (Math.hypot(gx, gy, gz) * kG + 1e-12); };
let seed = 777; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const z = { s: { n: 0, r: 0, c: 0 }, l: { n: 0, r: 0, c: 0 } }; let T = 0, TR = 0, TC = 0;
for (let i = 0; i < N; i++) {
  const x = rnd() * L, y = rnd() * L, zz = rnd() * L; const g = gate(x, y, zz);
  const zone = g < 0 ? z.s : z.l; const a = r11.eval(x, y, zz) < 0, b = ctl.eval(x, y, zz) < 0;
  zone.n++; if (a) zone.r++; if (b) zone.c++; T++; if (a) TR++; if (b) TC++;
}
const p = (a: number, b: number) => (100 * a / b).toFixed(2) + " %";
console.log(`whole box: R11 ${p(TR, T)} | fixed-level control ${p(TC, T)}`);
console.log(`sheet zone (g<0): R11 ${p(z.s.r, z.s.n)} | control ${p(z.s.c, z.s.n)}`);
console.log(`lattice zone (g>0): R11 ${p(z.l.r, z.l.n)} | control ${p(z.l.c, z.l.n)}`);
