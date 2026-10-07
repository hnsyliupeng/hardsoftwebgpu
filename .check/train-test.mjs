import { Robot } from '../src/engine/robot.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
import { buildMlpDataset, trainMlp, expertEpisode, trainPolicy, buildPolicyDataset } from '../src/workers/trainers.js';

const t0 = Date.now();
const robot = new Robot({ tasks: TASK_LIBRARY.map(s => s.spec) });
const ds = buildMlpDataset(robot, { samples: 200, seed: 7 });
console.log(`mlp dataset: ${ds.n} samples in ${Date.now() - t0} ms`);
const { net, history, mae } = trainMlp(ds, { epochs: 4, onEpoch: (e, l) => process.stdout.write(`  epoch ${e} loss ${l.toFixed(5)}\n`) });
console.log('mlp mae', Number(mae).toFixed(6), 'params', net.paramCount, `(${Date.now() - t0} ms total)`);

const t1 = Date.now();
const ep = expertEpisode(TASK_LIBRARY[1], { seed: 1, seconds: 20 });
console.log(`expert episode (${TASK_LIBRARY[1].id}) phase=${ep.metrics.phaseName} turns=${ep.metrics.turns.toFixed(2)} tokens=${ep.tokens.slice(0,8).join(',')}… targets[0..3]=${Array.from(ep.targets.slice(0,4)).map(v=>v.toFixed(3)).join(' ')} (${Date.now()-t1} ms)`);
const ds2 = { samples: [{ tokens: ep.tokens, cond: ep.cond, targets: ep.targets }, { tokens: ep.tokens, cond: ep.cond, targets: ep.targets }] };
const t2 = Date.now();
const { policy, loss } = trainPolicy(ds2, { epochs: 2, onEpoch: (e, l) => process.stdout.write(`  policy epoch ${e} loss ${l.toFixed(5)}\n`) });
console.log('policy loss', Number(loss).toFixed(6), "params", policy.paramCount, `(${Date.now()-t2} ms)`);
// rollout quality: does the trained (2-epoch) policy at least move toward the target?
const { out } = policy.forward(ep.tokens, ep.cond);
let err = 0, base = 0;
for (let i = 0; i < out.length; i++) { err += (out[i] - ep.targets[i]) ** 2; base += ep.targets[i] ** 2; }
console.log(`policy mse ${(err/out.length).toFixed(5)} vs zero-baseline ${(base/out.length).toFixed(5)}`);
