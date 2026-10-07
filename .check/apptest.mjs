import { byId, __drainRaf } from './dom-shim.mjs';
const report = [];
globalThis.__reportLog = report;
const mod = await import('../src/app/main.js');
const app = await mod.boot({
  setBoot: (t) => process.stdout.write(`  boot: ${t}\n`),
  hideBoot: () => {},
  showError: (t) => { console.log('PAGE ERROR:', String(t).slice(0, 600)); process.exitCode = 1; },
  report: (kind, text) => { report.push({ kind, text }); },
});
console.log('\n--- booted ---');
console.log('meshes:', Object.keys(app.meshes).length, 'triangles:', app.triangles.toFixed(0));
console.log('renderer:', app.renderer.constructor.name, 'camera dist', app.camera.dist.toFixed(2));
console.log('hud left panels:', byId.get('left').children.length, ' right panels:', byId.get('right').children.length);
console.log('labels in overlay:', byId.get('overlay').children.length);
// run some frames
__drainRaf(6);
console.log('after frames: steps', app.sim.steps, 'robot time', app.robot.time.toFixed(2), 'phase', app.robot.metrics().phaseName);
// exercise the interactive API surface the HUD would call
const scene = app.scene;
console.log('scene meshes:', scene.meshes.size, 'lines', scene.lines.length / 7, 'sprites', scene.sprites.length / 5);
app.view.cloud = true; app.view.trail = true; app.hud.update(1 / 60);
console.log('cloud points:', app.buildCloud());
// modes + manual target + camera presets
app.robot.setMode('manual');
app.robot.setManualTarget({ x: 0.2, y: 0.6, z: 0.1 }, { x: 0, y: 1, z: 0 });
app.robot.setMode('learned');
__drainRaf(3);
app.robot.setMode('expert');
app.robot.selectTask(4);
__drainRaf(3);
console.log('multi-stage index:', app.robot.taskIndex, 'objective ok');
console.log('report entries:', JSON.stringify(report.slice(0, 6)));

// ---- the MATLAB port panel on the WebGPU page ----------------------------
{
  const { port, portView, portPanel } = app;
  app.view.portArm = true;
  port.select('bulb');
  portView.playing = true;
  for (let i = 0; i < 200; i += 1) port.step(1);
  const geo = port.geometry();
  const entities = app.renderer.constructor.name;
  console.log('port arm: task', port.task, '| joints', geo.joints.length, '(D =', geo.spec.cellDiameterMm, 'mm) | cable guides',
    geo.cableGuides.length, '| tendons', geo.tendons.flat().length, '| spine pts', geo.spine.length);
  console.log('port readouts:', JSON.stringify(Object.fromEntries(port.readouts()).phase));
  const summary = port.runToEnd();
  console.log('port replay:', summary.frames, 'frames /', summary.seconds.toFixed(1), 's | settled',
    summary.maxSettledError.toFixed(2), 'mm | missed', summary.missed, '| motor', summary.motorSeconds.toFixed(2), 's');
  const res = await app.verifyPort((i, n, label) => { if (i === 1 || i === n) console.log(`  verify [${i}/${n}] ${label}`); });
  console.log('port verification inside the WebGPU page:', `${res.passed}/${res.total}`);
  const bad = res.rows.filter((r) => !r.ok);
  if (bad.length) { console.log('  failures:', bad.map((r) => r.name).join('; ')); process.exitCode = 1; }
  if (summary.missed !== 0 || Math.abs(summary.motorSeconds - 3.5) > 1e-6) process.exitCode = 1;
  if (!(geo.cells.length > 5 && geo.tendons.flat().length === 9 && geo.guides.length === 4)) process.exitCode = 1;
  void portPanel; void entities;
}

console.log(process.exitCode ? 'FAILED' : 'ALL OK');
