import { buildPolicyDataset, trainPolicy, rolloutScore } from '../src/workers/trainers.js';
const ds = buildPolicyDataset(null, { episodes: 5, seed: 11 });
const { policy, mse } = trainPolicy(ds, { epochs: 40, batch: 32, lr: 0.006, seed: 5 });
console.log(`policy mse ${mse.toFixed(4)} — bolt/bulb/valve/peg at several policy-authority settings`);
for (const w of [0.6, 0.75, 0.9, 0.97]) {
  const out = [];
  for (const i of [0, 1, 2, 3]) {
    const s = rolloutScore(policy, i, { seconds: 34, residualWeight: w });
    out.push(`${s.pure.id.slice(0, 4)} ${s.hybrid.success ? 'OK' : '—'} ${s.hybrid.turns.toFixed(2)}`);
  }
  console.log(`  residualWeight ${w} (policy authority ${(1 - w).toFixed(2)}): ${out.join(' | ')}`);
}
