/**
 * robot.js — the closed-loop machine: TRUNC arm + task physics + controllers.
 *
 * Three control modes, mirroring how the paper's controller stack is layered:
 *
 *   `expert`   — scripted finite-state controller (approach → align → engage →
 *                fasten → verify) that drives the tool to the task frame; this is
 *                the policy every dataset is distilled from.
 *   `learned`  — the trained pose → tendon-delta network (Mlp) or the causal
 *                trajectory transformer. Runs open-loop with an optional
 *                residual IK term, exactly like a learned inverse-kinematics
 *                controller with a classical stabiliser.
 *   `manual`   — the GUI joystick / target gizmo writes the tool target directly.
 *
 * Gravity, tendon elasticity and contact reactions all flow back into the arm, so
 * the controller has to close the loop on the *measured* pose — the compliance is
 * a feature, not a disturbance to hide.
 */

import { Arm, defaultConfig, homeState, cloneState, N_CABLES, N_SEGMENTS, CABLE_ANGLES } from '../core/arm.js';
import { V3, Quat, Transform, clamp, lerp, rad, deg, Rng } from '../core/mathx.js';
import {
  expertCommand, homeTaskState, taskMetrics, taskStep, toolAxis, TASK_KIND,
  armLateralError, armTiltError, PHASE, PHASE_NAMES,
} from '../core/physics.js';

export const CONTROL_MODE = { EXPERT: 'expert', LEARNED: 'learned', MANUAL: 'manual' };

/** Waypoints in a full plan — the fixed grid every demonstration is recorded on. */
export const POL_PLAN_WAYPOINTS = 48;
/** Waypoints the transformer emits per forward pass (row 0 is executed). */
export const POL_CHUNK = 16;
/** Conditioning vector width: task(12) + pose(7) + tendons(9) + progress(1). */
export const POL_COND_DIM = 29;

/**
 * Tendon-delta normalisation: every learned controller (the inverse-kinematics
 * MLP and the transformer policy) predicts cable deltas divided by this value,
 * and `netCables`/`learnedCommand` multiply it back. The training worker reads
 * the same constant, so dataset and rollout can never drift apart.
 * 0.06 m covers the worst case (45° bend + full compression on all segments).
 */
export const ACTUATION_SCALE = 0.06;

export class Robot {
  constructor(cfg = {}) {
    this.arm = new Arm({ ...defaultConfig(), ...cfg.arm });
    this.tasks = cfg.tasks ?? [];
    this.taskIndex = 0;
    this.spec = this.tasks[0] ?? null;
    this.state = homeState();
    this.taskState = homeTaskState();
    this.mode = CONTROL_MODE.EXPERT;
    this.time = 0;
    this.prevSpin = 0;
    this.rng = new Rng(cfg.seed ?? 7);
    this.net = null;              // pose → tendon deltas (learned IK)
    this.policy = null;           // plan tokens → tendon deltas (transformer)
    this.policyPlan = null;
    this.policyStep = 0;
    this.policyElapsed = 0;
    this.policyInterval = 1 / 3;   // seconds of simulated time per plan waypoint
    this.policySeqLen = POL_PLAN_WAYPOINTS; // waypoints in a full plan
    this.policyAttn = null;        // last attention tensor, for the HUD heat map
    this.manual = { target: null, spin: 0, motorSpeed: 0, hold: false };
    this.integral = V3.zero();
    this.humanForce = V3.zero();
    this.humanForceVec = V3.zero();
    this.reaction = { force: V3.zero(), torque: V3.zero() };
    this.telemetry = {
      bend: new Array(N_SEGMENTS).fill(0),
      tension: new Array(N_CABLES).fill(0),
      torque: 0,
      cableSpeed: 0,
      trackError: 0,
      complianceWork: 0,
      ikMs: 0,
    };
    this.trail = [];
    this.history = [];
    this.seed = cfg.seed ?? 7;
    this.reset();
  }

