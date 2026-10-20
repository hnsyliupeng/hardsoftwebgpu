// Diagnostic for the R9 wall check: where are the thin chords?
// Surface points come from z-rays on the field; each point gets the validator's inward-chord routine
// (src/validation/thickness.ts). Reports the chord distribution, the thin samples' gate values, and the
// lowest chords. A BCC lattice control (2r = 0.8 mm) is run with the same routine.
//   node --experimental-strip-types --no-warnings scripts/r9_wall_diagnostic.ts [res=192] [r9|bcc]
import { buildCoupled } from "../src/topology/coupled.ts";
import { strutLattice, tpmsValueGrad } from "../src/topology/lattice.ts";
import { rayWallThickness } from "../src/validation/thickness.ts";

const L = 20, RES = Number(process.argv[2] ?? 192), h = L / RES;
const which = process.argv[3] ?? "r9";
const field = which === "bcc"
  ? strutLattice({ type: "bcc", cellSize: 4, cells: [5, 5, 5], radius: 0.4 })
  : buildCoupled({ round: "R9" } as any, L).field;
const kG = (2 * Math.PI) / 8;
const gate = (x: number, y: number, z: number) => {
  const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as any, kG * x, kG * y, kG * z);
  return F / (Math.hypot(gx, gy, gz) * kG + 1e-12);
};
const pts: number[][] = [];
const G = 70, dz = 0.1;
for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
  const x = (i + 0.5) * L / G, y = (j + 0.5) * L / G;
  let zp = 0, fp = field.eval(x, y, zp);
  for (let z = dz; z <= L; z += dz) {
    const f = field.eval(x, y, z);
    if ((f < 0) !== (fp < 0)) {
      let a = zp, b = z, fa = fp;
      for (let it = 0; it < 30; it++) { const m = (a + b) / 2; const fm = field.eval(x, y, m); if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m; }
      pts.push([x, y, (a + b) / 2]);
    }
    zp = z; fp = f;
  }
}
const inner = pts.filter(([x, y, z]) => Math.min(x, y, z, L - x, L - y, L - z) >= 0.5);
const rows = inner.map(([x, y, z]) => {
  const w = rayWallThickness(field, { positions: new Float64Array([x, y, z]) } as any, h, 1, 0);
  return { c: w.chords ? w.min : NaN, x, y, z, g: gate(x, y, z) };
}).filter(r => Number.isFinite(r.c));
rows.sort((a, b) => a.c - b.c);
const q = (p: number) => rows[Math.floor(p * (rows.length - 1))].c;
console.log(`${which} res ${RES}: samples ${rows.length}, p5 ${q(0.05).toFixed(3)}, median ${q(0.5).toFixed(3)}, min ${rows[0].c.toFixed(3)}`);
const thin = rows.filter(r => r.c < 0.4);
console.log(`thin (<0.4 mm): ${thin.length}; with |gate| < 0.3: ${thin.filter(r => Math.abs(r.g) < 0.3).length}; on sheet side (gate < 0): ${thin.filter(r => r.g < 0).length}`);
for (const r of rows.slice(0, 12)) console.log(`${r.c.toFixed(3)}  x ${r.x.toFixed(2)} y ${r.y.toFixed(2)} z ${r.z.toFixed(2)}  gate ${r.g.toFixed(2)}`);
