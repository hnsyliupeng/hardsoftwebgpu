import { Arm, defaultConfig, homeState } from '../src/core/arm.js';
import { V3, Quat, Transform, rad } from '../src/core/mathx.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
const arm = new Arm(defaultConfig());
const spec = TASK_LIBRARY[0].spec;
const axis = V3.norm(spec.axis);
const p = V3.add(spec.anchor, V3.scale(axis, 0.002));
const seed = homeState();
const seg = arm.ik({ p, q: Quat.fromYTo(axis) }, seed, 24);
for (const f of [0, 0.5, 1, 2, 4]) {
  const st = homeState();
  st.cableCmd = arm.cableTargets(seg);
  const ext = { force: V3.scale(V3.new(1, 0, 0.4), f), torque: V3.zero() };
  for (let i = 0; i < 240*3; i++) arm.step(st, 1/240, ext, { speed: 0 });
  const st0 = homeState();
  st0.cableCmd = arm.cableTargets(seg);
  for (let i = 0; i < 240*3; i++) arm.step(st0, 1/240, { force: V3.zero(), torque: V3.zero() }, { speed: 0 });
  console.log(`F=${f}N lateral → tip shift ${(V3.len(V3.sub(st.tool.p, st0.tool.p))*1000).toFixed(2)}mm  (bend Δ ${rad(st.seg.reduce((a,s)=>a+s.bend,0) - st0.seg.reduce((a,s)=>a+s.bend,0)).toFixed(2)}°)`);
}
// and the sensitivity to a small cable error (what the servo lag looks like)
for (const dc of [0.0005, 0.001, 0.002]) {
  const st = homeState(); st.cableCmd = arm.cableTargets(seg);
  for (let i = 0; i < 240*3; i++) arm.step(st, 1/240, { force: V3.zero(), torque: V3.zero() }, { speed: 0 });
  const st2 = homeState(); st2.cableCmd = arm.cableTargets(seg).map((c, i) => c + (i % 3 === 0 ? dc : 0));
  for (let i = 0; i < 240*3; i++) arm.step(st2, 1/240, { force: V3.zero(), torque: V3.zero() }, { speed: 0 });
  console.log(`cable bias ${(dc*1000).toFixed(1)}mm on 3 cables → tip shift ${(V3.len(V3.sub(st2.tool.p, st.tool.p))*1000).toFixed(2)}mm`);
}