  reset(seed = this.seed) {
    this.rng = new Rng(seed);
    this.state = homeState();
    this.taskState = homeTaskState();
    this.time = 0;
    this.prevSpin = 0;
    this.integral = V3.zero();
    this.humanForce = V3.zero();
    this.reaction = { force: V3.zero(), torque: V3.zero() };
    this.ikSeed = null;
    this.trail = [];
    this.history = [];
    this.resetPolicy();
    return this;
  }

  get activeTask() { return this.spec; }

  selectTask(index) {
    this.taskIndex = clamp(index | 0, 0, Math.max(this.tasks.length - 1, 0));
    return this.setSpec(this.tasks[this.taskIndex] ?? null);
  }

  /**
   * Swap the active task spec (used by the multi-stage assembly runner, which
   * feeds one stage after another into the same controller).
   */
  setSpec(spec, { keepTime = false } = {}) {
    this.spec = spec ?? null;
    this.taskState = homeTaskState();
    this.integral = V3.zero();
    // keep the spin reference continuous: the motor keeps its angle across tasks
    this.prevSpin = this.state ? this.state.motorAngle : 0;
    this.reaction = { force: V3.zero(), torque: V3.zero() };
    if (!keepTime) this.time = 0;
    this.resetPolicy();
    return this.spec;
  }

  /** Forget the cached policy rollout so the next step re-plans from scratch. */
  resetPolicy() {
    this.policyPlan = null;
    this.policyStep = 0;
    this.policyElapsed = 0;
    return this;
  }

  setMode(mode) { this.mode = mode; this.integral = V3.zero(); this.resetPolicy(); return this; }

  /** Manual target written by the GUI gizmo, in world space. */
  setManualTarget(p, axis, { spin = null, motorSpeed = null, hold = null } = {}) {
    this.manual.target = { p: V3.clone(p), q: Quat.fromYTo(V3.norm(axis ?? Transform.up(this.state.tool))) };
    if (spin !== null) this.manual.spin = spin;
    if (motorSpeed !== null) this.manual.motorSpeed = motorSpeed;
    if (hold !== null) this.manual.hold = hold;
  }

  /** Human/contact push, applied at the tool in world coordinates (N). */
  setHumanForce(f) { this.humanForce = V3.clone(f); }

