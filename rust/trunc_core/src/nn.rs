//! Learned models.
//!
//! The paper trains a neural network to learn the arm's inverse kinematics so the arm
//! can be *programmed* (bulb, bolt, valve tasks) instead of teleoperated. This module
//! implements the two models the lab uses:
//!
//! * [`Mlp`] — dense inverse-kinematics net. Trained here with Adam + MSE; the
//!   browser mirror trains the identical architecture live (see `src/core/ik.js`).
//! * [`Transformer`] — a small **causal trajectory transformer**: it consumes a token
//!   sequence describing the task (goal waypoints + task id + object parameters) and
//!   emits per-step tendon-length deltas, i.e. an active policy over the plan.
//!
//! Both are dependency free and parameter-compatible with the JavaScript mirror, so
//! weights can move either way as flat `f32` buffers.

use crate::mathx::Rng;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act { Tanh, Relu, Gelu }

impl Act {
    pub fn apply(self, x: f32) -> f32 {
        match self {
            Act::Tanh => x.tanh(),
            Act::Relu => x.max(0.0),
            Act::Gelu => 0.5 * x * (1.0 + (0.797_884_6 * (x + 0.044_715 * x * x * x)).tanh()),
        }
    }
    pub fn deriv(self, x: f32, y: f32) -> f32 {
        match self {
            Act::Tanh => 1.0 - y * y,
            Act::Relu => if x > 0.0 { 1.0 } else { 0.0 },
            Act::Gelu => {
                let u = 0.797_884_6 * (x + 0.044_715 * x * x * x);
                let t = u.tanh();
                0.5 * (1.0 + t) + 0.5 * x * (1.0 - t * t) * 0.797_884_6 * (1.0 + 3.0 * 0.044_715 * x * x)
            }
        }
    }
}

/// One dense layer; weights are row-major `[out][in]`.
#[derive(Clone, Debug)]
pub struct Layer { pub in_dim: usize, pub out_dim: usize, pub w: Vec<f32>, pub b: Vec<f32> }

impl Layer {
    pub fn new(in_dim: usize, out_dim: usize, rng: &mut Rng) -> Self {
        let scale = (1.0 / in_dim as f32).sqrt();
        let mut w = vec![0.0f32; in_dim * out_dim];
        for v in w.iter_mut() { *v = rng.normal() * scale; }
        Layer { in_dim, out_dim, w, b: vec![0.0; out_dim] }
    }
    pub fn params(&self) -> usize { self.w.len() + self.b.len() }
}

#[derive(Clone, Debug)]
pub struct Mlp { pub layers: Vec<Layer>, pub act: Act }

impl Mlp {
    /// `sizes = [in, hidden…, out]`.
    pub fn new(sizes: &[usize], act: Act, seed: u64) -> Self {
        let mut rng = Rng::new(seed);
        let mut layers = Vec::new();
        for w in sizes.windows(2) {
            layers.push(Layer::new(w[0], w[1], &mut rng));
        }
        Mlp { layers, act }
    }

    pub fn param_count(&self) -> usize { self.layers.iter().map(|l| l.params()).sum() }

    /// Forward pass, returning every activation (needed for backprop).
    pub fn forward_activations(&self, x: &[f32]) -> Vec<Vec<f32>> {
        let (acts, _pres) = self.forward_cache(x);
        acts
    }

    /// Forward pass returning both activations and pre-activations.
    pub fn forward_cache(&self, x: &[f32]) -> (Vec<Vec<f32>>, Vec<Vec<f32>>) {
        let mut acts = vec![x.to_vec()];
        let mut pres = Vec::with_capacity(self.layers.len());
        let mut cur = x.to_vec();
        for l in self.layers.iter() {
            let mut pre = vec![0.0f32; l.out_dim];
            let mut out = vec![0.0f32; l.out_dim];
            for o in 0..l.out_dim {
                let mut acc = l.b[o];
                let row = &l.w[o * l.in_dim..(o + 1) * l.in_dim];
                for i in 0..l.in_dim { acc += row[i] * cur[i]; }
                pre[o] = acc;
                out[o] = self.act.apply(acc);
            }
            pres.push(pre);
            acts.push(out.clone());
            cur = out;
        }
        (acts, pres)
    }

    pub fn forward(&self, x: &[f32], out: &mut Vec<f32>) {
        let acts = self.forward_activations(x);
        out.clear();
        out.extend_from_slice(acts.last().map(|v| v.as_slice()).unwrap_or(&[]));
    }

