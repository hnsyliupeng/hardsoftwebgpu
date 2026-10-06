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
console.log(process.exitCode ? 'FAILED' : 'ALL OK');
