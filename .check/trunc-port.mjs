/**
 * trunc-port.mjs — verifies the TypeScript port of the TRUNC MATLAB code.
 *
 *   1. the kinematic model against hand-computed MATLAB values
 *   2. the reachable set (the shell the joint limits actually allow)
 *   3. every trajectory tracked by the damped-least-squares solver
 *   4. the animation driver replaying a task end to end
 *
 *   node --disable-warning=ExperimentalWarning .check/trunc-port.mjs
 */
import { emit } from '../tools/ts-emit.mjs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
emit({ quiet: true });
const J = async (p) => import(pathToFileURL(join(ROOT, 'js', p)).href);

const { forward, homeState, segmentTransform, TRUNC, sweepConfigurations } = await J('trunc/kinematics.js');
const { makeRng } = await J('trunc/math.js');
const { TASKS, taskWaypoints } = await J('trunc/trajectories.js');
const { Solver } = await J('sim/solver.js');
const { ArmAnimation, CHAIN_AXIS } = await J('sim/animation.js');
const placement = await J('sim/placement.js');
const { TASK_HOMES, homeFor, robotWaypoints, robotToApp, toApp } = placement;

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- 1. kinematics
console.log('\n== kinematics ==');
{
  const s = homeState();
  const pose = forward(s);
  const p = pose.position;
  ok('home tool position hangs straight down the base axis',
    near(p[0], 0, 1e-9) && near(p[1], 0, 1e-9) && near(p[2], -(TRUNC.length + TRUNC.toolLength), 1e-6),
    `p = [${p.map((v) => v.toFixed(4)).join(', ')}] mm (expect [0, 0, -778])`);
  ok('segment lengths are the 3:2:2 split of 695 mm',
    near(Math.abs(pose.T[0][14]), 3 / 7 * 695, 1e-9)
    && near(Math.abs(pose.T[2][14] - pose.T[1][14]), 2 / 7 * 695, 1e-9),
    `shoulder ${Math.abs(pose.T[0][14]).toFixed(3)} mm, wrist ${Math.abs(pose.T[2][14] - pose.T[1][14]).toFixed(3)} mm`);
  const c = pose.cables;
  // cable order is [w,e,s] per module: wrist 2L/7, elbow 2L/7, shoulder 3L/7
  ok('straight arm: every cable equals its segment length',
    near(c[0], 198.571428571, 1e-6) && near(c[1], 198.571428571, 1e-6)
    && near(c[2], 297.857142857, 1e-6) && near(c[8], 297.857142857, 1e-6),
    c.map((v) => v.toFixed(3)).join(' / ') + ' mm  (order w,e,s ×3)');
}
{
  // hand-computed: t1 = t3 = t5 = 30 deg, all bending planes 0. Each segment
  // advances along its own -Z, so Rx(30)/Rx(60)/Rx(90) accumulate.
  const s = homeState({ t1: 30 * DEG, t3: 30 * DEG, t5: 30 * DEG });
  const p = forward(s).position;
  const expectY = 99.285714286 + 171.967127 + 83;
  const expectZ = -297.857142857 - 171.973494 - 99.285714286;
  ok('30/30/30 deg bend matches the hand-computed MATLAB chain',
    near(p[1], expectY, 0.02) && near(p[2], expectZ, 0.02),
    `p.y ${p[1].toFixed(4)} (expect ${expectY.toFixed(4)}), p.z ${p[2].toFixed(4)} (expect ${expectZ.toFixed(4)})`);
}
{
  const a = forward(homeState({ t1: 30 * DEG, t2: 0 })).position;
  const b = forward(homeState({ t1: 30 * DEG, t2: 90 * DEG })).position;
  ok('bending plane rotates the tool about the base axis',
    near(Math.hypot(b[0], b[1], b[2]), Math.hypot(a[0], a[1], a[2]), 1e-6) && b[0] > 1 && near(b[1], 0, 1e-6),
    `|p| ${Math.hypot(a[0], a[1], a[2]).toFixed(3)} -> ${Math.hypot(b[0], b[1], b[2]).toFixed(3)} mm, plane 90 deg puts the tip on +x`);
}
{
  const m = segmentTransform(0, 0, -100);
  ok('segment transform is a pure translation when the joints are straight',
    near(m[14], -100, 1e-12) && near(m[0], 1, 1e-12), `Tz = ${m[14]}`);
}

// ------------------------------------------------------------- 2. reachable set
console.log('\n== reachable set ==');
const rand = makeRng(8);
const configs = sweepConfigurations(6000, rand, {
  maxShoulder: TRUNC.maxShoulder, maxElbow: TRUNC.maxElbow,
  maxWrist: TRUNC.maxWrist, maxCompression: TRUNC.maxCompression,
});
let rMin = Infinity;
let rMax = 0;
for (const c of configs) {
  const d = Math.hypot(...forward(c).position);
  rMin = Math.min(rMin, d);
  rMax = Math.max(rMax, d);
}
ok('the reachable set is the shell the joint limits allow',
  rMin > 400 && rMin < 520 && rMax > 760 && rMax <= 778.1,
  `|tool| in [${rMin.toFixed(1)}, ${rMax.toFixed(1)}] mm over ${configs.length} configurations ` +
  `(straight arm reaches ${(TRUNC.length + TRUNC.toolLength).toFixed(0)} mm)`);