    pub fn params_into(&self, out: &mut Vec<f32>) {
        for l in self.layers.iter() { out.extend_from_slice(&l.w); out.extend_from_slice(&l.b); }
    }

    pub fn set_params(&mut self, flat: &[f32]) -> bool {
        if flat.len() < self.param_count() { return false; }
        let mut off = 0usize;
        for l in self.layers.iter_mut() {
            let n = l.w.len();
            l.w.copy_from_slice(&flat[off..off + n]);
            off += n;
            let m = l.b.len();
            l.b.copy_from_slice(&flat[off..off + m]);
            off += m;
        }
        true
    }

    /// Flat parameter offsets per layer (length = layers + 1).
    pub fn layer_offsets(&self) -> Vec<usize> {
        let mut offs = Vec::with_capacity(self.layers.len() + 1);
        let mut acc = 0usize;
        offs.push(0);
        for l in self.layers.iter() {
            acc += l.w.len() + l.b.len();
            offs.push(acc);
        }
        offs
    }

    /// One MSE forward+backward pass for a single sample; accumulates into `grads`
    /// and returns the sample loss (mean squared error over the output vector).
    pub fn accumulate_grads(&self, x: &[f32], y: &[f32], grads: &mut [f32], loss: &mut f32) -> f32 {
        let (acts, pres) = self.forward_cache(x);
        let offs = self.layer_offsets();
        let n = self.layers.len();
        let out_dim = self.layers[n - 1].out_dim;
        let mut delta = vec![0.0f32; out_dim];
        let mut sample_loss = 0.0f32;
        for i in 0..out_dim {
            let e = acts[n][i] - y[i];
            sample_loss += e * e;
            delta[i] = 2.0 * e / out_dim as f32;
        }
        sample_loss /= out_dim as f32;
        *loss += sample_loss;
        for li in (0..n).rev() {
            let layer = &self.layers[li];
            let input = &acts[li];
            let base = offs[li];
            // `delta` is dL/d(acts[li + 1]); folding in the activation derivative
            // once gives dL/d(pre_li), which drives both this layer's parameters
            // and the gradient handed back to the previous layer.
            let mut d_pre = vec![0.0f32; layer.out_dim];
            for o in 0..layer.out_dim {
                d_pre[o] = delta[o] * self.act.deriv(pres[li][o], acts[li + 1][o]);
            }
            for o in 0..layer.out_dim {
                let row = o * layer.in_dim;
                for i in 0..layer.in_dim {
                    grads[base + row + i] += d_pre[o] * input[i];
                }
            }
            let bbase = base + layer.w.len();
            for o in 0..layer.out_dim { grads[bbase + o] += d_pre[o]; }
            if li > 0 {
                let mut prev = vec![0.0f32; layer.in_dim];
                for i in 0..layer.in_dim {
                    let mut acc = 0.0;
                    for o in 0..layer.out_dim {
                        acc += layer.w[o * layer.in_dim + i] * d_pre[o];
                    }
                    prev[i] = acc;
                }
                delta = prev;
            }
        }
        sample_loss
    }

}

/// Adam optimiser state.
#[derive(Clone, Debug)]
pub struct Adam { pub m: Vec<f32>, pub v: Vec<f32>, pub t: u32, pub lr: f32, pub b1: f32, pub b2: f32, pub eps: f32, pub wd: f32 }

impl Adam {
    pub fn new(n: usize, lr: f32) -> Self { Adam { m: vec![0.0; n], v: vec![0.0; n], t: 0, lr, b1: 0.9, b2: 0.999, eps: 1e-8, wd: 0.0 } }
    pub fn step(&mut self, params: &mut [f32], grads: &[f32]) {
        self.t += 1;
        let bc1 = 1.0 - self.b1.powi(self.t as i32);
        let bc2 = 1.0 - self.b2.powi(self.t as i32);
        for i in 0..params.len().min(grads.len()) {
            let g = grads[i] + self.wd * params[i];
            self.m[i] = self.b1 * self.m[i] + (1.0 - self.b1) * g;
            self.v[i] = self.b2 * self.v[i] + (1.0 - self.b2) * g * g;
            let mh = self.m[i] / bc1;
            let vh = self.v[i] / bc2;
            params[i] -= self.lr * mh / (vh.sqrt() + self.eps);
        }
    }
}

