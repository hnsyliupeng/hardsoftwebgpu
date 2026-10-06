// Can the transformer fit the nominal demonstrations, and does a tighter fit
// turn into a working closed-loop rollout?
import { buildPolicyDataset, trainPolicy, rolloutScore } from '../src/workers/trainers.js';
import { N_CABLES } from '../src/core/arm.js';

const t0 = Date.now();
const ds = buildPolicyDataset(null, { episodes: 5, seed: 11, onProgress: (m) => process.stdout.write(`  ${m}\n`) });
console.log(`dataset: ${ds.samplesCount} samples · interval ${ds.interval?.toFixed(4)} s · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const ids = new Set(ds.samples.map((s) => s.cond.slice(0, 4).join('')));
console.log(`distinct tasks: ${ids.size} (cond dim ${ds.samples[0].cond.length})`);

const rms = (loss) => Math.sqrt(loss / (48 * N_CABLES));
for (const epochs of [200, 600, 1500]) {
  const t1 = Date.now();
  const { policy, loss } = trainPolicy(ds, { epochs, batch: 5, lr: 0.006, seed: 5 });
  const sc = rolloutScore(policy, 0, { seconds: 32 });
  console.log(`epochs ${String(epochs).padStart(4)}: loss ${loss.toFixed(5)} (rms ${rms(loss).toFixed(4)} σ) ${((Date.now() - t1) / 1000).toFixed(1)} s → bolt ${sc.policy.turns.toFixed(2)} turns ${sc.policy.phase} | expert ${sc.expert.turns.toFixed(2)}`);
}
