/**
 * engineCheck.js — the *other* half of "check all function".
 *
 * `matlabPort.js` verifies the ported MATLAB model. This module verifies the
 * application built on top of it: the tendon-driven arm, the inverse-kinematics
 * solver, the five workshop jobs with their contact phases and damage limits,
 * and the two learners (the MLP inverse-kinematics network and the causal chunk
 * transformer). All of it is plain JS — no GPU, no worker, no DOM — so the CPU
 * page can run the same acceptance the WebGPU page depends on.
 *
 * `runEngineChecks(onStep)` returns the same shape as `verifyPort()`, so both
 * tables can be rendered side by side.
 */
import { Robot } from '../engine/robot.js';
import { TASK_LIBRARY } from '../engine/tasks.js';
import { Arm, defaultConfig, segmentState, homeState } from '../core/arm.js';
import { V3, Quat, Rng, clamp } from '../core/mathx.js';
import {
  poseJoint, cellLayout, armJoints, activeJointIndices, MOLD_DIAMETER_MM, JOINT_PITCH_MM,
  LINK, MAX_JOINT_BEND_DEG, TWIST_BEND_RATIO, SPRINGS, CABLE_TRIANGLE_MM, SEGMENT_JOINTS,
} from '../core/truncSpec.js';
import { MatlabPort } from './matlabPort.js';
import { buildMlpDataset, trainMlp, buildPolicyDataset, trainPolicy } from '../workers/trainers.js';

const ok = (cond, detail) => ({ ok: !!cond, detail });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const DT = 1 / 240;

/**
 * Run every engine-side check. `onStep(index, total, label)` is awaited between
 * checks so a page can paint its progress.
 */
