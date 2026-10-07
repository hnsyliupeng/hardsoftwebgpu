/**
 * nn.js — learned models, trained **live in the browser** (no bundler, no tf.js):
 *
 *  • `Mlp`         — inverse-kinematics net (cable lengths → tool pose) and its
 *                    inverse (pose → cable lengths), the model the paper trains.
 *  • `Transformer` — a small causal trajectory transformer: tokenised task plan +
 *                    conditioning vector (goal, object parameters) → tendon-length
 *                    deltas for every step of the plan. Trained by imitation of the
 *                    scripted expert controller with hand-written backprop.
 *  • `Adam`        — optimiser shared by both.
 *
 * Mirrors `rust/trunc_core/src/nn.rs` (same shapes, same forward equations); the
 * gradient check in tests/nn.test.mjs validates the backprop numerically.
 */

import { Rng } from './mathx.js';

export const ACT = { TANH: 0, RELU: 1, GELU: 2 };

export function activate(act, x) {
  switch (act) {
    case ACT.RELU: return x > 0 ? x : 0;
    case ACT.GELU: return 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
    default: return Math.tanh(x);
  }
}

export function activateDeriv(act, pre, out) {
  switch (act) {
    case ACT.RELU: return pre > 0 ? 1 : 0;
    case ACT.GELU: {
      const u = 0.7978845608 * (pre + 0.044715 * pre * pre * pre);
      const t = Math.tanh(u);
      return 0.5 * (1 + t) + 0.5 * pre * (1 - t * t) * 0.7978845608 * (1 + 3 * 0.044715 * pre * pre);
    }
    default: return 1 - out * out;
  }
}

export class Adam {
  constructor(n, lr = 0.003) {
    this.m = new Float32Array(n);
    this.v = new Float32Array(n);
    this.t = 0;
    this.lr = lr;
    this.b1 = 0.9;
    this.b2 = 0.999;
    this.eps = 1e-8;
    this.wd = 0;
  }
  setLr(lr) { this.lr = lr; }
  step(params, grads) {
    this.t += 1;
    const bc1 = 1 - this.b1 ** this.t;
    const bc2 = 1 - this.b2 ** this.t;
    const { m, v } = this;
    for (let i = 0; i < params.length; i += 1) {
      const g = grads[i] + this.wd * params[i];
      m[i] = this.b1 * m[i] + (1 - this.b1) * g;
      v[i] = this.b2 * v[i] + (1 - this.b2) * g * g;
      params[i] -= (this.lr * (m[i] / bc1)) / (Math.sqrt(v[i] / bc2) + this.eps);
    }
  }
}

// ---------------------------------------------------------------------------
// MLP
// ---------------------------------------------------------------------------

export class Mlp {
  constructor(sizes, { act = ACT.TANH, seed = 1 } = {}) {
    this.sizes = sizes.slice();
    this.act = act;
    const rng = new Rng(seed);
    this.layers = [];
    for (let i = 0; i + 1 < sizes.length; i += 1) {
      const inDim = sizes[i];
      const outDim = sizes[i + 1];
      const scale = Math.sqrt(1 / inDim);
      const w = new Float32Array(inDim * outDim);
      for (let k = 0; k < w.length; k += 1) w[k] = rng.normal() * scale;
      this.layers.push({ inDim, outDim, w, b: new Float32Array(outDim) });
    }
  }

  get paramCount() { return this.layers.reduce((a, l) => a + l.w.length + l.b.length, 0); }

  /** forward, returning all activations and pre-activations (for training) */
  forwardCache(x) {
    const acts = [x];
    const pres = [];
    let cur = x;
    for (const l of this.layers) {
      const pre = new Float32Array(l.outDim);
      const out = new Float32Array(l.outDim);
      for (let o = 0; o < l.outDim; o += 1) {
        let acc = l.b[o];
        const row = o * l.inDim;
        for (let i = 0; i < l.inDim; i += 1) acc += l.w[row + i] * cur[i];
        pre[o] = acc;
        out[o] = activate(this.act, acc);
      }
      pres.push(pre);
      acts.push(out);
      cur = out;
    }
    return { acts, pres };
  }

