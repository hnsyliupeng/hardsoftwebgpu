import { Arm, defaultConfig, homeState } from '../src/core/arm.js';
import { V3, Quat, Transform, rad } from '../src/core/mathx.js';

const ANCH = [
  ['bolt',  [0.1691,0.6437,0.0516], [0.3686,0.9151,-0.1635]],
  ['bulb',  [-0.0938,0.5954,0.2623], [-0.2978,0.9088,0.2921]],
  ['valve', [-0.2324,0.5943,-0.0777], [-0.1336,0.9451,-0.2982]],
  ['peg',   [0.0637,0.6265,-0.1754], [-0.2085,0.9753,-0.0727]],
];
const LADDER = [0.03, 0.015, 0.004, 0];
const ext = { force: V3.zero(), torque: V3.zero() };
const arm = new Arm(defaultConfig());
for (const [name, a, x] of ANCH) {
  const anchor = V3.new(...a), axis = V3.norm(V3.new(...x));
  const out = [];
  for (const s of LADDER) {
    const p = V3.add(anchor, V3.scale(axis, -s));
    const seed = homeState();
    const seg = arm.ik({ p, q: Quat.fromYTo(axis) }, seed, Number(process.argv[2] ?? 40), { axisWeight: Number(process.argv[3] ?? 0.3) });
    const st = homeState();
    st.cableCmd = arm.cableTargets(seg);
    for (let i = 0; i < 240*3; i++) arm.step(st, 1/240, ext, { speed: 0 });
    const err = V3.len(V3.sub(st.tool.p, p));
    const orient = rad(Math.acos(Math.min(1, Math.abs(V3.dot(Transform.up(st.tool), axis)))));
    const bend = rad(st.seg.reduce((q,z)=>q+z.bend,0));
    out.push(`${s}: ${(err*1000).toFixed(1)}mm/${orient.toFixed(1)}° b${bend.toFixed(0)}°`);
  }
  console.log(name.padEnd(6), out.join('   '));
}