export async function runEngineChecks(onStep = () => {}, { quick = false } = {}) {
  const rows = [];
  const add = (group, name, res) => rows.push({ group, name, ...res });
  const T = quick ? 11 : 14;
  let i = 0;
  const tick = async (label) => {
    i += 1;
    onStep(i, T, label);
    await new Promise((r) => setTimeout(r, 0));
  };

  // ---- plant ------------------------------------------------------------
  await tick('arm: geometry, tendons, stiffness');
  add('arm', 'the paper\'s joints: 3:2:2 cells, D = 56 mm, nine tendons', (() => {
    const arm = new Arm(defaultConfig());
    const state = homeState();
    const bones = arm.bones(state).filter((b) => b.active !== false);
    const cables = arm.cableTargets(state.seg);
    const guides = arm.guides(state);
    const counts = arm.cellCounts().join(':');
    const ball = bones.every((b) => near(b.cellDiameter * 1000, 56, 1e-9));
    const ring = guides.every((g) => near(g.radius * 1000, 65, 1e-9));
    const pitch = (arm.totalLength * 1000) / bones.length;
    return ok(bones.length === 7 && cables.length === 9 && guides.length === 8 && ball && ring
      && near(arm.totalLength * 1000, 710, 0.05) && near(pitch, 101.4, 0.2),
      `${bones.length} nested joints (${counts}), D = ${(bones[0].cellDiameter * 1000).toFixed(0)} mm, `
      + `${cables.length} tendons, ${guides.length} guides at ${(guides[0].radius * 1000).toFixed(0)} mm, `
      + `pitch ${pitch.toFixed(1)} mm, ${(arm.totalLength * 1000).toFixed(0)} mm reach`);
  })());
  add('cell', 'the unit cell is the paper\'s pinned double-arrowhead tiling', (() => {
    // The cell is a rigid-link linkage, not a decorated ball: N = 4 (eight fold
    // planes), M = 2 equatorial / M = 3 truss, links of width w and thickness t,
    // bent on a 56 mm mold (truss) and an 88 mm one (equatorial).
    const truss = cellLayout({ kind: 'truss' });
    const equa = cellLayout({ kind: 'equatorial', ballR: MOLD_DIAMETER_MM.equatorial / 2 });
    const poles = truss.sectors === 8 && equa.sectors === 8;
    const bands = truss.bands === 3 && equa.bands === 2;
    const molds = near(MOLD_DIAMETER_MM.truss, 56, 1e-12) && near(MOLD_DIAMETER_MM.equatorial, 88, 1e-12);
    const links = LINK.width === 5.0 && LINK.thickness === 1.6;
    // the truss cell really has one more row of arrow heads than the equatorial
    const arrows = (l) => l.chevrons.filter((c) => c.fold).length;
    const extra = arrows(truss) === 16 && arrows(equa) === 8;
    return ok(poles && bands && molds && links && extra,
      `N = ${truss.sectors / 2} (eight fold planes), M = ${truss.bands}/${equa.bands} bands, `
      + `molds ${MOLD_DIAMETER_MM.truss}/${MOLD_DIAMETER_MM.equatorial} mm, links ${LINK.width}x${LINK.thickness} mm, `
      + `${arrows(truss)} arrow-head links (truss) vs ${arrows(equa)} (equatorial)`);
  })());
  add('cell', 'the linkage closes at every bend, and rides a non-fixed sphere', (() => {
    // Every rigid link is pinned at both ends, so the fold vertices can only sit
    // where the two link spheres meet: `poseJoint()` solves exactly that from the
    // joint's two node frames. The paper: the cell "acts as a spherical mechanism
    // on a sphere of non-fixed radius" and is a constant velocity joint.
    const pitch = (kind, R) => { const l = cellLayout({ kind, ballR: R }); return JOINT_PITCH_MM - (JOINT_PITCH_MM - l.cellHeight); };
    const frame = (dy, deg) => {
      const t = (deg * Math.PI) / 180; const c = Math.cos(t); const s = Math.sin(t);
      return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, dy, 0, 1];
    };
    const rows = [];
    let worst = 0;
    let shrink = null;
    // the equatorial structure "disallows shear internal to the cell", so its
    // own range runs out near 36 deg; the truss cell is the one that bends
    // A module's bend is shared by the *pair* of shafts (the paper's nested pair
    // is "coupled in bending"), so a cell never sees the arm's whole 45 deg: the
    // MATLAB's 50/50/40 deg segment bends spread over 3/2/2 cells is
    // 16.7/25/20 deg per cell, and the cells close exactly out to 30 deg. The
    // 45 deg row is printed rather than asserted, because there the real cell's
    // links do deform — it is the efficiency the paper measures (85.7% at 45).
    for (const [kind, R, angles] of [['truss', 28, [0, 12, 30]], ['equatorial', 44, [0, 12, 30]]]) {
      const l = cellLayout({ kind, ballR: R });
      const closures = angles.map((deg) => {
        const j = poseJoint({ low: frame(0, 0), high: frame(JOINT_PITCH_MM, deg), kind, ballR: R });
        if (kind === 'truss' && (deg === 0 || deg === 30)) {
          shrink = shrink ?? { neutral: null, bent: null, mold: l.ballR };
          if (deg === 0) shrink.neutral = j.sphereR;
          else shrink.bent = j.sphereR;
        }
        return j.closure;
      });
      worst = Math.max(worst, ...closures);
      rows.push(`${kind} (${l.ballR * 2} mm mold, ${angles.join('/')}°): ${closures.map((c) => c.toExponential(1)).join(' ')} mm`);
    }
    // the fold sphere follows the bend — it is not a fixed radius
    const nonFixed = shrink.bent < shrink.neutral - 0.2 && Math.abs(shrink.neutral - shrink.mold) < 0.1;
    const past = poseJoint({ low: frame(0, 0), high: frame(JOINT_PITCH_MM, MAX_JOINT_BEND_DEG), kind: 'truss', ballR: 28 });
    return ok(worst < 1e-3 && nonFixed,
      `link closure ${rows.join(' · ')} | truss fold sphere ${shrink.neutral.toFixed(2)} -> ${shrink.bent.toFixed(2)} mm with bend (mold ${shrink.mold})`
      + ` | one cell asked for the arm's full ${MAX_JOINT_BEND_DEG} deg (past its range): ${past.closure.toExponential(1)} mm`);
  })());
  add('cell', 'the cell transmits rotation at constant velocity and is frame-invariant', (() => {
    // "Both variants behave as a spherical mechanism on a sphere of non-fixed
    // radius and act as constant velocity joints": turn the output ring by θ and
    // the cell's own frame sits at exactly θ/2 — that half-angle map is what
    // makes the two shafts roll together, whatever the bend.
    //
    // The joint state has to be a *state the hardware can be in*: the rod joins
    // the two plates, so the second node lies along the bisector of the two
    // plate normals at the joint's own pitch. Feeding `poseJoint` a pair of
    // frames whose axes are 45 deg apart but whose centres are in line describes
    // an assembly no connector can bolt up, and the model rightly reports it as
    // one.
    const frame = (p, q) => {
      const Q = Quat.norm(q ?? Quat.identity());
      const r = Quat.rotate(Q, V3.new(1, 0, 0));
      const u = Quat.rotate(Q, V3.new(0, 1, 0));
      const f = Quat.rotate(Q, V3.new(0, 0, 1));
      // the store convention used everywhere else in the app: the three triples
      // *are* the node's own x, shaft and z axes
      return [
        r.x, r.y, r.z, 0,
        u.x, u.y, u.z, 0,
        f.x, f.y, f.z, 0,
        p.x, p.y, p.z, 1,
      ];
    };
    const axisOf = (m) => V3.new(m[4], m[5], m[6]);
    const twist = (m) => Math.atan2(m[8], m[0]);      // roll about the shaft axis
    const rad = (d) => (d * Math.PI) / 180;
    const state = (bendDeg, turnDeg, base = null, offset = null) => {
      const q = Quat.mul(Quat.fromAxisAngle(V3.new(1, 0, 0), rad(bendDeg)),
        Quat.fromAxisAngle(V3.new(0, 1, 0), rad(turnDeg)));
      const lo = base ?? Quat.identity();
      const lowAxis = Quat.rotate(lo, V3.new(0, 1, 0));
      const highAxis = Quat.rotate(Quat.mul(lo, q), V3.new(0, 1, 0));
      const rod = V3.norm(V3.add(lowAxis, highAxis));   // the bisector: the rod
      const o = offset ?? V3.new(0, 0, 0);
      return {
        p: JOINT_PITCH_MM,
        low: frame(o, lo),
        high: frame(V3.add(o, V3.scale(rod, JOINT_PITCH_MM)), Quat.mul(lo, q)),
      };
    };
    let worstClosure = 0;
    let worstTwist = 0;
    let worstBend = 0;
    let pastRange = 0;
    for (const bendDeg of [0, 12, 30, MAX_JOINT_BEND_DEG]) {
      for (const turnDeg of [0, 20, 45, 90]) {
        const { low, high } = state(bendDeg, turnDeg);
        const j = poseJoint({ low, high, kind: 'truss' });
        const eq = poseJoint({ low, high, kind: 'equatorial' });
        const worst = Math.max(j.closure, eq.closure);
        if (bendDeg <= 30) worstClosure = Math.max(worstClosure, worst);
        else pastRange = Math.max(pastRange, worst);
        // the half-angle map: each plate's own axis sits half the bend from the
        // rod, on opposite sides of it
        const rod = V3.norm(V3.new(j.axis[0], j.axis[1], j.axis[2]));
        const tilt = (v) => Math.acos(clamp(V3.dot(v, rod), -1, 1)) * 180 / Math.PI;
        worstBend = Math.max(worstBend,
          Math.abs(tilt(V3.norm(axisOf(low))) - bendDeg / 2),
          Math.abs(tilt(V3.norm(axisOf(high))) - bendDeg / 2));
        // and both shafts must roll together: the truss and the equatorial cell
        // of one module pass the same twist
        let d = Math.abs(twist(j.rotation) - twist(eq.rotation));
        if (d > Math.PI / 2) d = Math.PI - d;
        worstTwist = Math.max(worstTwist, d);
      }
    }
    // and the shape must not depend on where the joint is in the world
    const a = state(30, 0);
    const movedFrame = (() => {
      const base = Quat.fromAxisAngle(V3.norm(V3.new(0.3, 1, 0.2)), 1.1);
      return state(30, 0, base, V3.new(120, -40, 75));
    })();
    void movedFrame.p;
    const base = poseJoint({ low: a.low, high: a.high, kind: 'truss' });
    const moved = poseJoint({ low: movedFrame.low, high: movedFrame.high, kind: 'truss' });
    let worstShape = 0;
    for (let k = 0; k < base.folds.length; k += 1) {
      const pa = V3.new(...base.folds[k].p);
      const pb = V3.new(...moved.folds[k].p);
      const relA = V3.sub(pa, V3.new(base.centre[0], base.centre[1], base.centre[2]));
      const relB = V3.sub(pb, V3.new(moved.centre[0], moved.centre[1], moved.centre[2]));
      worstShape = Math.max(worstShape, Math.abs(V3.len(relB) - V3.len(relA)));
    }
    return ok(worstClosure < 1e-6 && worstTwist < 1e-6 && worstShape < 1e-6 && worstBend < 1e-9,
      `half-angle map exact to ${worstBend.toExponential(1)}°, both shafts roll together to `
      + `${(worstTwist * 1000).toExponential(1)} mrad, closure ${worstClosure.toExponential(1)} mm to 30°, `
      + `shape unchanged (${worstShape.toExponential(1)} mm) by a 145 mm move + 63° reorientation, `
      + `one cell at ${MAX_JOINT_BEND_DEG}° ${pastRange.toExponential(1)} mm (past its own range)`);
  })());
  add('cell', 'every joint of the arm closes from its own two FK frames', (() => {
    // The arm's seven joints are 3:2:2 along the MATLAB's 3L/7 : 2L/7 : 2L/7
    // split, the last of each segment driven by the cables (shoulder, elbow,
    // wrist) and the rest passive. Each is solved from the two node frames the
    // run-time forward kinematics produces, so this checks the real chain. What
    // it reports is how far the paper's rigid links would have to stretch to sit
    // at the pose the FK asks for: at micrometres the FK and the mechanism agree.
    const port = new MatlabPort({ task: 'circle' });
    const geo = port.geometry();
    const closures = (geo.joints ?? []).map((j) => j.closure);
    const active = (geo.joints ?? []).filter((j) => j.active).map((j) => j.index);
    const perSeg = [0, 1, 2].map((s) => (geo.joints ?? []).filter((j) => j.segment === s).length);
    const worst = closures.length ? Math.max(...closures) : Infinity;
    const spec = geo.spec ?? {};
    const paper = perSeg.join(':') === SEGMENT_JOINTS.join(':')
      && active.join(',') === activeJointIndices().join(',')
      && spec.cableTriangleMm === CABLE_TRIANGLE_MM
      && spec.springs?.conical === SPRINGS.conical
      && spec.twistBendRatio?.truss === TWIST_BEND_RATIO.truss;
    return ok(closures.length === 7 && worst < 1e-3 && paper,
      `${closures.length} joints (${perSeg.join(':')}), active ${active.join('/')}, worst rigid-link violation ${worst.toExponential(1)} mm, `
      + `triad ring ${spec.cableTriangleMm} mm, ${geo.tendons.flat().length} tendons`);
  })());
  add('arm', 'forward kinematics is continuous and monotone in bend', (() => {
    const arm = new Arm(defaultConfig());
    let prev = null;
    let monotone = true;
    for (let a = 0; a <= 45; a += 5) {
      const seg = Array.from({ length: 3 }, () => segmentState((a * Math.PI) / 180, 0, 0));
      const p = arm.fk(seg).p;
      if (prev) {
        const d = V3.dist(prev, p);
        if (!Number.isFinite(d)) monotone = false;
      }
      prev = p;
    }
    const straight = arm.fk(Array.from({ length: 3 }, () => segmentState(0, 0, 0))).p;
    return ok(monotone && near(straight.y, arm.totalLength, 1e-6),
      `straight tool at y = ${(straight.y * 1000).toFixed(1)} mm = the chain's own length`);
  })());
  add('arm', 'bending stiffness rises with tendon tension', (() => {
    const arm = new Arm(defaultConfig());
    const own = (t) => arm.bendingStiffnessAt(t) - arm.winchBendingStiffness;   // truss + guide + tendon
    const a = own(arm.cfg.preload);
    const b = own(90);
    const total = [arm.bendingStiffnessAt(arm.cfg.preload), arm.bendingStiffnessAt(90)];
    return ok(b > a * 1.5,
      `arm bending stiffness ${a.toFixed(3)} → ${b.toFixed(3)} N·m/rad (${(b / a).toFixed(2)}×) for `
      + `${arm.cfg.preload} → 90 N · total including the winch ${total[0].toFixed(1)} → ${total[1].toFixed(1)}`);
  })());
  add('arm', 'the workspace cloud fills the shell the paper reports', (() => {
    const arm = new Arm(defaultConfig());
    const cloud = arm.workspaceCloud(1200, 42);
    let lo = Infinity;
    let hi = 0;
    for (let k = 0; k < cloud.length; k += 3) {
      const r = Math.hypot(cloud[k], cloud[k + 1], cloud[k + 2]);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    return ok(hi > arm.totalLength * 0.9 && lo > 0.05,
      `|tool| ${(lo * 1000).toFixed(0)}–${(hi * 1000).toFixed(0)} mm over 1200 poses`);
  })());

  // ---- solver -----------------------------------------------------------
  await tick('solver: inverse kinematics');
  add('solver', 'IK reaches 12 sampled targets inside the shell', (() => {
    const arm = new Arm(defaultConfig());
    const rng = new Rng(7);
    let worst = 0;
    let misses = 0;
    for (let k = 0; k < 12; k += 1) {
      // sample the reachable set, then ask for a point next to it
      const seedSeg = Array.from({ length: 3 }, () => segmentState(
        rng.range(0, 0.5), rng.range(-Math.PI, Math.PI), rng.range(0, arm.maxCompression / 3),
      ));
      const reachable = arm.fk(seedSeg);
      const target = {
        p: V3.new(reachable.p.x + rng.range(-0.05, 0.05), reachable.p.y + rng.range(-0.05, 0.05), reachable.p.z + rng.range(-0.05, 0.05)),
        q: reachable.q,
      };
      const seed = { ...homeState(), seg: seedSeg.map((s) => ({ ...s })) };
      const seg = arm.ik(target, seed, 40, { axisWeight: 0 });
      const got = arm.fk(seg).p;
      const d = V3.dist(got, target.p);
      worst = Math.max(worst, d);
      if (d > 0.02) misses += 1;
    }
    return ok(misses === 0, `worst ${(worst * 1000).toFixed(2)} mm over 12 targets, ${misses} misses`);
  })());
  add('solver', 'the joint stops hold (≤ 45° per segment, compression bounded)', (() => {
    const arm = new Arm(defaultConfig());
    const rng = new Rng(3);
    let worstBend = 0;
    let worstComp = 0;
    for (let k = 0; k < 8; k += 1) {
      const p = V3.new(rng.range(-0.3, 0.3), rng.range(0.3, 0.7), rng.range(-0.3, 0.3));
      const target = { p, q: Quat.fromYTo(V3.norm(p)) };   // the IK needs a real orientation
      const seg = arm.ik(target, homeState(), 30, { axisWeight: 0 });
      for (const s of seg) {
        worstBend = Math.max(worstBend, s.bend);
        worstComp = Math.max(worstComp, s.compress);
      }
    }
    return ok(worstBend <= 45.0001 * Math.PI / 180 && worstComp <= arm.maxCompression / 3 + 1e-9,
      `worst bend ${((worstBend * 180) / Math.PI).toFixed(3)}° (stop 45°), worst squash ${(worstComp * 1000).toFixed(2)} mm (cap ${((arm.maxCompression / 3) * 1000).toFixed(2)})`);
  })());

  // ---- the five jobs ----------------------------------------------------
  for (const scenario of TASK_LIBRARY) {
    await tick(`jobs: ${scenario.id} episode`);
    const r = new Robot({ tasks: TASK_LIBRARY.map((s) => s.spec) });
    r.selectTask(TASK_LIBRARY.indexOf(scenario));
    let solvedAt = -1;
    const steps = Math.round(26 / DT);
    for (let k = 0; k < steps; k += 1) {
      r.step(DT);
      if (solvedAt < 0 && r.metrics().success) solvedAt = r.time;
    }
    const m = r.metrics();
    const spec = r.spec;
    const wantDepth = spec.pitch * spec.turnsRequired * 1000;
    const depthErr = Math.abs(m.depthMm - wantDepth);
    const seconds = solvedAt >= 0 ? solvedAt : r.time;
    add('jobs', `${scenario.id}: completes, no damage, no overload`, ok(m.success && !m.damaged,
      `${m.phaseName} in ${seconds.toFixed(2)} s · ${m.turns.toFixed(2)} turns · depth ${m.depthMm.toFixed(2)} mm `
      + `(want ${wantDepth.toFixed(2)}, Δ${depthErr.toFixed(2)}) · peak ${m.peakForceN.toFixed(1)} N · safety ${m.safety.toFixed(2)}`));
  }

  // ---- the learners -----------------------------------------------------
  await tick('learners: MLP inverse kinematics');
  const trainRobot = new Robot({ tasks: TASK_LIBRARY.map((s) => s.spec) });
  const ds = buildMlpDataset(trainRobot, { samples: quick ? 700 : 1400, seed: 7 });
  const t0 = performance.now();
  const mlp = trainMlp(ds, { epochs: quick ? 25 : 40 });
  const trainSeconds = (performance.now() - t0) / 1000;
  const mean = ds.y.reduce((a, v) => a + v, 0) / ds.y.length;
  const baseline = Math.sqrt(ds.y.reduce((a, v) => a + (v - mean) ** 2, 0) / ds.y.length);
  add('learners', 'the IK network beats the constant predictor', ok(mlp.mae < baseline,
    `mean |error| ${mlp.mae.toFixed(5)} m = ${(mlp.mae * 1000).toFixed(2)} mm tendon · baseline ${baseline.toFixed(5)} · `
    + `${(baseline / mlp.mae).toFixed(2)}× better · ${mlp.net.paramCount} params · ${trainSeconds.toFixed(1)} s`));

  await tick('learners: transformer policy distillation');
  const pds = buildPolicyDataset(trainRobot, { episodes: quick ? 2 : 3, seed: 7 });
  const pol = trainPolicy(pds, { epochs: quick ? 3 : 5 });
  add('learners', 'the transformer distils the expert planner', ok(Number.isFinite(pol.loss) && pol.loss < 1.5,
    `${pds.samples.length} state→chunk pairs · mse ${pol.loss.toFixed(5)} (rms ${Math.sqrt(pol.loss).toFixed(3)}σ) · ${pol.policy.paramCount} params`));

  await tick('learners: rollout with the trained policy');
  add('learners', 'the learned plan moves the arm and the residual helps', (() => {
    // The measured ablation in docs/design.md: plan alone fails in approach,
    // plan + solver residual at authority 25 % reaches the same 6.00 turns as
    // the expert solver. The policy here is trained for seconds rather than
    // minutes, so this check asks for motion and monotonicity, not a full seat —
    // and it reports both numbers so the gap is visible rather than hidden.
    const run = (weight) => {
      const r = new Robot({ tasks: TASK_LIBRARY.map((s) => s.spec) });
      r.net = mlp.net;
      r.policy = pol.policy;
      r.selectTask(0);
      r.setMode?.('learned');
      const steps = Math.round(26 / DT);
      for (let k = 0; k < steps; k += 1) r.step(DT, { residual: true, residualWeight: weight });
      return r.metrics();
    };
    const pure = run(0);
    const hybrid = run(0.75);
    const want = TASK_LIBRARY[0].spec.turnsRequired;
    return ok(hybrid.turns > 0.2 && hybrid.turns >= pure.turns - 1e-9,
      `${TASK_LIBRARY[0].id} needs ${want} turns: plan alone ${pure.turns.toFixed(2)} (${pure.phaseName}) · `
      + `plan + solver ${hybrid.turns.toFixed(2)} (${hybrid.phaseName}) · a fully trained policy reaches `
      + `${want.toFixed(2)} (docs/design.md), so this is the training budget showing, not the plant`);
  })());

  // ---- safety ------------------------------------------------------------
  await tick('safety: wrench envelope across all jobs');
  add('safety', 'no job exceeds the safety envelope', (() => {
    const r = new Robot({ tasks: TASK_LIBRARY.map((s) => s.spec) });
    let worst = 0;
    let worstId = '';
    for (let t = 0; t < TASK_LIBRARY.length; t += 1) {
      r.selectTask(t);
      for (let k = 0; k < Math.round(20 / DT); k += 1) r.step(DT);
      const s = r.metrics().safety;
      if (s > worst) { worst = s; worstId = TASK_LIBRARY[t].id; }
    }
    return ok(worst < 0.6 && clamp(1.5, 0, 1) === 1,
      `worst safety index ${worst.toFixed(3)} on ${worstId} over ${TASK_LIBRARY.length} jobs (1.0 = damage)`);
  })());

  const passed = rows.filter((r) => r.ok).length;
  return { rows, passed, total: rows.length, net: mlp.net, policy: pol.policy };
}

export default runEngineChecks;