  forward(x) {
    const { acts } = this.forwardCache(Float32Array.from(x));
    return acts[acts.length - 1];
  }

  /** accumulate MSE gradients for one sample */
  accumulate(x, y, grads) {
    const { acts, pres } = this.forwardCache(x);
    const n = this.layers.length;
    const outDim = this.layers[n - 1].outDim;
    let delta = new Float32Array(outDim);
    let loss = 0;
    for (let i = 0; i < outDim; i += 1) {
      const e = acts[n][i] - y[i];
      loss += e * e;
      delta[i] = (2 * e) / outDim;
    }
    loss /= outDim;
    const offsets = [0];
    for (const l of this.layers) offsets.push(offsets[offsets.length - 1] + l.w.length + l.b.length);
    for (let li = n - 1; li >= 0; li -= 1) {
      const l = this.layers[li];
      const input = acts[li];
      const off = offsets[li];
      // delta is dL/d(acts[li+1]); fold in the activation derivative once, so
      // dPre = dL/d(pre_li) is what drives this layer's weights *and* the
      // gradient handed to the previous layer.
      const dPre = new Float32Array(l.outDim);
      for (let o = 0; o < l.outDim; o += 1) {
        dPre[o] = delta[o] * activateDeriv(this.act, pres[li][o], acts[li + 1][o]);
      }
      for (let o = 0; o < l.outDim; o += 1) {
        const row = o * l.inDim;
        grads[off + l.w.length + o] += dPre[o];
        for (let i = 0; i < l.inDim; i += 1) grads[off + row + i] += dPre[o] * input[i];
      }
      if (li > 0) {
        const prev = new Float32Array(l.inDim);
        for (let i = 0; i < l.inDim; i += 1) {
          let acc = 0;
          for (let o = 0; o < l.outDim; o += 1) acc += l.w[o * l.inDim + i] * dPre[o];
          prev[i] = acc;
        }
        delta = prev;
      }
    }
    return loss;
  }

  /**
   * Train on a dataset {x: Float32Array(n*inDim), y: Float32Array(n*outDim)}.
   * Returns the loss history; `onEpoch` can update the UI / abort.
   */
  train(data, { epochs = 200, batch = 32, lr = 0.003, seed = 1, onEpoch = null } = {}) {
    const nParams = this.paramCount;
    const flat = this.params();
    const grads = new Float32Array(nParams);
    const adam = new Adam(nParams, lr);
    const rng = new Rng(seed);
    const history = [];
    const inDim = this.sizes[0];
    const outDim = this.sizes[this.sizes.length - 1];
    const x = new Float32Array(inDim);
    const y = new Float32Array(outDim);
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      let loss = 0;
      let steps = 0;
      let seen = 0;
      while (seen < data.n) {
        grads.fill(0);
        let batchLoss = 0;
        let used = 0;
        for (let b = 0; b < batch; b += 1) {
          const idx = rng.pick(data.n);
          x.set(data.x.subarray(idx * inDim, idx * inDim + inDim));
          y.set(data.y.subarray(idx * outDim, idx * outDim + outDim));
          batchLoss += this.accumulate(x, y, grads);
          used += 1;
          seen += 1;
        }
        const inv = 1 / Math.max(used, 1);
        for (let i = 0; i < grads.length; i += 1) grads[i] *= inv;
        adam.step(flat, grads);
        this.setParams(flat);
        loss += batchLoss * inv;
        steps += 1;
      }
      const mean = loss / Math.max(steps, 1);
      history.push(mean);
      if (onEpoch && onEpoch(epoch, mean, history) === false) break;
    }
    return history;
  }

  /** mean absolute error per output channel */
  evaluate(data) {
    const inDim = this.sizes[0];
    const outDim = this.sizes[this.sizes.length - 1];
    const mae = new Float32Array(outDim);
    let total = 0;
    for (let i = 0; i < data.n; i += 1) {
      const out = this.forward(data.x.subarray(i * inDim, i * inDim + inDim));
      for (let k = 0; k < outDim; k += 1) {
        const e = Math.abs(out[k] - data.y[i * outDim + k]);
        mae[k] += e;
        total += e;
      }
    }
    const inv = 1 / Math.max(data.n, 1);
    return { mae: Array.from(mae, (v) => v * inv), mean: total * inv };
  }

  predict(x) { return Array.from(this.forward(Float32Array.from(x))); }

  params() {
    const out = new Float32Array(this.paramCount);
    let o = 0;
    for (const l of this.layers) { out.set(l.w, o); o += l.w.length; out.set(l.b, o); o += l.b.length; }
    return out;
  }

  setParams(flat) {
    let o = 0;
    for (const l of this.layers) {
      l.w.set(flat.subarray(o, o + l.w.length)); o += l.w.length;
      l.b.set(flat.subarray(o, o + l.b.length)); o += l.b.length;
    }
  }

  toJSON() { return { arch: this.sizes, act: this.act, params: Array.from(this.params(), (v) => +v.toFixed(6)) }; }

  static fromJSON(json) {
    const net = new Mlp(json.arch, { act: json.act ?? ACT.TANH });
    net.setParams(Float32Array.from(json.params));
    return net;
  }
}

