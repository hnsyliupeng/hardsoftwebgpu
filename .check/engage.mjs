import { Robot } from '../src/engine/robot.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
import { V3, Transform, rad } from '../src/core/mathx.js';
import { armLateralError, armTiltError, PHASE_NAMES, TASK_KIND } from '../src/core/physics.js';
const which = Number(process.argv[2] ?? 2);
const robot = new Robot({ tasks: TASK_LIBRARY.map(s => s.spec) });
robot.selectTask(which);
const spec = robot.spec;
const dt = 1/240;
for (let k = 0; k < Math.round(8/dt); k++) {
  robot.step(dt);
  if (k % Math.round(0.5/dt)) continue;
  const st = robot.state, ts = robot.taskState;
  const lat = armLateralError(st.tool, spec), tilt = armTiltError(st.tool, spec);
  const absorbLen = spec.clearance * (1 + 10 * spec.compliance * 0.5);
  const residual = Math.max(lat - absorbLen, 0);
  console.log([robot.time.toFixed(1), PHASE_NAMES[ts.phase].padEnd(7), 'dA=' + V3.len(V3.sub(st.tool.p, spec.anchor)).toFixed(4),
    'lat=' + (lat*1000).toFixed(2) + 'mm', 'res=' + (residual*1000).toFixed(2), 'tilt=' + rad(tilt).toFixed(1) + '°',
    'canEng=' + (residual <= spec.clearance*1.5 && tilt < 0.12), 'T=' + st.toolTorque.toFixed(3), 'spin=' + st.motorAngle.toFixed(2),
    'ovl=' + ts.overloadTime.toFixed(3), 'turns=' + ts.turns.toFixed(2), 'dep=' + (ts.depth*1000).toFixed(1)].join(' '));
  if (ts.phase === 5 || ts.phase === 6) break;
}
