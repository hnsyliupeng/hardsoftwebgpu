// Is the failure the *fit* or the *clock*? Replay the exact bucketed expert
// commands through the policy pathway at several plan intervals.
import { Robot, CONTROL_MODE } from '../src/engine/robot.js';
import { TASK_LIBRARY, stagesOf } from '../src/engine/tasks.js';
import { PHASE } from '../src/core/physics.js';
import { N_CABLES } from '../src/core/arm.js';

const stage = stagesOf(TASK_LIBRARY[0])[0];
const scenario = { ...stage, spec: stage.spec };
const dt = 1 / 240;

// record
const rec = [];
{
  const r = new Robot({ tasks: [scenario.spec], seed: 7 });
  r.selectTask(0); r.setMode(CONTROL_MODE.EXPERT);
  for (let i = 0; i < Math.round(34 / dt); i += 1) {
    r.step(dt, { ikIters: 24, cableSlew: 0.025, record: false });
    rec.push(Float32Array.from(r.state.cableCmd));
    const m = r.metrics();
    if ((m.phase === PHASE.DONE || m.phase === PHASE.FAILED) && r.taskState.phaseTime > 0.5) break;
  }
}
console.log(`bolt demo: ${rec.length} steps = ${(rec.length / 240).toFixed(1)} s`);

function makeOracle(horizon) {
  const per = Math.max(1, Math.floor(horizon / dt / 48));
  const out = new Float32Array(48 * N_CABLES);
  for (let tok = 0; tok < 48; tok += 1) {
    const lo = tok * per; const hi = Math.min(rec.length, lo + per);
    for (let c = 0; c < N_CABLES; c += 1) {
      let acc = 0;
      for (let i = lo; i < hi; i += 1) acc += rec[i][c];
      out[tok * N_CABLES + c] = (hi > lo ? acc / (hi - lo) : out[Math.max(0, tok - 1) * N_CABLES + c]) / 0.06;
    }
  }
  return { planInterval: per * dt, yMean: null, yStd: null, forward: () => ({ out, attn: null }) };
}

for (const horizon of [13.5, 16, 20, 26.1, 34]) {
  const o = makeOracle(horizon);
  const r = new Robot({ tasks: [scenario.spec] });
  r.selectTask(0); r.policy = o; r.setMode(CONTROL_MODE.LEARNED);
  const trace = [];
  let last = '';
  for (let i = 0; i < Math.round(38 / dt); i += 1) {
    r.step(dt, { ikIters: 24, residual: false });
    const m = r.metrics();
    if (m.phaseName !== last) { trace.push(`${r.time.toFixed(1)}s:${m.phaseName}`); last = m.phaseName; }
    if (m.phase === PHASE.DONE || m.phase === PHASE.FAILED) break;
  }
  const m = r.metrics();
  console.log(`interval ${o.planInterval.toFixed(3)} s (plan ${(48 * o.planInterval).toFixed(1)} s): ${m.phaseName.padEnd(9)} turns ${m.turns.toFixed(2)} | ${trace.join(' → ')}`);
}