// ---------------------------------------------------------------------------
// Causal trajectory transformer (tensor-level, hand-written backprop)
// ---------------------------------------------------------------------------

export class Transformer {
  constructor(cfg, vocab, condIn, seed = 1) {
    this.cfg = {
      dModel: 32, nHeads: 2, nLayers: 2, dFf: 64, seqLen: 24, outDim: 9, ...cfg,
    };
    this.vocab = vocab;
    this.condIn = condIn;
    const rng = new Rng(seed);
    const { dModel: d, dFf } = this.cfg;
    const s = Math.sqrt(1 / d);
    const rand = (n, scale) => {
      const v = new Float32Array(n);
      for (let i = 0; i < n; i += 1) v[i] = rng.normal() * scale;
      return v;
    };
    this.embed = rand(vocab * d, 1);
    this.posEmbed = rand(this.cfg.seqLen * d, 0.02);
    this.condW = rand(d * condIn, s);
    this.condB = new Float32Array(d);
    this.headW = rand(this.cfg.outDim * d, s);
    this.headB = new Float32Array(this.cfg.outDim);
    this.blocks = [];
    for (let i = 0; i < this.cfg.nLayers; i += 1) {
      this.blocks.push({
        wq: rand(d * d, s), wk: rand(d * d, s), wv: rand(d * d, s), wo: rand(d * d, s),
        ln1g: new Float32Array(d).fill(1), ln1b: new Float32Array(d),
        w1: rand(dFf * d, s), b1: new Float32Array(dFf),
        w2: rand(d * dFf, s), b2: new Float32Array(d),
        ln2g: new Float32Array(d).fill(1), ln2b: new Float32Array(d),
      });
    }
  }

  get paramCount() {
    const d = this.cfg.dModel;
    let n = this.embed.length + this.posEmbed.length + this.condW.length + this.condB.length + this.headW.length + this.headB.length;
    for (const b of this.blocks) {
      n += b.wq.length + b.wk.length + b.wv.length + b.wo.length + b.ln1g.length + b.ln1b.length
        + b.w1.length + b.b1.length + b.w2.length + b.b2.length + b.ln2g.length + b.ln2b.length;
    }
    return n;
  }

