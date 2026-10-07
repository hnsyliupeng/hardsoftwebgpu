/**
 * trunc-calibrate.mjs — reconstructs the missing `home_pos` (and the task-frame
 * orientation) from the trajectories themselves.
 *
 * `generate_trajectory.m` writes its waypoints as offsets in a task frame and
 * adds `home_pos`, which lived in a binary MAT file that is not in the
 * repository. What *is* knowable is the arm: the ported forward kinematics plus
 * the manufacturing joint limits define exactly which points the tool can
 * reach. This script
 *
 *   1. samples the configuration space into a cloud of reachable tool points,
 *   2. for each of the 24 axis-aligned task→robot orientations and a grid of
 *      translations, scores every task by the distance from its waypoints to
 *      the nearest reachable point (a lower bound on the tracking error),
 *   3. keeps the orientation that makes all five trajectories followable, and
 *      refines each task's offset,
 *   4. confirms the winners with the real damped-least-squares solver.
 *
 *   node --disable-warning=ExperimentalWarning .check/trunc-calibrate.mjs
 *   node --disable-warning=ExperimentalWarning .check/trunc-calibrate.mjs --write
 */
import { emit } from '../tools/ts-emit.mjs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
emit({ quiet: true });
const J = async (p) => import(pathToFileURL(join(ROOT, 'js', p)).href);

const { forward, homeState, sweepConfigurations, TRUNC } = await J('trunc/kinematics.js');
const { makeRng } = await J('trunc/math.js');
const { TASKS, taskWaypoints } = await J('trunc/trajectories.js');
const { Solver } = await J('sim/solver.js');

const WRITE = process.argv.includes('--write');
const DECIMATE = 12;          // waypoints used while searching
const CLOUD = Number(process.env.CLOUD ?? 24000);

// ---------------------------------------------------------------- reach cloud
const rand = makeRng(8);
const configs = sweepConfigurations(CLOUD, rand, {
  maxShoulder: TRUNC.maxShoulder, maxElbow: TRUNC.maxElbow,
  maxWrist: TRUNC.maxWrist, maxCompression: TRUNC.maxCompression,
});
const cloud = new Float64Array(configs.length * 3);
configs.forEach((c, i) => {
  const p = forward(c).position;
  cloud[i * 3] = p[0]; cloud[i * 3 + 1] = p[1]; cloud[i * 3 + 2] = p[2];
});
console.log(`reach cloud: ${configs.length} configurations sampled`);
let shellMin = Infinity;
let shellMax = 0;
for (let i = 0; i < configs.length; i += 1) {
  const r = Math.hypot(cloud[i * 3], cloud[i * 3 + 1], cloud[i * 3 + 2]);
  shellMin = Math.min(shellMin, r);
  shellMax = Math.max(shellMax, r);
}
console.log(`reachable shell: |tool| in [${shellMin.toFixed(1)}, ${shellMax.toFixed(1)}] mm`);

/** Distance from a point to the nearest reachable tool position. */
function clearance(p) {
  let best = Infinity;
  for (let i = 0; i < configs.length; i += 1) {
    const dx = cloud[i * 3] - p[0];
    const dy = cloud[i * 3 + 1] - p[1];
    const dz = cloud[i * 3 + 2] - p[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ------------------------------------------------------------- 24 orientations
const AXES = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const rot = [];
for (const perm of AXES) {
  for (let signs = 0; signs < 8; signs += 1) {
    const s = [signs & 1 ? -1 : 1, signs & 2 ? -1 : 1, signs & 4 ? -1 : 1];
    // rows of M: robot[k] = s[k] * task[perm[k]]
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k += 1) M[k][perm[k]] = s[k];
    const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
      - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
      + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    if (Math.round(det) === 1) rot.push({ M, id: `x${perm[0]}y${perm[1]}z${perm[2]}|${s.join('')}` });
  }
}

const applyM = (M, p) => [
  M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2],
  M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2],
  M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2],
];

/** Worst / mean clearance of a decimated trajectory under one placement. */
function scoreTask(task, M, home) {
  const wps = taskWaypoints(task, [0, 0, 0]);
  let worst = 0;
  let mean = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(wps.length / DECIMATE));
  for (let i = 0; i < wps.length; i += step) {
    const q = applyM(M, wps[i].p);
    const c = clearance([q[0] + home[0], q[1] + home[1], q[2] + home[2]]);
    worst = Math.max(worst, c);
    mean += c;
    n += 1;
  }
  return { worst, mean: mean / n };
}

