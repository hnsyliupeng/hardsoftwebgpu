// Void-channel check for R11: the validator chord routine applied to the complement field (-f) as well as the solid.
// Usage: node --experimental-strip-types --no-warnings scripts/r11_void_check.ts [res=96]
import { buildCoupled } from "../src/topology/coupled.ts";
import { rayWallThickness } from "../src/validation/thickness.ts";
const L = 20, RES = Number(process.argv[2] ?? 96), h = L / RES;
const solid = buildCoupled({ round: "R11" } as any, L).field;
const void_ = { bounds: solid.bounds, eval: (x: number, y: number, z: number) => -solid.eval(x, y, z), expr: "complement" } as any;
function surfacePts(field: any) {
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
  return pts.filter(([x, y, z]) => Math.min(x, y, z, L - x, L - y, L - z) >= 0.5);
}
function chords(field: any, pts: number[][]) {
  return pts.map(([x, y, z]) => rayWallThickness(field, { positions: new Float64Array([x, y, z]) } as any, h, 1, 0))
    .filter(w => w.chords > 0).map(w => w.min).sort((a, b) => a - b);
}
const q = (arr: number[], p: number) => arr[Math.floor(p * (arr.length - 1))];
const sp = surfacePts(solid);
const cs = chords(solid, sp);
const cv = chords(void_, sp);
console.log(`R11 res ${RES}: surface samples ${sp.length}`);
console.log(`solid walls: p5 ${q(cs, 0.05).toFixed(3)} mm, median ${q(cs, 0.5).toFixed(3)} mm, min ${cs[0].toFixed(3)} mm`);
console.log(`void channels: p5 ${q(cv, 0.05).toFixed(3)} mm, median ${q(cv, 0.5).toFixed(3)} mm, min ${cv[0].toFixed(3)} mm`);