  /**
   * Forward pass.
   * @returns {{out: Float32Array, attn: Float32Array[]}} out is (t × outDim) tanh-bounded;
   *          attn[k] is the (heads × t × t) causal attention matrix of layer k.
   */
  forward(tokens, cond, cache = null) {
    const { dModel: d, nHeads: h, dFf } = this.cfg;
    const t = Math.min(tokens.length, this.cfg.seqLen);
    const dh = d / h;
    // ---- embed + condition + position
    const x = new Float32Array(t * d);
    for (let i = 0; i < t; i += 1) {
      const tok = tokens[i] % this.vocab;
      for (let k = 0; k < d; k += 1) {
        let v = this.embed[tok * d + k] + this.posEmbed[i * d + k];
        let acc = this.condB[k];
        for (let c = 0; c < this.condIn; c += 1) acc += this.condW[k * this.condIn + c] * cond[c];
        v += acc;
        x[i * d + k] = v;
      }
    }
    const attnAll = [];
    const layers = [];
    let cur = x;
    // ---- blocks
    for (let li = 0; li < this.blocks.length; li += 1) {
      const blk = this.blocks[li];
      const xn1 = layerNorm(cur, t, d, blk.ln1g, blk.ln1b);
      const q = matmulT(t, d, d, xn1, blk.wq);
      const kk = matmulT(t, d, d, xn1, blk.wk);
      const vv = matmulT(t, d, d, xn1, blk.wv);
      const ctx = new Float32Array(t * d);
      const attn = new Float32Array(h * t * t);
      for (let head = 0; head < h; head += 1) {
        for (let i = 0; i < t; i += 1) {
          const scores = new Float32Array(i + 1);
          let maxS = -Infinity;
          for (let j = 0; j <= i; j += 1) {
            let sum = 0;
            for (let k2 = 0; k2 < dh; k2 += 1) sum += q[i * d + head * dh + k2] * kk[j * d + head * dh + k2];
            sum /= Math.sqrt(dh);
            scores[j] = sum;
            if (sum > maxS) maxS = sum;
          }
          let denom = 0;
          for (let j = 0; j <= i; j += 1) { scores[j] = Math.exp(scores[j] - maxS); denom += scores[j]; }
          for (let j = 0; j <= i; j += 1) {
            const w = denom > 0 ? scores[j] / denom : 0;
            attn[(head * t + i) * t + j] = w;
            for (let k2 = 0; k2 < dh; k2 += 1) ctx[i * d + head * dh + k2] += w * vv[j * d + head * dh + k2];
          }
        }
      }
      attnAll.push(attn);
      const proj = matmulT(t, d, d, ctx, blk.wo);
      const x2 = new Float32Array(t * d);
      for (let i = 0; i < t * d; i += 1) x2[i] = cur[i] + proj[i];
      const xn2 = layerNorm(x2, t, d, blk.ln2g, blk.ln2b);
      const hidden = new Float32Array(t * dFf);
      for (let i = 0; i < t; i += 1) {
        for (let o = 0; o < dFf; o += 1) {
          let acc = blk.b1[o];
          for (let j = 0; j < d; j += 1) acc += blk.w1[o * d + j] * xn2[i * d + j];
          hidden[i * dFf + o] = activate(ACT.GELU, acc);
        }
      }
      const proj2 = matmulT(t, dFf, d, hidden, blk.w2);
      for (let i = 0; i < t; i += 1) {
        for (let o = 0; o < d; o += 1) proj2[i * d + o] += blk.b2[o]; // MLP output bias
      }
      const x3 = new Float32Array(t * d);
      for (let i = 0; i < t * d; i += 1) x3[i] = x2[i] + proj2[i];
      layers.push({ xn1, q, kk, vv, ctx, attn, x2, xn2, hidden, x3 });
      cur = x3;
    }
    // ---- head
    const pre = matmulT(t, d, this.cfg.outDim, cur, this.headW);
    const out = new Float32Array(t * this.cfg.outDim);
    for (let i = 0; i < t; i += 1) {
      for (let o = 0; o < this.cfg.outDim; o += 1) out[i * this.cfg.outDim + o] = Math.tanh(pre[i * this.cfg.outDim + o] + this.headB[o]);
    }
    if (cache) {
      Object.assign(cache, { t, d, h, dh, x, layers, cur, pre, out, tokens, cond, xn1: null });
      cache.attnAll = attnAll;
    }
    return { out, attn: attnAll };
  }