/// Supervised dataset: rows of `in_dim` inputs and `out_dim` targets.
#[derive(Clone, Debug, Default)]
pub struct Dataset { pub x: Vec<f32>, pub y: Vec<f32>, pub n: usize, pub in_dim: usize, pub out_dim: usize }

impl Dataset {
    pub fn new(in_dim: usize, out_dim: usize) -> Self { Dataset { x: Vec::new(), y: Vec::new(), n: 0, in_dim, out_dim } }
    pub fn push(&mut self, x: &[f32], y: &[f32]) {
        self.x.extend_from_slice(x);
        self.y.extend_from_slice(y);
        self.n += 1;
    }
    pub fn x_row(&self, i: usize) -> &[f32] { &self.x[i * self.in_dim..(i + 1) * self.in_dim] }
    pub fn y_row(&self, i: usize) -> &[f32] { &self.y[i * self.out_dim..(i + 1) * self.out_dim] }
    pub fn split(&self, test_frac: f32) -> (Dataset, Dataset) {
        let n_test = ((self.n as f32) * test_frac).round() as usize;
        let mut train = Dataset::new(self.in_dim, self.out_dim);
        let mut test = Dataset::new(self.in_dim, self.out_dim);
        for i in 0..self.n {
            if i % (1.0 / test_frac.max(1e-3)).round().max(1.0) as usize == 0 && test.n < n_test {
                test.push(self.x_row(i), self.y_row(i));
            } else {
                train.push(self.x_row(i), self.y_row(i));
            }
        }
        (train, test)
    }
}

#[derive(Clone, Debug, Default)]
pub struct TrainReport { pub epochs: u32, pub loss: Vec<f32>, pub test_loss: f32, pub samples: u32 }

/// Train an MLP with Adam on a dataset (deterministic given the seed).
pub fn train_mlp(net: &mut Mlp, data: &Dataset, epochs: u32, batch: usize, lr: f32, seed: u64, report_every: u32) -> TrainReport {
    let n_params = net.param_count();
    let mut adam = Adam::new(n_params, lr);
    let mut grad = vec![0.0f32; n_params];
    let mut params = Vec::with_capacity(n_params);
    let mut rng = Rng::new(seed);
    let mut report = TrainReport { epochs, loss: Vec::new(), test_loss: 0.0, samples: data.n as u32 };
    let batch = batch.max(1);
    for epoch in 0..epochs {
        let mut epoch_loss = 0.0f32;
        let mut steps = 0u32;
        let mut seen = 0usize;
        while seen < data.n {
            grad.iter_mut().for_each(|g| *g = 0.0);
            let mut loss = 0.0f32;
            let mut used = 0usize;
            for _ in 0..batch {
                let i = rng.pick(data.n);
                net.accumulate_grads(data.x_row(i), data.y_row(i), &mut grad, &mut loss);
                used += 1;
                seen += 1;
            }
            let inv = 1.0 / used.max(1) as f32;
            grad.iter_mut().for_each(|g| *g *= inv);
            params.clear();
            net.params_into(&mut params);
            adam.step(&mut params, &grad);
            net.set_params(&params);
            epoch_loss += loss * inv;
            steps += 1;
        }
        let mean = epoch_loss / steps.max(1) as f32;
        if report_every == 0 || epoch % report_every == 0 || epoch + 1 == epochs {
            report.loss.push(mean);
        }
    }
    report
}

/// Evaluation helper: mean absolute error per output dimension.
pub fn evaluate(net: &Mlp, data: &Dataset) -> (f32, Vec<f32>) {
    let mut out = Vec::new();
    let mut mae = vec![0.0f32; data.out_dim];
    let mut tot = 0.0f32;
    for i in 0..data.n {
        net.forward(data.x_row(i), &mut out);
        for k in 0..data.out_dim.min(out.len()) {
            let e = (out[k] - data.y_row(i)[k]).abs();
            mae[k] += e;
            tot += e;
        }
    }
    let inv = 1.0 / data.n.max(1) as f32;
    for m in mae.iter_mut() { *m *= inv; }
    (tot * inv, mae)
}

// ---------------------------------------------------------------------------
// Causal trajectory transformer
// ---------------------------------------------------------------------------

/// Configuration mirroring the JS/WebGPU trainer.
#[derive(Clone, Copy, Debug)]
pub struct TransformerConfig {
    pub d_model: usize,
    pub n_heads: usize,
    pub n_layers: usize,
    pub d_ff: usize,
    /// Sequence length (waypoints in the plan).
    pub seq_len: usize,
    /// Output width per step (nine tendon deltas).
    pub out_dim: usize,
}

