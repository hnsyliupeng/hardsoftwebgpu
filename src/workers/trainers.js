/**
 * trainers.js — dataset distillation and training, shared by the Web Worker and
 * the main-thread fallback.
 *
 * Two learners, matching the paper's controller stack:
 *
 *   `buildMlpDataset` / `trainMlp`
 *      the learned *inverse kinematics* map: measured tool pose (+payload) →
 *      the nine tendon lengths that put the tip there. Labels come from the
 *      arm's own damped-least-squares solver, which is the teacher.
 *
 *   `buildPolicyDataset` / `trainPolicy`
 *      the causal *chunk transformer*: plan tokens (job + phase of the job at
 *      each upcoming waypoint), the measured state and the object parameters →
 *      the next `POL_CHUNK` tendon commands. Labels come from the scripted
 *      expert. The rollout executes only the first row and re-plans every
 *      control step, which is what makes it self-correcting.
 *
 * Both datasets are built from the same `Arm` the browser runs, so what the
 * worker learns and what the app executes cannot drift apart.
 */

import { Arm, defaultConfig, homeState, N_CABLES, N_SEGMENTS } from '../core/arm.js';
import { Mlp, Transformer, Adam, ACT } from '../core/nn.js';
import { Transformer as TransformerAlias } from '../core/nn.js';
import { V3, Quat, Transform, Rng, clamp, rad, deg } from '../core/mathx.js';
import {
  ACTUATION_SCALE, Robot, CONTROL_MODE, taskPhaseSchedule,
  POL_CHUNK, POL_COND_DIM, POL_PLAN_WAYPOINTS, phaseTokensFor,
} from '../engine/robot.js';
import { TASK_LIBRARY, stagesOf } from '../engine/tasks.js';
import { PHASE } from '../core/physics.js';

export const MLP_IN = 19;   // pose (7) + current joint state (3 segments × 4)
export const MLP_OUT = 9;
export const MLP_ARCH = [MLP_IN, 48, 48, MLP_OUT];

/** Conditioning vector length — must match `Robot.policyCond()`. */
export const POLICY_COND = POL_COND_DIM;
/** Token vocabulary — must match `Robot.policyTokenFor()`. */
export const POLICY_VOCAB = 1 + 4 * (PHASE.DONE + 1);
export const POLICY_SEQ = POL_CHUNK;   // waypoints per forward pass

/**
 * Random reachable tip poses → tendon lengths.
 *
 * The teacher is the arm's own forward kinematics: sample a joint configuration
 * in the *interior* of the joint space (smooth arcs, no joint at its stop), then
 * record where the tip ends up and which tendon lengths produced that shape.
 * That is the exact inverse map — no solver iteration, no branch ambiguity — and
 * it is the same distribution the app's IK solves in (warm-started, smooth).
 */
export function buildMlpDataset(robot, { samples = 900, seed = 7 } = {}) {
  const arm = robot.arm;
  const rng = new Rng(seed);
  const x = new Float32Array(samples * MLP_IN);
  const y = new Float32Array(samples * MLP_OUT);
  let n = 0;
  let tried = 0;
  while (n < samples && tried < samples * 40) {
    tried += 1;
    // Sample the *operation manifold*, not the whole joint space.
    //
    // The inverse map (tip pose → tendon lengths) is many-to-one: bending modes
    // that leave the tip where it is form a null space, so labels drawn from the
    // full space disagree and no function can fit them. The arm does not operate
    // that way — it bends as a smooth arc, with the total bend distributed over
    // the three joints in a fixed pattern and the squash following the bend. That
    // restriction is what makes the map learnable, and it is also the region the
    // scripted expert actually drives through (docs/design.md).
    const basePlane = rng.nextF32() * 2 * Math.PI - Math.PI;
    const totalBend = deg(20 + 100 * rng.nextF32());
    const squash = (0.15 + 0.5 * rng.nextF32()) * (totalBend / deg(120));
    const seg = [0, 1, 2].map((_, i) => ({
      bend: totalBend * [0.45, 0.35, 0.20][i] * (0.9 + 0.2 * rng.nextF32()),
      plane: basePlane + (rng.nextF32() - 0.5) * 0.3,
      compress: squash * (arm.maxCompression / 3),
      hysteresis: 0,
    }));
    const sum = seg.reduce((a, s) => a + s.bend, 0);
    if (sum < deg(20) || sum > deg(125)) continue;
    const t = arm.fk(seg, 0, 0);
    if (t.p.y < 0.35 || t.p.y > 0.74) continue;
    if (Math.hypot(t.p.x, t.p.z) < 0.05) continue;
    const axis = Transform.up(t);
    const cables = arm.cableTargets(seg);
    // a nearby *seed* configuration: the network sees the state it is asked to
    // move from, exactly as `Robot.netInput` builds it at run time
    const seedSeg = seg.map((sg) => ({
      bend: clamp(sg.bend + (rng.nextF32() - 0.5) * 0.35, 0, arm.maxBendPerSegment),
      plane: sg.plane + (rng.nextF32() - 0.5) * 0.4,
      compress: clamp(sg.compress + (rng.nextF32() - 0.5) * 0.008, 0, arm.maxCompression / 3),
      hysteresis: 0,
    }));
    const base = V3.new(0, 0.35, 0);
    const row = [
      (t.p.x - base.x) * 3, (t.p.y - base.y) * 3, (t.p.z - base.z) * 3,
      axis.x, axis.y, axis.z, clamp(arm.cfg.payloadKg, 0, 1),
    ];
    for (let sIdx = 0; sIdx < 3; sIdx += 1) {
      row.push(seedSeg[sIdx].bend * 2, Math.sin(seedSeg[sIdx].plane), Math.cos(seedSeg[sIdx].plane), seedSeg[sIdx].compress * 10);
    }
    x.set(row, n * MLP_IN);
    for (let c = 0; c < MLP_OUT; c += 1) y[n * MLP_OUT + c] = clamp(cables[c] / ACTUATION_SCALE, -1, 1);
    n += 1;
  }
  return { x, y, n, inDim: MLP_IN, outDim: MLP_OUT };
}

