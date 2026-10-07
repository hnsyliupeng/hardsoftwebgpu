/**
 * matlabPort.js — the MATLAB port as application state.
 *
 * Both front ends import this one module, so the CPU page and the WebGPU page
 * run exactly the same simulation:
 *
 *   * `MatlabPort` drives `ArmAnimation` from `ts/sim` — the ported replay loop
 *     with its servo rate limit, pauses, motor pulses and 15-sample pose
 *     average — and hands the renderers geometry in **app metres**: spine
 *     samples, truss cells, equatorial guide rings, the nine tendons and the
 *     tool, plus the track the tool has left behind.
 *   * `verifyPort()` walks the ported modules one by one and returns a table of
 *     numbers, so "check all functions" is a button rather than a claim.
 *
 * The module is DOM-free, network-free and dependency-free: the same code runs
 * in the browser, in Node, and inside the single-file builds.
 */
import {
  TRUNC, segmentTransform, cornersOf, cableTriangle, forward, homeState, sweepConfigurations,
} from '../../js/trunc/kinematics.js';
import {
  mul, identity, apply, rotX, rotY, rotZ, rotm2quat, quat2rotm, quatMul, quatConj, quatNorm,
  wrapTo180, findPeaks, makeRng, DEG, RAD,
} from '../../js/trunc/math.js';

// Careful: the port's names are the other way round from the usual convention —
// `DEG` is the size of a degree in radians (π/180) and `RAD` the size of a
// radian in degrees (180/π). These aliases say what is meant.
const toRad = DEG;   // degrees → radians
const toDeg = RAD;   // radians → degrees
import { TASKS, HOME_POS, taskSummary, taskWaypoints } from '../../js/trunc/trajectories.js';
import { interpWaypoints } from '../../js/trunc/interp.js';
import { RobotArm, LoopbackLink } from '../../js/trunc/robotArm.js';
import { ArmMotor, MockMotorLink } from '../../js/trunc/armMotor.js';
import { HOME, SERVO_LIMITS, compressionVector, clampCompression, compressionToLength } from '../../js/trunc/setup.js';
import { splitTrials, efficiency, decodeCvTrace, cvAmplitude, normaliseQuaternions } from '../../js/trunc/analysis.js';
import {
  TASK_HOMES, DEFAULT_HOME, homeFor, robotWaypoints, robotToApp, toRobot, REACH,
  taskExtent, MATLAB_TO_ROBOT, APP_CHAIN_AXIS,
} from '../../js/sim/placement.js';
import { ArmAnimation, HOME_CABLES } from '../../js/sim/animation.js';
import { Solver, DEFAULT_LIMITS, reach, bendOf } from '../../js/sim/solver.js';

// ------------------------------------------------------------------ metadata
export const PORT_TASKS = [
  { id: 'circle', label: 'circle', note: '90 mm circle, 20 traced waypoints (100 densified)' },
  { id: 'triangle', label: 'triangle', note: '80 mm triangle on a 60° table' },
  { id: 'steps', label: 'steps', note: '3 × 160/3 mm climb with 25 mm risers' },
  { id: 'motherboard', label: 'motherboard', note: '2 holes, 10.5 s of tool motor each' },
  { id: 'bulb', label: 'bulb', note: 'into the socket, 3.5 s of tool motor' },
];

/** `AnimationOptions` defaults, exposed so the GUI is honest about them. */
export const DEFAULT_PARAMS = {
  dt: 1 / 60,
  pauseLength: 0.5,
  operatorWait: 0.2,
  servoRate: 900,
  tolerance: 1.5,
  samples: 15,
  ikIters: 20,
  axisWeight: 0,
  waypointTimeout: 3,
  seed: 7,
};

export const PARAM_SPECS = [
  { key: 'dt', label: 'timestep', min: 1 / 240, max: 1 / 20, step: 1 / 240, unit: ' s', digits: 4 },
  { key: 'servoRate', label: 'servo rate', min: 60, max: 3000, step: 10, unit: ' cnt/s', digits: 0 },
  { key: 'tolerance', label: 'arrival band', min: 0.1, max: 10, step: 0.1, unit: ' mm', digits: 1 },
  { key: 'pauseLength', label: 'waypoint pause', min: 0, max: 2, step: 0.05, unit: ' s', digits: 2 },
  { key: 'ikIters', label: 'IK iterations', min: 4, max: 60, step: 1, digits: 0 },
  { key: 'samples', label: 'pose average', min: 1, max: 30, step: 1, unit: ' frames', digits: 0 },
  { key: 'axisWeight', label: 'axis hold', min: 0, max: 1, step: 0.05, digits: 2 },
  { key: 'waypointTimeout', label: 'waypoint timeout', min: 0.5, max: 10, step: 0.5, unit: ' s', digits: 1 },
  { key: 'seed', label: 'solver seed', min: 1, max: 64, step: 1, digits: 0 },
];

