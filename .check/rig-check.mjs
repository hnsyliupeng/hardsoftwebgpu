// The drawn arm must agree with the kinematics: last cell lands on the tool,
// every tendon starts near the base and ends on its own segment's ring.
import { byId } from './dom-shim.mjs';
import { attachSoftCanvas } from './softcanvas.mjs';
attachSoftCanvas(byId.get('view'), 1280, 720);
const app = await (await import('../src/app/main.js')).boot({ setBoot: () => {}, hideBoot: () => {}, showError: (t) => console.log('ERR', t), report: () => {} });
const { V3, Quat, Transform } = await import('../src/core/mathx.js');
const bones = app.robot.bones();
const tip = app.robot.state.tool.p;
const body = bones.slice(0, -1);
const last = body[body.length - 1];
const end = V3.add(last.transform.p, V3.scale(Quat.rotate(last.transform.q, V3.new(0, 1, 0)), last.length * 0.5));
console.log(`bones ${bones.length} · chain top ${last.transform.p.y.toFixed(3)} m · chain end ${end.y.toFixed(3)} m · tool ${tip.y.toFixed(3)} m`);
console.log(`chain-end vs tool: ${(V3.dist(end, tip) * 1000).toFixed(1)} mm   (want < 15 mm: the tool gizmo is 18 mm long)`);
const cables = app.robot.cables();
let worst = 0;
cables.forEach((c) => {
  const a = c.points[0];
  const b = c.points[c.points.length - 1];
  const r = Math.hypot(a.x, a.z);
  worst = Math.max(worst, Math.abs(r - 0.0245));
  console.log(`  cable ${c.cable}: base (${a.x.toFixed(3)}, ${a.y.toFixed(3)}, ${a.z.toFixed(3)}) → anchor (${b.x.toFixed(3)}, ${b.y.toFixed(3)}, ${b.z.toFixed(3)}) · ${c.points.length} pts`);
});
console.log(`base ring radius error: ${(worst * 1000).toFixed(2)} mm (want ≈ 0: cables sit on the spine's surface)`);
// spine monotonicity: each bone must be further up than the previous in the arm's own frame
let monotone = true;
for (let i = 1; i < body.length; i += 1) {
  const d = V3.dist(body[i].transform.p, { x: 0, y: 0, z: 0 }) - V3.dist(body[i - 1].transform.p, { x: 0, y: 0, z: 0 });
  if (d < 0) monotone = false;
}
console.log(`radial distance increases along the chain: ${monotone}`);