/**
 * Train the inverse-kinematics network.
 *
 * The labels (tendon lengths) sit around a large common offset — every cable is
 * pulled a little towards the bending side — and a tanh head represents a small
 * constant very slowly. So the trainer standardises the labels per channel and
 * hands the mean/σ back to the caller: with them the run-time prediction is
 * `y = out·σ + μ`. This single change is worth a 5× lower error.
 */
export function trainMlp(ds, { epochs = 40, batch = 32, lr = 0.004, seed = 3, onEpoch = null } = {}) {
  const { n, outDim } = ds;
  const mean = new Float32Array(outDim);
  const std = new Float32Array(outDim);
  for (let i = 0; i < n; i += 1) for (let k = 0; k < outDim; k += 1) mean[k] += ds.y[i * outDim + k] / n;
  for (let i = 0; i < n; i += 1) for (let k = 0; k < outDim; k += 1) std[k] += ((ds.y[i * outDim + k] - mean[k]) ** 2) / n;
  for (let k = 0; k < outDim; k += 1) std[k] = Math.max(Math.sqrt(std[k]), 1e-6);
  const normalised = { x: ds.x, n, inDim: ds.inDim, outDim, y: new Float32Array(n * outDim) };
  for (let i = 0; i < n * outDim; i += 1) {
    const k = i % outDim;
    normalised.y[i] = (ds.y[i] - mean[k]) / std[k];
  }
  const net = new Mlp(MLP_ARCH, { act: ACT.TANH, seed });
  const history = net.train(normalised, { epochs, batch, lr, seed: seed + 1, onEpoch });
  net.yMean = mean;
  net.yStd = std;
  const raw = net.evaluate(normalised);
  // `evaluate` returns per-channel MAE (Float32Array) — report the mean
  let mae = 0;
  if (typeof raw === 'number') mae = raw;
  else if (raw && typeof raw.mean === 'number') mae = raw.mean;
  else if (raw && typeof raw.length === 'number' && raw.length) {
    let acc = 0;
    for (let i = 0; i < raw.length; i += 1) acc += raw[i];
    mae = acc / raw.length;
  }
  // report the error in *tendon metres*, after de-standardising, so the number in
  // the HUD is the one that matters
  let absErr = 0;
  let cnt = 0;
  for (let i = 0; i < n; i += 1) {
    const out = net.forward(ds.x.subarray(i * ds.inDim, i * ds.inDim + ds.inDim));
    for (let k = 0; k < outDim; k += 1) {
      absErr += Math.abs(out[k] * std[k] + mean[k] - ds.y[i * outDim + k]);
      cnt += 1;
    }
  }
  const rawMae = absErr / Math.max(cnt, 1);
  return { net, history, mae: rawMae, mean, std, normalisedMae: mae };
}

/**
 * Run the scripted expert through a scenario and record the tendon-length
 * trajectory, bucketed into `POLICY_SEQ` tokens — one distillation episode.
 */
/**
 * One scripted demonstration, distilled into (state → action chunk) pairs.
 *
 * The transformer is a *receding-horizon* policy, not a trajectory generator:
 * at every waypoint it is asked "given what you can measure right now, what
 * tendon command should be applied now, and what do the next few waypoints
 * look like?" Only the first row is executed. That keeps the regression local
 * and lets the rollout correct itself — measured on this plant, learning the
 * whole 26 s trajectory open-loop from a static context plateaus at 0.33σ
 * (≈1.5 mm of tendon error) and never seats the bolt, whereas the local map
 * fits to a fraction of a millimetre.
 */