impl Default for TransformerConfig {
    fn default() -> Self {
        TransformerConfig { d_model: 32, n_heads: 2, n_layers: 2, d_ff: 64, seq_len: 24, out_dim: 9 }
    }
}

#[derive(Clone, Debug)]
pub struct TransformerBlock {
    pub wq: Vec<f32>, pub wk: Vec<f32>, pub wv: Vec<f32>, pub wo: Vec<f32>,
    pub ln1_g: Vec<f32>, pub ln1_b: Vec<f32>,
    pub w1: Vec<f32>, pub b1: Vec<f32>, pub w2: Vec<f32>, pub b2: Vec<f32>,
    pub ln2_g: Vec<f32>, pub ln2_b: Vec<f32>,
}

#[derive(Clone, Debug)]
pub struct Transformer {
    pub cfg: TransformerConfig,
    /// Token embedding table (plan token id → vector).
    pub embed: Vec<f32>,
    pub vocab: usize,
    /// Task/condition encoder (goal + object parameters → d_model).
    pub cond_w: Vec<f32>,
    pub cond_b: Vec<f32>,
    pub cond_in: usize,
    pub pos_embed: Vec<f32>,
    pub blocks: Vec<TransformerBlock>,
    /// Output head: d_model → out_dim.
    pub head_w: Vec<f32>,
    pub head_b: Vec<f32>,
}

impl Transformer {
    pub fn new(cfg: TransformerConfig, vocab: usize, cond_in: usize, seed: u64) -> Self {
        let mut rng = Rng::new(seed);
        let d = cfg.d_model;
        let mut rnd = |n: usize, scale: f32| -> Vec<f32> {
            let mut v = vec![0.0f32; n];
            for x in v.iter_mut() { *x = rng.normal() * scale; }
            v
        };
        let s = (1.0 / d as f32).sqrt();
        let mut blocks = Vec::new();
        for _ in 0..cfg.n_layers {
            blocks.push(TransformerBlock {
                wq: rnd(d * d, s), wk: rnd(d * d, s), wv: rnd(d * d, s), wo: rnd(d * d, s),
                ln1_g: vec![1.0; d], ln1_b: vec![0.0; d],
                w1: rnd(d * cfg.d_ff, s), b1: vec![0.0; cfg.d_ff], w2: rnd(cfg.d_ff * d, s), b2: vec![0.0; d],
                ln2_g: vec![1.0; d], ln2_b: vec![0.0; d],
            });
        }
        Transformer {
            cfg,
            embed: rnd(vocab * d, 1.0),
            vocab,
            cond_w: rnd(d * cond_in, s),
            cond_b: vec![0.0; d],
            cond_in,
            pos_embed: rnd(cfg.seq_len * d, 0.02),
            blocks,
            head_w: rnd(cfg.out_dim * d, s),
            head_b: vec![0.0; cfg.out_dim],
        }
    }

