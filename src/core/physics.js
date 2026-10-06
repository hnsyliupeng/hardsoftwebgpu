/**
 * physics.js — task physics: threads, valves, fragile bulbs and human contact.
 *
 * Faithful JavaScript mirror of `rust/trunc_core/src/physics.rs`. The two
 * implementations share every constant and every branch, so the headless Rust
 * CLI (`trunc_cli bench`) and the WebGPU front-end report the same numbers.
 *
 * | task                | why it needs a TRUNC                 | modelled physics |
 * |---------------------|--------------------------------------|------------------|
 * | bolt fastening      | continuous torque, misalignment tol. | thread engagement, cross-threading, stiffness |
 * | light-bulb install  | delicate torque + rotation until lit  | fragile torque window, turn criterion |
 * | valve turning       | multi-turn rotation while bent        | stiction + viscous friction, turn counter |
 * | human collaboration | safe contact, still finishes the job  | contact compliance, force limiting, safety index |
 *
 * The integrator is quasi-static semi-implicit Euler, so results are
 * deterministic and reproducible between the browser and Rust.
 */

import { V3, Quat, Transform, clamp, lerp, PI } from './mathx.js';

export const TASK_KIND = { BOLT: 0, BULB: 1, VALVE: 2, PEG: 3 };
export const TASK_NAMES = ['bolt fastening', 'light-bulb install', 'valve turning', 'peg-in-hole (human in the loop)'];

export const PHASE = { APPROACH: 0, ALIGN: 1, ENGAGE: 2, FASTEN: 3, VERIFY: 4, DONE: 5, FAILED: 6 };
export const PHASE_NAMES = ['approach', 'align', 'engage', 'fasten', 'verify', 'complete', 'failed'];

export const TURNS_PER_RAD = 1 / (2 * PI);

/**
 * Axial approach ladder, in metres, measured *along the part axis* from the
 * anchor. The values come from the arm's own reachable set: with the tool axis
 * held on the part axis the tip can be placed anywhere in the 0.58–0.70 m shell
 * (docs/design.md has the sweep), so the whole ladder has to sit inside that
 * band for every task anchor. `STANDOFF.APPROACH` is also the `distToAnchor`
 * gate amplitude used by the phase machine below.
 */
/**
 * Remote-centre seek gain: fraction of the measured lateral offset that the
 * controller removes each control step while engaged. 1.0 would null it in one
 * step (and fight the servo), 0.35 leaves the compliance visible.
 */
export const SEEK_GAIN = 0.35;

export const STANDOFF = {
  APPROACH: 0.03,
  ALIGN: 0.015,
  ENGAGE: 0.004,
  FASTEN: 0.0,
  DONE: 0.03,
  FAILED: 0.05,
};

/** Default `TaskSpec` — mirrored field-for-field from Rust. */
export function defaultTaskSpec() {
  return {
    kind: TASK_KIND.BOLT,
    anchor: V3.zero(),
    axis: V3.up(),
    pitch: 0.00125,       // M8 coarse, m / turn
    turnsRequired: 6.0,
    clearance: 0.0006,    // 0.6 mm radial play
    friction: 0.14,
    torqueLimit: 1.4,     // N·m
    forceLimit: 40.0,     // N
    compliance: 0.85,
    stiction: 0.25,
    disturbance: 0.0,
  };
}

/** Preset specs, exactly the numbers used by `TaskSpec::bolt/bulb/valve/peg`. */
export function taskPreset(kind, anchor = V3.zero(), axis = V3.up()) {
  const base = defaultTaskSpec();
  switch (kind) {
    case TASK_KIND.BULB:
      return { ...base, kind, anchor, axis, pitch: 0.0025, turnsRequired: 2.4, clearance: 0.0008, friction: 0.22, torqueLimit: 0.35, forceLimit: 12.0, compliance: 0.9, stiction: 0.02, disturbance: 0 };
    case TASK_KIND.VALVE:
      return { ...base, kind, anchor, axis, pitch: 0.002, turnsRequired: 5.0, clearance: 0.0012, friction: 0.35, torqueLimit: 1.6, forceLimit: 60.0, compliance: 0.8, stiction: 0.45, disturbance: 0 };
    case TASK_KIND.PEG:
      return { ...base, kind, anchor, axis, pitch: 0.00125, turnsRequired: 3.0, clearance: 0.0008, friction: 0.18, torqueLimit: 1.2, forceLimit: 30.0, compliance: 0.92, stiction: 0.2, disturbance: 1.6 };
    default:
      return { ...base, kind: TASK_KIND.BOLT, anchor, axis };
  }
}