  /**
   * One control step. Returns the telemetry snapshot for this frame.
   * @param {number} dt seconds
   * @param {object} opts { loadTorque, disturbance, adaptive }
   */
  step(dt, opts = {}) {
    const arm = this.arm;
    const spec = this.spec;
    const st = this.state;

    // ---------------------------------------------------- 1. pick the target
    let cmd;
    if (this.mode === CONTROL_MODE.EXPERT && spec) {
      cmd = expertCommand(spec, this.taskState, st.tool, this.time);
    } else if (this.mode === CONTROL_MODE.LEARNED) {
      cmd = this.learnedCommand(dt, opts);
    } else {
      const t = this.manual.target ?? { p: V3.new(0, 0.62, 0), q: Quat.fromYTo(V3.up()) };
      cmd = { target: t, motorSpeed: this.manual.motorSpeed, hold: this.manual.hold, phase: -1 };
    }

    // Open-loop tendon override: used by the acceptance probes to measure the
    // *ceiling* of any purely feed-forward controller — replay the expert's own
    // cable trajectory with the servo loop, IK and residual all switched off.
    if (opts.cableOverride) {
      const src = opts.cableOverride;
      for (let i = 0; i < N_CABLES; i += 1) {
        st.cableCmd[i] = clamp(src[i] ?? st.cableCmd[i], -0.12, 0.12);
      }
      cmd = { ...cmd, preCommanded: true };
    }

    // ---------------------------------------------------- 2. track & correct
    const measured = this.measuredTool();
    const err = V3.sub(cmd.target.p, measured.p);
    // slow integral term: absorbs gravity droop, payload and cable creep, the way
    // a real controller closes the loop on its learned inverse-kinematics model
    const trackGain = opts.trackGain ?? 1.0;
    if (this.mode !== CONTROL_MODE.MANUAL || opts.manualTracking) {
      this.integral = V3.add(
        V3.scale(this.integral, clamp(1 - dt * 0.6, 0, 1)),
        V3.scale(err, clamp(dt * (opts.integralGain ?? 7) * trackGain, 0, 0.5)),
      );
      const il = V3.len(this.integral);
      const maxI = 0.08;
      if (il > maxI) this.integral = V3.scale(this.integral, maxI / il);
    }
    const ikTarget = {
      p: V3.add(cmd.target.p, this.integral),
      q: cmd.target.q,
    };

    // ---------------------------------------------------- 3. solve actuation
    // The transformer policy emits tendon lengths directly (open-loop rollout),
    // so it owns the servo command and the classical solver stays out of the way.
    const ikIters = opts.ikIters ?? 24;
    let cables = null;
    if (cmd.planCables) {
      // Policy authority: the transformer plan is blended with a classical solve
      // of the supervisor's target pose. `opts.residualWeight` (the app's
      // "policy authority" slider, inverted) sets how much of the loop the
      // learned model owns. Measured ablation for the open-loop plan alone is in
      // docs/design.md — it plans the motion but does not seat the screw.
      cables = Array.from(cmd.planCables);
      if (opts.residual !== false) {
        const segRes = arm.ik(ikTarget, st, Math.max(2, Math.round(ikIters / 4)));
        const res = arm.cableTargets(segRes);
        const w = clamp(opts.residualWeight ?? 0.75, 0, 1);
        for (let i = 0; i < N_CABLES; i += 1) cables[i] = lerp(cables[i], res[i], w);
      }
    } else if (cmd.preCommanded) {
      cables = null;
    } else if (this.mode === CONTROL_MODE.LEARNED && this.net && opts.netEnabled !== false) {
      cables = this.netCables(ikTarget, opts);
    }
    if (!cmd.preCommanded && !cables) {
      const t0 = performance.now();
      // warm start from the previous solution: continuous, repeatable motion
      // (the paper's 0.4 mm trajectory repeatability) and far fewer iterations
      const seed = this.ikSeed ?? st;
      // Load-aware solve: the IK is asked for the *loaded* equilibrium, with the
      // contact wrench the part is currently applying fed in as the predicted
      // external load. The integral below then only has to cancel what is left.
      const seg = (this.reaction && opts.loadComp !== false)
        ? arm.ikCompensated(ikTarget, seed, ikIters, this.reaction, { passes: 2, axisWeight: opts.axisWeight ?? 0.3 })
        : arm.ik(ikTarget, seed, ikIters, { axisWeight: opts.axisWeight ?? 0.3 });
      this.ikSeed = { ...st, seg: seg.map((x) => ({ ...x })) };
      this.telemetry.ikMs = performance.now() - t0;
      cables = arm.cableTargets(seg);
      if (this.mode === CONTROL_MODE.LEARNED && opts.residual !== false && opts.netEnabled !== false) {
        // learned model + small classical residual: keeps the demo honest about
        // what the network adds (feed-forward) and what the solver adds (drift)
        const segRes = arm.ik(ikTarget, st, 2);
        const res = arm.cableTargets(segRes);
        const w = clamp(opts.residualWeight ?? 0.25, 0, 1);
        cables = cables.map((c, i) => lerp(c, res[i], w));
      }
    }
    // Torque limit / tendon saturation / slew limit: a real winch cannot exceed
    // its rating, and its setpoint cannot step — rate-limiting the command is
    // what keeps a newly commanded standoff from becoming a whip at the tip.
    if (!cmd.preCommanded || cmd.planCables) {
      const maxStep = (opts.cableSlew ?? 0.025) * dt;
      for (let i = 0; i < N_CABLES; i += 1) {
        const want = clamp(cables[i], -0.12, 0.12);
        const prev = st.cableCmd[i];
        st.cableCmd[i] = clamp(want, prev - maxStep, prev + maxStep);
      }
    }

    // ---------------------------------------------------- 4. arm + task
    const extForce = V3.add(this.humanForce, this.reaction.force);
    const motorSpeed = (cmd.motorSpeed ?? 0) + (opts.motorSpeedBias ?? 0);
    const hold = cmd.hold ?? false;
    const t0 = performance.now();
    arm.step(st, dt, { force: extForce, torque: this.reaction.torque }, { speed: motorSpeed, hold });
    const armMs = performance.now() - t0;

    if (spec) {
      const input = {
        toolPos: st.tool.p,
        toolAxis: toolAxis(st.tool),
        spin: st.motorAngle,
        torque: st.toolTorque,
        speed: st.motorSpeed,
        complianceGain: clamp(arm.cfg.compliance / 2, 0, 1),
        lateralError: armLateralError(st.tool, spec),
        tiltError: armTiltError(st.tool, spec),
        time: this.time,
      };
      this.reaction = taskStep(spec, this.taskState, input, this.prevSpin, dt);
    } else {
      this.reaction = { force: V3.zero(), torque: V3.zero() };
    }
    this.prevSpin = st.motorAngle;
    this.time += dt;

    // ---------------------------------------------------- 5. bookkeeping
    const tel = this.telemetry;
    for (let s = 0; s < N_SEGMENTS; s += 1) tel.bend[s] = st.seg[s].bend;
    for (let c = 0; c < N_CABLES; c += 1) tel.tension[c] = st.tension[c];
    tel.torque = st.toolTorque;
    tel.cableSpeed = st.cableSpeed;
    tel.trackError = V3.len(err);
    tel.complianceWork = this.taskState.complianceWork;
    tel.armMs = armMs;
    tel.contactForce = V3.len(this.reaction.force);

    this.trail.push({ p: V3.clone(st.tool.p), t: this.time });
    if (this.trail.length > 900) this.trail.splice(0, this.trail.length - 900);
    if (opts.record !== false) {
      this.history.push({
        t: this.time,
        pos: V3.toArray(st.tool.p),
        bend: st.seg.map((s) => rad(s.bend)),
        torque: st.toolTorque,
        depth: this.taskState.depth,
        turns: this.taskState.turns,
        force: V3.len(this.reaction.force),
      });
      if (this.history.length > 20000) this.history.splice(0, 4000);
    }
    return tel;
  }

