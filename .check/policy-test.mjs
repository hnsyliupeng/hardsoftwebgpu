import { Robot } from '../src/engine/robot.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
import { expertEpisode, trainPolicy } from '../src/workers/trainers.js';
const t0 = Date.now();
const samples = [];
for (const idx of [0, 1, 2]) {
  const ep = expertEpisode(TASK_LIBRARY[idx], { seed: 3 + idx, seconds: 40 });
  console.log(`${TASK_LIBRARY[idx].id}: ${ep.metrics.phaseName} turns=${ep.metrics.turns.toFixed(2)} depth=${ep.metrics.depthMm.toFixed(2)}mm (${Date.now()-t0}ms)`);
  samples.push({ tokens: ep.tokens, cond: ep.cond, targets: ep.targets });
}
let zero = 0, tot = 0;
for (const s of samples) for (const v of s.targets) { zero += v*v; tot += 1; }
console.log('zero-baseline mse', (zero/tot).toFixed(5));
for (const lr of [0.001, 0.004]) {
  const { policy, loss } = trainPolicy({ samples }, { epochs: 40, batch: 2, lr, seed: 5 });
  const tokens = samples[0].tokens, cond = samples[0].cond;
  const { out } = policy.forward(tokens, cond);
  let e = 0;
  for (let i = 0; i < out.length; i++) e += (out[i] - samples[0].targets[i]) ** 2;
  console.log(`lr=${lr}: final loss ${loss.toFixed(5)} · eval mse ${(e/out.length).toFixed(5)} · vs zero-baseline ${(zero/tot).toFixed(5)}`);
}
console.log('total', Date.now()-t0, 'ms');
