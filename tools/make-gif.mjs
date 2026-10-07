#!/usr/bin/env node
/**
 * make-gif.mjs — renders the ported MATLAB animation to a GIF.
 *
 * The motion comes from `ts/sim` (compiled to `js/` by `ts-emit.mjs`): the
 * constant-curvature FK and its damped-least-squares inverse, the calibrated
 * task placements, the waypoint densifier, the servo rate limit, the pauses and
 * the tool-motor pulses. This script adds nothing to the physics — it samples
 * that trajectory and draws it with `tools/raster.js`, then encodes the frames
 * with `tools/gif.js`. No browser, no dependencies.
 *
 *   node --disable-warning=ExperimentalWarning tools/make-gif.mjs
 *   node ... tools/make-gif.mjs --task=bulb --frames=4 --still=2
 *   node ... tools/make-gif.mjs --stills          # one PNG per task, no GIF
 */
import { emit } from './ts-emit.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Raster, add, sub, mul, normalize, mix } from './raster.js';
import { GifWriter, medianCut, paletteLookup } from './gif.js';
import { encodePng } from '../.check/softcanvas.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
emit({ quiet: true });
const J = (p) => import(pathToFileURL(join(ROOT, 'js', p)).href);

const { TRUNC, segmentTransform } = await J('trunc/kinematics.js');
const { mul: mat4 } = await J('trunc/math.js');
const { ArmAnimation } = await J('sim/animation.js');
const { robotWaypoints, homeFor, robotToApp, taskExtent } = await J('sim/placement.js');

// ------------------------------------------------------------------ options
const flag = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const W = Number(flag.width ?? 720);
const H = Number(flag.height ?? 540);
const SS = Number(flag.ss ?? 2);
const PER_TASK = Number(flag.frames ?? 8);
const DELAY = Number(flag.delay ?? 130);       // ms per GIF frame
const TASKS = flag.task ? [String(flag.task)]
  : ['circle', 'triangle', 'steps', 'motherboard', 'bulb'];
const OUT = String(flag.out ?? join(ROOT, 'docs', 'trunc-animation.gif'));
const STILLS = Boolean(flag.stills);
const STILL = flag.still ? Number(flag.still) : null;
const CARD_DELAY = Number(flag.card ?? 2200);  // ms for the results card

const C = {
  sky: [[28, 32, 44], [10, 12, 17]],
  grid: [[64, 72, 90], [30, 34, 46]],
  base: [72, 80, 96],
  baseTop: [96, 106, 124],
  truss: [138, 146, 162],
  trussDark: [74, 80, 94],
  cell: [58, 64, 78],
  guide: [206, 214, 228],
  tendon: [240, 176, 84],
  tendonIdle: [148, 118, 74],
  tool: [214, 220, 230],
  path: [78, 96, 130],
  pathDone: [120, 190, 255],
  trace: [120, 214, 190],
  target: [112, 232, 188],
  motor: [248, 148, 92],
  text: [228, 234, 244],
  dim: [146, 156, 174],
  accent: [116, 198, 255],
  panel: [14, 17, 24],
  border: [50, 58, 74],
  prop: [96, 106, 124],
  propLit: [150, 160, 180],
};

// ------------------------------------------------------------- arm geometry
const SPINE_N = 13;       // samples per segment (the tube reads smooth at this)

const crossV = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const toAppM = (p) => mul(robotToApp(p), 0.001);          // mm, robot -> m, app
const frameU = (dir) => normalize(
  Math.abs(dir[1]) > 0.85 ? crossV([1, 0, 0], dir) : crossV([0, 1, 0], dir),
);

