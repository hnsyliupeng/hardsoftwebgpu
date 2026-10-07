// Is the drawn arm a lattice tower? Count instances, measure the tower's extent,
// and report the truss triangle budget.
import { byId, __drainRaf } from './dom-shim.mjs';
import { attachSoftCanvas, encodePng } from './softcanvas.mjs';
import { writeFileSync } from 'node:fs';
import { V3 } from '../src/core/mathx.js';
const ctx = attachSoftCanvas(byId.get('view'), 1280, 720);
const app = await (await import('../src/app/main.js')).boot({ setBoot: () => {}, hideBoot: () => {}, showError: (t) => console.log('ERR', t), report: () => {} });
__drainRaf(2);
const scene = app.scene;
let tris = 0;
for (const [name, entry] of scene.meshes) {
  const mesh = app.renderer.meshes.get(name);
  const t = (mesh?.indices?.length ?? 0) / 3;
  tris += t * entry.count;
  if (/cell|tool|base/.test(name)) console.log(`  ${name.padEnd(12)} inst ${String(entry.count).padStart(3)} · ${String(t).padStart(5)} tris each · ${String(t * entry.count).padStart(6)} total`);
}
console.log(`scene total ${tris.toFixed(0)} tris`);
const bones = app.robot.bones().filter((b) => b.active !== false);
const guides = app.robot.guides();
const lo = Math.min(...bones.map((b) => b.transform.p.y));
const hi = Math.max(...bones.map((b) => b.transform.p.y));
const tip = app.robot.state.tool.p;
console.log(`tower: ${bones.length} nested joints from y ${lo.toFixed(3)} to ${hi.toFixed(3)} m · ${guides.length} cable guides · tool at y ${tip.y.toFixed(3)} m`);
console.log(`joint pitch: ${((hi - lo) / (bones.length - 1) * 1000).toFixed(1)} mm, ball D = ${(bones[0].cellDiameter * 1000).toFixed(0)} mm (paper), guide ring ${(guides[0].radius * 1000).toFixed(0)} mm`);