export function homeTaskState() {
  return {
    phase: PHASE.APPROACH,
    depth: 0,
    turns: 0,
    loadTorque: 0,
    reaction: { force: V3.zero(), torque: V3.zero() },
    misalign: 0,
    absorbed: 0,
    damaged: false,
    engaged: false,
    opening: 1,
    connected: false,
    success: false,
    phaseTime: 0,
    peakForce: 0,
    failReason: '',
    misalignTime: 0,
    complianceWork: 0,
    overloadTime: 0,
    humanForce: 0,
    humanForceApplied: 0,
  };
}

export function cloneTaskState(s) {
  return {
    ...s,
    reaction: { force: V3.clone(s.reaction.force), torque: V3.clone(s.reaction.torque) },
  };
}

/**
 * Advance a task by `dt`, returning the wrench the part applies back on the tool.
 * `input` fields: toolPos, toolAxis, spin, torque, speed, complianceGain,
 * lateralError, tiltError, time.
 */
export function taskStep(spec, st, input, prevSpin, dt) {
  st.phaseTime += dt;
  const spinDelta = input.spin - prevSpin;
  const turnsDelta = spinDelta * TURNS_PER_RAD;

  // ----------------------------------------------------------- alignment
  const lat = input.lateralError;
  const tilt = Math.abs(input.tiltError);
  st.misalign = lat;
  // Remote-centre compliance: part of the lateral error is absorbed by the bent
  // structure instead of loading the threads.
  // the compliant structure absorbs misalignment: at full compliance the tool can
  // sit `absorbLen` off the part axis and still present the threads straight
  const absorbLen = spec.clearance * (1 + 14 * spec.compliance * input.complianceGain);
  const residual = Math.max(lat - absorbLen, 0);
  st.absorbed = lat - residual;
  st.complianceWork += st.absorbed * 0.5 * spec.friction * 1e3 * dt;

  const canEngage = residual <= spec.clearance * 1.5 && tilt < 0.12;
  const axisErr = 1 - Math.abs(V3.dot(input.toolAxis, spec.axis));
  const distToAnchor = V3.len(V3.sub(input.toolPos, spec.anchor));

  // -------------------------------------------------------------- phases
  switch (st.phase) {
    case PHASE.APPROACH:
      if (distToAnchor < STANDOFF.APPROACH + 0.02) { st.phase = PHASE.ALIGN; st.phaseTime = 0; }
      break;
    case PHASE.ALIGN:
      // the tool has to be square *and* centred inside the compliant window before
      // the shaft is allowed to turn — this is the paper's remote-centre alignment
      if (axisErr < 0.02 && distToAnchor < STANDOFF.ALIGN + 0.01 && lat < absorbLen * 0.9) {
        st.phase = PHASE.ENGAGE;
        st.phaseTime = 0;
      } else if (st.phaseTime > 10) { st.phase = PHASE.FAILED; st.failReason = 'alignment timeout'; }
      break;
    case PHASE.ENGAGE:
      if (!canEngage) {
        // Forcing a misaligned part: cross-threading damage *accumulates*, it is
        // not instantaneous — the compliance gives the threads time to find each
        // other, which is the whole point of doing this with a soft arm.
        if (Math.abs(input.torque) > 0.05 && residual > spec.clearance * 2) st.misalignTime += dt;
        else st.misalignTime = Math.max(st.misalignTime - dt, 0);
        if (st.misalignTime > 0.15) {
          st.loadTorque = Math.abs(input.torque);
          st.damaged = true;
          st.failReason = 'torqued a misaligned thread';
          st.phase = PHASE.FAILED;
        }
      } else if (Math.abs(turnsDelta) > 1e-5) {
        st.engaged = true;
        st.phase = PHASE.FASTEN;
        st.phaseTime = 0;
      }
      break;
    case PHASE.FASTEN: {
      // sustained gross misalignment is what strips threads, not a single control
      // step of contact transient
      if (!canEngage && residual > spec.clearance * 6) st.misalignTime = (st.misalignTime ?? 0) + dt;
      else st.misalignTime = Math.max((st.misalignTime ?? 0) - dt * 2, 0);
      if (st.misalignTime > 0.15) { st.damaged = true; st.failReason = 'thread forced off-axis'; st.phase = PHASE.FAILED; }
      if (st.engaged) {
        st.depth += Math.abs(turnsDelta) * spec.pitch;
        st.turns += Math.abs(turnsDelta);
      }
      const thread = spec.friction * 0.35 * clamp(st.depth / 0.01, 0, 1);
      // load budget: every task keeps ~30 % headroom under its own torque limit,
      // so the limit is a *safety* envelope (and a trap for the learned policy)
      // rather than something the nominal profile trips
      const ramp = 0.12 * clamp(st.turns / Math.max(spec.turnsRequired, 0.1), 0, 1.15) ** 2;
      let base = 0.03;
      if (spec.kind === TASK_KIND.VALVE) base = spec.stiction + spec.friction * 0.35 * Math.min(st.turns, spec.turnsRequired * 1.05);
      else if (spec.kind === TASK_KIND.BULB) base = 0.02 + spec.friction * 0.02;
      st.loadTorque = base + thread + ramp;
      if (st.loadTorque > spec.torqueLimit) { st.damaged = true; st.failReason = `torque limit: ${st.loadTorque.toFixed(2)} N·m`; st.phase = PHASE.FAILED; }
      else if (st.turns >= spec.turnsRequired) {
        // the seat is reached when the *turns* are in; the torque the shaft carries
        // is reported separately and only becomes a limit (not a gate)
        st.phase = PHASE.VERIFY;
        st.phaseTime = 0;
      }
      if (spec.kind === TASK_KIND.VALVE) st.opening = clamp(1 - st.turns / Math.max(spec.turnsRequired, 0.1), 0, 1);
      else if (spec.kind === TASK_KIND.BULB) st.connected = st.turns >= spec.turnsRequired * 0.98;
      else if (spec.kind === TASK_KIND.BOLT) st.connected = st.depth >= spec.pitch * spec.turnsRequired * 0.95;
      else st.connected = st.turns >= spec.turnsRequired;
      break;
    }
    case PHASE.VERIFY:
      st.loadTorque *= 0.9;
      if (st.phaseTime > 0.15) {
        st.success = !st.damaged;
        st.phase = st.success ? PHASE.DONE : PHASE.FAILED;
      }
      break;
    default:
      st.loadTorque = lerp(st.loadTorque, 0, clamp(dt * 4, 0, 1));
      break;
  }

  // ------------------------------------------- contact reaction wrench
  // Contact only exists while the tool is at the part: on the approach the tool
  // is far away and nothing pushes back.
  const engagedPhases = st.phase === PHASE.ENGAGE || st.phase === PHASE.FASTEN
    || st.phase === PHASE.VERIFY || st.phase === PHASE.DONE;
  // Contact needs *both* an engaged phase and proximity: while the arm is still
  // slewing towards a newly commanded standoff it has no business loading the
  // part, which is what keeps the approach transient from spiking the wrench.
  const near = distToAnchor < 0.012;
  const inContact = near && (engagedPhases || distToAnchor < 0.05);
  let force = V3.zero();
  let torque = V3.zero();
  const lateralStiffness = 220 * (1 - 0.7 * spec.compliance * input.complianceGain);
  if (inContact) {
    // The compliant structure absorbs the first `absorbLen` of lateral error, so
    // only the residual loads the threads — the paper's misalignment tolerance.
    // Both terms are capped: a fixture cannot push harder than it can push, and
    // a bounded wrench is what keeps the position loop stable on a soft arm.
    const lateral = Math.min(residual * lateralStiffness, 3.0);
    force = V3.add(force, V3.new(lateral, 0, lateral * 0.35));
    // approach/insertion axial load while the tool is over the part
    const axialPush = Math.min(clamp(STANDOFF.ALIGN - distToAnchor, 0, 0.03) * 1200, 2.5);
    force = V3.add(force, V3.scale(spec.axis, -axialPush));
  }
  if (inContact && (st.engaged || st.phase === PHASE.FASTEN || st.phase === PHASE.VERIFY || st.phase === PHASE.DONE)) {
    const dir = input.speed >= 0 ? 1 : 0;
    torque = V3.add(torque, V3.scale(spec.axis, -st.loadTorque * dir));
  }
  if (spec.disturbance > 0 || st.humanForce > 0) {
    // |F| of the operator's push: the scripted disturbance plus whatever the GUI
    // joystick is applying. Bounded by construction — never fed back into itself.
    const t = input.time;
    const hf = spec.disturbance * Math.sin(t * 1.7) * (0.6 + 0.4 * Math.sin(t * 0.31)) + st.humanForce;
    st.humanForce = Math.max(st.humanForce, 0);
    st.humanForceApplied = hf;
    force = V3.add(force, V3.new(hf * 0.6, -hf * 0.25, hf));
  } else {
    st.humanForceApplied = 0;
  }
  // The contact is compliant: the part, threads and the arm all yield, so the
  // wrench saturates instead of growing without bound.
  const fSat = V3.len(force);
  const cap = spec.forceLimit * 1.3;
  if (fSat > cap) force = V3.scale(force, cap / fSat);
  const fMag = inContact ? V3.len(force) : 0;
  if (fMag > st.peakForce) st.peakForce = fMag;
  // First-order filter on the reaction wrench: contact makes and breaks in a
  // single control step when a soft arm settles onto a part, and feeding that
  // discontinuity straight into the structure excites it. A 25 ms filter is the
  // same thing the part's own elastic housing does to a force step.
  const alpha = clamp(dt * 40, 0, 1);
  const target = inContact ? force : V3.zero();
  const targetT = inContact ? torque : V3.zero();
  st.reaction = {
    force: V3.add(st.reaction.force, V3.scale(V3.sub(target, st.reaction.force), alpha)),
    torque: V3.add(st.reaction.torque, V3.scale(V3.sub(targetT, st.reaction.torque), alpha)),
  };
  // Damage needs a *sustained* overload: a single control step of contact
  // transient is not a stripped thread (the paper's compliance absorbs those).
  if (fMag > spec.forceLimit) st.overloadTime += dt; else st.overloadTime = Math.max(st.overloadTime - dt * 2, 0);
  if (st.overloadTime > 0.05) { st.damaged = true; st.failReason = `contact force ${fMag.toFixed(1)} N over ${spec.forceLimit} N limit`; st.phase = PHASE.FAILED; }
  return st.reaction;
}