/**
 * The whole arm in app space, walked through the ported segment transforms:
 * three truss segments, the guide collars between them, the nine tendons and
 * the tool. Sampling inside a segment means multiplying the accumulated frame
 * by a partial `Segment_transform`, which follows the real constant-curvature
 * arc instead of interpolating a chord.
 */
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function armGeometry(state) {
  const lens = [TRUNC.split[0], TRUNC.split[1], TRUNC.split[2]].map((f) => f * state.L);
  const joints = [
    [state.t1, state.t2],
    [state.t3, state.t4],
    [state.t5, state.t6],
  ];
  let T = IDENT;
  const arcs = [];
  const collars = [];
  for (let s = 0; s < 3; s += 1) {
    collars.push(toAppM([T[12], T[13], T[14]]));
    const [a, b] = joints[s];
    const arc = [];
    for (let i = 0; i <= SPINE_N; i += 1) {
      const Ti = mat4(T, segmentTransform(a, b, -lens[s] * (i / SPINE_N)));
      arc.push(toAppM([Ti[12], Ti[13], Ti[14]]));
    }
    arcs.push(arc);
    T = mat4(T, segmentTransform(a, b, -lens[s]));
  }
  collars.push(toAppM([T[12], T[13], T[14]]));
  const Tt = mat4(T, segmentTransform(0, 0, -state.toolLength));
  return { arcs, collars, tip: toAppM([Tt[12], Tt[13], Tt[14]]), spine: arcs.flat() };
}