/** The MATLAB's cable-triangle radius (65 mm) — the ring the nine tendons ride. */
export const CABLE_RING_M = TRUNC.cableRadius / 1000;

const SPINE_N = 13;        // samples per segment when drawing the arc
const CELL_L = 0.0789;     // one printed truss cell, m (the mesh the GPU scene uses)

const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => { const n = vlen(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const pos4 = (T) => [T[12], T[13], T[14]];

/** mm in the robot frame → metres in the app frame (+Y up). */
export const mm2app = (p) => vmul(robotToApp(p), 0.001);

/**
 * Walk the ported segment transforms and collect everything a renderer needs.
 * Sampling *inside* a segment multiplies the accumulated frame by a partial
 * `Segment_transform`, so the drawn arc is the model's own constant-curvature
 * curve rather than an interpolation between joint centres.
 */
export function portGeometry(state, cableRing = CABLE_RING_M) {
  const lens = TRUNC.split.map((f) => f * state.L);
  const joints = [[state.t1, state.t2], [state.t3, state.t4], [state.t5, state.t6]];
  const arcs = [];
  const interfaces = [];      // the four module interfaces, for the guide rings
  const tendons = [0, 1, 2].map(() => [[], [], []]);   // [module][cable] → polyline
  let T = identity();

  for (let s = 0; s < 3; s += 1) {
    interfaces.push({ p: mm2app(pos4(T)), T });
    const [a, b] = joints[s];
    const arc = [];
    for (let i = 0; i <= SPINE_N; i += 1) {
      const Ti = mul(T, segmentTransform(a, b, -lens[s] * (i / SPINE_N)));
      arc.push(mm2app(pos4(Ti)));
      const corners = cornersOf(Ti, cableRing);
      for (let k = 0; k < 3; k += 1) tendons[s][k].push(mm2app(corners[k]));
    }
    T = mul(T, segmentTransform(a, b, -lens[s]));
    arcs.push(arc);
  }
  const wrist = mm2app(pos4(T));
  interfaces.push({ p: wrist, T });

  // the guide rings sit at the interfaces; their axis is the local tangent
  const guides = interfaces.map((it, i) => {
    const seg = arcs[Math.min(2, i)];
    const other = arcs[Math.max(0, i - 1)];
    const dir = i === 0
      ? vnorm(vsub(seg[1], seg[0]))
      : vnorm(vsub(it.p, other[other.length - 2]));
    return { p: it.p, dir, r: cableRing };
  });

  // truss cells, at their own pitch along each arc, stretched to fit exactly
  const cells = [];
  for (const arc of arcs) {
    let len = 0;
    for (let i = 1; i < arc.length; i += 1) len += vlen(vsub(arc[i], arc[i - 1]));
    const n = Math.max(1, Math.round((len * 1000) / (CELL_L * 1000)));
    const scale = len / (n * CELL_L);
    for (let j = 0; j < n; j += 1) {
      const t = (j + 0.5) / n;
      const i = Math.min(arc.length - 2, Math.max(1, Math.round(t * (arc.length - 1))));
      cells.push({
        p: arc[i],
        dir: vnorm(vsub(arc[i + 1], arc[i - 1])),
        scale,
        kind: 0,
      });
    }
  }

  const toolTip = mm2app(apply(mul(T, segmentTransform(0, 0, -state.toolLength)), [0, 0, 0]));
  return {
    spine: arcs.flat(),
    arcs,
    cells,
    guides,
    tendons,
    toolBase: wrist,
    tip: toolTip,
    toolDir: vnorm(vsub(toolTip, wrist)),
    cableRing,
    jointCentres: interfaces.map((it) => it.p),
  };
}

// ------------------------------------------------------------------ the plant
export class MatlabPort {
  constructor({ task = 'circle', home = null, params = {}, cableRing = CABLE_RING_M } = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.cableRing = cableRing;
    this.task = task;
    this.home = (home ?? homeFor(task)).slice();
    this.restart();
  }

  /** Switch task (optionally re-placing it) and start over. */
  select(task, home = null) {
    this.task = task;
    this.home = (home ?? homeFor(task)).slice();
    this.restart();
  }

  /** Any `AnimationOptions` change restarts the replay, as changing a slider should. */
  setParams(patch) {
    this.params = { ...this.params, ...patch };
    this.restart();
  }

  restart() {
    this.anim = new ArmAnimation({ task: this.task, home: this.home, ...this.params });
    this.frame = null;
    this.trail = [];
    this.errors = [];
    this.pulses = [];
    this.steps = 0;
    this.cache = null;
  }

  /** Advance the replay. Returns the newest frame. */
  step(n = 1) {
    let frame = this.frame;
    for (let i = 0; i < n; i += 1) {
      if (this.anim.done) break;
      frame = this.anim.step();
      this.frame = frame;
      this.steps += 1;
      this.trail.push(mm2app(frame.ee));
      if (this.trail.length > 5000) this.trail.shift();
      this.errors.push(frame.err);
      if (this.errors.length > 5000) this.errors.shift();
      if (frame.motorOn) {
        const last = this.pulses[this.pulses.length - 1];
        if (!last || !last.open) this.pulses.push({ open: true, start: frame.time, seconds: 0 });
      } else if (this.pulses.length && this.pulses[this.pulses.length - 1].open) {
        const last = this.pulses[this.pulses.length - 1];
        last.open = false;
        last.seconds = frame.time - last.start;
      }
      this.cache = null;
    }
    return frame;
  }

  /** Run to the end of the trajectory (used by the GIF export and the checks). */
  runToEnd(maxFrames = 120000) {
    while (!this.anim.done && this.steps < maxFrames) this.step(1);
    return this.summary();
  }

  summary() {
    if (this.cache && this.anim.done) return this.cache;
    if (!this.anim.done) return null;
    this.cache = this.anim.run(200000);
    return this.cache;
  }

  /** The commanded tool path in app metres. */
  trajectory() {
    return robotWaypoints(this.task, this.home).map(mm2app);
  }

  /** Everything the renderers need for the current frame. */
  geometry() {
    const f = this.ensureFrame();
    const g = portGeometry(f.state, this.cableRing);
    return {
      ...g,
      target: mm2app(f.target),
      ee: mm2app(f.ee),
      motorOn: f.motorOn,
      phase: f.phase,
    };
  }

  ensureFrame() {
    if (!this.frame) this.step(1);
    return this.frame;
  }

  /** Progress through the waypoint list, 0..1. */
  progress() {
    const f = this.ensureFrame();
    return {
      waypoint: f.waypoint,
      waypointCount: this.anim.waypoints.length,
      fraction: (f.waypoint + 1) / Math.max(1, this.anim.waypoints.length),
    };
  }

  extent() {
    return taskExtent(this.task, this.home);
  }

  /** The port's own joint / cable numbers, formatted for a HUD. */
  readouts() {
    const f = this.ensureFrame();
    const s = f.state;
    const bend = [s.t1, s.t3, s.t5].map((v) => v * toDeg);
    const plane = [s.t2, s.t4, s.t6].map((v) => v * toDeg);
    return [
      ['phase', f.phase],
      ['time', `${f.time.toFixed(1)} s`],
      ['waypoint', `${f.waypoint + 1}/${this.anim.waypoints.length}`],
      ['error', `${f.err.toFixed(2)} mm`],
      ['settled', `${(f.err <= this.params.tolerance ? f.err : 0).toFixed(2)} mm`],
      ['tool', f.ee.map((v) => v.toFixed(0)).join(', ')],
      ['target', f.target.map((v) => v.toFixed(0)).join(', ')],
      ['bend', bend.map((v) => v.toFixed(1)).join('/') + '°'],
      ['plane', plane.map((v) => v.toFixed(1)).join('/') + '°'],
      ['L', `${s.L.toFixed(1)} mm`],
      ['bend sum', `${bend.reduce((a, b) => a + Math.abs(b), 0).toFixed(1)}°`],
      ['motor', f.motorOn ? `on ${f.motorRemaining.toFixed(1)} s` : 'off'],
      ['cable travel', `${this.anim.cableTravel.reduce((a, b) => a + b, 0).toFixed(0)} mm`],
      ['axis error', `${f.axisError.toFixed(1)}°`],
    ];
  }

  /** Cable deltas (mm) as signed bars, module-major. */
  cableBars() {
    const f = this.ensureFrame();
    return f.cableDelta.slice();
  }
}

// -------------------------------------------------------------- verification
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const ok = (cond, detail) => ({ ok: !!cond, detail });

/**
 * Exercise every ported module and report the numbers. `onStep` is called with
 * (index, total, label) so a GUI can show progress.
 */
export async function verifyPort(onStep = () => {}) {
  const rows = [];
  const add = (group, name, res, expected = '') => {
    rows.push({ group, name, ...res, expected });
  };
  let i = 0;
  const T = 22;
  const tick = async (label) => {
    i += 1;
    onStep(i, T, label);
    await new Promise((r) => setTimeout(r, 0));   // let the page paint
  };

  // ---- math -------------------------------------------------------------
  await tick('math: wrapTo180 / quaternions / peaks / rng');
  add('math', 'wrapTo180(190) = -170', (() => {
    const v = wrapTo180(190);
    return ok(near(v, -170, 1e-9), `${v.toFixed(6)}°`);
  })());
  add('math', 'rotm2quat → quat2rotm is the identity', (() => {
    const R = mul(rotZ(0.7), rotX(-0.4));
    const q = rotm2quat(R);
    const back = quat2rotm(q);
    let worst = 0;
    for (let k = 0; k < 16; k += 1) worst = Math.max(worst, Math.abs(back[k] - R[k]));
    return ok(worst < 1e-12, `|q| = ${Math.hypot(...q).toFixed(9)}, worst |ΔR| = ${worst.toExponential(2)}`);
  })());
  add('math', 'quatMul / quatConj invert each other', (() => {
    const q = rotm2quat(quat2rotm([0.5, 0.5, 0.5, 0.5]));
    const one = quatMul(q, quatConj(q));
    return ok(near(one[0], 1, 1e-9), `qw = ${one[0].toFixed(9)}`);
  })());
  add('math', 'findPeaks (MATLAB parity)', (() => {
    const x = [0, 1, 0, -1, 0, 2, 0, 1, 0];
    const { pks, locs } = findPeaks(x);
    return ok(pks.length === 3 && locs[1] === 5 && near(pks[1], 2, 1e-12),
      `${pks.length} peaks at [${locs}] = [${pks}]`);
  })());
  add('math', 'makeRng(8) is reproducible', (() => {
    const a = makeRng(8); const b = makeRng(8);
    const seq = (r) => [r(), r(), r()];
    const q = seq(a); const w = seq(b);
    return ok(q.every((v, k) => v === w[k]), `first = ${q[0].toFixed(9)}`);
  })());

  // ---- kinematics -------------------------------------------------------
  await tick('kinematics: FK anchors, cables, limits');
  add('kinematics', 'home pose tool = (0, 0, -778) mm', (() => {
    const p = forward(homeState()).position;
    const good = near(p[0], 0, 1e-9) && near(p[1], 0, 1e-9) && near(p[2], -778, 1e-9);
    return ok(good, `tool at [${p.map((v) => v.toFixed(3))}] mm, |tool| = ${Math.hypot(...p).toFixed(3)} mm`);
  })());
  add('kinematics', 'segment split 3/7 : 2/7 : 2/7 of L = 695', (() => {
    const lens = TRUNC.split.map((f) => f * TRUNC.length);
    const good = near(lens[0], 297.857, 1e-3) && near(lens[1], 198.571, 1e-3) && near(lens[2], 198.571, 1e-3);
    return ok(good, `${lens.map((v) => v.toFixed(3)).join(' / ')} mm`);
  })());
  add('kinematics', 'straight-arm cable lengths', (() => {
    const c = forward(homeState()).cables;
    const good = near(c[0], 198.571, 1e-3) && near(c[1], 198.571, 1e-3) && near(c[2], 297.857, 1e-3)
      && near(c[6], 198.571, 1e-3) && near(c[8], 297.857, 1e-3);
    return ok(good, `[w,e,s] module 1 = ${c[0].toFixed(3)} / ${c[1].toFixed(3)} / ${c[2].toFixed(3)} mm`);
  })());
  add('kinematics', '30/30/30° bend matches the MATLAB', (() => {
    const s = homeState({ t1: 30 * toRad, t3: 30 * toRad, t5: 30 * toRad });
    const p = forward(s).position;
    const good = near(p[1], 354.2536, 0.02) && near(p[2], -569.1108, 0.02);
    return ok(good, `y = ${p[1].toFixed(4)} (hand-computed 354.2536), z = ${p[2].toFixed(4)} (expect -569.1108)`);
  })());
  add('kinematics', 'cable triangle radius 65 mm, 120° apart', (() => {
    const c = cornersOf(identity(), TRUNC.cableRadius);
    const r = c.map((p) => Math.hypot(p[0], p[1], p[2]));
    const ang = Math.atan2(c[0][1], c[0][0]) * RAD;
    const gap = Math.atan2(c[1][1], c[1][0]) * RAD - ang;
    return ok(r.every((v) => near(v, 65, 1e-9)) && near(Math.abs(gap), 120, 1e-9),
      `r = ${r[0].toFixed(3)} mm, spacing = ${gap.toFixed(3)}°`);
  })());
  add('kinematics', 'joint limits 50/50/40°, ΔL ≤ 70 mm', (() => {
    const good = TRUNC.maxShoulder === 50 && TRUNC.maxElbow === 50 && TRUNC.maxWrist === 40 && TRUNC.maxCompression === 70;
    return ok(good, `${TRUNC.maxShoulder}/${TRUNC.maxElbow}/${TRUNC.maxWrist}°, ΔL ${TRUNC.maxCompression} mm`);
  })());
  add('kinematics', 'reach shell over 600 configurations', (() => {
    const rng = makeRng(8);
    const states = sweepConfigurations(600, rng);   // deg limits are converted internally
    let lo = Infinity; let hi = -Infinity;
    for (const s of states) {
      const d = Math.hypot(...forward(s).position);
      lo = Math.min(lo, d); hi = Math.max(hi, d);
    }
    return ok(lo > 400 && hi > 770, `${lo.toFixed(1)} … ${hi.toFixed(1)} mm`);
  })());

  // ---- trajectories -----------------------------------------------------
  await tick('trajectories: five task generators');
  const summaries = {};
  for (const t of PORT_TASKS) {
    await tick(`trajectories: ${t.id}`);
    const sum = taskSummary(t.id);
    summaries[t.id] = sum;
    add('trajectories', `${t.id}: ${sum.waypoints} waypoints, ${(sum.length / 1000).toFixed(3)} m`, (() => ({
      ok: sum.waypoints > 2 && sum.length > 0,
      detail: `span [${sum.span.map((v) => v.toFixed(1)).join(', ')}] mm, ${sum.duration.toFixed(1)} s commanded`,
    }))());
  }
  add('trajectories', 'circle: r = 90 mm, planar, 20 traced waypoints', (() => {
    const wps = taskWaypoints('circle');
    const r = wps.map((w) => Math.hypot(w.p[0], w.p[1]));
    const z = wps.map((w) => w.p[2]);
    const spread = Math.max(...r) - Math.min(...r);
    const dz = Math.max(...z) - Math.min(...z);
    const rms = Math.sqrt(r.reduce((a, v) => a + v * v, 0) / r.length);
    return ok(dz < 1e-9 && spread < 1 && near(rms, 90, 0.5),
      `r̄ = ${rms.toFixed(3)} mm (spread ${spread.toFixed(3)}), Δz ${dz.toFixed(6)} mm, ${wps.length} waypoints`);
  })());
  add('trajectories', 'motherboard drills 2 × 10.5 s', (() => {
    const wps = taskWaypoints('motherboard');
    const motor = wps.reduce((a, w) => a + w.motor, 0);
    const pulses = wps.filter((w) => w.motor > 0).length;
    return ok(near(motor, 21, 1e-9) && pulses === 2, `${motor.toFixed(2)} s over ${pulses} pulse starts`);
  })());
  add('trajectories', 'bulb tool motor 3.5 s', (() => {
    const wps = taskWaypoints('bulb');
    const motor = wps.reduce((a, w) => a + w.motor, 0);
    return ok(near(motor, 3.5, 1e-9), `${motor.toFixed(2)} s`);
  })());

  // ---- interpolation ----------------------------------------------------
  await tick('interp: the densifier MATLAB never shipped');
  add('interp', '100 samples from 20 waypoints, same path length', (() => {
    const wps = taskWaypoints('circle').slice(0, 21);
    const dense = interpWaypoints(wps, 100, 'cubic');
    const plen = (a) => a.reduce((acc, w, k) => (k ? acc + Math.hypot(w.p[0] - a[k - 1].p[0], w.p[1] - a[k - 1].p[1], w.p[2] - a[k - 1].p[2]) : 0), 0);
    const ratio = plen(dense) / plen(wps);
    const ends = Math.hypot(...dense[0].p.map((v, k) => v - wps[0].p[k])) + Math.hypot(...dense[99].p.map((v, k) => v - wps[20].p[k]));
    return ok(dense.length === 100 && ends < 1e-9 && Math.abs(ratio - 1) < 0.06,
      `${dense.length} samples, path ${(ratio * 100).toFixed(2)} % of the polyline, endpoints exact`);
  })());
  add('interp', 'pause/motor flags survive only on block boundaries', (() => {
    const wps = taskWaypoints('motherboard');
    const dense = interpWaypoints(wps, wps.length * 4, 'cubic');
    const flagged = dense.filter((w) => w.pause !== 0 || w.motor > 0).length;
    const source = wps.filter((w) => w.pause !== 0 || w.motor > 0).length;
    return ok(flagged === source, `${flagged} flagged samples = ${source} source boundaries`);
  })());
  add('interp', 'linear mode still hits the endpoints exactly', (() => {
    const wps = taskWaypoints('triangle');
    const dense = interpWaypoints(wps, 64, 'linear');
    const a = dense[0].p; const b = dense[dense.length - 1].p;
    const w0 = wps[0].p; const w1 = wps[wps.length - 1].p;
    const err = Math.hypot(a[0] - w0[0], a[1] - w0[1], a[2] - w0[2]) + Math.hypot(b[0] - w1[0], b[1] - w1[1], b[2] - w1[2]);
    return ok(err < 1e-9, `endpoint error ${err.toExponential(2)} mm`);
  })());

  // ---- hardware wrappers ------------------------------------------------
  await tick('robotArm + armMotor over loopback transports');
  add('robotArm', 'setPos arrives and reports seconds', (() => {
    const link = new LoopbackLink(900, 0);
    const arm = new RobotArm({ link, pauseLength: 0.5, threshold: 1, timeout: 20 });
    const cmd = HOME.map((v, k) => v + (k % 3 === 0 ? 40 : -18));
    const res = arm.setPos(cmd);
    return ok(res.ok && res.seconds > 0, `${res.seconds.toFixed(3)} s, ok = ${res.ok}`);
  })());
  add('robotArm', 'setPos refuses an out-of-range command', (() => {
    const link = new LoopbackLink(900, 0);
    const arm = new RobotArm({ link });
    let unsafe = null;
    arm.on((e) => { if (e.kind === 'unsafe') unsafe = e.detail; });
    const res = arm.setPos(HOME.map(() => SERVO_LIMITS.max + 50));
    return ok(!res.ok && unsafe, unsafe ?? 'no event');
  })());
  add('robotArm', 'resetArm cycles comp → comp_max five times', (() => {
    const link = new LoopbackLink(2000, 0);
    const arm = new RobotArm({ link, threshold: 1, timeout: 20 });
    const cycle = [];
    arm.resetArm((rep, phase) => cycle.push(`${rep}:${phase}`));
    return ok(cycle.length === 10 && cycle[0] === '0:comp_max' && cycle[9] === '4:comp', `${cycle.length} legs, last ${cycle[cycle.length - 1]}`);
  })());
  add('setup', 'compression pattern Δ·[1, 5/7, 3/7] clamps at −70', (() => {
    const c = compressionVector(-80);
    const d = clampCompression(-80);
    const good = near(d, -70, 1e-12) && near(c[0] - HOME[0], -70, 1e-9) && near(c[1] - HOME[1], -50, 1e-9);
    return ok(good, `clamped Δ = ${d}, channel deltas ${c.map((v, k) => (v - HOME[k]).toFixed(1)).join(', ')}`);
  })());
  add('armMotor', 'pulse() energises the relay for exactly t seconds', (() => {
    const link = new MockMotorLink();
    const motor = new ArmMotor(link);
    const dt = 1 / 240;
    const end = motor.pulse(3.5);
    const steps = Math.round(6 / dt);      // integer count: no float drift in the loop
    for (let i = 0; i < steps; i += 1) { link.advance(dt); motor.update(dt); }
    const withinStep = Math.abs(link.duty - 3.5) <= dt + 1e-9;
    return ok(near(end, 3.5, 1e-12) && withinStep && link.pulses.length === 1,
      `commanded ${end} s, relay duty ${link.duty.toFixed(4)} s (within one ${dt.toFixed(4)} s step)`);
  })());

  // ---- analysis ---------------------------------------------------------
  await tick('analysis: cross-coupling, efficiency, CV joint');
  add('analysis', 'splitTrials breaks on joint changes', (() => {
    const samples = [0, 0, 1, 1, 1, 2].map((joint) => ({ joint }));
    const runs = splitTrials(samples);
    return ok(runs.length === 3, `${runs.length} runs of ${runs.map((r) => r.length).join('/')}`);
  })());
  add('analysis', 'efficiency = 100 · out/in over the 800-sample window', (() => {
    const samples = Array.from({ length: 1200 }, () => ({ powerIn: 2, powerOut: 1 }));
    const e = efficiency(samples);
    return ok(near(e, 50, 1e-9), `${e.toFixed(4)} %`);
  })());
  add('analysis', 'CV trace: counts × 360/1024, wrapped', (() => {
    const { angle } = decodeCvTrace([0, 256, 512, 768]);
    const good = near(angle[1], 90, 1e-9) && near(angle[3], -90, 1e-9);
    return ok(good, `counts 0/256/512/768 → ${angle.map((v) => v.toFixed(1)).join(', ')}°`);
  })());
  add('analysis', 'cvAmplitude is peak-to-peak of |angle|', (() => {
    const a = cvAmplitude({ angle: [0, 10, 0, 20, 0, 10, 0] });
    return ok(near(a, 10, 1e-9), `${a.toFixed(3)}° between the 10° and 20° phases`);
  })());
  add('analysis', 'normaliseQuaternions returns unit quaternions about identity', (() => {
    const rows = normaliseQuaternions([{ x: 0, y: 0, z: 0, q: [1, 0, 0, 0] }]);
    const n = Math.hypot(...rows[0].q);
    return ok(near(n, 1, 1e-9), `|q| = ${n.toFixed(9)}`);
  })());

  // ---- solver -----------------------------------------------------------
  await tick('solver: inverse kinematics');
  add('solver', 'IK reaches the first target of every task', (() => {
    const solver = new Solver(DEFAULT_LIMITS, { samples: 900, restarts: 5, seed: 8 });
    const errs = PORT_TASKS.map((t) => {
      const first = robotWaypoints(t.id, homeFor(t.id))[0];
      return solver.solve(first, homeState(), [0, 0, -1], { iters: 20, axisWeight: 0 }).err;
    });
    const worst = Math.max(...errs);
    return ok(worst < 0.5, `worst ${worst.toExponential(3)} mm over ${errs.length} start poses`);
  })());
  add('solver', 'reach() reports the 710 + 83 mm arm', (() => {
    const r = reach([0, 0, -778]);
    return ok(near(r, 778, 1e-9), `${r.toFixed(3)} mm straight out`);
  })());
  add('solver', 'bendOf sums the three joint bends', (() => {
    const s = homeState(); s.t1 = 10 * toRad; s.t3 = 20 * toRad; s.t5 = 30 * toRad;
    const b = bendOf(s);
    return ok(near(b, 60, 1e-4), `${b.toFixed(4)}° (bendOf reports degrees)`);
  })());

  // ---- placement + animation -------------------------------------------
  await tick('placement: calibrated homes');
  add('placement', 'MATLAB → robot rotation is proper (det +1)', (() => {
    const M = MATLAB_TO_ROBOT;
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
      - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
      + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    return ok(near(det, 1, 1e-12), `det = ${det.toFixed(12)} on diag(${M.map((r) => r.join('/')).join(', ')})`);
  })());
  add('placement', 'task → robot → app is a rigid transform', (() => {
    let worstLen = 0; let worstAng = 0;
    for (const t of PORT_TASKS) {
      const home = homeFor(t.id);
      const wps = taskWaypoints(t.id);
      const base = mm2app(home);
      const rel = wps.map((w) => {
        const app = mm2app(toRobot(w.p, home));
        return [app[0] - base[0], app[1] - base[1], app[2] - base[2]];
      });
      wps.forEach((w, i) => {
        const len = Math.hypot(...w.p);
        const got = Math.hypot(...rel[i]);
        worstLen = Math.max(worstLen, Math.abs(got - len / 1000));
      });
      const angle = (a, b, c) => {
        const u = a.map((v, k) => b[k] - v); const w2 = a.map((v, k) => c[k] - v);
        const dot = u.reduce((acc, v, k) => acc + v * w2[k], 0);
        return Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...u) * Math.hypot(...w2)))));
      };
      const task = [wps[0].p, wps[5].p, wps[11].p];
      worstAng = Math.max(worstAng, Math.abs(angle(task[0], task[1], task[2]) - angle(rel[0], rel[5], rel[11])));
    }
    return ok(worstLen < 1e-9 && worstAng < 1e-9,
      `lengths preserved to ${worstLen.toExponential(2)} m, angles to ${worstAng.toExponential(2)} rad`);
  })());
  add('placement', 'task volumes sit inside the reach shell', (() => {
    const lines = [];
    let good = true;
    for (const t of PORT_TASKS) {
      const home = homeFor(t.id);
      let lo = Infinity; let hi = -Infinity;
      for (const p of robotWaypoints(t.id, home)) {
        const d = Math.hypot(...mm2app(p)) * 1000;
        lo = Math.min(lo, d); hi = Math.max(hi, d);
      }
      good = good && lo > REACH.min * 0.9 && hi < REACH.max * 1.02;
      lines.push(`${t.id} ${lo.toFixed(0)}–${hi.toFixed(0)} mm`);
    }
    return ok(good, `${lines.join(', ')}  (shell ${REACH.min.toFixed(0)}–${REACH.max.toFixed(0)} mm)`);
  })());
  add('placement', 'goal tool positions are reachable by the IK', (() => {
    const solver = new Solver(DEFAULT_LIMITS, { samples: 900, restarts: 4, seed: 8 });
    let worst = 0; let misses = 0;
    for (const name of ['circle', 'motherboard', 'bulb']) {
      for (let k = 0; k < 6; k += 1) {
        const wps = robotWaypoints(name, homeFor(name));
        const t = wps[Math.floor((k / 6) * wps.length)];
        const r = solver.solve(t, homeState(), [0, 0, -1], { iters: 20, axisWeight: 0 });
        worst = Math.max(worst, r.err);
        if (r.err > 5) misses += 1;
      }
    }
    return ok(misses === 0, `worst ${worst.toFixed(3)} mm, ${misses} misses of 18 goals`);
  })());

  await tick('animation: circle replay end to end');
  add('animation', 'circle replay: settled error, no missed waypoints', (() => {
    const port = new MatlabPort({ task: 'circle' });
    const s = port.runToEnd();
    return ok(s.missed === 0 && s.maxSettledError < 1.5 && s.frames > 3000,
      `${s.frames} frames / ${s.seconds.toFixed(1)} s, settled ${s.maxSettledError.toFixed(2)} mm, missed ${s.missed}, travel ${s.cableTravel.toFixed(0)} mm`);
  })());
  add('animation', 'servo command is comp + l_delta', (() => {
    const port = new MatlabPort({ task: 'triangle', params: { pauseLength: 0.1 } });
    const f = port.step(30);
    const delta = f.cables.map((c, k) => c - HOME_CABLES[k]);
    const worst = Math.max(...delta.map((d, k) => Math.abs(d - f.cableDelta[k])));
    return ok(worst < 1e-9, `max |Δcable − l_delta| = ${worst.toExponential(2)} mm`);
  })());
  await tick('animation: motherboard + bulb motor pulses');
  add('animation', 'motherboard drills 2 × 10.5 s of motor', (() => {
    const port = new MatlabPort({ task: 'motherboard', params: { pauseLength: 0.1, operatorWait: 0.15 } });
    const s = port.runToEnd();
    return ok(s.pulses === 2 && near(s.motorSeconds, 21, 1e-6),
      `${s.pulses} pulses, ${s.motorSeconds.toFixed(2)} s of relay, settled ${s.maxSettledError.toFixed(2)} mm`);
  })());
  add('animation', 'bulb task grips for 3.5 s', (() => {
    const port = new MatlabPort({ task: 'bulb', params: { pauseLength: 0.1, operatorWait: 0.15 } });
    const s = port.runToEnd();
    return ok(s.pulses === 1 && near(s.motorSeconds, 3.5, 1e-6),
      `${s.pulses} pulse, ${s.motorSeconds.toFixed(2)} s of relay, settled ${s.maxSettledError.toFixed(2)} mm`);
  })());

  const passed = rows.filter((r) => r.ok).length;
  return { rows, passed, total: rows.length, summaries };
}
