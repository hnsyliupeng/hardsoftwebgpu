import { Robot } from '../src/engine/robot.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
import { V3 } from '../src/core/mathx.js';
import { PHASE_NAMES } from '../src/core/physics.js';
const robot = new Robot({ tasks: TASK_LIBRARY.map(s => s.spec) });
robot.selectTask(Number(process.argv[2] ?? 0));
const spec = robot.spec;
let last = -9;
const dt = 1/240;
for (let k = 0; k < Math.round(20/dt); k++) {
  robot.step(dt);
  const ts = robot.taskState;
  if (ts.phase !== last) {
    const dA = V3.len(V3.sub(robot.state.tool.p, spec.anchor));
    console.log(`t=${robot.time.toFixed(3)} ${PHASE_NAMES[last] ?? 'start'} → ${PHASE_NAMES[ts.phase]}  dist=${dA.toFixed(4)} phaseTime=${ts.phaseTime.toFixed(3)} F=${robot.telemetry.contactForce.toFixed(2)} T=${robot.state.toolTorque.toFixed(3)} turns=${ts.turns.toFixed(3)} damaged=${ts.damaged} reason=${ts.failReason}`);
    last = ts.phase;
  }
  if (robot.time > 6 && ts.phase > 4) break;
}