/**
 * Safety index for the human-collaboration demo: 1.0 = contact force at the pain
 * threshold, values below 1 are safe.
 */
export function safetyIndex(peakForce, torque, programmedStiffness) {
  const f = (peakForce / 45) ** 2;
  const t = (Math.abs(torque) / 1.5) ** 2;
  const softness = 1 / Math.max(programmedStiffness, 0.2);
  return clamp(Math.sqrt(f + t) * Math.min(softness, 1.4), 0, 3);
}

/** Scoring used by the HUD and the headless CLI benchmark. */
export function taskMetrics(spec, st, time, stiffness) {
  return {
    success: st.success,
    damaged: st.damaged,
    turns: st.turns,
    depthMm: st.depth * 1000,
    loadTorque: st.loadTorque,
    misalignMm: st.misalign * 1000,
    absorbedMm: st.absorbed * 1000,
    peakForceN: st.peakForce,
    safety: safetyIndex(st.peakForce, st.loadTorque, stiffness),
    timeS: time,
    phase: st.phase,
    phaseName: PHASE_NAMES[st.phase],
    opening: st.opening,
    connected: st.connected,
  };
}

/** The tool's approach axis is its local +Y (the truss axis at the tip). */
export function toolAxis(tool) { return V3.norm(Transform.up(tool)); }

