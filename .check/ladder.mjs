import { Arm, defaultConfig, homeState } from '../src/core/arm.js';
import { V3, Quat, Transform, rad } from '../src/core/mathx.js';

const CAND = [
  ['bolt-old',  [0.17,0.585,0.11],  [0.18,0.96,0.20]],
  ['bulb-old',  [0.12,0.655,0.09],  [0.10,0.98,0.14]],
  ['valve-old', [0.22,0.555,0.17],  [0.30,0.90,0.30]],
  ['peg-old',   [0.10,0.62,0.06],   [0.08,0.99,0.10]],
  ['bolt-up',   [0.10,0.66,0.05],   [-0.10,0.98,-0.12]],
  ['valve-up',  [-0.16,0.62,-0.06], [0.28,0.94,0.18]],
  ['bulb-in',   [-0.06,0.64,0.20],  [-0.10,0.99,0.12]],
  ['peg-in',    [0.06,0.63,-0.18],  [0.09,0.99,-0.12]],
];
const LADDER = [0.03, 0.015, 0.004, 0];
const ext = { force: V3.zero(), torque: V3.zero() };
const arm = new Arm(defaultConfig());
for (const [name, a, x] of CAND) {
  const anchor = V3.new(...a), axis = V3.norm(V3.new(...x));
  const out = [];
  for (const s of LADDER) {
    const p = V3.add(anchor, V3.scale(axis, -s));
    const seed = homeState();
    const seg = arm.ikCompensated({ p, q: Quat.fromYTo(axis) }, seed, 24, ext, { passes: 2, axisWeight: 1.0 });
    const ikErr = V3.len(V3.sub(arm.fk(arm.predictLoaded(seg, seed, ext), 0, 0).p, p));
    const st = homeState();
    st.cableCmd = arm.cableTargets(seg);
    for (let i = 0; i < 240*3; i++) arm.step(st, 1/240, ext, { speed: 0 });
    const err = V3.len(V3.sub(st.tool.p, p));
    const orient = rad(Math.acos(Math.min(1, Math.abs(V3.dot(Transform.up(st.tool), axis)))));
    out.push(`${s}: ik${(ikErr*1000).toFixed(0)}/sim${(err*1000).toFixed(0)}mm/${orient.toFixed(1)}°`);
  }
  console.log(name.padEnd(10), out.join('  '));
}
