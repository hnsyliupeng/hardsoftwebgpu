/**
 * Render real frames of the app with its own CPU rasteriser and write PNGs.
 * No browser involved: the DOM shim provides the page, `softcanvas.mjs`
 * provides actual pixels for the canvas the renderer draws into.
 */
import { writeFileSync } from 'node:fs';
import { byId, __drainRaf } from './dom-shim.mjs';
import { attachSoftCanvas, encodePng } from './softcanvas.mjs';

const view = byId.get('view');
const ctx = attachSoftCanvas(view, 1280, 720);

const mod = await import('../src/app/main.js');
const app = await mod.boot({
  setBoot: (t) => process.stdout.write(`  boot: ${t}\n`),
  hideBoot: () => {},
  showError: (t) => { console.log('PAGE ERROR:', String(t).slice(0, 400)); process.exitCode = 1; },
  report: () => {},
});
console.log(`renderer ${app.renderer.constructor.name} · ${app.triangles.toFixed(0)} triangles · meshes ${Object.keys(app.meshes).length}`);

// The rasteriser is the slow part of a screenshot, so advance the simulation
// directly — the same fixed step and options the app's loop uses — and let the
// renderer draw only the frames we actually keep.
const FIXED_DT = 1 / 240;
const STEP_OPTS = { ikIters: 24, residual: true, residualWeight: 1 - 0.25, cableSlew: 0.025 };
const advance = (seconds) => {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i += 1) { app.robot.step(FIXED_DT, STEP_OPTS); app.sim.steps += 1; }
};

const shoot = (name, frames = 1) => {
  __drainRaf(frames);
  app.renderer.present(app.scene, {});
  const png = encodePng(ctx.buf, ctx.canvas.width, ctx.canvas.height, 2);
  writeFileSync(name, png);
  const m = app.robot.metrics();
  console.log(`${name}  ${png.length / 1024 | 0} kB · ${ctx.counts.tris} tri fills · t=${app.robot.time.toFixed(2)}s phase=${m.phaseName} turns=${m.turns.toFixed(2)} bend=${app.robot.telemetry.bend.map((b) => b.toFixed(2)).join('/')} rad`);
  void frames;
};

// 1. boot frame (home pose, bench, all five jobs on the plate)
shoot('docs/screenshot-1-home.png', 2);
// 2. mid-job: the expert is fastening the bolt
advance(9);
shoot('docs/screenshot-2-bolt.png', 1);
// 3. bolt seated, workspace cloud on
advance(18);
app.view.cloud = true;
app.buildCloud();
shoot('docs/screenshot-3-workspace.png', 1);
console.log(process.exitCode ? 'FAILED' : 'SHOTS OK');
