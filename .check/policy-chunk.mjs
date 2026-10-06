// Chunked, state-conditioned policy: fit quality and closed-loop rollouts.
import { buildPolicyDataset, trainPolicy, rolloutScore } from '../src/workers/trainers.js';
import { N_CABLES } from '../src/core/arm.js';
import { POL_CHUNK } from '../src/engine/robot.js';
const t0 = Date.now();
const ds = buildPolicyDataset(null, { episodes: 5, seed: 11, onProgress: (m) => process.stdout.write(`  ${m}\n`) });
console.log(`dataset: ${ds.samplesCount} samples · interval ${ds.interval.toFixed(4)} s · cond ${ds.samples[0].cond.length} · chunk ${POL_CHUNK} · built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const epochs = Number(process.argv[2] ?? 40);
const t1 = Date.now();
const { policy, loss, rms } = trainPolicy(ds, {
  epochs, batch: 32, lr: 0.006, seed: 5,
  onEpoch: (e, l) => { if (e % 20 === 0) console.log(`  ep ${String(e).padStart(3)} mse ${l.toFixed(5)} rms ${Math.sqrt(l).toFixed(4)}σ`); },
});
// row-0 accuracy in tendon millimetres
let abs = 0; let n = 0; let mx = 0;
for (const s of ds.samples.slice(0, 60)) {
  const { out } = policy.forward(s.tokens, s.cond);
  for (let c = 0; c < N_CABLES; c += 1) {
    const v = out[c] * policy.yStd[c] + policy.yMean[c];
    const d = Math.abs(v - s.targets[c]) * 60;
    abs += d; n += 1; mx = Math.max(mx, d);
  }
}
console.log(`trained ${((Date.now() - t1) / 1000).toFixed(1)} s · mse ${loss.toFixed(5)} rms ${rms.toFixed(4)}σ · row0 err mean ${(abs / n).toFixed(3)} mm max ${mx.toFixed(2)} mm`);
for (const i of [0, 1, 2, 3, 4]) {
  const sc = rolloutScore(policy, i, { seconds: 32 });
  console.log(`  ${sc.policy.id.padEnd(9)} ${sc.policy.phase.padEnd(9)} turns ${sc.policy.turns.toFixed(2)} depth ${sc.policy.depthMm.toFixed(1)} mm | expert ${sc.expert.turns.toFixed(2)}`);
}