export function expertEpisode(scenario, {
  seed = 7, dt = 1 / 240, seconds = 34, ikIters = 24, noise = 1, horizon = seconds,
  samplePeriod = 0.1,
} = {}) {
  const robot = new Robot({ tasks: [scenario.spec], seed });
  // Distil the *nominal* demonstration: sensor noise is a per-run perturbation
  // that is not in the conditioning vector, so leaving it on would make the
  // demonstration irreproducible.
  if (noise !== 1) {
    robot.arm.cfg.sensorNoise *= noise;
    robot.arm.cfg.hysteresis *= noise;
  }
  robot.selectTask(0);
  robot.setMode(CONTROL_MODE.EXPERT);
  const interval = Math.round(horizon / dt) / POL_PLAN_WAYPOINTS / dt * dt;
  const waypoint = Math.round(horizon / dt) / POL_PLAN_WAYPOINTS;   // steps per waypoint
  const commands = Array.from({ length: N_CABLES }, () => []);
  const conds = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    // exactly the settings the app runs (docs/design.md): the distillation has to
    // see the same controller the rollout will be compared against
    robot.step(dt, { ikIters, cableSlew: 0.025, record: false });
    for (let c = 0; c < N_CABLES; c += 1) commands[c].push(robot.state.cableCmd[c]);
    const k = clamp(Math.floor(i / waypoint), 0, POL_PLAN_WAYPOINTS - 1);
    conds.push(Float32Array.from(robot.policyCond(robot.state, k / (POL_PLAN_WAYPOINTS - 1))));
    const m = robot.metrics();
    if ((m.phase === PHASE.DONE || m.phase === PHASE.FAILED) && robot.taskState.phaseTime > 0.5) break;
  }
  // Bucket the command trajectory over the *fixed plan grid* — a 13 s peg run and
  // a 26 s bolt run must share one time base, otherwise whichever interval the
  // dataset averages to will stretch one of them.
  const per = Math.max(1, Math.round(waypoint));
  const rows = new Float32Array(POL_PLAN_WAYPOINTS * N_CABLES);
  for (let w = 0; w < POL_PLAN_WAYPOINTS; w += 1) {
    const lo = w * per;
    const hi = Math.min(commands[0].length, lo + per);
    for (let c = 0; c < N_CABLES; c += 1) {
      let acc = 0;
      let cnt = 0;
      for (let i = lo; i < hi; i += 1) { acc += commands[c][i]; cnt += 1; }
      // past the end of the episode the plan simply holds its last command
      const v = cnt ? acc / cnt : (w > 0 ? rows[(w - 1) * N_CABLES + c] : 0);
      rows[w * N_CABLES + c] = clamp(v / ACTUATION_SCALE, -1, 1);
    }
  }
  return {
    rows, conds, dt, interval: per * dt, steps: commands[0].length,
    kind: scenario.spec.kind,
    metrics: robot.metrics(),
    // kept for the probes that replay a whole demonstration
    targets: rows,
    tokens: phaseTokensFor(scenario.spec.kind, 0, POL_CHUNK),
    cond: conds[0],
  };
}

/**
 * (state, future waypoints) → action chunk, sampled along each demonstration.
 * One sample per `samplePeriod` of simulated time, so a 26 s episode yields
 * ~260 samples instead of a single whole-trajectory row.
 */
export function buildPolicyDataset(robot, {
  episodes = 5, seed = 11, samplePeriod = 0.1, onProgress = null,
} = {}) {
  const samples = [];
  const intervals = [];
  let tried = 0;
  for (let round = 0; round < episodes && tried < episodes * 4; round += 1) {
    const scenario = TASK_LIBRARY[round % TASK_LIBRARY.length];
    const stage = stagesOf(scenario)[0];
    tried += 1;
    const ep = expertEpisode({ ...stage, spec: stage.spec }, {
      seed: seed + round * 7, noise: 0, samplePeriod,
    });
    const ok = ep.metrics.success;
    if (onProgress) onProgress(`${scenario.id}: ${ok ? 'solved' : ep.metrics.phaseName}`);
    if (!ok) continue;
    intervals.push(ep.interval);
    const stride = Math.max(1, Math.round(samplePeriod / ep.dt));
    for (let i = 0; i < ep.steps; i += stride) {
      const k = clamp(Math.floor((i * ep.dt) / ep.interval), 0, POL_PLAN_WAYPOINTS - 1);
      const targets = new Float32Array(POL_CHUNK * N_CABLES);
      for (let j = 0; j < POL_CHUNK; j += 1) {
        const w = Math.min(POL_PLAN_WAYPOINTS - 1, k + j);
        for (let c = 0; c < N_CABLES; c += 1) targets[j * N_CABLES + c] = ep.rows[w * N_CABLES + c];
      }
      samples.push({
        tokens: phaseTokensFor(ep.kind, k, POL_CHUNK),
        cond: ep.conds[i],
        targets,
      });
    }
  }
  const interval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
  return { samples, samplesCount: samples.length, interval };
}

