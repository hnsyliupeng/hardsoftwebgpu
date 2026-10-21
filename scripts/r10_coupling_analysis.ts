// Coupling analysis for R10 (gated dominance): how much does the gate change the solid compared with a
// plain union of the same two phases at fixed thickness?
//
// Control = R10 with radius_amp_mm = 0 and sheet_amp_mm = 0 (sheet 0.7 mm, struts r = 0.4 mm, no gate dependence).
// For N uniform points in the 20 mm box, reports per gate zone (g < 0 sheet side, g > 0 lattice side):
//   - solid fraction of R10 and of the control,
//   - solid fraction of each phase alone (sheet alone, lattice alone) in R10,
//   - the fraction of points whose solid/void status differs between R10 and the control.
// The sheet and lattice formulas below repeat buildR10 in src/topology/coupled.ts. Keep them in sync.
//
//   node --experimental-strip-types --no-warnings scripts/r10_coupling_analysis.ts [N=40000]
import { buildCoupled } from "../src/topology/coupled.ts";
import { strutLattice, tpmsValueGrad } from "../src/topology/lattice.ts";

const L = 20;
const N = Number(process.argv[2] ?? 40000);
const P = { lattice: "bcc", lattice_cell_mm: 4, strut_radius_mm: 0.4, radius_amp_mm: 0.1, sheet: "schwarz_d", sheet_cell_mm: 5, sheet_wall_mm: 0.7, sheet_amp_mm: 0.2, gate_cell_mm: 8, dominance_mm: 1, blend_mm: 0.2, skin_mm: 0 };

const r10 = buildCoupled({ round: "R10", params: { ...P } } as any, L).field;
const control = buildCoupled({ round: "R10", params: { ...P, radius_amp_mm: 0, sheet_amp_mm: 0 } } as any, L).field;

// Sheet and lattice alone, using the same formulas as buildR10.
const nL = Math.round(L / P.lattice_cell_mm);
const lat = strutLattice({ type: "bcc", cellSize: L / nL, cells: [nL, nL, nL], radius: P.strut_radius_mm });
const kS = (2 * Math.PI) / P.sheet_cell_mm;
const kG = (2 * Math.PI) / P.gate_cell_mm;
const gate = (x: number, y: number, z: number) => {
  const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as any, kG * x, kG * y, kG * z);
  return F / (Math.hypot(gx, gy, gz) * kG + 1e-12);
};
const thick = (g: number) => P.sheet_wall_mm - P.sheet_amp_mm * Math.tanh(g / P.dominance_mm);
const rad = (g: number) => P.strut_radius_mm + P.radius_amp_mm * Math.tanh(g / P.dominance_mm);

// Deterministic LCG so the run is reproducible.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const zone = { sheet: { n: 0, r10: 0, ctl: 0, sheetOnly: 0, latOnly: 0, differ: 0 }, lattice: { n: 0, r10: 0, ctl: 0, sheetOnly: 0, latOnly: 0, differ: 0 } };
let total = 0, totalR10 = 0, totalCtl = 0, totalDiffer = 0;
for (let i = 0; i < N; i++) {
  const x = rnd() * L, y = rnd() * L, z = rnd() * L;
  const g = gate(x, y, z);
  const z0 = g < 0 ? zone.sheet : zone.lattice;
  const inR10 = r10.eval(x, y, z) < 0;
  const inCtl = control.eval(x, y, z) < 0;
  const [F, gx, gy, gz] = tpmsValueGrad("schwarz_d" as any, kS * x, kS * y, kS * z);
  const sheetD = Math.abs(F) / (Math.hypot(gx, gy, gz) * kS + 1e-12) - thick(g) / 2;
  const latD = lat.eval(x, y, z) - (rad(g) - P.strut_radius_mm);
  z0.n++;
  if (inR10) z0.r10++;
  if (inCtl) z0.ctl++;
  if (sheetD < 0) z0.sheetOnly++;
  if (latD < 0) z0.latOnly++;
  if (inR10 !== inCtl) z0.differ++;
  total++;
  if (inR10) totalR10++;
  if (inCtl) totalCtl++;
  if (inR10 !== inCtl) totalDiffer++;
}
const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(2) + " %" : "n/a");
console.log(`N = ${N} points, box ${L} mm, control = fixed-thickness union (amplitudes 0)`);
console.log(`whole box: R10 solid ${pct(totalR10, total)}, control solid ${pct(totalCtl, total)}, status differs ${pct(totalDiffer, total)}`);
for (const [name, z] of Object.entries(zone)) {
  console.log(`zone ${name} (${name === "sheet" ? "g < 0" : "g > 0"}), n = ${z.n}:`);
  console.log(`  R10 solid ${pct(z.r10, z.n)} | control solid ${pct(z.ctl, z.n)} | differs ${pct(z.differ, z.n)}`);
  console.log(`  sheet alone ${pct(z.sheetOnly, z.n)} | lattice alone ${pct(z.latOnly, z.n)}`);
}