    /// Forward pass over a plan. Returns per-step outputs (+ optional attention weights
    /// of layer 0, `n_heads × seq × seq`, for the UI heat-map).
    pub fn forward(&self, tokens: &[u32], cond: &[f32], out: &mut Vec<f32>, attention: Option<&mut Vec<f32>>) {
        let d = self.cfg.d_model;
        let t = tokens.len().min(self.cfg.seq_len);
        let h = self.cfg.n_heads.max(1);
        let dh = d / h;
        // embed tokens + condition + position
        let mut x = vec![0.0f32; t * d];
        for i in 0..t {
            let tok = (tokens[i] as usize) % self.vocab;
            for k in 0..d {
                let mut v = self.embed[tok * d + k] + self.pos_embed[i * d + k];
                let mut acc = self.cond_b[k];
                for c in 0..self.cond_in.min(cond.len()) {
                    acc += self.cond_w[k * self.cond_in + c] * cond[c];
                }
                v += acc;
                x[i * d + k] = v;
            }
        }
        let mut attn_out = attention;
        for block in self.blocks.iter() {
            // ---- layer norm 1
            let mut xn = vec![0.0f32; t * d];
            for i in 0..t {
                let base = i * d;
                let mut mean = 0.0;
                for k in 0..d { mean += x[base + k]; }
                mean /= d as f32;
                let mut var = 0.0;
                for k in 0..d { let v = x[base + k] - mean; var += v * v; }
                var /= d as f32;
                let inv = 1.0 / (var + 1e-5).sqrt();
                for k in 0..d { xn[base + k] = (x[base + k] - mean) * inv * block.ln1_g[k] + block.ln1_b[k]; }
            }
            // ---- QKV
            let mut q = vec![0.0f32; t * d];
            let mut kk = vec![0.0f32; t * d];
            let mut vv = vec![0.0f32; t * d];
            for i in 0..t {
                for o in 0..d {
                    let mut aq = 0.0; let mut ak = 0.0; let mut av = 0.0;
                    for j in 0..d {
                        let xv = xn[i * d + j];
                        aq += block.wq[o * d + j] * xv;
                        ak += block.wk[o * d + j] * xv;
                        av += block.wv[o * d + j] * xv;
                    }
                    q[i * d + o] = aq; kk[i * d + o] = ak; vv[i * d + o] = av;
                }
            }
            // ---- causal attention
            let mut ctx = vec![0.0f32; t * d];
            let mut weights = vec![0.0f32; h * t * t];
            for head in 0..h {
                for i in 0..t {
                    let mut scores = vec![0.0f32; i + 1];
                    let mut maxs = f32::MIN;
                    for j in 0..=i {
                        let mut s = 0.0;
                        for k2 in 0..dh { s += q[i * d + head * dh + k2] * kk[j * d + head * dh + k2]; }
                        s /= (dh as f32).sqrt();
                        scores[j] = s;
                        if s > maxs { maxs = s; }
                    }
                    let mut sum = 0.0;
                    for s in scores.iter_mut() { *s = (*s - maxs).exp(); sum += *s; }
                    for (j, s) in scores.iter().enumerate() {
                        let w = if sum > 0.0 { *s / sum } else { 0.0 };
                        weights[(head * t + i) * t + j] = w;
                        for k2 in 0..dh { ctx[i * d + head * dh + k2] += w * vv[j * d + head * dh + k2]; }
                    }
                }
            }
            if let Some(buf) = attn_out.as_deref_mut() {
                buf.clear();
                buf.extend_from_slice(&weights);
            }
            // ---- output projection + residual
            for i in 0..t {
                for o in 0..d {
                    let mut acc = 0.0;
                    for j in 0..d { acc += block.wo[o * d + j] * ctx[i * d + j]; }
                    x[i * d + o] += acc;
                }
            }
            // ---- layer norm 2 + MLP
            let mut xn2 = vec![0.0f32; t * d];
            for i in 0..t {
                let base = i * d;
                let mut mean = 0.0;
                for k in 0..d { mean += x[base + k]; }
                mean /= d as f32;
                let mut var = 0.0;
                for k in 0..d { let v = x[base + k] - mean; var += v * v; }
                var /= d as f32;
                let inv = 1.0 / (var + 1e-5).sqrt();
                for k in 0..d { xn2[base + k] = (x[base + k] - mean) * inv * block.ln2_g[k] + block.ln2_b[k]; }
            }
            for i in 0..t {
                let mut hidden = vec![0.0f32; self.cfg.d_ff];
                for o in 0..self.cfg.d_ff {
                    let mut acc = block.b1[o];
                    for j in 0..d { acc += block.w1[o * d + j] * xn2[i * d + j]; }
                    hidden[o] = Act::Gelu.apply(acc);
                }
                for o in 0..d {
                    let mut acc = block.b2[o];
                    for j in 0..self.cfg.d_ff { acc += block.w2[o * self.cfg.d_ff + j] * hidden[j]; }
                    x[i * d + o] += acc;
                }
            }
        }
        // ---- head
        out.clear();
        for i in 0..t {
            for o in 0..self.cfg.out_dim {
                let mut acc = self.head_b[o];
                for j in 0..d { acc += self.head_w[o * d + j] * x[i * d + j]; }
                out.push(Act::Tanh.apply(acc));
            }
        }
    }

    pub fn param_count(&self) -> usize {
        let mut n = self.embed.len() + self.pos_embed.len() + self.cond_w.len() + self.cond_b.len() + self.head_w.len() + self.head_b.len();
        for b in self.blocks.iter() {
            n += b.wq.len() + b.wk.len() + b.wv.len() + b.wo.len() + b.ln1_g.len() + b.ln1_b.len()
                + b.w1.len() + b.b1.len() + b.w2.len() + b.b2.len() + b.ln2_g.len() + b.ln2_b.len();
        }
        n
    }
}
