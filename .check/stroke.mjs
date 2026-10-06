import { Arm, defaultConfig, homeState } from '../src/core/arm.js';
import { V3, Quat, Transform, rad } from '../src/core/mathx.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';

const arm = new Arm(defaultConfig());
const ext = { force: V3.zero(), torque: V3.zero() };
for (const which of [0,1,2,3]) {
  const spec = TASK_LIBRARY[which].spec;
  const axis = V3.norm(spec.axis);
  const enter = spec.pitch * spec.turnsRequired * 1000;   // mm of engagement travel
  let seed = homeState();
  let pos = V3.add(spec.anchor, V3.scale(axis, 0.02));
  const jump = [];
  let worst = 0, prev = null;
  const steps = Math.round((20 + enter) / 1);
  for (let k = 0; k <= steps; k++) {
    const target = { p: pos, q: Quat.fromYTo(axis) };
    const s2 = arm.ik(target, seed, 16, { axisWeight: 0.3 });
    const tip = arm.fk(s2, 0, 0);
    const err = V3.len(V3.sub(tip.p, pos)) * 1000;
    worst = Math.max(worst, err);
    if (prev) {
      const j = Math.max(...s2.map((s, i) => Math.abs(rad(s.bend - prev[i].bend))));
      jump.push({ mm: (20 - k), j, err });
    }
    prev = s2.map(s => ({ ...s }));
    seed = { ...seed, seg: s2.map(s => ({ ...s })) };
    pos = V3.add(pos, V3.scale(axis, -0.001));
  }
  const bad = jump.filter(x => x.j > 3 || x.err > 3);
  console.log(`${TASK_LIBRARY[which].id.padEnd(6)} stroke ${enter.toFixed(1)}mm: worstErr=${worst.toFixed(1)}mm, first breakdown at ${bad.length ? bad[0].mm.toFixed(0) + 'mm (jump ' + bad[0].j.toFixed(1) + '°, err ' + bad[0].err.toFixed(1) + 'mm)' : 'none'}, breakdowns=${bad.length}/${jump.length}`);
}
