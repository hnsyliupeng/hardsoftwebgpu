import { Robot } from '../src/engine/robot.js';
import { TASK_LIBRARY } from '../src/engine/tasks.js';
import { buildPolicyDataset, trainPolicy, rolloutScore, buildMlpDataset, trainMlp } from '../src/workers/trainers.js';
const t0 = Date.now();
const robot = new Robot({ tasks: TASK_LIBRARY.map(s => s.spec) });
const ds = buildPolicyDataset(robot, { episodes: 4, seed: 5, onProgress: (t) => console.log('  ', t) });
console.log(`dataset: ${ds.samples.length} solved episodes (${Date.now()-t0} ms)`);
const { policy, loss } = trainPolicy(ds, { epochs: 150, lr: 0.004, seed: 5 });
console.log('policy loss', loss.toFixed(5), `(${Date.now()-t0} ms)`);
const score = rolloutScore(policy, 0, { seconds: 26 });
console.log('rollout (open loop):', JSON.stringify(score.policy));
console.log('expert (same job)  :', JSON.stringify(score.expert));
// and the learned IK network
const mds = buildMlpDataset(robot, { samples: 2000, seed: 7 });
const { net, mae } = trainMlp(mds, { epochs: 120, batch: 32, lr: 0.006 });
console.log(`mlp: ${mds.n} samples · mae ${Number(mae).toFixed(5)} rad-scale (×${0.06} m) = ${(Number(mae)*0.06*1000).toFixed(2)} mm rms tendon error`);