  /**
   * One training step on a batch of (tokens, cond, target) demonstrations.
   * `targets` is (t × outDim) expert tendon deltas, values in [-1, 1].
   * Returns the mean squared error before the update.
   */
  trainStep(batch, grads, adam, { clip = 1.0 } = {}) {
    grads.fill(0);
    let loss = 0;
    let samples = 0;
    for (const sample of batch) {
      loss += this.backwardSample(sample.tokens, sample.cond, sample.targets, grads);
      samples += 1;
    }
    const inv = 1 / Math.max(samples, 1);
    let norm = 0;
    for (let i = 0; i < grads.length; i += 1) { grads[i] *= inv; norm += grads[i] * grads[i]; }
    norm = Math.sqrt(norm);
    if (clip > 0 && norm > clip) {
      const s = clip / norm;
      for (let i = 0; i < grads.length; i += 1) grads[i] *= s;
    }
    const params = this.params();
    adam.step(params, grads);
    this.setParams(params);
    return loss * inv;
  }

  backwardSample(tokens, cond, targets, grads) {
    const { dModel: d, nHeads: h, dFf } = this.cfg;
    const t = Math.min(tokens.length, this.cfg.seqLen);
    const dh = d / h;
    const cache = {};
    const { out } = this.forward(tokens, cond, cache);
    const { layers, x, cur: finalX } = cache;
    const outDim = this.cfg.outDim;

    // ---- head
    let loss = 0;
    const dPre = new Float32Array(t * outDim);
    for (let i = 0; i < t * outDim; i += 1) {
      const e = out[i] - targets[i];
      loss += e * e;
      const dp = (2 * e * (1 - out[i] * out[i])) / outDim;
      dPre[i] = dp / t;
    }
    const offs = this.layerOffsets();
    const dHeadW = new Float32Array(this.headW.length);
    const dHeadB = new Float32Array(outDim);
    let dCur = new Float32Array(t * d);
    for (let i = 0; i < t; i += 1) {
      for (let o = 0; o < outDim; o += 1) {
        const g = dPre[i * outDim + o];
        dHeadB[o] += g;
        for (let j = 0; j < d; j += 1) {
          dHeadW[o * d + j] += g * finalX[i * d + j];
          dCur[i * d + j] += g * this.headW[o * d + j];
        }
      }
    }
    accumulate(grads, offs.headW, dHeadW);
    accumulate(grads, offs.headB, dHeadB);
    // ---- blocks (reverse)
    for (let li = layers.length - 1; li >= 0; li -= 1) {
      const blk = this.blocks[li];
      const L = layers[li];
      const prev = li > 0 ? layers[li - 1].x3 : x;
      const gradsBlk = {
        wq: new Float32Array(blk.wq.length), wk: new Float32Array(blk.wk.length),
        wv: new Float32Array(blk.wv.length), wo: new Float32Array(blk.wo.length),
        ln1g: new Float32Array(d), ln1b: new Float32Array(d),
        w1: new Float32Array(blk.w1.length), b1: new Float32Array(dFf),
        w2: new Float32Array(blk.w2.length), b2: new Float32Array(d),
        ln2g: new Float32Array(d), ln2b: new Float32Array(d),
      };
      // MLP path
      const dHidden = new Float32Array(t * dFf);
      const dProj2 = new Float32Array(t * d);
      for (let i = 0; i < t; i += 1) {
        for (let o = 0; o < d; o += 1) dProj2[i * d + o] = dCur[i * d + o];
      }
      for (let i = 0; i < t; i += 1) {
        for (let oo = 0; oo < d; oo += 1) gradsBlk.b2[oo] += dProj2[i * d + oo];
        for (let h = 0; h < dFf; h += 1) {
          const hid = L.hidden[i * dFf + h];
          let acc = 0;
          for (let oo = 0; oo < d; oo += 1) {
            gradsBlk.w2[oo * dFf + h] += dProj2[i * d + oo] * hid;
            acc += blk.w2[oo * dFf + h] * dProj2[i * d + oo];
          }
          let pre = blk.b1[h];
          for (let j = 0; j < d; j += 1) pre += blk.w1[h * d + j] * L.xn2[i * d + j];
          dHidden[i * dFf + h] = acc * activateDeriv(ACT.GELU, pre, hid);
        }
      }
      const dXn2 = new Float32Array(t * d);
      for (let i = 0; i < t; i += 1) {
        for (let o = 0; o < dFf; o += 1) {
          gradsBlk.b1[o] += dHidden[i * dFf + o];
          for (let j = 0; j < d; j += 1) {
            gradsBlk.w1[o * d + j] += dHidden[i * dFf + o] * L.xn2[i * d + j];
            dXn2[i * d + j] += dHidden[i * dFf + o] * blk.w1[o * d + j];
          }
        }
      }
      // layer norm 2 (over x2) + residual
      const dX2 = new Float32Array(t * d);
      for (let i = 0; i < t * d; i += 1) dX2[i] += dCur[i];
      layerNormBackward(L.xn2, L.x2, dXn2, blk.ln2g, t, d, gradsBlk.ln2g, gradsBlk.ln2b, dX2);
      // attention path
      const dProj = new Float32Array(t * d);
      for (let i = 0; i < t * d; i += 1) dProj[i] = dX2[i];
      const dCtx = new Float32Array(t * d);
      for (let i = 0; i < t; i += 1) {
        for (let o = 0; o < d; o += 1) {
          for (let j = 0; j < d; j += 1) {
            gradsBlk.wo[o * d + j] += dProj[i * d + o] * L.ctx[i * d + j];
            dCtx[i * d + j] += dProj[i * d + o] * blk.wo[o * d + j];
          }
        }
      }
      const dQ = new Float32Array(t * d);
      const dK = new Float32Array(t * d);
      const dV = new Float32Array(t * d);
      for (let head = 0; head < h; head += 1) {
        for (let i = 0; i < t; i += 1) {
          const dScores = new Float32Array(i + 1);
          for (let j = 0; j <= i; j += 1) {
            const w = L.attn[(head * t + i) * t + j];
            let acc = 0;
            for (let k2 = 0; k2 < dh; k2 += 1) {
              dV[j * d + head * dh + k2] += w * dCtx[i * d + head * dh + k2];
              acc += dCtx[i * d + head * dh + k2] * L.vv[j * d + head * dh + k2];
            }
            dScores[j] = acc;
          }
          // softmax backward (causal row)
          let dot = 0;
          for (let j = 0; j <= i; j += 1) dot += dScores[j] * L.attn[(head * t + i) * t + j];
          for (let j = 0; j <= i; j += 1) {
            const w = L.attn[(head * t + i) * t + j];
            const ds = (dScores[j] - dot) * w / Math.sqrt(dh);
            for (let k2 = 0; k2 < dh; k2 += 1) {
              dQ[i * d + head * dh + k2] += ds * L.kk[j * d + head * dh + k2];
              dK[j * d + head * dh + k2] += ds * L.q[i * d + head * dh + k2];
            }
          }
        }
      }
      for (let i = 0; i < t; i += 1) {
        for (let o = 0; o < d; o += 1) {
          for (let j = 0; j < d; j += 1) {
            const xn = L.xn1[i * d + j];
            gradsBlk.wq[o * d + j] += dQ[i * d + o] * xn;
            gradsBlk.wk[o * d + j] += dK[i * d + o] * xn;
            gradsBlk.wv[o * d + j] += dV[i * d + o] * xn;
          }
        }
      }
      const dXn1 = new Float32Array(t * d);
      for (let i = 0; i < t; i += 1) {
        for (let j = 0; j < d; j += 1) {
          let acc = 0;
          for (let o = 0; o < d; o += 1) {
            acc += dQ[i * d + o] * blk.wq[o * d + j]
              + dK[i * d + o] * blk.wk[o * d + j]
              + dV[i * d + o] * blk.wv[o * d + j];
          }
          dXn1[i * d + j] = acc;
        }
      }
      const dPrev = new Float32Array(t * d);
      for (let i = 0; i < t * d; i += 1) dPrev[i] = dX2[i];
      layerNormBackward(L.xn1, prev, dXn1, blk.ln1g, t, d, gradsBlk.ln1g, gradsBlk.ln1b, dPrev);
      dCur = dPrev;
      // ---- scatter block grads into the flat gradient vector
      const bo = offs.blocks[li];
      accumulate(grads, bo.wq, gradsBlk.wq);
      accumulate(grads, bo.wk, gradsBlk.wk);
      accumulate(grads, bo.wv, gradsBlk.wv);
      accumulate(grads, bo.wo, gradsBlk.wo);
      accumulate(grads, bo.ln1g, gradsBlk.ln1g);
      accumulate(grads, bo.ln1b, gradsBlk.ln1b);
      accumulate(grads, bo.w1, gradsBlk.w1);
      accumulate(grads, bo.b1, gradsBlk.b1);
      accumulate(grads, bo.w2, gradsBlk.w2);
      accumulate(grads, bo.b2, gradsBlk.b2);
      accumulate(grads, bo.ln2g, gradsBlk.ln2g);
      accumulate(grads, bo.ln2b, gradsBlk.ln2b);
    }
    // ---- embeddings + conditioning
    const gEmbed = offs.embed;
    const gPos = offs.posEmbed;
    const gCondW = offs.condW;
    const gCondB = offs.condB;
    for (let i = 0; i < t; i += 1) {
      const tok = tokens[i] % this.vocab;
      for (let k = 0; k < d; k += 1) {
        const g = dCur[i * d + k];
        grads[gEmbed + tok * d + k] += g;
        grads[gPos + i * d + k] += g;
        grads[gCondB + k] += g;
        for (let c = 0; c < this.condIn; c += 1) grads[gCondW + k * this.condIn + c] += g * cond[c];
      }
    }
    return loss / (t * outDim);
  }

