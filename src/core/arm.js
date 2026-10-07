/**
 * arm.js — the TRUNC soft arm: nine tendons, three active joints (shoulder / elbow /
 * wrist), the nested truss torque channel, quasi-static compliance and hysteresis.
 *
 * Mirror of `rust/trunc_core/src/arm.rs` (identical equations and constants).
 */

import {
  approach, clamp, deg, lerp, Quat, Rng, sign, Transform, V3, wrapPi,
} from './mathx.js';
import {
  ANGULAR_LIMIT_HARD, bendingTorque, cellChain, cellEquatorial, cellTruss, crossCoupling,
  efficiency, hysteresisDeadband, MAX_BEND_RAD, torsionalStiffnessAtBend, twistForTorque,
} from './metamaterial.js';

export const N_SEGMENTS = 3;
export const N_CABLES = 9;
export const CABLE_ANGLES = [deg(90), deg(210), deg(330)];
export const SEGMENT_NAMES = ['shoulder', 'elbow', 'wrist'];

export function defaultConfig() {
  return {
    segmentLength: 0.71 / 3,
    cellsPerSegment: 3,
    cableRadius: 0.0245,
    cellRadius: 0.026,
    preload: 25,
    servoSpeed: 0.35,
    servoBandwidth: 200,
    tendonStiffness: 900,
    winchStiffness: 2.0e6,
    anisotropy: 52,
    compliance: 1,
    damping: 0.08,
    payloadKg: 0.35,
    gravitySag: 1,
    hysteresis: 0.35,
    sensorNoise: 0.00015,
    motorTorque: 2.4,
    motorSpeed: 52,
    motorGain: 1.2,
  };
}

export function segmentState(bend = 0, plane = 0, compress = 0) {
  return { bend, plane, compress, hysteresis: 0 };
}

export function homeState() {
  return {
    seg: [segmentState(), segmentState(), segmentState()],
    cables: new Array(N_CABLES).fill(0),
    cableCmd: new Array(N_CABLES).fill(0),
    prevCableCmd: null,      // set on the first control step (velocity feed-forward)
    tension: new Array(N_CABLES).fill(0),
    motorAngle: 0,
    motorSpeed: 0,
    shaftTwist: 0,
    toolTorque: 0,
    tool: Transform.identity(),
    compression: 0,
    cableSpeed: 0,
    atLimit: false,
  };
}

export function cloneState(s) {
  return {
    seg: s.seg.map((x) => ({ ...x })),
    cables: s.cables.slice(),
    cableCmd: s.cableCmd.slice(),
    prevCableCmd: s.prevCableCmd ? s.prevCableCmd.slice() : null,
    tension: s.tension.slice(),
    motorAngle: s.motorAngle,
    motorSpeed: s.motorSpeed,
    shaftTwist: s.shaftTwist,
    toolTorque: s.toolTorque,
    tool: Transform.clone(s.tool),
    compression: s.compression,
    cableSpeed: s.cableSpeed,
    atLimit: s.atLimit,
  };
}

export const emptyWrench = () => ({ force: V3.zero(), torque: V3.zero() });

export class Arm {
  constructor(cfg = defaultConfig()) {
    this.cfg = { ...cfg };
    const r = this.cfg.cellRadius;
    const trussCell = cellTruss(this.cfg.segmentLength / this.cfg.cellsPerSegment, r * 0.94, this.cfg.anisotropy);
    this.truss = cellChain(trussCell, this.cfg.cellsPerSegment);
    this.guide = cellChain(cellEquatorial(this.cfg.segmentLength / this.cfg.cellsPerSegment, r), this.cfg.cellsPerSegment);
    /** the single printed cell used for the compliance maths */
    this.shoulder = this.truss;
  }

  get totalLength() { return this.cfg.segmentLength * N_SEGMENTS; }
  get maxCompression() { return 0.0943 * Math.sqrt(this.cfg.compliance); }
  get maxBendPerSegment() { return MAX_BEND_RAD * Math.min(Math.sqrt(this.cfg.compliance), 1.4); }
  get segmentBendingStiffness() { return this.truss.bendingStiffness() / Math.max(this.cfg.compliance, 0.05); }

  /**
   * The tendons themselves resist bending: a small rotation Δφ stretches the
   * three cables by r·Δφ, and the resulting force difference contributes
   * 1.5·k_tendon·r²·Δφ of restoring moment. With the paper's 900 N/m tendons on
   * the 24.5 mm cable circle that is ≈0.8 N·m/rad — more than the printed cell
   * chain, which is exactly why the joint feels stiff while being soft.
   */
  get tendonBendingStiffness() { return 1.5 * this.cfg.tendonStiffness * this.cfg.cableRadius ** 2; }

  /** Total quasi-static bending stiffness of one segment under tendon actuation. */

  /**
   * Bending stiffness of the *equatorial* guide cells that ride outside the truss.
   * They are part of the printed segment — the cables run through them — and they
   * contribute roughly 80 % again of the truss chain, which is why the assembled
   * joint is stiffer than the torque channel alone.
   */
  get guideBendingStiffness() { return this.guide.bendingStiffness() / Math.max(this.cfg.compliance, 0.05); }

