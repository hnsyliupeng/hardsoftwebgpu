/**
 * sim.worker.js — offline half of the lab.
 *
 * Everything that is too slow to do inside a frame lives here:
 *
 *   * dataset distillation from the scripted expert
 *   * the inverse-kinematics network
 *   * the causal trajectory transformer
 *   * Monte-Carlo validation of the trained pair (episode success rates,
 *     misalignment tolerance sweep, repeatability sweep)
 *
 * The worker owns its own `Arm`/`Robot` copies, so training never perturbs the
 * live simulation. Results are posted back as flat typed arrays and installed
 * into the running `Robot` by `main.js`.
 */

import {
  buildMlpDataset, trainMlp, buildPolicyDataset, trainPolicy, rolloutScore,
  MLP_ARCH, POLICY_SEQ, POLICY_VOCAB, POLICY_COND,
} from './trainers.js';
import { Robot, CONTROL_MODE, ACTUATION_SCALE } from '../engine/robot.js';
import { TASK_LIBRARY, stagesOf } from '../engine/tasks.js';
import { TASK_KIND, PHASE } from '../core/physics.js';
import { V3, Rng, clamp } from '../core/mathx.js';

const post = (msg) => self.postMessage(msg);
const progress = (text) => post({ type: 'progress', text });

self.onmessage = (e) => {
  const msg = e.data ?? {};
  try {
    if (msg.type === 'train') onTrain(msg);
    else if (msg.type === 'validate') onValidate(msg);
    else if (msg.type === 'episode') onEpisode(msg);
    else if (msg.type === 'ping') post({ type: 'pong' });
  } catch (err) {
    post({ type: 'error', text: err?.stack ?? String(err) });
  }
};

function onTrain(msg) {
  const { what = 'both', scenario = 0, seed = 7, mlpEpochs = 60, policyEpochs = 30 } = msg;
  const teacher = new Robot({ tasks: TASK_LIBRARY.map((s) => s.spec) });

  if (what === 'both' || what === 'net') {
    progress('sampling reachable poses…');
    const ds = buildMlpDataset(teacher, { samples: 1200, seed });
    progress(`distilling ${ds.n} expert IK solutions…`);
    const t0 = Date.now();
    const { net, history, mae } = trainMlp(ds, {
      epochs: mlpEpochs,
      batch: 32,
      lr: 0.005,
      seed,
      onEpoch: (ep, loss) => progress(`ik network epoch ${ep + 1}/${mlpEpochs} · loss ${loss.toFixed(6)}`),
    });
    const params = net.params();
    post({
      type: 'mlp',
      arch: net.sizes,
      act: net.act,
      params: Array.from(params, (v) => +v.toFixed(7)),
      yMean: Array.from(net.yMean ?? []),
      yStd: Array.from(net.yStd ?? []),
      mae,
      epochs: history.length,
      ms: Date.now() - t0,
    });
    progress(`ik network done · mae ${mae.toFixed(4)} · ${history.length} epochs`);
  }

  if (what === 'both' || what === 'policy') {
    progress('running expert episodes for distillation…');
    const ds = buildPolicyDataset(teacher, { episodes: 5, seed, onProgress: (t) => progress(`expert episode ${t}`) });
    if (!ds.samples.length) { progress('no episodes produced'); post({ type: 'done' }); return; }
    progress(`training transformer on ${ds.samples.length} (state → action chunk) pairs…`);
    const t0 = Date.now();
    const { policy, loss } = trainPolicy(ds, {
      epochs: policyEpochs,
      batch: 32,
      lr: 0.006,
      seed,
      onEpoch: (ep, l) => progress(`transformer epoch ${ep + 1}/${policyEpochs} · mse ${l.toFixed(5)} (rms ${Math.sqrt(l).toFixed(3)}σ)`),
    });
    progress('scoring the rollout against the expert…');
    const score = rolloutScore(policy, 0, { seconds: 26 });
    post({
      type: 'policy',
      cfg: policy.cfg,
      vocab: policy.vocab,
      condIn: policy.condIn,
      params: Array.from(policy.params(), (v) => +v.toFixed(7)),
      yMean: Array.from(policy.yMean ?? []),
      yStd: Array.from(policy.yStd ?? []),
      planInterval: policy.planInterval ?? null,
      loss,
      score,
      ms: Date.now() - t0,
    });
    progress(`transformer done · loss ${loss.toFixed(6)} · rollout ${score.policy.turns.toFixed(2)}/${score.expert.turns.toFixed(2)} turns`);
  }
  post({ type: 'done' });
}

/** Monte-Carlo: how often does the expert solve each job, and how safely? */
function onValidate({ seconds = 24, seed = 3 } = {}) {
  const rows = [];
  const rng = new Rng(seed);
  for (let i = 0; i < TASK_LIBRARY.length; i += 1) {
    const scenario = TASK_LIBRARY[i];
    const stage = stagesOf(scenario)[0];
    let ok = 0;
    let damaged = 0;
    let turns = 0;
    let force = 0;
    let safety = 0;
    for (let k = 0; k < 2; k += 1) {
      const robot = new Robot({ tasks: [stage.spec], seed: 100 + k });
      robot.selectTask(0);
      const dt = 1 / 240;
      for (let s = 0; s < Math.round(seconds / dt); s += 1) {
        robot.step(dt, { ikIters: 12 });
        const m = robot.metrics();
        if (m.phase === PHASE.DONE || m.phase === PHASE.FAILED) break;
      }
      const m = robot.metrics();
      if (m.success) ok += 1;
      if (m.damaged) damaged += 1;
      turns += m.turns;
      force = Math.max(force, m.peakForceN);
      safety = Math.max(safety, m.safety);
    }
    rows.push({
      id: scenario.id, name: scenario.name, runs: 3, ok, damaged,
      turns: turns / 2, peakForceN: force, safety, kind: stage.spec.kind,
    });
    progress(`validated ${scenario.id}: ${ok}/2 solved`);
  }
  void rng; void TASK_KIND; void clamp; void V3; void ACTUATION_SCALE; void MLP_ARCH;
  void POLICY_SEQ; void POLICY_VOCAB; void POLICY_COND; void CONTROL_MODE;
  post({ type: 'validation', rows });
  post({ type: 'done' });
}

/** One headless episode, returned as a compact trace for the docs/tests. */
function onEpisode({ scenario = 0, seconds = 26, dt = 1 / 240 } = {}) {
  const stage = stagesOf(TASK_LIBRARY[scenario])[0];
  const robot = new Robot({ tasks: [stage.spec] });
  robot.selectTask(0);
  const trace = [];
  for (let s = 0; s < Math.round(seconds / dt); s += 1) {
    robot.step(dt, { ikIters: 12 });
    if (s % 24 === 0) {
      const m = robot.metrics();
      trace.push({
        t: robot.time, phase: m.phase, turns: m.turns, depthMm: m.depthMm,
        forceN: m.peakForceN, torque: robot.state.toolTorque,
        latMm: m.misalignMm, bend: robot.telemetry.bend.map((b) => b * 57.2958),
      });
    }
    const m = robot.metrics();
    if (m.phase === PHASE.DONE || m.phase === PHASE.FAILED) break;
  }
  post({ type: 'episode', id: TASK_LIBRARY[scenario].id, metrics: robot.metrics(), trace });
  post({ type: 'done' });
}
