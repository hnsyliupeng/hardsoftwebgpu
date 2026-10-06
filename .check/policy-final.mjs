import { buildPolicyDataset, trainPolicy, rolloutScore } from '../src/workers/trainers.js';
const ds = buildPolicyDataset(null, { episodes: 5, seed: 11 });
console.log(`dataset ${ds.samplesCount} samples · interval ${ds.interval.toFixed(3)} s`);
const t0 = Date.now();
const { policy, loss, rms } = trainPolicy(ds, { epochs: 30, batch: 32, lr: 0.006, seed: 5 });
console.log(`trained ${((Date.now() - t0) / 1000).toFixed(0)} s · mse ${loss.toFixed(5)} rms ${rms.toFixed(3)}σ`);
for (const i of [0, 1, 2, 3]) {
  const s = rolloutScore(policy, i, { seconds: 34 });
  console.log(`${s.pure.id.padEnd(9)} pure ${s.pure.phase.padEnd(9)} ${s.pure.turns.toFixed(2)} turns | hybrid ${s.hybrid.phase.padEnd(9)} ${s.hybrid.turns.toFixed(2)} turns | expert ${s.expert.turns.toFixed(2)}`);
}