  /** flat parameter layout, used by Adam and by the gradient scatter */
  layerOffsets() {
    if (!this._offsets) {
      let o = 0;
      const take = (n) => { const at = o; o += n; return at; };
      const offs = {
        embed: take(this.embed.length),
        posEmbed: take(this.posEmbed.length),
        condW: take(this.condW.length),
        condB: take(this.condB.length),
        headW: take(this.headW.length),
        headB: take(this.headB.length),
        blocks: [],
      };
      for (const b of this.blocks) {
        offs.blocks.push({
          wq: take(b.wq.length), wk: take(b.wk.length), wv: take(b.wv.length), wo: take(b.wo.length),
          ln1g: take(b.ln1g.length), ln1b: take(b.ln1b.length),
          w1: take(b.w1.length), b1: take(b.b1.length), w2: take(b.w2.length), b2: take(b.b2.length),
          ln2g: take(b.ln2g.length), ln2b: take(b.ln2b.length),
        });
      }
      this._offsets = offs;
      this._paramCount = o;
    }
    return this._offsets;
  }

  params() {
    const out = new Float32Array(this.paramCount);
    let o = 0;
    const put = (arr) => { out.set(arr, o); o += arr.length; };
    put(this.embed); put(this.posEmbed); put(this.condW); put(this.condB); put(this.headW); put(this.headB);
    for (const b of this.blocks) {
      put(b.wq); put(b.wk); put(b.wv); put(b.wo); put(b.ln1g); put(b.ln1b);
      put(b.w1); put(b.b1); put(b.w2); put(b.b2); put(b.ln2g); put(b.ln2b);
    }
    return out;
  }

