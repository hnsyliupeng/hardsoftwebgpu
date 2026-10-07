#!/usr/bin/env node
/**
 * make-gif.mjs — renders the ported MATLAB animation to a GIF.
 *
 * Nothing about the motion or the picture is defined here: `src/app/matlabPort.js`
 * is the replay (the same one the CPU page and the WebGPU page run) and
 * `src/app/portScene.js` is the drawing (the same one the CPU page draws). This
 * file only chooses which frames to keep, adds the end card, and encodes.
 *
 *   node --disable-warning=ExperimentalWarning tools/make-gif.mjs
 *   node ... tools/make-gif.mjs --task=bulb --frames=6 --still=3
 *   node ... tools/make-gif.mjs --stills            # one PNG per task, no GIF
 */
import { emit } from './ts-emit.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Raster } from './raster.js';
import { GifWriter, medianCut, paletteLookup } from './gif.js';
import { encodePng } from '../.check/softcanvas.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
emit({ quiet: true });

const { MatlabPort, PORT_TASKS, portGeometry, mm2app, CABLE_RING_M } =
  await import(pathToFileURL(join(ROOT, 'src/app/matlabPort.js')).href);
const { drawScene, drawSummaryCard, cameraFor, portProps } =
  await import(pathToFileURL(join(ROOT, 'src/app/portScene.js')).href);

// ------------------------------------------------------------------ options
const flag = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const W = Number(flag.width ?? 720);
const H = Number(flag.height ?? 540);
const SS = Number(flag.ss ?? 2);
const PER_TASK = Number(flag.frames ?? 14);
const DELAY = Number(flag.delay ?? 110);
const CARD_DELAY = Number(flag.card ?? 3000);
const OUT = String(flag.out ?? join(ROOT, 'docs', 'trunc-animation.gif'));
const STILLS = Boolean(flag.stills);
const STILL = flag.still ? Number(flag.still) : null;
const TASKS = flag.task ? [String(flag.task)] : PORT_TASKS.map((t) => t.id);
const TRAIL_MAX = Number(flag.trail ?? 260);   // points drawn per frame

/**
 * Frames are picked by motion, not by the clock: every waypoint change, plus a
 * pick whenever the tool has moved 4 mm since the last one. Sampling evenly in
 * time would drown the GIF in pauses.
 */
function pickFrames(frames, want) {
  const moving = [];
  let last = null;
  for (let i = 0; i < frames.length; i += 1) {
    const p = frames[i].ee;
    const d = last ? Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) : Infinity;
    const boundary = i === 0 || frames[i].waypoint !== frames[i - 1].waypoint || frames[i].motorOn !== frames[i - 1].motorOn;
    if (boundary || d > 4) { moving.push(i); last = p; }
  }
  const stride = Math.max(1, Math.ceil(moving.length / want));
  const picks = [];
  for (let i = 0; i < moving.length; i += stride) picks.push(moving[i]);
  if (picks[picks.length - 1] !== frames.length - 1) picks.push(frames.length - 1);
  return picks;
}

// --------------------------------------------------------------------- main
const raster = new Raster(W, H, { supersample: SS });
const frames = [];
const delays = [];
const samples = [];
const rows = [];
const totals = { missed: 0, frames: 0, mean: 0, seconds: 0, n: 0 };
const started = Date.now();

console.log(`rendering ${TASKS.length} task(s) — ${W}×${H} ss=${SS}, ${PER_TASK} frames each`);

for (let ti = 0; ti < TASKS.length; ti += 1) {
  const task = TASKS[ti];
  const params = { pauseLength: 0.1, operatorWait: 0.15 };
  const port = new MatlabPort({ task, params });

  // One pass: every frame, plus the tool's own path so far (cheap, 3 numbers each).
  const all = [];
  const track = [];
  while (!port.anim.done && all.length < 60000) {
    const f = port.step(1);
    all.push(f);
    track.push(f.ee);
  }
  const summary = port.summary();
  const trajectory = port.trajectory();
  const items = portProps(task, trajectory);
  const cam = cameraFor(port.extent(), flag.yaw ? { yaw: Number(flag.yaw) } : {});
  const view = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: cam.target };

  const picks = pickFrames(all, PER_TASK);
  console.log(`  ${task}: ${all.length} sim frames → ${picks.length} drawn · settled ${summary.maxSettledError.toFixed(2)} mm · `
    + `missed ${summary.missed} · motor ${summary.motorSeconds.toFixed(1)} s`);

  rows.push([
    task,
    `${picks.length}/${all.length}`,
    summary.maxSettledError.toFixed(2),
    summary.cableTravel.toFixed(0),
    summary.motorSeconds.toFixed(1),
  ]);
  totals.missed += summary.missed;
  totals.frames += summary.frames;
  totals.mean += summary.meanError;
  totals.seconds += summary.seconds;
  totals.n += 1;

  for (const idx of picks) {
    const f = all[idx];
    const stride = Math.max(1, Math.ceil((idx + 1) / TRAIL_MAX));
    const trail = track.slice(0, idx + 1).filter((_, i) => i % stride === 0).map(mm2app);
    raster.setCamera(view);
    drawScene(raster, {
      geometry: portGeometry(f.state, port.cableRing),
      trajectory,
      trail,
      frame: { ...f, target: mm2app(f.target), ee: mm2app(f.ee) },
      items,
      waypointCount: port.anim.waypoints.length,
      home: port.home,
      summary,
      taskName: task,
      taskIndex: ti,
      taskCount: TASKS.length,
      show: { grid: true, tendons: true, guides: true, path: true, trail: true },
      title: 'TRUNC ARM',
      subtitle: 'MATLAB PORT  ·  TS + JS',
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

drawSummaryCard(raster, rows, { ...totals, mean: totals.mean / Math.max(1, totals.n) });
const card = raster.resolve();
frames.push(card);
delays.push(CARD_DELAY);
samples.push(card);

if (!flag.nogif) {
  const palette = medianCut(samples.map((data) => ({ data })), 256);
  const writer = new GifWriter(W, H, palette);
  const lookup = paletteLookup(palette);
  frames.forEach((f, i) => writer.addFrame(writer.quantise(f, lookup, { dither: false }), delays[i]));
  const bytes = writer.finish();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`wrote ${OUT} — ${frames.length} frames, ${palette.length} colours, ${(bytes.length / 1024).toFixed(0)} kB, cable ring ${(CABLE_RING_M * 1000).toFixed(0)} mm`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
for (const r of rows) console.log(`  ${r[0].padEnd(12)} ${r[1].padStart(9)}  settled ${r[2].padStart(6)} mm  cable ${r[3].padStart(5)} mm  motor ${r[4].padStart(5)} s`);
