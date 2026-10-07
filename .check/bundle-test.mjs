/**
 * bundle-test.mjs — run the shipped single-file build the way a browser would.
 *
 * The standalone HTML embeds every module as text and hands them to the module
 * loader as blob URLs. Node has no blob URLs but it does import `data:` URLs, so
 * this probe:
 *   1. reads hardsoftwebgpu.html and extracts its <script> blocks in order
 *   2. defines Blob / URL.createObjectURL so that a blob becomes a data: module
 *   3. evaluates the loader block, then imports the entry it produced
 *   4. boots the app with the DOM shim and draws a real frame with the app's own
 *      FallbackRenderer (via the software canvas)
 *
 * If this passes, the bundle's loader, specifier rewriting, inlined shaders and
 * worker wiring are all sound — the only untested part is the browser itself.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { byId, __drainRaf } from './dom-shim.mjs';
import { attachSoftCanvas, encodePng } from './softcanvas.mjs';

const html = readFileSync(new URL('../hardsoftwebgpu.html', import.meta.url), 'utf8');

// ------------------------------------------------ blob → data: URL module shim
// Blob URLs are materialised as real files in a temp dir: Node imports file://
// natively, and every module specifier has already been rewritten to an absolute
// URL by the bundle's loader, so no relative resolution is needed.
const BLOB_DIR = join(tmpdir(), 'hsg-bundle-test');
rmSync(BLOB_DIR, { recursive: true, force: true });
mkdirSync(BLOB_DIR, { recursive: true });
const blobUrls = new Map();
let nextBlob = 0;
globalThis.Blob = class Blob {
  constructor(parts, opts = {}) {
    this.parts = parts.map(String);
    this.type = opts.type ?? '';
  }
  text() { return Promise.resolve(this.parts.join('')); }
};
URL.createObjectURL = (blob) => {
  const text = blob.parts.join('');
  nextBlob += 1;
  const file = join(BLOB_DIR, `mod${String(nextBlob).padStart(3, '0')}.mjs`);
  writeFileSync(file, text);
  blobUrls.set(`blob:${nextBlob}`, file);
  return pathToFileURL(file).href;
};
URL.revokeObjectURL = () => {};

// --------------------------------------------------------------- script blocks
const blocks = [...html.matchAll(/<script(?:\s+type="module")?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
console.log(`index → ${blocks.length} script blocks, ${(html.length / 1024).toFixed(0)} kB standalone`);
if (blocks.length < 2) throw new Error('expected a loader block and a bootstrap block');

// the bootstrap uses top-level await, so run both blocks as modules (also as
// files, so an error can be inspected line by line)
const asModule = (src, tag = 'block') => {
  const file = join(BLOB_DIR, `${tag}.mjs`);
  writeFileSync(file, src);
  return import(pathToFileURL(file).href);
};

const t0 = Date.now();
await asModule(blocks[0], 'loader');            // loader → window.__entryUrl
console.log(`loader ran in ${Date.now() - t0} ms · entry ${String(window.__entryUrl).slice(0, 32)}… · ${blobUrls.size} blob modules mapped`);
if (!window.__entryUrl) throw new Error('loader did not set window.__entryUrl');

// the app draws into #view; give that canvas real pixels before boot
attachSoftCanvas(byId.get('view'), 1280, 720);

// the page reports to the dev server; capture it instead
const report = [];
globalThis.fetch = (url, opts) => {
  if (String(url).includes('/__log') && opts?.body) {
    try { report.push(JSON.parse(opts.body)); } catch { /* ignore */ }
  }
  return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve(''), headers: { get: () => null } });
};
globalThis.location = { protocol: 'file:', search: '', href: 'file:///hardsoftwebgpu.html' };

const bootStart = Date.now();
try {
  await asModule(blocks[1], 'bootstrap');        // page bootstrap → imports the entry, boots
} catch (err) {
  console.log('BOOTSTRAP THREW:', String(err?.message ?? err).split('\n')[0].slice(0, 300));
  console.log(String(err?.stack ?? '').split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
}
const app = globalThis.window.__app;
console.log(`boot ${app ? 'OK' : 'MISSING'} in ${Date.now() - bootStart} ms`);
if (!app) {
  console.log('reported entries:', JSON.stringify(report.slice(-4), null, 1));
  process.exitCode = 1;
} else {
  console.log(`renderer ${app.renderer.constructor.name} · ${app.triangles.toFixed(0)} tris · ${Object.keys(app.meshes).length} meshes`);
  const sim = app.sim;
  for (let i = 0; i < 2400; i += 1) app.robot.step(1 / 240, { ikIters: 24, cableSlew: 0.025, residual: true, residualWeight: 0.75 });
  __drainRaf(2);
  app.renderer.present(app.scene, {});
  writeFileSync(new URL('../docs/screenshot-4-standalone.png', import.meta.url), encodePng(app.renderer.canvas._ctx?.buf ?? app.renderer.ctx.buf, app.renderer.canvas.width, app.renderer.canvas.height, 2));
  const m = app.robot.metrics();
  console.log(`ran 10 s of simulation · phase ${m.phaseName} · turns ${m.turns.toFixed(2)} · wrote docs/screenshot-4-standalone.png`);
  // the inlined MATLAB port must work in the standalone file too
  {
    const { port, portView } = app;
    app.view.portArm = true;
    portView.playing = true;
    port.select('motherboard');
    for (let i = 0; i < 300; i += 1) port.step(1);
    const geo = port.geometry();
    __drainRaf(2);
    app.renderer.present(app.scene, {});
    const summary = port.runToEnd();
    // the roller sits on the cable triangle: 65 mm from the ring's own centre
    const g0 = geo.cableGuides?.[0];
    const rel = g0 && g0.tips[0].map((v, i) => v - g0.p[i]);
    const guideRing = rel && Math.hypot(...rel);
    const paper = geo.joints?.length === 7 && geo.cableGuides?.length === 8
      && geo.spec?.cellDiameterMm === 56 && geo.spec?.armLengthMm === 710
      && Math.abs(guideRing * 1000 - 65) < 1e-6;
    const good = paper && geo.tendons.flat().length === 9
      && summary.missed === 0 && Math.abs(summary.motorSeconds - 21) < 1e-6;
    console.log(`inlined MATLAB port · task ${port.task} · ${geo.joints.length} TRUNC joints (D = ${geo.spec.cellDiameterMm} mm), `
      + `${geo.cableGuides.length} cable guides at ${(guideRing * 1000).toFixed(0)} mm, ${geo.tendons.flat().length} tendons · `
      + `replay ${summary.frames} frames, motor ${summary.motorSeconds.toFixed(1)} s, missed ${summary.missed}`);
    const res = await app.verifyPort();
    console.log(`port verification in the standalone file: ${res.passed}/${res.total}`);
    if (!good || res.passed !== res.total) process.exitCode = 1;
  }
  // the engine checks must run inside the standalone file as well
  {
    const res = await app.runEngineChecks(() => {});
    const failed = res.rows.filter((r) => !r.ok);
    console.log(`engine checks in the standalone file: ${res.passed}/${res.total}`
      + (failed.length ? ` — FAIL ${failed[0].group}/${failed[0].name}: ${failed[0].detail}` : ''));
    if (failed.length) process.exitCode = 1;
  }
  console.log(report.length ? `page reports: ${JSON.stringify(report.slice(-3))}` : 'page reports: (none — nothing went wrong)');
}
console.log(process.exitCode ? 'BUNDLE FAILED' : 'BUNDLE OK — standalone boots and renders');
