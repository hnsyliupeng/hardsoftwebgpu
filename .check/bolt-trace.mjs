import { Robot } from '../src/engine/robot.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
import { V3, rad } from '../src/core/mathx.js';
import { armLateralError, armTiltError, PHASE_NAMES } from '../src/core/physics.js';
const robot = new Robot({ tasks: TASK_LIBRARY.map(s => s.spec) });
robot.selectTask(Number(process.argv[2] ?? 0));
const spec = robot.spec, arm = robot.arm;
const dt = 1/240;
let log = false;
for (let k = 0; k < Math.round(6/dt); k++) {
  robot.step(dt);
  const ts = robot.taskState;
  if (ts.phase >= 2) log = true;
  if (log && k % 4 === 0) {
    const st = robot.state;
    const lat = armLateralError(st.tool, spec), tilt = rad(armTiltError(st.tool, spec));
    const absorb = spec.clearance * (1 + 14 * spec.compliance * 0.5);
    console.log([robot.time.toFixed(3), PHASE_NAMES[ts.phase].padEnd(7), 'lat=' + (lat*1000).toFixed(2), 'res=' + (Math.max(lat-absorb,0)*1000).toFixed(2),
      'tilt=' + tilt.toFixed(1), 'misT=' + ts.misalignTime.toFixed(3), 'ovl=' + ts.overloadTime.toFixed(3),
      'T=' + st.toolTorque.toFixed(3), 'F=' + V3.len(robot.reaction.force).toFixed(2), 'turns=' + ts.turns.toFixed(3), 'canEng=' + (Math.max(lat-absorb,0) <= spec.clearance*1.5 && tilt < 6.9)].join(' '));
  }
  if (ts.phase >= 5) break;
}
