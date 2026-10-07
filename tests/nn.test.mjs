/**
 * Gradient / behaviour tests for the learned models.
 * `node --test tests/`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Adam, Mlp, Transformer, ACT } from '../src/core/nn.js';
import { Rng } from '../src/core/mathx.js';

function makeData(n, inDim, outDim, fn) {
  const x = new Float32Array(n * inDim);
  const y = new Float32Array(n * outDim);
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < inDim; k += 1) x[i * inDim + k] = Math.sin(i * 0.37 + k) * 0.8;
    const target = fn(x.subarray(i * inDim, (i + 1) * inDim));
    for (let k = 0; k < outDim; k += 1) y[i * outDim + k] = target[k];
  }
  return { x, y, n, inDim, outDim };
}

test('MLP analytic gradients match finite differences', () => {
  const net = new Mlp([3, 5, 4, 2], { act: ACT.TANH, seed: 4 });
  const x = Float32Array.from([0.3, -0.7, 0.25]);
  const y = Float32Array.from([0.5, -0.2]);
  const p = net.paramCount;
  const sumSq = (out) => ((out[0] - y[0]) ** 2 + (out[1] - y[1]) ** 2) / net.layers[net.layers.length - 1].outDim;

  // analytic: whatever `accumulate` (the trainer's backward) produces
  const grads = new Float32Array(p);
  const reported = net.accumulate(x, y, grads);
  assert.ok(Math.abs(reported - sumSq(net.forward(x))) < 1e-6, 'accumulate returns its own loss');

  // numeric: central differences on the exact same loss
  const base = net.params();
  const eps = 1e-3;
  const lossAt = (params) => { net.setParams(params); return sumSq(net.forward(x)); };
  let worst = 0;
  for (let i = 0; i < p; i += 1) {
    const plus = Float32Array.from(base); plus[i] += eps;
    const minus = Float32Array.from(base); minus[i] -= eps;
    const numeric = (lossAt(plus) - lossAt(minus)) / (2 * eps);
    worst = Math.max(worst, Math.abs(numeric - grads[i]));
  }
  net.setParams(base);
  assert.ok(worst < 8e-3, `worst |analytic - numeric| = ${worst}`);
  assert.ok(worst > 0, 'gradients are not all zero');
});

test('MLP trains to fit a smooth function', () => {
  const data = makeData(120, 4, 2, (x) => [Math.tanh(x[0] * 1.5 - x[1]), x[2] * x[3]]);
  const net = new Mlp([4, 24, 24, 2], { act: ACT.TANH, seed: 2 });
  const before = net.evaluate(data).mean;
  net.train(data, { epochs: 60, batch: 16, lr: 0.01, seed: 3 });
  const after = net.evaluate(data).mean;
  assert.ok(after < before * 0.5, `loss ${before} → ${after}`);
});

test('transformer forward is causal and attention rows sum to one', () => {
  const t = new Transformer({ dModel: 12, nHeads: 3, nLayers: 2, dFf: 24, seqLen: 6, outDim: 4 }, 40, 5, 1);
  const tokens = [1, 2, 3, 4, 5, 6];
  const cond = [0.1, -0.2, 0.3, 0.4, -0.5];
  const { out, attn } = t.forward(tokens, cond);
  assert.equal(out.length, 6 * 4);
  assert.ok(Array.from(out).every((v) => Number.isFinite(v) && Math.abs(v) <= 1.000001));
  for (const layerAttn of attn) {
    for (let head = 0; head < 3; head += 1) {
      for (let i = 0; i < 6; i += 1) {
        let sum = 0;
        for (let j = 0; j < 6; j += 1) {
          const w = layerAttn[(head * 6 + i) * 6 + j];
          if (j > i) assert.ok(Math.abs(w) < 1e-6, 'future token received attention');
          sum += w;
        }
        assert.ok(Math.abs(sum - 1) < 1e-4, `row ${i} sums to ${sum}`);
      }
    }
  }
});

test('transformer backprop matches finite differences', () => {
  const cfg = { dModel: 6, nHeads: 2, nLayers: 1, dFf: 10, seqLen: 3, outDim: 2 };
  const t = new Transformer(cfg, 8, 3, 5);
  const rng = new Rng(11);
  const tokens = [1, 2, 3];
  const cond = [0.2, -0.4, 0.1];
  const targets = new Float32Array(3 * 2);
  for (let i = 0; i < targets.length; i += 1) targets[i] = rng.signed() * 0.5;

  const p = t.paramCount;
  const grads = new Float32Array(p);
  t.backwardSample(tokens, cond, targets, grads);

  const lossAt = (params) => {
    t.setParams(params);
    const { out } = t.forward(tokens, cond);
    let l = 0;
    for (let i = 0; i < out.length; i += 1) l += (out[i] - targets[i]) ** 2;
    return l / out.length;
  };
  const base = t.params();
  const eps = 1e-3;
  let checked = 0;
  let worst = 0;
  for (let i = 0; i < p; i += 7) { // sample parameters to keep the test fast
    const plus = Float32Array.from(base); plus[i] += eps;
    const minus = Float32Array.from(base); minus[i] -= eps;
    const numeric = (lossAt(plus) - lossAt(minus)) / (2 * eps);
    const analytic = grads[i];
    worst = Math.max(worst, Math.abs(numeric - analytic));
    assert.ok(Math.abs(numeric - analytic) < 2e-2, `param ${i}: analytic ${analytic} vs numeric ${numeric}`);
    checked += 1;
  }
  t.setParams(base);
  assert.ok(checked > 20, `only ${checked} parameters sampled`);
  assert.ok(worst < 2e-2);
});

test('transformer learns an imitation task (loss falls, Adam updates)', () => {
  const cfg = { dModel: 16, nHeads: 2, nLayers: 2, dFf: 32, seqLen: 8, outDim: 4 };
  const t = new Transformer(cfg, 16, 6, 3);
  const rng = new Rng(7);
  const batch = [];
  for (let i = 0; i < 12; i += 1) {
    const tokens = Array.from({ length: 8 }, (_, k) => (i + k) % 12);
    const cond = Array.from({ length: 6 }, () => rng.signed());
    const targets = new Float32Array(8 * 4);
    for (let k = 0; k < targets.length; k += 1) targets[k] = Math.tanh(cond[k % 6] * 1.2);
    batch.push({ tokens, cond, targets });
  }
  const adam = new Adam(t.paramCount, 0.01);
  const grads = new Float32Array(t.paramCount);
  const first = t.trainStep(batch, grads, adam);
  let last = first;
  for (let step = 0; step < 30; step += 1) last = t.trainStep(batch, grads, adam);
  assert.ok(last < first * 0.9, `transformer loss ${first} → ${last}`);
});

test('weights round-trip through JSON for the UI export button', () => {
  const net = new Mlp([5, 8, 3], { act: ACT.GELU, seed: 9 });
  const clone = Mlp.fromJSON(JSON.parse(JSON.stringify(net.toJSON())));
  const x = [0.1, -0.2, 0.3, 0.4, -0.5];
  const a = net.predict(x);
  const b = clone.predict(x);
  for (let i = 0; i < a.length; i += 1) assert.ok(Math.abs(a[i] - b[i]) < 1e-6);

  const t = new Transformer({ dModel: 8, nHeads: 2, nLayers: 1, dFf: 16, seqLen: 4, outDim: 3 }, 12, 4, 2);
  const tClone = Transformer.fromJSON(JSON.parse(JSON.stringify(t.toJSON())));
  const x1 = t.policy([1, 2, 3, 4], [0.1, 0.2, 0.3, 0.4]);
  const x2 = tClone.policy([1, 2, 3, 4], [0.1, 0.2, 0.3, 0.4]);
  for (let i = 0; i < x1.length; i += 1) assert.ok(Math.abs(x1[i] - x2[i]) < 1e-5);
});