  /**
   * Total quasi-static bending stiffness of one segment: truss chain + equatorial
   * guides (both stiffen with tendon tension) + the tendons themselves.
   */
  bendingStiffnessAt(tension = this.cfg.preload) {
    return (this.segmentBendingStiffness + this.guideBendingStiffness) * this.stiffnessFactor(tension)
      + this.tendonBendingStiffness
      + this.winchBendingStiffness;
  }

  // ------------------------------------------------------------------ tendons

  cableDelta(seg, cable) {
    const psi = CABLE_ANGLES[cable % 3];
    return -this.cfg.cableRadius * seg.bend * Math.cos(psi - seg.plane) - seg.compress;
  }

  cableTargets(seg) {
    const out = new Array(N_CABLES).fill(0);
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      for (let c = 0; c < 3; c += 1) out[s * 3 + c] = this.cableDelta(seg[s], c);
    }
    return out;
  }

  /** closed-form inverse of the tendon kinematics (three cables → bend, plane, compress) */
  segmentFromCables(l0, l1, l2) {
    const d = [l0, l1, l2];
    const mean = (d[0] + d[1] + d[2]) / 3;
    const compress = -mean;
    let sx = 0;
    let sz = 0;
    for (let c = 0; c < 3; c += 1) {
      const psi = CABLE_ANGLES[c];
      const a = -d[c] / Math.max(this.cfg.cableRadius, 1e-6);
      sx += a * Math.cos(psi);
      sz += a * Math.sin(psi);
    }
    sx *= 2 / 3;
    sz *= 2 / 3;
    const bend = Math.hypot(sx, sz);
    if (bend > 1e-9) { sx /= bend; sz /= bend; }
    return { bend, plane: Math.atan2(sz, sx), compress: Math.max(compress, 0) };
  }

  segmentsFromCables(cables, motorAngle = 0, shaftTwist = 0) {
    const out = [];
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const r = this.segmentFromCables(cables[s * 3], cables[s * 3 + 1], cables[s * 3 + 2]);
      r.bend = clamp(r.bend, 0, ANGULAR_LIMIT_HARD);
      out.push(segmentState(r.bend, r.plane, r.compress));
    }
    const err = new Array(N_CABLES).fill(0);
    const est = this.cableTargets(out);
    for (let c = 0; c < N_CABLES; c += 1) err[c] = cables[c] - est[c];
    return { seg: out, residual: err, motorAngle, shaftTwist };
  }

  // -------------------------------------------------------------- kinematics

  /**
   * Constant-curvature transform of one segment: the tangent starts at +Y and
   * rotates by `bend` towards the bending plane direction d = (cos ψ, 0, sin ψ),
   * so the chord is (L/φ)·(sin φ·Y + (1 − cos φ)·d) — continuous at φ → 0, where
   * it degenerates to a straight (0, L, 0) segment.
   */
  /**
   * Chord transform of one curved piece.
   *
   * `lenOverride` exists because the arm is *drawn* per printed cell (three per
   * segment), and a cell's chord is a third of the segment's. Calling this with
   * no override — as `fk` does — gives the whole segment.
   */
  segmentTransform(seg, lenOverride = null) {
    const len = Math.max((lenOverride ?? this.cfg.segmentLength) - seg.compress, 0.002);
    const bend = seg.bend;
    const d = V3.new(Math.cos(seg.plane), 0, Math.sin(seg.plane));
    if (Math.abs(bend) < 1e-6) return { p: V3.new(0, len, 0), q: Quat.identity() };
    const axis = V3.new(Math.sin(seg.plane), 0, -Math.cos(seg.plane));
    const radius = len / bend;
    const p = V3.new(
      radius * (1 - Math.cos(bend)) * d.x,
      radius * Math.sin(bend),
      radius * (1 - Math.cos(bend)) * d.z,
    );
    return { p, q: Quat.fromAxisAngle(axis, bend) };
  }

  /**
   * Forward kinematics: tool pose for a configuration.
   * Accepts a *prefix* of the segment chain (folding a sub-chain is how the
   * tendon guides and the cable anchors are placed).
   */
  fk(seg, motorAngle = 0, shaftTwist = 0) {
    let t = Transform.identity();
    const n = Math.min(seg.length, N_SEGMENTS);
    for (let s = 0; s < n; s += 1) t = Transform.mul(t, this.segmentTransform(seg[s]));
    t = Transform.rotated(t, Quat.fromAxisAngle(V3.up(), motorAngle - shaftTwist));
    return t;
  }

  compressionOf(seg) {
    let total = 0;
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const len = this.cfg.segmentLength;
      const arc = V3.len(this.segmentTransform(seg[s]).p);
      total += seg[s].compress + Math.max(len - arc, 0);
    }
    return total;
  }

  bendFromMoment(momentLocal) {
    const mxz = V3.new(momentLocal.x, 0, momentLocal.z);
    const mag = V3.len(mxz);
    if (mag < 1e-9) return { bend: 0, plane: 0 };
    const a = V3.scale(mxz, 1 / mag);
    return { bend: mag, plane: Math.atan2(a.x, -a.z) };
  }

  /**
   * Tension stiffening: above the preload the truss cells are pulled into contact
   * and the joint stops being a soft lattice — the effect the paper measures as a
   * rising stiffness with tendon tension. The factor works on the *excess* over
   * the preload, so raising the preload stiffens the rest state instead of
   * cancelling the effect.
   */
  stiffnessFactor(tension) {
    const excess = Math.max(tension - this.cfg.preload, 0);
    return 1 + 0.35 * Math.sqrt(excess);
  }

  /**
   * Shape dictated by the tendon geometry: the three cables of a segment form the
   * closed-form (bend, plane, compression) triplet — inextensible-tendon
   * kinematics, the same inversion `segmentsFromCables` uses.
   */
  shapeFromCables(state) {
    const seg = state.seg.map((x) => ({ ...x }));
    const maxComp = this.maxCompression / N_SEGMENTS;
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const r = this.segmentFromCables(state.cables[s * 3], state.cables[s * 3 + 1], state.cables[s * 3 + 2]);
      seg[s].bend = clamp(r.bend, 0, this.maxBendPerSegment);
      seg[s].plane = wrapPi(r.plane);
      seg[s].compress = clamp(r.compress, 0, maxComp);
    }
    return seg;
  }

  /**
   * Elastic deflection of the tendon-driven shape under gravity, payload and the
   * external wrench. This is the compliance that absorbs misalignment: the
   * structure (plus the tendons, which stiffen as they are loaded) bends a
   * further M/k in the direction of the applied moment, clamped at the 45° stop.
   */
  applyLoads(kin, state, ext = emptyWrench()) {
    const seg = kin.map((x) => ({ ...x }));
    const mass = Math.max(this.cfg.payloadKg, 0);
    let frame = Transform.identity();
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const tip = this.fk(seg, state.motorAngle, state.shaftTwist).p;
      const lever = V3.sub(tip, frame.p);
      const weight = V3.new(0, -9.81 * mass, 0);
      const momentWorld = V3.add(
        V3.cross(lever, weight),
        V3.sub(ext.torque, V3.cross(ext.force, lever)),
      );
      const momentLocal = Quat.inverseRotate(frame.q, momentWorld);
      const { bend: mag, plane } = this.bendFromMoment(momentLocal);
      const tensionHere = Math.max(
        state.tension[s * 3], state.tension[s * 3 + 1], state.tension[s * 3 + 2],
      );
      const k = this.bendingStiffnessAt(tensionHere);
      const dphi = clamp(mag / Math.max(k, 1e-6), 0, this.maxBendPerSegment);
      const total = seg[s].bend + dphi;
      if (total > 1e-9 && dphi > 1e-9) {
        // blend the bending plane towards the load direction
        const cx = seg[s].bend * Math.cos(seg[s].plane) + dphi * Math.cos(plane);
        const cz = seg[s].bend * Math.sin(seg[s].plane) + dphi * Math.sin(plane);
        seg[s].plane = Math.atan2(cz, cx);
      }
      seg[s].bend = clamp(total, 0, this.maxBendPerSegment);
      frame = Transform.mul(frame, this.segmentTransform(seg[s]));
    }
    return seg;
  }

  /**
   * External-load bending stiffness contributed by the *tendon path*: the cables
   * are inextensible and the winches are screw-driven, so a load can only deflect
   * the arm by stretching the tendon (small) or back-driving the servo (tiny).
   * This is why the assembled arm is soft under tendon actuation and stiff under
   * an external push — the two stiffnesses act on different paths, and it is the
   * load path that decides how far the compliance lets the tip drift.
   */
  get winchBendingStiffness() { return 1.5 * this.cfg.winchStiffness * this.cfg.cableRadius ** 2; }

  /**
   * Tendon tensions that hold the shape: the restoring moment of every segment is
   * shared between the three cables by the cosine of their angular offset, and
   * the tendon's own elasticity (`tendonStiffness`) softens the commanded bend by
   * the elastic elongation — which is why stiffer tendons give a stiffer joint.
   */
  updateTensions(state, seg, ext = emptyWrench()) {
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const restore = bendingTorque(this.truss.cell, seg[s].bend) * 3;
      const load = V3.len(V3.add(ext.torque, V3.cross(ext.force, V3.new(0, 0.06, 0))));
      for (let c = 0; c < 3; c += 1) {
        const psi = CABLE_ANGLES[c];
        const share = Math.max(Math.cos(psi - seg[s].plane), 0.15);
        const force = (Math.max(restore, load * 0.35) * share) / (1.5 * this.cfg.cableRadius);
        const elongation = force / Math.max(this.cfg.tendonStiffness, 1);
        state.tension[s * 3 + c] = this.cfg.preload + force * (1 - 0.35 * elongation);
      }
    }
    return state.tension;
  }

  /** Deprecated alias kept for the CLI/JS parity tests: shape + loads. */
  solveBends(state, ext = emptyWrench()) {
    return this.applyLoads(this.shapeFromCables(state), state, ext);
  }

  /**
   * Quasi-static shape a *candidate* joint configuration would settle into under
   * gravity, payload and external wrench — the prediction the controller needs in
   * order to pre-compensate its own compliance.
   */
  predictLoaded(seg, state, ext = emptyWrench()) {
    return this.applyLoads(seg.map((s) => ({ ...s })), state, ext);
  }

  /**
   * Load-aware IK: iterate the kinematic solve against the predicted load
   * deflection so the *loaded* tip lands on the target.
   *
   * A tendon-driven arm with position control does exactly this — it feeds
   * forward the gravity/payload droop. What is left over is the genuine
   * compliance: an external, unmodelled wrench (a human pushing, thread reaction
   * forces, bolt/coupling reaction torques) still bends the structure, which is
   * the paper's misalignment-absorption mechanism rather than a tracking error.
   *
   * @param {object} target { p, q } desired *loaded* tool pose
   * @param {object} seedState warm-start state (previous solution)
   * @param {number} iters IK iterations per pass
   * @param {{force:object,torque:object}} ext predicted external wrench at the tool
   * @param {{passes:number,tol:number}} opts
   */
  ikCompensated(target, seedState, iters = 8, ext = emptyWrench(), { passes = 3, tol = 3e-4, axisWeight = 0.5 } = {}) {
    let bias = V3.zero();
    let seg = this.ik(target, seedState, iters, { axisWeight });
    for (let pass = 0; pass < passes; pass += 1) {
      const loaded = this.predictLoaded(seg, seedState, ext);
      const tip = this.fk(loaded, seedState.motorAngle, seedState.shaftTwist);
      const err = V3.sub(target.p, tip.p);
      if (V3.len(err) < tol) break;
      bias = V3.add(bias, err);
      seg = this.ik({ p: V3.add(target.p, bias), q: target.q }, seedState, iters, { axisWeight });
    }
    return seg;
  }


  /** Invert the stiffening torque curve: bend for a moment on stiffness `k`. */
  bendForTorqueStiffened(torque, k) {
    const kk = Math.max(k, 1e-6);
    let phi = torque / kk;
    for (let i = 0; i < 6; i += 1) {
      const t = phi / MAX_BEND_RAD;
      const f = kk * (phi + 0.45 * phi * t * t) - torque;
      const df = Math.max(kk * (1 + 1.35 * t * t), 1e-6);
      phi -= f / df;
    }
    return phi;
  }

  // -------------------------------------------------------------- actuation

  /**
   * Advance servos, tensions, structure and the torque channel.
   * @param {object} state arm state (mutated)
   * @param {number} dt seconds
   * @param {{force:object,torque:object}} ext external wrench at the tool
   * @param {{speed:number,hold:boolean}} motor motor command
   */
  step(state, dt, ext = emptyWrench(), motor = { speed: 0, hold: false }) {
    let speedSq = 0;
    const prevCmd = state.prevCableCmd;
    for (let c = 0; c < N_CABLES; c += 1) {
      const cmd = state.cableCmd[c];
      const err = cmd - state.cables[c];
      // Velocity feed-forward: the winches are commanded through a trajectory, so
      // the *setpoint rate* is known and does not have to be earned by loop error.
      // Without it a soft arm tracks its own cable command with a lag of
      // v/bandwidth, which is metres of tip error per millimetre of lag.
      const vf = prevCmd ? clamp((cmd - prevCmd[c]) / Math.max(dt, 1e-6), -this.cfg.servoSpeed, this.cfg.servoSpeed) : 0;
      const v = clamp(err * this.cfg.servoBandwidth + vf, -this.cfg.servoSpeed, this.cfg.servoSpeed);
      state.cables[c] += v * dt;
      speedSq += v * v;
      // tension is *not* computed here: it follows from the shape the tendons
      // hold (`updateTensions`), once the quasi-static solve has run below.
    }
    state.cableSpeed = Math.sqrt(speedSq / N_CABLES);
    state.prevCableCmd = state.cableCmd.slice();

    const prevSeg = state.seg;
    const seg = this.applyLoads(this.shapeFromCables(state), state, ext);
    // history-dependent hysteresis (reproduces the paper's repeatability numbers)
    if (this.cfg.hysteresis > 0) {
      const dead = hysteresisDeadband();
      for (let s = 0; s < N_SEGMENTS; s += 1) {
        const d = seg[s].bend - prevSeg[s].bend;
        let h = prevSeg[s].hysteresis;
        if (Math.abs(d) > dead) h = lerp(h, sign(d), Math.min(Math.abs(d) / dead - 1, 1) * 0.8);
        seg[s].hysteresis = clamp(h, -1, 1);
      }
    } else {
      for (let s = 0; s < N_SEGMENTS; s += 1) seg[s].hysteresis = prevSeg[s].hysteresis;
    }
    state.seg = seg;
    this.updateTensions(state, seg, ext);
    state.atLimit = seg.some((s) => s.bend >= MAX_BEND_RAD - 1e-4);
    state.compression = this.compressionOf(seg);

    // ---- torque channel (continuous rotation while bent) -------------------
    let rpmRef = motor.speed * 9.549297;
    if (Math.abs(rpmRef) < 1e-3) rpmRef = motor.hold ? 1 : 0;
    const eff = efficiency(this.truss.cell, seg.reduce((a, s) => a + s.bend, 0) / N_SEGMENTS, rpmRef);
    let torque;
    if (motor.hold) {
      torque = clamp(-V3.dot(ext.torque, V3.up()), -this.cfg.motorTorque, this.cfg.motorTorque);
      state.motorSpeed *= 0.55;
    } else {
      const err = motor.speed - state.motorSpeed;
      torque = clamp(err * this.cfg.motorGain, -this.cfg.motorTorque, this.cfg.motorTorque);
      state.motorSpeed = approach(state.motorSpeed, motor.speed, this.cfg.motorSpeed * dt * 6);
    }
    state.motorAngle += state.motorSpeed * dt;
    state.toolTorque = torque * eff;

    const bendAvg = seg.reduce((a, s) => a + Math.abs(s.bend), 0) / N_SEGMENTS;
    const kt = torsionalStiffnessAtBend(this.truss.cell, bendAvg) / Math.max(this.cfg.compliance, 0.05);
    state.shaftTwist = twistForTorque(this.truss.cell, ((state.toolTorque / Math.max(kt, 1e-6)) * 0.35) / 3);
    const cross = crossCoupling(this.truss.cell, bendAvg) * 0.5 * this.cfg.compliance;
    const motorEffective = state.motorAngle - state.shaftTwist - cross * Math.tanh(state.motorAngle);
    state.tool = this.fk(seg, motorEffective, 0);
    return state;
  }

  /** Tool pose as measured (hysteresis + encoder noise) — the IK net's training target. */
  measuredPose(state, rng) {
    const seg = state.seg.map((s) => ({ ...s }));
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const h = seg[s].hysteresis * this.cfg.hysteresis * deg(0.35);
      seg[s].bend = clamp(seg[s].bend + h, -ANGULAR_LIMIT_HARD, ANGULAR_LIMIT_HARD);
    }
    const t = this.fk(seg, state.motorAngle, state.shaftTwist);
    const n = this.cfg.sensorNoise;
    return { q: t.q, p: V3.add(t.p, V3.new(rng.normal() * n, rng.normal() * n, rng.normal() * n)) };
  }

  measuredCables(state, rng) {
    return state.cables.map((c) => c + rng.normal() * this.cfg.sensorNoise);
  }

  // ----------------------------------------------------------------- inverse

  /**
   * Inverse kinematics over the nine tendon DOFs (per segment: bend, plane,
   * compression).
   *
   * Two stages, because continuum IK has two failure modes:
   *
   *  1. **CCD warm-up** — for each segment, aim it at the target in the plane
   *     containing its current tangent, respecting the 45° joint stop. This is
   *     the classic cyclic-coordinate-descent step and it is immune to the
   *     straight-arm singularity (the bending plane is undefined when straight)
   *     and to local minima of a pure Gauss-Newton iteration.
   *  2. **Levenberg–Marquardt polish** — damped least squares on the stacked
   *     residual (tool position + truss-axis direction), with column scaling so
   *     radian DOFs and metre DOFs are commensurate, and a backtracking line
   *     search that keeps the cost monotone.
   *
   * The seed state matters: callers pass the previous configuration to get
   * continuous, repeatable motion (this is what reproduces the paper's 0.4 mm
   * trajectory repeatability).
   */
  ik(target, seedState, iters = 24, {
    axisWeight = 0.3, tol = 1e-4, compressWeight = 0.5,
    wrinkleWeight = 0.35, stopWeight = 0.25,
  } = {}) {
    const targetP = target.p;
    const axis = V3.norm(Transform.up(target));
    const nParam = 9;   // bend/plane/squash per segment
    const nRes = 14;    // + squash preference (3) + smooth-arc (2) + soft stop (3)
    const maxComp = this.maxCompression / N_SEGMENTS;
    const seg = seedState.seg.map((x) => ({ ...x }));
    const clampSeg = (s) => {
      s.bend = clamp(s.bend, 0, this.maxBendPerSegment);
      s.plane = wrapPi(s.plane);
      s.compress = clamp(s.compress, 0, maxComp);
    };
    seg.forEach(clampSeg);
    const frameBefore = (k) => {
      let t = Transform.identity();
      for (let i = 0; i < k; i += 1) t = Transform.mul(t, this.segmentTransform(seg[i]));
      return t;
    };
    const residual = (x) => {
      const t = this.fk(x, seedState.motorAngle, seedState.shaftTwist);
      const dp = V3.sub(targetP, t.p);
      const ta = Transform.up(t);
      const sgn = V3.dot(ta, axis) >= 0 ? 1 : -1;
      const eo = V3.cross(V3.scale(ta, sgn), axis);
      // Squash preference: axial shortening is the *compliant* DOF, so the solver
      // only spends it when bending cannot reach — this is what keeps the arm
      // visibly bending (and the truss torque channel in play) on every task.
      // A printed continuum segment cannot twist its bending plane arbitrarily
      // between neighbours: mirroring the plane 180° gives an S-shaped arm that is
      // (a) not buildable from the cell chain and (b) a kinematic singularity
      // where a 0.5 mm target step throws the tip 100 mm. Penalising the wrinkle
      // keeps the solver on smooth arcs, and the soft stop keeps it off the 45°
      // hard limit, which is the other degeneracy.
      const a = V3.new(x[0].bend, x[1].bend, x[2].bend);
      const wrinkle = Math.sqrt(Math.max(a.x * a.y, 0)) * (1 - Math.cos(x[0].plane - x[1].plane));
      const wrinkle2 = Math.sqrt(Math.max(a.y * a.z, 0)) * (1 - Math.cos(x[1].plane - x[2].plane));
      const stop = this.maxBendPerSegment * 0.94;
      const over = (b) => Math.max(0, b - stop) * 4;
      return [
        dp.x, dp.y, dp.z,
        eo.x * axisWeight, eo.y * axisWeight, eo.z * axisWeight,
        -compressWeight * x[0].compress, -compressWeight * x[1].compress, -compressWeight * x[2].compress,
        -wrinkleWeight * wrinkle, -wrinkleWeight * wrinkle2,
        -stopWeight * over(x[0].bend), -stopWeight * over(x[1].bend), -stopWeight * over(x[2].bend),
      ];
    };
    const cost = (x) => { const r = residual(x); let a = 0; for (let i = 0; i < nRes; i += 1) a += r[i] * r[i]; return a; };

    // ---------------------------------------------------------- stage 1: CCD
    const sweeps = clamp(Math.round(iters / 4), 3, 14);
    let best = seg.map((x) => ({ ...x }));
    let bestCost = cost(best);
    for (let sweep = 0; sweep < sweeps; sweep += 1) {
      for (let si = 0; si < N_SEGMENTS; si += 1) {
        const frame = frameBefore(si);
        const origin = frame.p;
        const tangent = Quat.rotate(frame.q, V3.up());
        const toTarget = V3.sub(targetP, origin);
        const dist = V3.len(toTarget);
        if (dist < 1e-9) continue;
        const dir = V3.scale(toTarget, 1 / dist);
        const cosA = clamp(V3.dot(tangent, dir), -1, 1);
        const angle = Math.acos(cosA);
        // desired bending direction: the component of (dir − tangent) in the local frame
        const lean = V3.sub(dir, V3.scale(tangent, cosA));
        const leanLen = V3.len(lean);
        seg[si].bend = clamp(angle, 0, this.maxBendPerSegment);
        if (leanLen > 1e-9) {
          const dLocal = Quat.inverseRotate(frame.q, V3.scale(lean, 1 / leanLen));
          seg[si].plane = Math.atan2(dLocal.z, dLocal.x);
        }
      }
      const c = cost(seg);
      if (c < bestCost) { bestCost = c; best = seg.map((x) => ({ ...x })); }
      if (bestCost < tol * tol) break;
    }
    for (let si = 0; si < N_SEGMENTS; si += 1) { seg[si] = { ...best[si] }; }

    // ------------------------------------------- stage 2: LM polish
    const h = 1e-4;
    const dscale = [0.3, 0.6, 0.3, 0.6, 0.3, 0.6, maxComp, maxComp, maxComp];
    let lambda = 1e-2;
    let cur = bestCost;
    for (let it = 0; it < iters && cur > tol * tol; it += 1) {
      const base = residual(seg);
      const J = [];
      for (let r = 0; r < nRes; r += 1) J.push(new Array(nParam).fill(0));
      for (let d = 0; d < nParam; d += 1) {
        const probe = seg.map((x) => ({ ...x }));
        const si = d >> 1;
        if (d >= 6) probe[d - 6].compress += h;
        else if (d % 2 === 0) probe[si].bend += h;
        else probe[si].plane += h;
        const rp = residual(probe);
        for (let r = 0; r < nRes; r += 1) J[r][d] = ((rp[r] - base[r]) / h) * dscale[d];
      }
      const A = [];
      for (let r = 0; r < nParam; r += 1) {
        A.push(new Array(nParam + 1).fill(0));
        for (let c = 0; c < nParam; c += 1) {
          let acc = 0;
          for (let k = 0; k < nRes; k += 1) acc += J[k][r] * J[k][c];
          if (r === c) acc += lambda * Math.abs(acc) + 1e-10;
          A[r][c] = acc;
        }
        let b = 0;
        for (let k = 0; k < nRes; k += 1) b += J[k][r] * base[k];
        A[r][nParam] = -b; // residual is (target − current) → (JᵀJ)Δ = −Jᵀr
      }
      let ok = true;
      for (let col = 0; col < nParam; col += 1) {
        let piv = col;
        for (let r = col + 1; r < nParam; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
        if (Math.abs(A[piv][col]) < 1e-12) { ok = false; break; }
        const tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
        const d0 = A[col][col];
        for (let c = col; c <= nParam; c += 1) A[col][c] /= d0;
        for (let r = 0; r < nParam; r += 1) {
          if (r === col) continue;
          const f = A[r][col];
          if (f !== 0) for (let c = col; c <= nParam; c += 1) A[r][c] -= f * A[col][c];
        }
      }
      if (!ok) { lambda *= 4; continue; }
      const step = new Array(nParam).fill(0);
      for (let d = 0; d < nParam; d += 1) step[d] = A[d][nParam] * dscale[d];
      let accepted = false;
      for (let ls = 0; ls < 7; ls += 1) {
        const scale = 0.45 ** ls;
        const trial = seg.map((x, si) => ({
          bend: seg[si].bend + step[si * 2] * scale,
          plane: seg[si].plane + step[si * 2 + 1] * scale,
          compress: seg[si].compress + step[6 + si] * scale,
        }));
        trial.forEach(clampSeg);
        const c = cost(trial);
        if (c < cur) {
          for (let si2 = 0; si2 < N_SEGMENTS; si2 += 1) seg[si2] = { ...trial[si2] };
          cur = c;
          if (cur < bestCost) { bestCost = cur; best = seg.map((x) => ({ ...x })); }
          lambda = Math.max(lambda * 0.5, 1e-7);
          accepted = true;
          break;
        }
        lambda = Math.min(lambda * 6, 50);
      }
      if (!accepted && lambda >= 50) break;
    }
    for (let si = 0; si < N_SEGMENTS; si += 1) { seg[si] = { ...best[si] }; }
    seg.reset = null;
    return seg;
  }

  // --------------------------------------------------------------- workspace

  /** Sample reachable tool positions (paper: 18 300 sampled poses). */
  workspaceCloud(n, seed = 42) {
    const rng = new Rng(seed);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const c = rng.nextF32() ** 1.7 * this.maxCompression;
      const seg = [];
      for (let s = 0; s < N_SEGMENTS; s += 1) {
        seg.push(segmentState(rng.nextF32() * MAX_BEND_RAD, rng.range(-Math.PI, Math.PI), c / 3));
      }
      const p = this.fk(seg).p;
      out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z;
    }
    return out;
  }

  /** Random reachable poses ordered by a greedy nearest-neighbour tour. */
  planTrajectory(n, seed = 7) {
    const rng = new Rng(seed);
    const poses = [];
    for (let i = 0; i < n * 3 && poses.length < n; i += 1) {
      const seg = [];
      for (let s = 0; s < N_SEGMENTS; s += 1) seg.push(segmentState(rng.range(deg(5), deg(40)), rng.range(-Math.PI, Math.PI), 0));
      const t = this.fk(seg);
      const r = V3.len(t.p);
      if (r > 0.25 && r < this.totalLength) poses.push(t);
    }
    return greedyTour(poses);
  }

  /**
   * Reproduce the paper's repeatability experiment (point vs trajectory order) and
   * return the residual standard deviations.
   */
  repeatabilityStudy(n, trials, ordered, seed = 11) {
    const rng = new Rng(seed);
    const poses = this.planTrajectory(n, seed);
    if (!ordered) {
      for (let i = poses.length - 1; i > 0; i -= 1) {
        const j = rng.pick(i + 1);
        const tmp = poses[i]; poses[i] = poses[j]; poses[j] = tmp;
      }
    }
    const count = poses.length;
    const samples = Array.from({ length: count }, () => []);
    for (let trial = 0; trial < trials; trial += 1) {
      const state = homeState();
      let seg = [segmentState(), segmentState(), segmentState()];
      for (let i = 0; i < count; i += 1) {
        const solved = this.ik(poses[i], { ...state, seg }, 12);
        for (let s = 0; s < N_SEGMENTS; s += 1) {
          const d = solved[s].bend - seg[s].bend;
          const dead = hysteresisDeadband();
          if (Math.abs(d) > dead) seg[s].hysteresis = clamp(lerp(seg[s].hysteresis, sign(d), 0.6), -1, 1);
          const h = seg[s].hysteresis * this.cfg.hysteresis * deg(0.35);
          seg[s] = segmentState(clamp(solved[s].bend + h, 0, MAX_BEND_RAD), solved[s].plane, solved[s].compress);
        }
        const t = this.fk(seg);
        samples[i].push({ p: t.p, a: Transform.up(t) });
      }
    }
    let posVar = 0;
    let angVar = 0;
    let m = 0;
    for (const s of samples) {
      let mp = V3.zero();
      let ma = V3.zero();
      for (const { p, a } of s) { mp = V3.add(mp, p); ma = V3.add(ma, a); }
      mp = V3.scale(mp, 1 / Math.max(s.length, 1));
      ma = V3.scale(ma, 1 / Math.max(s.length, 1));
      for (const { p, a } of s) {
        posVar += V3.dist(p, mp) ** 2;
        angVar += V3.dist(a, ma) ** 2;
        m += 1;
      }
    }
    return {
      points: count,
      trials,
      posSdMm: Math.sqrt(posVar / Math.max(m, 1)) * 1000,
      angSdDeg: (Math.sqrt(angVar / Math.max(m, 1)) * 180) / Math.PI,
      trajectoryOrder: ordered,
    };
  }

  // --------------------------------------------------------------- rendering

  /**
   * Per-cell transforms for the instanced renderer.
   *
   * The printed cell is ~79 mm, so each segment is three cells. Each cell walks
   * the *cell* chord (hence the `lenOverride`); walking whole-segment chords was
   * making the drawn arm three times too long — a genuine, visible bug: the
   * drawn chain ended at y = 1.70 m while the tool was at y = 0.59 m.
   */
  bones(state) {
    const cells = Math.max(this.cfg.cellsPerSegment, 1);
    const out = [];
    let frame = Transform.identity();
    const spin = state.motorAngle - state.shaftTwist;
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const seg = state.seg[s];
      // uniform split, matching `fk`: a circular arc's sub-chords compose to the
      // same end pose, so the drawn arm cannot drift off the kinematic tool
      const cellBend = seg.bend / cells;
      const cellLen = Math.max((this.cfg.segmentLength - seg.compress) / cells, 0.002);
      for (let c = 0; c < cells; c += 1) {
        const frac = (s * cells + c + 0.5) / (cells * N_SEGMENTS);
        const twist = spin * frac;
        const mid = Transform.mul(frame, { p: V3.new(0, cellLen * 0.5, 0), q: Quat.identity() });
        const axis = V3.new(Math.sin(seg.plane), 0, -Math.cos(seg.plane));
        const q = Quat.mul(Quat.mul(frame.q, Quat.fromAxisAngle(axis, cellBend * 0.5)), Quat.fromAxisAngle(V3.up(), twist - state.shaftTwist * frac));
        out.push({
          transform: { p: mid.p, q },
          kind: c === 0 && s === 0 ? 0 : 1,
          length: cellLen,
          radius: this.cfg.cellRadius,
          segment: s,
          active: true,
        });
        frame = Transform.mul(frame, this.segmentTransform(segmentState(cellBend, seg.plane, 0), cellLen));
      }
    }
    const t = this.fk(state.seg, 0, 0);
    out.push({ transform: { p: t.p, q: t.q }, kind: 0, length: 0.018, radius: this.cfg.cellRadius * 0.86, segment: 2, active: false });
    return out;
  }

  /**
   * Tendon polylines in world space.
   *
   * A tendon runs on the cell surface at `cableRadius` from the spine, from the
   * base to the ring where it is anchored (the end of its own segment). The spine
   * is walked cell by cell — the same walk `bones()` uses — so the drawn tendon
   * cannot drift away from the drawn arm.
   */
  cablePaths(state) {
    const out = [];
    const cells = Math.max(this.cfg.cellsPerSegment, 1);
    // world spine samples: [0] = base, then one per cell
    const spine = [Transform.identity()];
    for (let s = 0; s < N_SEGMENTS; s += 1) {
      const seg = state.seg[s];
      const cellBend = seg.bend / cells;
      const cellLen = Math.max((this.cfg.segmentLength - seg.compress) / cells, 0.002);
      for (let c = 0; c < cells; c += 1) {
        spine.push(Transform.mul(spine[spine.length - 1], this.segmentTransform(segmentState(cellBend, seg.plane, 0), cellLen)));
      }
    }
    for (let c = 0; c < N_CABLES; c += 1) {
      const psi = CABLE_ANGLES[c % 3];
      const segIdx = Math.floor(c / 3);
      const off = V3.new(this.cfg.cableRadius * Math.cos(psi), 0, this.cfg.cableRadius * Math.sin(psi));
      const points = [];
      const last = Math.min((segIdx + 1) * cells, spine.length - 1);
      for (let i = 0; i <= last; i += 1) points.push(Transform.apply(spine[i], off));
      out.push({ points, tension: state.tension[c], cable: c, segment: segIdx });
    }
    return out;
  }
}

/** Greedy nearest-neighbour tour (paper's KNN-TSP ordering). */
export function greedyTour(poses) {
  if (poses.length < 3) return poses.slice();
  const used = new Array(poses.length).fill(false);
  const ordered = [];
  let idx = 0;
  used[0] = true;
  ordered.push(poses[0]);
  for (let k = 1; k < poses.length; k += 1) {
    const cur = poses[idx].p;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < poses.length; j += 1) {
      if (used[j]) continue;
      const d = V3.dist(poses[j].p, cur);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best < 0) break;
    used[best] = true;
    ordered.push(poses[best]);
    idx = best;
  }
  return ordered;
}

export function poseError(current, target) {
  const dp = V3.sub(target.p, current.p);
  const dq = Quat.mul(Quat.conj(current.q), target.q);
  return { dp, axis: V3.scale(V3.new(dq.x, dq.y, dq.z), 2) };
}