/**
 * Expert controller: the scripted policy the transformer imitates. Returns the
 * desired tool pose (Transform) and the motor command for the current phase —
 * the same policy `trunc_cli demo` runs headlessly.
 */
export function expertCommand(spec, st, tool, t) {
  const axis = V3.norm(spec.axis);
  let standoff = STANDOFF.APPROACH;
  if (st.phase === PHASE.ALIGN) standoff = STANDOFF.ALIGN;
  else if (st.phase === PHASE.ENGAGE) standoff = STANDOFF.ENGAGE;
  else if (st.phase === PHASE.FASTEN || st.phase === PHASE.VERIFY) standoff = STANDOFF.FASTEN;
  else if (st.phase === PHASE.DONE) standoff = STANDOFF.DONE;
  else if (st.phase === PHASE.FAILED) standoff = STANDOFF.FAILED;

  const wobble = st.phase === PHASE.APPROACH ? 0.012 * Math.sin(t * 1.3) : 0;
  let p = V3.add(spec.anchor, V3.scale(axis, -standoff + (st.phase === PHASE.FASTEN ? st.depth : 0)));
  // Remote-centre seek: while the shaft is engaged, drive the *lateral* component
  // of the tool offset back to zero. This is what real compliant-insertion
  // controllers do — the wrist is nudged onto the part axis instead of relying on
  // the open-loop pose, and it is the reason a soft arm can thread a bolt at all.
  if (st.phase !== PHASE.APPROACH && st.phase !== PHASE.DONE) {
    const d = V3.sub(tool.p, spec.anchor);
    const lateralVec = V3.sub(d, V3.scale(axis, V3.dot(d, axis)));
    p = V3.add(p, V3.scale(lateralVec, -SEEK_GAIN));
  } else if (st.phase === PHASE.DONE) {
    const d = V3.sub(tool.p, spec.anchor);
    const lateralVec = V3.sub(d, V3.scale(axis, V3.dot(d, axis)));
    p = V3.add(p, V3.scale(lateralVec, -SEEK_GAIN * 0.5));
  }
  p.x += wobble; p.z += wobble * 0.5;
  const spin = Quat.twistAbout(tool.q, Transform.up(tool));
  const q = Quat.mul(Quat.fromYTo(axis), Quat.fromAxisAngle(V3.up(), spin));

  let motorSpeed = 0;
  let hold = false;
  if (st.phase === PHASE.ENGAGE) motorSpeed = st.engaged ? 0.6 : 0.18;
  else if (st.phase === PHASE.FASTEN) {
    motorSpeed = spec.kind === TASK_KIND.VALVE ? 2.2 : spec.kind === TASK_KIND.BULB ? 0.9 : 1.6;
  } else if (st.phase === PHASE.VERIFY) { hold = true; }
  return { target: { p, q }, motorSpeed, hold, phase: st.phase };
}