ok('the task frame maps into the app frame with the chain pointing up',
  near(toApp([0, 0, 0], TASK_HOMES.circle)[1], -TASK_HOMES.circle[2], 1e-9)
  && near(robotToApp([0, 0, -100])[1], 100, 1e-12),
  `circle task centre = [${toApp([0, 0, 0], TASK_HOMES.circle).map((v) => v.toFixed(0)).join(', ')}] mm in app space`);

// --------------------------------------------------------------- 3. trajectory IK
console.log('\n== trajectories ==');
const solver = new Solver(undefined, { samples: 1500, restarts: 6 });
let allTrack = true;
const tracking = {};
for (const name of Object.keys(TASKS)) {
  const home = homeFor(name);
  const targets = robotWaypoints(name, home);
  let seed = null;
  let worst = 0;
  let mean = 0;
  let misses = 0;
  for (const target of targets) {
    const r = solver.solve(target, seed, CHAIN_AXIS, { axisWeight: 0 });
    seed = r.state;
    worst = Math.max(worst, r.err);
    mean += r.err / targets.length;
    if (r.err > 5) misses += 1;
  }
  tracking[name] = { worst, mean, misses, total: targets.length, home };
  const good = worst <= 5;
  allTrack = allTrack && good;
  console.log(`    ${name.padEnd(12)} worst ${worst.toFixed(2)} mm  mean ${mean.toFixed(2)}  `
    + `misses ${misses}/${targets.length}  home_pos [${home.join(', ')}]`);
}
ok('every trajectory is tracked within 5 mm',
  allTrack,
  Object.entries(tracking).map(([k, v]) => `${k} ${v.worst.toFixed(2)}`).join(' | '));

// ----------------------------------------------------------------- 4. animation
console.log('\n== animation ==');
{
  const anim = new ArmAnimation({ task: 'circle', dt: 1 / 60, operatorWait: 0.5 });
  const summary = anim.run();
  ok('circle replay completes and tracks its waypoints',
    anim.done && summary.missed === 0 && summary.meanError < 5 && summary.maxSettledError < 1.5,
    `${summary.frames} frames / ${summary.seconds.toFixed(1)} s, mean err ${summary.meanError.toFixed(2)} mm, `
    + `settled err ${summary.maxSettledError.toFixed(2)} mm (transient max ${summary.maxError.toFixed(2)}), `
    + `missed ${summary.missed}/${summary.waypoints}, cable travel ${summary.cableTravel.toFixed(0)} mm`);
  const f = anim.step();
  ok('frames carry the `comp + l_delta` servo command vector',
    f.servo.length === 9 && f.cableDelta.length === 9 && f.servo.every(Number.isFinite),
    `servo = [${f.servo.map((v) => v.toFixed(1)).join(', ')}]`);
}
{
  const anim = new ArmAnimation({ task: 'motherboard', dt: 1 / 60, operatorWait: 0.2 });
  const summary = anim.run();
  const expectedMotor = 2 * 14 * (15 / 20);
  ok('motherboard drill task pulses the tool motor for both holes',
    summary.motorSeconds >= expectedMotor - 0.01 && summary.motorSeconds <= expectedMotor + 0.01
    && summary.pulses === 2 && anim.done && summary.missed === 0,
    `${summary.frames} frames, motor on ${summary.motorSeconds.toFixed(2)} s (trajectory asks for `
    + `${expectedMotor.toFixed(2)} s = 2 x 10.5 s), max tracking ${summary.maxError.toFixed(2)} mm`);
  // the drill phases must be the frames where the relay is live
  const drill = [];
  const a2 = new ArmAnimation({ task: 'motherboard', dt: 1 / 60, operatorWait: 0.2 });
  while (!a2.done) {
    const fr = a2.step();
    if (fr.motorOn) drill.push(fr);
  }
  ok('drill phases are flagged while the relay is energised',
    drill.length > 60 && a2.motor.history.length === 2,
    `${drill.length} frames with the motor live across ${a2.motor.history.length} pulses `
    + `(${a2.motor.history.map((h) => h.seconds.toFixed(1)).join(' s, ')} s), `
    + `phases ${[...new Set(drill.map((f) => f.phase))].join('/')}`);
}
{
  const anim = new ArmAnimation({ task: 'bulb', dt: 1 / 60, operatorWait: 0.2 });
  const summary = anim.run();
  ok('bulb task runs to completion on its own placement',
    anim.done && summary.missed === 0 && summary.meanError < 5
    && summary.motorSeconds >= 3.4 && summary.motorSeconds <= 3.6 && summary.pulses === 1,
    `${summary.frames} frames / ${summary.seconds.toFixed(1)} s, mean err ${summary.meanError.toFixed(2)} mm, `
    + `motor ${summary.motorSeconds.toFixed(1)} s`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
