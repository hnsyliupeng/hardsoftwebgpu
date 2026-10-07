import { Robot } from '../src/engine/robot.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
import { V3, rad } from '../src/core/mathx.js';
import { PHASE_NAMES } from '../src/core/physics.js';
const robot = new Robot({ tasks: TASK_LIBRARY.map(s => s.spec) });
robot.selectTask(0);
const arm = robot.arm;
const origStep = arm.step.bind(arm);
let prev = null;
arm.step = (state, dt, ext, motor) => {
  const before = { p: V3.clone(state.tool.p), c: state.cables.slice(), seg: state.seg.map(s=>rad(s.bend)) };
  const r = origStep(state, dt, ext, motor);
  const jump = V3.len(V3.sub(state.tool.p, before.p));
  const cj = Math.max(...state.cables.map((c,i)=>Math.abs(c-before.c[i])));
  const sj = Math.max(...state.seg.map((s,i)=>Math.abs(rad(s.bend)-before.seg[i])));
  if (jump > 0.005 || sj > 1 || cj > 0.005) {
    console.log(`t=${robot.time.toFixed(4)} jump=${(jump*1000).toFixed(1)}mm segJump=${sj.toFixed(2)}° cableJump=${(cj*1000).toFixed(2)}mm phase=${PHASE_NAMES[robot.taskState.phase]} dt=${dt.toFixed(5)} motor=${JSON.stringify(motor)}`);
    console.log('   cables', state.cables.map(c=>(c*1000).toFixed(1)).join(' '), 'cmd', state.cableCmd.map(c=>(c*1000).toFixed(1)).join(' '));
    console.log('   seg   ', state.seg.map(s=>`${rad(s.bend).toFixed(1)}/${rad(s.plane).toFixed(0)}/${(s.compress*1000).toFixed(1)}`).join(' '));
  }
  return r;
};
const dt = 1/240;
for (let k = 0; k < Math.round(3/dt); k++) {
  robot.step(dt);
  if (robot.taskState.phase === 6) { console.log('FAILED at', robot.time.toFixed(3)); break; }
}
console.log('done phase', PHASE_NAMES[robot.taskState.phase]);