/** Radial distance between the tool axis and the part axis, metres. */
export function armLateralError(tool, spec) {
  const axis = V3.norm(spec.axis);
  const d = V3.sub(tool.p, spec.anchor);
  const along = V3.scale(axis, V3.dot(d, axis));
  return V3.len(V3.sub(d, along));
}

/** Tilt between the tool and the part axis, radians. */
export function armTiltError(tool, spec) {
  const a = toolAxis(tool);
  const b = V3.norm(spec.axis);
  return Math.acos(clamp(Math.abs(V3.dot(a, b)), 0, 1));
}

/**
 * One headless episode with the scripted expert: the HUD "auto run" button, the
 * tests and the CLI benchmark all funnel through here. Returns the metrics.
 */
export function runExpertEpisode(spec, arm, state, { dt = 1 / 240, seconds = 16, onStep = null } = {}) {
  const st = homeTaskState();
  let prevSpin = state.motorAngle;
  let t = 0;
  let guard = Math.ceil(seconds / dt) + 8;
  while (t < seconds && guard-- > 0 && st.phase !== PHASE.DONE && st.phase !== PHASE.FAILED) {
    const cmd = expertCommand(spec, st, state.tool, t);
    const seg = arm.ik(cmd.target, state, 5);
    const cables = arm.cableTargets(seg);
    for (let c = 0; c < cables.length; c += 1) state.cableCmd[c] = cables[c];
    arm.step(state, dt, { force: st.reaction.force, torque: st.reaction.torque }, { speed: cmd.motorSpeed, hold: cmd.hold });
    const input = {
      toolPos: state.tool.p,
      toolAxis: toolAxis(state.tool),
      spin: state.motorAngle,
      torque: state.toolTorque,
      speed: state.motorSpeed,
      complianceGain: clamp(arm.cfg.compliance / 2, 0, 1),
      lateralError: armLateralError(state.tool, spec),
      tiltError: armTiltError(state.tool, spec),
      time: t,
    };
    taskStep(spec, st, input, prevSpin, dt);
    prevSpin = state.motorAngle;
    t += dt;
    if (!Number.isFinite(state.tool.p.x)) break;
    if (onStep) onStep(st, state, t);
  }
  return { state: st, metrics: taskMetrics(spec, st, t, arm.cfg.compliance), time: t };
}