  setParams(flat) {
    let o = 0;
    const take = (arr) => { arr.set(flat.subarray(o, o + arr.length)); o += arr.length; };
    take(this.embed); take(this.posEmbed); take(this.condW); take(this.condB); take(this.headW); take(this.headB);
    for (const b of this.blocks) {
      take(b.wq); take(b.wk); take(b.wv); take(b.wo); take(b.ln1g); take(b.ln1b);
      take(b.w1); take(b.b1); take(b.w2); take(b.b2); take(b.ln2g); take(b.ln2b);
    }
  }

  /** convenience: run the policy for one plan, returning the (t × outDim) deltas */
  policy(tokens, cond) { return this.forward(tokens, cond).out; }

  toJSON() {
    return {
      cfg: this.cfg, vocab: this.vocab, condIn: this.condIn,
      params: Array.from(this.params(), (v) => +v.toFixed(6)),
    };
  }

  static fromJSON(json) {
    const t = new Transformer(json.cfg, json.vocab, json.condIn);
    t.setParams(Float32Array.from(json.params));
    return t;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function accumulate(dst, at, src) {
  for (let i = 0; i < src.length; i += 1) dst[at + i] += src[i];
}

function matmulT(rows, inner, out, a, w) {
  // a: (rows × inner) row-major, w: (out × inner) row-major → (rows × out)
  const r = new Float32Array(rows * out);
  for (let i = 0; i < rows; i += 1) {
    for (let o = 0; o < out; o += 1) {
      let acc = 0;
      const wo = o * inner;
      const ai = i * inner;
      for (let j = 0; j < inner; j += 1) acc += a[ai + j] * w[wo + j];
      r[i * out + o] = acc;
    }
  }
  return r;
}

function layerNorm(x, t, d, g, b) {
  const out = new Float32Array(t * d);
  for (let i = 0; i < t; i += 1) {
    let mean = 0;
    for (let k = 0; k < d; k += 1) mean += x[i * d + k];
    mean /= d;
    let varr = 0;
    for (let k = 0; k < d; k += 1) { const v = x[i * d + k] - mean; varr += v * v; }
    varr /= d;
    const inv = 1 / Math.sqrt(varr + 1e-5);
    for (let k = 0; k < d; k += 1) out[i * d + k] = (x[i * d + k] - mean) * inv * g[k] + b[k];
  }
  return out;
}

function layerNormBackward(normed, src, dNormed, g, t, d, dG, dB, dSrc) {
  for (let i = 0; i < t; i += 1) {
    let mean = 0;
    for (let k = 0; k < d; k += 1) mean += src[i * d + k];
    mean /= d;
    let varr = 0;
    for (let k = 0; k < d; k += 1) { const v = src[i * d + k] - mean; varr += v * v; }
    varr /= d;
    const inv = 1 / Math.sqrt(varr + 1e-5);
    let sumDy = 0;
    let sumDyX = 0;
    const base = i * d;
    for (let k = 0; k < d; k += 1) {
      const dy = dNormed[base + k] * g[k];
      dG[k] += dNormed[base + k] * normed[base + k];
      dB[k] += dNormed[base + k];
      const xhat = (src[base + k] - mean) * inv;
      sumDy += dy;
      sumDyX += dy * xhat;
    }
    for (let k = 0; k < d; k += 1) {
      const dy = dNormed[base + k] * g[k];
      const xhat = (src[base + k] - mean) * inv;
      dSrc[base + k] += inv * (dy - sumDy / d - (xhat * sumDyX) / d);
    }
  }
}