  /** Noise + hysteresis: what the controller actually measures (encoder + load cell). */
  measuredTool() {
    return this.arm.measuredPose(this.state, this.rng);
  }

  /** Learned pose → tendon deltas, with the conditioning the net was trained on. */
  netCables(target, opts = {}) {
    const x = this.netInput(target);
    const out = this.net.forward(x);
    // The net predicts a normalised tendon length; the trainer stored the
    // per-channel mean/σ it standardised with, so de-standardise here.
    const scale = opts.netScale ?? ACTUATION_SCALE;
    const yMean = this.net.yMean;
    const yStd = this.net.yStd;
    return Array.from(out, (v, i) => ((yMean ? v * yStd[i] + yMean[i] : v) * scale));
  }

  /**
   * Input vector for the learned inverse-kinematics network:
   *   [ target position (scaled), target axis, payload,
   *     current joint state — bend, sin/cos of the bending plane, squash ]
   *
   * The joint state matters: with nine tendon DOFs and a six-DOF pose there is a
   * null space, so "where I want to be" alone cannot select a unique set of
   * tendon lengths. Conditioning on where the arm *is* collapses that ambiguity
   * (the network becomes a step of a residual trajectory controller, which is how
   * the paper's learned IK is used as well).
   */
  netInput(target) {
    const t = target;
    const axis = V3.norm(Transform.up(t));
    const p = V3.sub(t.p, V3.new(0, 0.35, 0));
    const out = [
      p.x * 3, p.y * 3, p.z * 3,
      axis.x, axis.y, axis.z,
      clamp(this.arm.cfg.payloadKg, 0, 1),
    ];
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const seg = this.state.seg[s];
      out.push(seg.bend * 2, Math.sin(seg.plane), Math.cos(seg.plane), seg.compress * 10);
    }
    return Float32Array.from(out);
  }

  /**
   * Transformer policy rollout.
   *
   * The plan tokens are a *causal schedule* over the episode: token `i` says
   * which job is being done and which part of it is in progress, so the whole
   * tendon-delta trajectory can be emitted in one forward pass and then played
   * back at the control rate. The worker distils this same schedule from the
   * scripted expert, so training and rollout share one tokenisation.
   */
  learnedCommand(dt, opts = {}) {
    if (!this.policy) {
      if (!this.spec) return { target: { p: V3.new(0, 0.6, 0), q: Quat.fromYTo(V3.up()) }, motorSpeed: 0, hold: false };
      // untrained policy: fall back to the scripted expert so the app is still
      // useful (the HUD says "expert fallback" while the net is untrained)
      this.policyFallback = true;
      return expertCommand(this.spec, this.taskState, this.state.tool, this.time);
    }
    this.policyFallback = false;
    // Where are we in the plan? The policy was distilled on a fixed waypoint
    // grid, so the clock — not the plan itself — says which chunk to ask for.
    const interval = this.policy.planInterval ?? this.policyInterval;
    const k = clamp(Math.floor(this.time / interval), 0, POL_PLAN_WAYPOINTS - 1);
    const tokens = this.policyTokens(POL_CHUNK, k);
    const cond = Float32Array.from(this.policyCond(this.state, k / (POL_PLAN_WAYPOINTS - 1)));
    const { out, attn } = this.policy.forward(tokens, cond);
    this.policyAttn = attn;
    this.policyStep = k;
    // row 0 is "what to command now"; the rest of the chunk is the model's
    // prediction of the next waypoints and is deliberately not executed —
    // re-planning from the measured state every step is what removes drift
    const yMean = this.policy.yMean;
    const yStd = this.policy.yStd;
    this.policyPlan = [];
    for (let i = 0; i < POL_CHUNK; i += 1) {
      const row = new Float32Array(N_CABLES);
      for (let c = 0; c < N_CABLES; c += 1) {
        const v = out[i * N_CABLES + c];
        row[c] = (yMean ? v * yStd[c] + yMean[c] : v) * ACTUATION_SCALE;
      }
      this.policyPlan.push(row);
    }
    // hand the plan to `step`, which may blend it with the classical solve
    // The transformer owns the *tendon plan*; the phase supervisor stays
    // classical. Guessing the phase from the plan index alone does not work —
    // measured: an exact replay of the expert's own tendon trajectory reaches
    // 1.3 of 6 turns when the spin is driven by the token schedule, and all
    // 6.00 turns when the spin is driven by the contact state machine below.
    // A screw must turn when the nut is *on the thread*, not when the clock says so.
    const sup = expertCommand(this.spec, this.taskState, this.state.tool, this.time);
    return {
      // the state machine still says *where* the tool should be; the policy says
      // what tendon lengths get it there
      target: sup.target,
      motorSpeed: sup.motorSpeed,
      hold: sup.hold,
      phase: sup.phase,
      preCommanded: true,
      planCables: this.policyPlan[0],
    };
  }

  /** Token id for one plan step: 1 + kind·7 + phase (vocab laid out for the model). */
  policyTokenFor(kind, phase) { return 1 + kind * (PHASE.DONE + 1) + phase; }

  /**
   * Plan tokens for a chunk of waypoints: token `i` is the phase the operator
   * intends `POL_CHUNK` waypoints into the future. The chunk is re-solved from
   * the measured state at every control step, so the model never has to guess
   * where it is — that is in the conditioning vector.
   */
  policyTokens(len = POL_CHUNK, k = 0) {
    const spec = this.spec;
    if (!spec) return Uint16Array.from([0]);
    return phaseTokensFor(spec.kind, k, len);
  }

  /**
   * Conditioning vector: what job, what the *measured* state is right now, how
   * far through the plan, and where the tendons currently are. Feeding the state
   * in makes the map single-valued and the rollout self-correcting; without it
   * the same (task, tokens) pair maps to a whole fan of trajectories.
   */
  policyCond(state = this.state, progress = 0) {
    const spec = this.spec;
    const kindOneHot = [0, 0, 0, 0].map((_, i) => (spec && spec.kind === i ? 1 : 0));
    const tool = (state && state.tool) || this.state.tool;
    const q = tool.q;
    const out = [
      ...kindOneHot,
      spec ? clamp(spec.pitch / 0.003, 0, 1) : 0,
      spec ? clamp(spec.turnsRequired / 8, 0, 1) : 0,
      spec ? clamp(spec.clearance / 0.002, 0, 1) : 0,
      spec ? clamp(spec.torqueLimit / 2, 0, 1) : 0,
      spec ? clamp(spec.friction, 0, 1) : 0,
      clamp(this.arm.cfg.compliance / 2, 0, 1),
      clamp(this.arm.cfg.payloadKg, 0, 1),
      spec ? clamp(V3.len(spec.anchor) / 0.7, 0, 1) : 0,
    ];
    out.push(tool.p.x / 0.7, tool.p.y / 0.7, tool.p.z / 0.7);
    out.push(q.x, q.y, q.z, q.w);
    for (let c = 0; c < N_CABLES; c += 1) out.push((state?.cableCmd?.[c] ?? 0) / ACTUATION_SCALE);
    out.push(progress);
    return out;
  }

  /** Metrics for the HUD. */
  metrics() {
    return this.spec
      ? taskMetrics(this.spec, this.taskState, this.time, this.arm.cfg.compliance)
      : { success: false, damaged: false, turns: 0, depthMm: 0, loadTorque: 0, misalignMm: 0, absorbedMm: 0, peakForceN: 0, safety: 0, timeS: this.time, phase: -1, phaseName: 'idle' };
  }

  /** Rendering data: the cell chain, the cable guides, the tendons. */
  bones() { return this.arm.bones(this.state); }
  guides() { return this.arm.guides(this.state); }
  cables() { return this.arm.cablePaths(this.state); }

  /** Deep copy of the tool pose for gizmos. */
  toolPose() { return Transform.clone(this.state.tool); }
}

/**
 * Phase schedule for token `i` of a `len`-token episode. Shared with the worker
 * so the distilled dataset uses exactly the tokens the rollout will feed in.
 */
/**
 * Token ids for a chunk of waypoints starting at `k0`: token `i` says which phase
 * of the job the plan intends `i` waypoints from now. The same function is used
 * to tokenise the demonstrations and to drive the rollout, so training and
 * inference cannot drift apart.
 */
export function phaseTokensFor(kind, k0, len = POL_CHUNK) {
  const out = new Uint16Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = 1 + kind * (PHASE.DONE + 1) + taskPhaseSchedule(k0 + i, POL_PLAN_WAYPOINTS);
  }
  return out;
}

export function taskPhaseSchedule(i, len) {
  const n = Math.max(1, Math.round(len));
  return clamp(Math.floor((i / n) * (PHASE.DONE + 1)), 0, PHASE.DONE);
}

export { N_CABLES, N_SEGMENTS, CABLE_ANGLES, PHASE_NAMES, cloneState };
