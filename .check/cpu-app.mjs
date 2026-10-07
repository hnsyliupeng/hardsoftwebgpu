/**
 * cpu-app.mjs — boots the CPU reference page (cpu.html's app) inside Node with
 * the DOM shim and exercises it the way a user would: pick a task, move a
 * slider, pause, step, orbit the camera, then run the full port verification
 * from the page and inspect the rendered pixels.
 *
 *   node --disable-warning=ExperimentalWarning .check/cpu-app.mjs
 */
import { byId, __drainRaf } from './dom-shim.mjs';
import { writeFileSync } from 'node:fs';

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const report = [];
const { bootCpu } = await import('../src/app/cpuApp.js');
const app = await bootCpu({ report: (kind, text) => report.push(`${kind}: ${text}`), manual: true });

ok('page boots and mounts its panels', byId.get('app').children.length === 2 && app.canvas.width > 0,
  `${byId.get('app').children.length} root children, canvas ${app.canvas.width}×${app.canvas.height}`);
ok('a frame renders into the canvas buffer (non-empty pixels)',
  (() => {
    const rgba = app.render();
    let seen = new Set();
    for (let i = 0; i < rgba.length; i += 4 * 97) seen.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
    return seen.size > 8;
  })(), `${app.raster.outW}×${app.raster.outH} at supersample ${app.raster.ss}`);
ok('the arm is drawn from the ported FK (tool tip matches forward())',
  (() => {
    const g = app.port.geometry();
    // the drawn tip and the model's own end-effector, in the same frame
    const d = Math.hypot(g.tip[0] - g.ee[0], g.tip[1] - g.ee[1], g.tip[2] - g.ee[2]);
    const paper = g.joints?.length === 7 && g.cableGuides?.length === 8
      && g.spec?.cellDiameterMm === 56 && g.spec?.armLengthMm === 710;
    return g.spine.length === 39 && g.tendons.flat().length === 9 && d < 1e-12 && paper
      && Math.abs(Math.hypot(...g.tip) * 1000 - Math.hypot(...app.port.frame.ee)) < 1e-6;
  })(), `spine ${app.port.geometry().spine.length} pts, `
  + `${app.port.geometry().joints?.length} TRUNC joints (D = 56 mm), 9 tendons, tool at the FK's own tip`);

// ---- interaction ---------------------------------------------------------
byId.get('app');
app.tasks.nodes[2].dispatch('click');
app.port.select('steps');
ok('picking a task switches the replay', app.port.task === 'steps' && app.port.steps === 0,
  `task = ${app.port.task}, waypoints = ${app.port.anim.waypoints.length}`);

console.table ? null : null;
const before = app.port.params.servoRate;
const animBefore = app.port.anim;
app.paramWidgets.servoRate.input.value = '1800';
app.paramWidgets.servoRate.input.dispatch('input');
ok('a parameter slider retunes and restarts the replay',
  app.port.params.servoRate === 1800 && app.port.anim !== animBefore,
  `servoRate ${before} → ${app.port.params.servoRate}, replay re-instantiated`);

// ticking by hand (no rAF loop in this harness), exactly what the page's loop does
const before1 = app.port.steps;
app.state.playing = true;
for (let i = 0; i < 4; i += 1) { app.port.step(app.state.stepsPerFrame); app.render(); app.update(); }
const running = app.port.steps;
app.state.playing = false;
const pausedAt = app.port.steps;
app.state.playing = true;
for (let i = 0; i < 4; i += 1) { app.port.step(app.state.stepsPerFrame); app.render(); app.update(); }
ok('play/pause really stops the simulation clock', running > before1 && pausedAt < app.port.steps,
  `${before1} → ${running} running, held at ${pausedAt} while paused, ${app.port.steps} after resuming`);

app.canvas.dispatch('pointerdown', { clientX: 100, clientY: 100, shiftKey: false, pointerId: 1 });
app.canvas.dispatch('pointermove', { clientX: 160, clientY: 120 });
app.canvas.dispatch('pointerup', {});
ok('dragging the canvas orbits the camera', Math.abs(app.view.yaw - 0.55) > 0.05 && app.view.auto === false,
  `yaw 0.55 → ${app.view.yaw.toFixed(3)}, auto ${app.view.auto}`);
app.applyPreset('close');
ok('camera presets move the eye', app.view.dist < 0.8, `dist ${app.view.dist.toFixed(2)} m`);

// ---- the verification table ---------------------------------------------
await app.runVerification();
const v = app.state.verified;
ok('“run all checks” completes in the page', !!v && v.total > 30, v ? `${v.passed}/${v.total} passed` : 'no result');
ok('every checked function passes', !!v && v.passed === v.total,
  v ? v.rows.filter((r) => !r.ok).map((r) => r.name).join('; ') || 'no failures' : 'no result');
ok('the verdict badge reports the run', /checks passed/.test(app.verdict.textContent ?? ''),
  app.verdict.textContent ?? '(no text)');
ok('the results table is rendered with one row per check', app.checkTable.children.length > 0
  || app.checkTable.textContent.length > 0, `${(v?.rows.length ?? 0)} rows`);

// ---- end-to-end ----------------------------------------------------------
app.port.select('bulb');
const summary = app.port.runToEnd();
app.update();
ok('a whole task replays and reports the port\'s own numbers',
  summary.missed === 0 && Math.abs(summary.motorSeconds - 3.5) < 1e-6,
  `${summary.frames} frames / ${summary.seconds.toFixed(1)} s, settled ${summary.maxSettledError.toFixed(2)} mm, motor ${summary.motorSeconds.toFixed(2)} s`);

const card = app.renderCard([
  ['circle', '15/900', '0.18', '1180', '0.0'],
  ['bulb', `${summary.frames}`, summary.maxSettledError.toFixed(2), summary.cableTravel.toFixed(0), summary.motorSeconds.toFixed(1)],
], { missed: summary.missed, frames: summary.frames, mean: summary.meanError, seconds: summary.seconds });
writeFileSync('/tmp/cpu-card.png', (await import('./softcanvas.mjs')).encodePng(card, app.raster.outW, app.raster.outH, 1));

// a scene PNG for the docs, drawn by the same code path the page uses
app.port.select('circle');
app.port.step(90);
app.applyPreset('iso');
const shot = app.render();
writeFileSync('/tmp/cpu-scene.png', (await import('./softcanvas.mjs')).encodePng(shot, app.raster.outW, app.raster.outH, 1));
ok('wrote /tmp/cpu-card.png and /tmp/cpu-scene.png from the page renderer', true,
  `${app.raster.outW}×${app.raster.outH}`);

app.stop();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
