import { Robot } from '../src/engine/robot.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
const robot = new Robot({ tasks: TASK_LIBRARY.map(s => s.spec) });
const dt = 1/240;
for (let i = 0; i < 5; i++) {
  robot.selectTask(i);
  let done = -1;
  for (let k = 0; k < Math.round(26/dt); k++) { robot.step(dt); if (done < 0 && robot.metrics().success) done = robot.time; }
  const m = robot.metrics();
  console.log(`${TASK_LIBRARY[i].id.padEnd(9)} ${m.phaseName.padEnd(7)} ${m.success?'OK ':'-- '} done=${done>=0?done.toFixed(2)+'s':'-'} turns=${m.turns.toFixed(2)} depth=${m.depthMm.toFixed(2)}mm dev=${(m.depthMm - robot.spec.pitch*robot.spec.turnsRequired*1000).toFixed(2)}mm peakF=${m.peakForceN.toFixed(1)}N T=${robot.state.toolTorque.toFixed(2)}Nm safety=${m.safety.toFixed(2)} dam=${m.damaged} reason=''${robot.taskState.failReason}''`);
}