/** Tendon polylines: three per module, on a circle around the spine. */
function tendonLines(arcs, radius, phase) {
  const out = [[], [], []];
  for (const arc of arcs) {
    for (let i = 0; i < arc.length; i += 1) {
      const p = arc[i];
      const dir = normalize(sub(
        arc[Math.min(arc.length - 1, i + 1)],
        arc[Math.max(0, i - 1)],
      ));
      const u = frameU(dir);
      const v = crossV(dir, u);
      for (let k = 0; k < 3; k += 1) {
        const a = (k / 3) * Math.PI * 2 + phase;
        out[k].push(add(p, add(mul(u, Math.cos(a) * radius), mul(v, Math.sin(a) * radius))));
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ props
/** Task furniture, so each of the five tasks reads differently. */
function props(task, path) {
  const items = [];
  const pts = path.map(toAppM);
  if (task === 'motherboard') {
    const p1 = pts[Math.floor(pts.length * 0.35)];
    const p2 = pts[Math.floor(pts.length * 0.55)];
    const x0 = Math.min(p1[0], p2[0]) - 0.06;
    const x1 = Math.max(p1[0], p2[0]) + 0.06;
    const z0 = Math.min(p1[2], p2[2]) - 0.05;
    const z1 = Math.max(p1[2], p2[2]) + 0.05;
    const y = Math.min(...pts.map((p) => p[1])) - 0.012;
    items.push({ kind: 'quad', corners: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], rgb: C.prop });
    for (const q of [p1, p2]) {
      items.push({ kind: 'cyl', a: [q[0], y, q[2]], b: [q[0], y + 0.022, q[2]], r: 0.011, rgb: C.propLit });
    }
  }
  if (task === 'bulb') {
    const socket = pts[pts.length - 1];
    items.push({ kind: 'cyl', a: [socket[0], socket[1] - 0.07, socket[2]], b: socket, r: 0.026, rgb: C.prop });
    items.push({ kind: 'sphere', c: [socket[0], socket[1] + 0.045, socket[2]], r: 0.035, rgb: [206, 214, 226] });
  }
  return items;
}

function drawProps(r, items) {
  for (const it of items) {
    if (it.kind === 'quad') {
      const n = normalize(crossV(sub(it.corners[1], it.corners[0]), sub(it.corners[3], it.corners[0])));
      const n2 = n[1] < 0 ? mul(n, -1) : n;
      const col = mix(it.rgb, [255, 255, 255], 0.35 * Math.max(0, -n2[1] * 0.4 + 0.25));
      for (let i = 1; i < it.corners.length - 1; i += 1) {
        r.tri3(it.corners[0], it.corners[i], it.corners[i + 1], col);
      }
    }
    if (it.kind === 'cyl') r.cyl3(it.a, it.b, it.r, it.rgb, { segments: 14, cap: true });
    if (it.kind === 'sphere') r.sphere3(it.c, it.r, it.rgb, { rings: 9, segments: 14 });
  }
}

// ------------------------------------------------------------------ camera
function cameraFor(task, model) {
  // The arm runs from the base at the origin up to the task volume, so the
  // camera sits back far enough for both to be in shot with the whole task.
  const c = model.centre.map((v) => v / 1000);
  const target = [c[0] * 0.22, Math.max(0.34, c[1] * 0.52), c[2] * 0.22];
  const span = Math.max(0.7, model.radius + Math.hypot(c[0], c[1], c[2]) * 0.5);
  const yaw = { circle: 0.55, triangle: 0.8, steps: 0.35, motherboard: -0.5, bulb: 1.15 }[task] ?? 0.6;
  return { yaw, pitch: 0.26, dist: span * 1.45 + 0.34, target };
}

// ------------------------------------------------------------------- scene
function layout() {
  return {
    pad: 10,
    title: [10, 10, 196, 32],
    info: [10, 48, 244, 76],
    legend: [10, 132, 244, 60],
    bars: [W - 122, 10, 112, 164],
    bar: [0, 10, 0, 0],
  };
}

function drawScene(r, s) {
  const { frame, path, trace, task, taskIndex, taskCount, model, geom, view } = s;
  r.clearGradient(C.sky[0], C.sky[1]);

  // ---------------------------------------------------------------- ground
  const G = 0.62;
  for (let i = -7; i <= 7; i += 1) {
    const t = Math.abs(i / 7);
    const col = mix(C.grid[0], C.grid[1], t);
    r.line3([(i / 7) * G, 0, -G], [(i / 7) * G, 0, G], col, 1);
    r.line3([-G, 0, (i / 7) * G], [G, 0, (i / 7) * G], col, 1);
  }
  // base mount
  r.cyl3([0, -0.012, 0], [0, 0.03, 0], 0.082, C.base, { segments: 20, cap: true });
  r.cyl3([0, 0.03, 0], [0, 0.042, 0], 0.055, C.baseTop, { segments: 20, cap: true });

  drawProps(r, s.items);

  // ------------------------------------------------------------- trajectory
  const pts = path.map(toAppM);
  for (let i = 1; i < pts.length; i += 1) {
    const done = i <= frame.waypoint + 1;
    r.line3(pts[i - 1], pts[i], done ? C.pathDone : C.path, done ? 2 : 1);
  }
  // executed tool trace
  for (let i = 1; i < trace.length; i += 1) r.line3(trace[i - 1], trace[i], C.trace, 1);

  // target marker
  const target = toAppM(frame.target);
  const tcol = frame.motorOn ? C.motor : C.target;
  r.disc3(target, view.up, 0.018, tcol, 14);
  r.line3(add(target, [-0.03, 0, 0]), add(target, [0.03, 0, 0]), tcol, 1);
  r.line3(add(target, [0, 0, -0.03]), add(target, [0, 0, 0.03]), tcol, 1);

  // -------------------------------------------------------------- the arm
  const tendonR = 0.036;
  const tension = frame.cableDelta;
  const lo = [0, 1, 2].map((k) => Math.min(...[0, 3, 6].map((o) => tension[o + k])));
  for (let k = 0; k < 3; k += 1) {
    const heat = Math.min(1, Math.max(0, (Math.abs(tension[k]) - Math.abs(lo[k])) / 45));
    const col = mix(C.tendonIdle, C.tendon, heat);
    const lines = tendonLines(geom.arcs, tendonR, (k / 3) * Math.PI * 2 + Math.PI / 2);
    for (let i = 1; i < lines[0].length; i += 1) r.line3(lines[0][i - 1], lines[0][i], col, 2);
    for (let i = 1; i < lines[1].length; i += 1) r.line3(lines[1][i - 1], lines[1][i], col, 2);
    for (let i = 1; i < lines[2].length; i += 1) r.line3(lines[2][i - 1], lines[2][i], col, 2);
  }
  // truss tube, cell rings, guide collars
  r.tube3(geom.spine, 0.0245, C.truss, { segments: 16 });
  for (let i = 2; i < geom.spine.length - 1; i += 1) {
    const dir = normalize(sub(geom.spine[i + 1], geom.spine[i - 1]));
    r.disc3(geom.spine[i], dir, 0.0255, C.cell, 16);
  }
  for (const c of geom.collars) {
    const dir = normalize(sub(geom.tip, [0, 0, 0]));
    r.cyl3(sub(c, mul(dir, 0.008)), add(c, mul(dir, 0.008)), 0.042, C.guide, { segments: 18, cap: true });
  }
  // tool
  const last = geom.arcs[2][geom.arcs[2].length - 1];
  const tdir = normalize(sub(geom.tip, last));
  r.cyl3(last, mix(last, geom.tip, 0.72), 0.021, C.tool, { segments: 14, cap: true });
  r.cyl3(mix(last, geom.tip, 0.72), geom.tip, 0.011, C.tool, { segments: 12, cap: true });
  r.disc3(geom.tip, tdir, 0.012, frame.motorOn ? C.motor : C.accent, 12);

  // ------------------------------------------------------------------ HUD
  const L = layout();
  r.panel(...L.title, C.panel, C.border);
  r.text(L.title[0] + 6, L.title[1] + 5, 'TRUNC ARM', C.accent, 2);
  r.text(L.title[0] + 6, L.title[1] + 20, 'MATLAB PORT  TS + JS', C.dim, 1);

  const p = frame.ee;
  const info = [
    `TASK ${taskIndex + 1}/${taskCount}  ${task.toUpperCase()}`,
    `PHASE ${frame.phase.toUpperCase()}`,
    `WAYPOINT ${frame.waypoint + 1}/${s.waypointCount}`,
    `TOOL ${p.map((v) => v.toFixed(0)).join(', ')} MM`,
    `ERROR ${frame.err.toFixed(2)} MM`,
    frame.motorOn ? `MOTOR ON  ${frame.motorRemaining.toFixed(1)} S` : 'MOTOR OFF',
  ];
  r.panel(...L.info, C.panel, C.border);
  info.forEach((line, i) => r.text(L.info[0] + 6, L.info[1] + 5 + i * 11, line, i === 1 ? C.accent : C.text, 1));

  // nine cable deltas, three per module
  const [bx, by, bw, bh] = L.bars;
  r.panel(bx, by, bw, bh, C.panel, C.border);
  r.text(bx + 6, by + 5, 'CABLE DELTA MM', C.dim, 1);
  for (let m = 0; m < 3; m += 1) r.text(bx + 10 + m * 36, by + 17, `M${m + 1}`, C.dim, 1);
  for (let i = 0; i < 9; i += 1) {
    const d = frame.cableDelta[i];
    const mod = Math.floor(i / 3);
    const col = i % 3;
    const cx = bx + 8 + mod * 36;
    const cy = by + 30 + col * 42;
    r.text(cx, cy, `${d >= 0 ? '+' : ''}${d.toFixed(0)}`, C.dim, 1);
    const zero = cy + 26;
    r.rect(cx + 2, zero - 1, 18, 1, C.border);
    const h = Math.min(22, Math.abs(d) / 4);
    r.rect(cx + 7, d >= 0 ? zero - h : zero, 8, h, [C.tendon, C.accent, C.tendonIdle][col]);
  }
  const legendY = by + 158;
  ['C1', 'C2', 'C3'].forEach((lab, i) => {
    r.text(bx + 6 + i * 34, legendY, lab, [C.tendon, C.accent, C.tendonIdle][i], 1);
  });

  // what the colours mean: the TRUNC parts the arm is built from
  const [lx, ly, lw, lh] = L.legend;
  r.panel(lx, ly, lw, lh, C.panel, C.border);
  r.text(lx + 6, ly + 5, 'ARM  TRUSS / EQUATORIAL GUIDES', C.dim, 1);
  const key = [
    [C.truss, 'TRUSS SEGMENT (3)', 0],
    [C.guide, 'GUIDE COLLAR (4)', 1],
    [C.tendon, 'TENDON x3 PER MODULE', 2],
    [C.trace, 'TOOL TRACE', 3],
  ];
  key.forEach(([col, label, i]) => {
    const ky = ly + 18 + i * 10;
    r.rect(lx + 6, ky, 7, 7, col);
    r.rect(lx + 6, ky, 7, 1, [0, 0, 0]);
    r.text(lx + 18, ky + 1, label, C.text, 1);
  });
  const kx = lx + 152;
  r.text(kx, ly + 18, 'TASK PATH', C.path, 1);
  r.rect(kx, ly + 27, 7, 7, C.pathDone);
  r.text(kx + 12, ly + 28, 'TRAVELLED', C.text, 1);
  r.rect(kx, ly + 38, 7, 7, C.target);
  r.text(kx + 12, ly + 39, 'WAYPOINT', C.text, 1);
  r.rect(kx, ly + 49, 7, 7, C.motor);
  r.text(kx + 12, ly + 50, 'TOOL MOTOR', C.text, 1);

  // bottom progress + caption
  const prog = (frame.waypoint + 1) / s.waypointCount;
  r.rect(L.pad, H - 22, W - 2 * L.pad, 7, [24, 28, 38]);
  r.rect(L.pad, H - 22, (W - 2 * L.pad) * prog, 7, C.accent);
  r.text(L.pad, H - 38, `T ${frame.time.toFixed(1)} S   HOME ${s.home.map((v) => v.toFixed(0)).join(',')} MM   CABLE TRAVEL ${s.travel.toFixed(0)} MM`, C.dim, 1);

  // marks for the waypoints still to come, so the bar reads as progress
  const step = Math.max(1, Math.ceil(s.waypointCount / 48));
  for (let i = frame.waypoint + step; i < s.waypointCount; i += step) {
    const x = L.pad + ((W - 2 * L.pad) * i) / s.waypointCount;
    r.rect(x, H - 22, 1, 7, [46, 52, 68]);
  }
}

/** The end card: the port's own summary numbers for every task. */
function drawCard(r, rows, totals) {
  r.clearGradient([20, 24, 34], [10, 12, 17]);
  const top = Math.round(H * 0.16);
  r.text(W / 2 - 156, top, 'TRUNC MATLAB PORT', C.accent, 3);
  r.text(W / 2 - 156, top + 34, 'TS + JS  TENDON-DRIVEN ARM  REPLAY', C.dim, 1);
  let y = top + 76;
  const cols = [56, 262, 366, 486, 606];
  const head = ['TASK', 'WAYPOINTS', 'SETTLED MM', 'CABLE MM', 'MOTOR S'];
  head.forEach((hn, i) => r.text(cols[i], y, hn, C.dim, 1));
  y += 14;
  r.rect(46, y - 4, W - 92, 1, C.border);
  for (const row of rows) {
    y += 20;
    cols.forEach((cx, i) => r.text(cx, y, String(row[i]), i === 0 ? C.text : C.dim, 2));
  }
  y += 34;
  r.rect(46, y - 10, W - 92, 1, C.border);
  y += 6;
  r.text(56, y, `MISSED WAYPOINTS ${totals.missed}   SIM FRAMES ${totals.frames}   MEAN ERROR ${totals.mean.toFixed(2)} MM`, C.text, 1);
  r.text(56, y + 16, `SIMULATED ${totals.seconds.toFixed(1)} S   GEOMETRY FROM THE PORTED FORWARD KINEMATICS`, C.dim, 1);
  r.text(56, y + 32, 'TRUNC = TRUSS + EQUATORIAL GUIDE  TORQUE-TRANSMITTING JOINTS', C.dim, 1);
}

// --------------------------------------------------------------------- main
const raster = new Raster(W, H, { supersample: SS });
const frames = [];
const delays = [];
const samples = [];
const rows = [];
const totals = { missed: 0, frames: 0, mean: 0, seconds: 0, n: 0 };
const started = Date.now();

console.log(`rendering ${TASKS.length} task(s) — ${W}x${H} ss=${SS}, ${PER_TASK} frames each`);

for (let ti = 0; ti < TASKS.length; ti += 1) {
  const task = TASKS[ti];
  const home = homeFor(task);
  const model = taskExtent(task, home);
  const path = robotWaypoints(task, home);
  const view = { ...cameraFor(task, model), up: [0, 1, 0] };
  const items = props(task, path);

  const anim = new ArmAnimation({ task, dt: 1 / 60, pauseLength: 0.1, operatorWait: 0.15 });
  const all = [];
  while (!anim.done && all.length < 60000) all.push(anim.step());
  // Pick frames that cover the motion: every new waypoint, plus a pick whenever
  // the tool has travelled far enough. Sampling by time would drown in pauses.
  const moving = [];
  let last = null;
  for (let i = 0; i < all.length; i += 1) {
    const p = all[i].ee;
    const d = last ? Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) : Infinity;
    if (i === 0 || all[i].waypoint !== all[i - 1].waypoint || d > 5) {
      moving.push(i);
      last = p;
    }
  }
  const stride = Math.max(1, Math.ceil(moving.length / PER_TASK));
  const picks = [];
  for (let i = 0; i < moving.length; i += stride) picks.push(moving[i]);
  if (picks[picks.length - 1] !== all.length - 1) picks.push(all.length - 1);
  const summary = anim.run();
  console.log(`  ${task}: ${all.length} sim frames, ${moving.length} motion picks -> ${picks.length} drawn, settled ${(summary.maxSettledError ?? 0).toFixed(2)} mm, missed ${summary.missed}`);

  rows.push([
    task,
    `${picks.length}/${all.length}`,
    (summary.maxSettledError ?? 0).toFixed(2),
    (summary.cableTravel ?? 0).toFixed(0),
    (summary.motorSeconds ?? 0).toFixed(1),
  ]);
  totals.missed += summary.missed ?? 0;
  totals.frames += all.length;
  totals.mean += summary.meanError ?? 0;
  totals.seconds += summary.seconds ?? 0;
  totals.n += 1;

  const trace = [];
  for (const idx of picks) {
    const frame = all[idx];
    const geom = armGeometry(frame.state);
    trace.push(geom.tip);
    raster.setCamera(view);
    drawScene(raster, {
      frame, path, trace, task, taskIndex: ti, taskCount: TASKS.length,
      model, geom, view, items, home,
      waypointCount: Math.max(1, anim.waypoints.length),
      travel: summary.cableTravel ?? 0,
    });
    const rgba = raster.resolve();
    frames.push(rgba);
    delays.push(DELAY);
    if (samples.length < 40) samples.push(rgba);
    if (STILL !== null && frames.length === STILL) {
      writeFileSync('/tmp/still.png', encodePng(rgba, W, H, 1));
      console.log(`  wrote /tmp/still.png (frame ${STILL})`);
    }
    if (STILLS) writeFileSync(`/tmp/still-${task}.png`, encodePng(rgba, W, H, 1));
  }
}

// results card
drawCard(raster, rows, { ...totals, mean: totals.mean / Math.max(1, totals.n) });
const card = raster.resolve();
frames.push(card);
delays.push(CARD_DELAY);
samples.push(card);

if (!flag.nogif) {
  const palette = medianCut(samples.map((data) => ({ data })), 256);
  const writer = new GifWriter(W, H, palette);
  const lookup = paletteLookup(palette);
  frames.forEach((f, i) => writer.addFrame(writer.quantise(f, lookup, { dither: i === 0 }), delays[i]));
  const bytes = writer.finish();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`wrote ${OUT} — ${frames.length} frames, ${palette.length} colours, ${(bytes.length / 1024).toFixed(0)} kB`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.table ? console.table(rows.map((r) => [r[0], r[1], r[2], r[3], r[4]])) : null;