/** Coarse-to-fine translation search for one task under one orientation. */
function searchHome(task, M) {
  let best = null;
  const ranges = [
    { x: [-300, 300, 150], y: [-300, 300, 150], z: [-1200, 0, 200] },
    { x: [-120, 120, 60], y: [-120, 120, 60], z: [-200, 200, 50] },
    { x: [-40, 40, 20], y: [-40, 40, 20], z: [-50, 50, 25] },
  ];
  for (const r of ranges) {
    const start = best ? best.home : [0, 0, 0];
    const grid = best
      ? {
        x: [start[0] + r.x[0], start[0] + r.x[1], r.x[2]],
        y: [start[1] + r.y[0], start[1] + r.y[1], r.y[2]],
        z: [start[2] + r.z[0], start[2] + r.z[1], r.z[2]],
      }
      : r;
    for (let x = grid.x[0]; x <= grid.x[1]; x += grid.x[2]) {
      for (let y = grid.y[0]; y <= grid.y[1]; y += grid.y[2]) {
        for (let z = grid.z[0]; z <= grid.z[1]; z += grid.z[2]) {
          const res = scoreTask(task, M, [x, y, z]);
          if (!best || res.worst < best.worst - 1e-9
            || (Math.abs(res.worst - best.worst) < 1e-9 && res.mean < best.mean)) {
            best = { home: [x, y, z], worst: res.worst, mean: res.mean };
          }
        }
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------- sweep
console.log('\n== orientation sweep ==');
const ranked = [];
for (const { M, id } of rot) {
  const per = {};
  let worst = 0;
  for (const task of Object.keys(TASKS)) {
    const r = searchHome(task, M);
    per[task] = r;
    worst = Math.max(worst, r.worst);
  }
  ranked.push({ id, M, per, worst });
}
ranked.sort((a, b) => a.worst - b.worst);
console.log('  worst clearance per orientation (lower is better), top 5:');
for (const r of ranked.slice(0, 5)) {
  const detail = Object.entries(r.per).map(([k, v]) => `${k} ${v.worst.toFixed(0)}`).join('  ');
  console.log(`    ${r.id.padEnd(14)} ${r.worst.toFixed(1)} mm   ${detail}`);
}
const winner = ranked[0];
console.log(`\n  winner: ${winner.id}`);
for (const [task, v] of Object.entries(winner.per)) {
  console.log(`    ${task.padEnd(12)} home [${v.home.map((n) => n.toFixed(0)).join(', ')}] mm  clearance ≤ ${v.worst.toFixed(1)} mm`);
}

// ------------------------------------------------------- confirm with the IK
console.log('\n== confirmation with the damped-least-squares solver ==');
const solver = new Solver(undefined, { samples: 1500, restarts: 6 });
const axis = applyM(winner.M, [0, 0, -1]);
const confirmed = {};
let allGood = true;
for (const [task, v] of Object.entries(winner.per)) {
  const wps = taskWaypoints(task, [0, 0, 0]).map((w) => {
    const q = applyM(winner.M, w.p);
    return [q[0] + v.home[0], q[1] + v.home[1], q[2] + v.home[2]];
  });
  let seed = null;
  let worst = 0;
  let mean = 0;
  let misses = 0;
  for (const p of wps) {
    const r = solver.solve(p, seed, axis, { axisWeight: 0.15 });
    seed = r.state;
    worst = Math.max(worst, r.err);
    mean += r.err / wps.length;
    if (r.err > 5) misses += 1;
  }
  confirmed[task] = { home: v.home, worst, mean, misses, total: wps.length };
  const good = worst < 5;
  allGood = allGood && good;
  console.log(`    ${task.padEnd(12)} worst ${worst.toFixed(2)} mm  mean ${mean.toFixed(2)}  misses ${misses}/${wps.length}  home [${v.home.map((n) => n.toFixed(0)).join(', ')}]  ${good ? 'ok' : 'NEEDS WORK'}`);
}
console.log(`\n${allGood ? 'all tasks track within 5 mm' : 'some tasks still miss — offsets need another round'}`);

if (WRITE) {
  console.log('\n// ---- paste into ts/sim/placement.ts ----');
  console.log(`export const MATLAB_TO_ROBOT = [${winner.M.map((row) => `[${row.join(', ')}]`).join(', ')}];`);
  console.log('export const TASK_HOMES: Record<string, Vec3> = {');
  for (const [task, v] of Object.entries(confirmed)) {
    console.log(`  '${task}': [${v.home.map((n) => n.toFixed(0)).join(', ')}],`);
  }
  console.log('};');
}
if (!allGood) process.exitCode = 2;