/**
 * Fit the chunk policy. Labels are standardised per tendon channel (a tanh head
 * represents a large common offset only very slowly); the mean/σ travel with the
 * policy and are undone at prediction time.
 */
export function trainPolicy(ds, { epochs = 40, batch = 32, lr = 0.006, seed = 5, onEpoch = null } = {}) {
  const { samples } = ds;
  const outDim = POL_CHUNK * N_CABLES;
  const mean = new Float32Array(N_CABLES);
  const std = new Float32Array(N_CABLES);
  let count = 0;
  for (const sample of samples) {
    for (let i = 0; i < outDim; i += 1) { mean[i % N_CABLES] += sample.targets[i]; count += 1; }
  }
  for (let c = 0; c < N_CABLES; c += 1) mean[c] /= Math.max(count / N_CABLES, 1);
  for (const sample of samples) {
    for (let i = 0; i < outDim; i += 1) {
      const d = sample.targets[i] - mean[i % N_CABLES];
      std[i % N_CABLES] += (d * d) / Math.max(count / N_CABLES, 1);
    }
  }
  for (let c = 0; c < N_CABLES; c += 1) std[c] = Math.max(Math.sqrt(std[c]), 1e-6);
  const normSamples = samples.map((sm) => {
    const targets = new Float32Array(sm.targets.length);
    for (let i = 0; i < targets.length; i += 1) {
      targets[i] = (sm.targets[i] - mean[i % N_CABLES]) / std[i % N_CABLES];
    }
    return { tokens: sm.tokens, cond: sm.cond, targets };
  });
  const policy = new Transformer({
    dModel: 32, nHeads: 2, nLayers: 2, dFf: 64, seqLen: POL_CHUNK, outDim: N_CABLES,
  }, POLICY_VOCAB, POLICY_COND, seed);
  const params = policy.params();
  const grads = new Float32Array(params.length);
  const adam = new Adam(params.length, lr);
  const rng = new Rng(seed + 1);
  let last = 0;
  for (let ep = 0; ep < epochs; ep += 1) {
    let loss = 0;
    let batches = 0;
    let seen = 0;
    while (seen < normSamples.length) {
      const group = [];
      for (let b = 0; b < batch && seen < normSamples.length; b += 1) {
        group.push(normSamples[rng.pick(normSamples.length)]);
        seen += 1;
      }
      loss += policy.trainStep(group, grads, adam, { clip: 1.0 });
      batches += 1;
    }
    last = loss / Math.max(batches, 1);
    if (onEpoch && onEpoch(ep, last) === false) break;
  }
  policy.yMean = mean;
  policy.yStd = std;
  if (ds.interval) policy.planInterval = ds.interval;
  return { policy, loss: last, mean, std, mse: last, rms: Math.sqrt(last) };
}

/**
 * Three-arm rollout, so the transformer's contribution is *measured* rather than
 * asserted:
 *   `pure`   the transformer plan alone, open loop (no solver in the loop)
 *   `hybrid` the transformer plan plus the classical tracking residual — the
 *            configuration the app runs in "learned" mode
 *   `expert` the scripted expert (the teacher)
 */
export function rolloutScore(policy, scenarioIndex = 0, { seconds = 32, dt = 1 / 240, residualWeight = 0.75 } = {}) {
  const scenario = TASK_LIBRARY[scenarioIndex % TASK_LIBRARY.length] ?? TASK_LIBRARY[0];
  const stage = stagesOf(scenario)[0];
  const run = (usePolicy, residual, weight = residualWeight) => {
    const robot = new Robot({ tasks: [stage.spec] });
    robot.selectTask(0);
    if (usePolicy) {
      robot.policy = policy;
      robot.setMode(CONTROL_MODE.LEARNED);
    }
    for (let i = 0; i < Math.round(seconds / dt); i += 1) {
      robot.step(dt, usePolicy ? { ikIters: 24, residual, residualWeight: weight } : { ikIters: 24 });
      const m = robot.metrics();
      if (m.phase === PHASE.DONE || m.phase === PHASE.FAILED) break;
    }
    const m = robot.metrics();
    return { id: scenario.id, phase: m.phaseName, success: m.success, turns: m.turns, depthMm: m.depthMm, time: robot.time };
  };
  const pure = run(true, false);
  const hybrid = run(true, true, residualWeight);
  const expert = run(false, false);
  return { policy: pure, pure, hybrid, expert };
}
