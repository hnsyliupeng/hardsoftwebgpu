/**
 * cpuApp.js — the CPU reference front end.
 *
 * This page is the "does everything work" page: it draws the ported MATLAB arm
 * with `tools/raster.js` (no GPU, no WGSL, no WebGPU adapter) and it can run the
 * full port verification from the GUI, one row per checked function. If
 * something is wrong in the port, it is wrong *here*, on the CPU page, before
 * the WebGPU page ever gets involved.
 *
 * Layout: task + playback + parameters on the left, live readouts, cable deltas
 * and the verification table on the right, the rasterised scene in the middle.
 */
import { Raster } from '../../tools/raster.js';
import {
  MatlabPort, PORT_TASKS, PARAM_SPECS, DEFAULT_PARAMS, CABLE_RING_M, verifyPort, portGeometry,
} from './matlabPort.js';
import { drawScene, drawSummaryCard, cameraFor, portProps, SCENE } from './portScene.js';
import {
  panel, slider, toggle, select, button, buttonRow, readout, barBank, taskList, toast, el,
} from '../ui/panels.js';

const CSS_EXTRA = `
  body.cpu #app { display: grid; height: 100vh; grid-template-rows: 40px 1fr 28px;
    grid-template-areas: "head" "main" "foot"; }
  body.cpu header { grid-area: head; }
  body.cpu header h1 { font-size: 13px; }
  body.cpu .cpu-grid { grid-area: main; display: grid; gap: 10px; overflow: hidden;
    grid-template-columns: 268px minmax(0, 1fr) 312px; padding: 10px; }
  body.cpu .cpu-col { display: flex; flex-direction: column; gap: 9px; overflow-y: auto; overflow-x: hidden; padding-right: 3px; }
  body.cpu .cpu-stage { position: relative; flex: 1 1 auto; min-height: 0; border: 1px solid var(--line);
    border-radius: 8px; overflow: hidden; background: #0a0c12; }
  body.cpu .cpu-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
  body.cpu .cpu-stage canvas.dragging { cursor: grabbing; }
  body.cpu .cpu-badge { position: absolute; top: 8px; right: 8px; font-family: var(--mono); font-size: 10px;
    padding: 3px 7px; border-radius: 5px; background: rgba(10,14,20,0.78); border: 1px solid var(--line); color: var(--accent-2); }
  body.cpu .cpu-foot { grid-area: foot; display: flex; align-items: center; gap: 10px; padding: 0 12px;
    font-family: var(--mono); font-size: 11px; color: var(--dim); border-top: 1px solid var(--line);
    background: rgba(6,9,14,0.95); }
  body.cpu .cpu-foot .spacer { flex: 1; }
  body.cpu .verdict { font-size: 11.5px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--line);
    background: rgba(20,26,36,0.7); }
  body.cpu .verdict.pass { border-color: rgba(80,220,160,0.5); color: #7ef0c0; }
  body.cpu .verdict.fail { border-color: rgba(248,113,113,0.55); color: #ffb3b3; }
  body.cpu table.checks { width: 100%; border-collapse: collapse; font-size: 10.5px; font-family: var(--mono); }
  body.cpu table.checks td { padding: 2px 4px; border-bottom: 1px solid rgba(120,150,190,0.12); vertical-align: top; }
  body.cpu table.checks td.name { color: #dbe6f5; }
  body.cpu table.checks td.detail { color: var(--dim); }
  body.cpu table.checks td.mark { width: 34px; font-weight: 600; }
  body.cpu table.checks tr.pass td.mark { color: #6ee7b7; }
  body.cpu table.checks tr.fail td.mark { color: #fca5a5; }
  body.cpu table.checks tr.group td { color: var(--accent); letter-spacing: 0.08em; padding-top: 7px; text-transform: uppercase; }
  body.cpu .bar-bank { font-size: 10px; }
`;

/** Everything the page needs, in one object the checker can drive. */
export async function bootCpu(hooks = {}) {
  const report = hooks.report ?? (() => {});
  const head = document.head ?? document.documentElement;
  if (head && !document.getElementById('cpu-extra-css')) {
    head.append(el('style', { id: 'cpu-extra-css', text: CSS_EXTRA }));
  }

  const grid = el('div', { class: 'cpu-grid' });
  const left = el('div', { class: 'cpu-col' });
  const centre = el('div', { class: 'cpu-col', style: { overflow: 'hidden' } });
  const right = el('div', { class: 'cpu-col' });
  grid.append(left, centre, right);
  document.getElementById('app').append(grid);

  // ---- stage ------------------------------------------------------------
  const stage = el('div', { class: 'cpu-stage' });
  const canvas = el('canvas', { id: 'view', width: 900, height: 620 });
  const badge = el('div', { class: 'cpu-badge', text: 'CPU RASTERISER  ·  no GPU' });
  const overlay = el('div', { class: 'cpu-overlay' });
  stage.append(canvas, overlay, badge);
  centre.append(stage);
  const ctx = canvas.getContext('2d');

  // ---- state ------------------------------------------------------------
  const state = {
    task: 'circle',
    playing: true,
    stepsPerFrame: 1,
    renderScale: 0.9,
    supersample: 1,
    fps: 0,
    frames: 0,
    lastDraw: 0,
    verifying: false,
    verified: null,
    engineChecking: false,
    engineChecked: null,
  };
  const view = {
    yaw: 0.55, pitch: 0.26, dist: 1.4, target: [0, 0.4, 0],
    auto: true, grid: true, tendons: true, guides: true, path: true, trail: true, hud: true,
  };
  const port = new MatlabPort({ task: state.task });

  // ---- camera -----------------------------------------------------------
  const applyPreset = (name) => {
    const ext = port.extent();
    const presets = {
      iso: cameraFor(ext),
      front: { yaw: 0, pitch: 0.06, dist: cameraFor(ext).dist, target: cameraFor(ext).target },
      top: { yaw: 0.001, pitch: 1.32, dist: cameraFor(ext).dist * 1.05, target: cameraFor(ext).target },
      close: { yaw: 0.75, pitch: 0.22, dist: 0.62, target: [0, 0.55, 0] },
      wide: { yaw: 1.1, pitch: 0.34, dist: 2.6, target: [0, 0.35, 0] },
    };
    const p = presets[name] ?? presets.iso;
    Object.assign(view, p);
    view.target = p.target.slice();
    view.auto = name === 'iso';
  };
  applyPreset('iso');

  // ---- renderer ---------------------------------------------------------
  let raster = new Raster(900, 620, { supersample: state.supersample });
  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const w = Math.max(320, Math.floor((rect.width || 900) * state.renderScale));
    const h = Math.max(240, Math.floor((rect.height || 620) * state.renderScale));
    if (canvas.width !== w || canvas.height !== h || raster.outW !== w || raster.outH !== h) {
      canvas.width = w;
      canvas.height = h;
      raster = new Raster(w, h, { supersample: state.supersample });
    }
  };

  function render() {
    const frame = port.ensureFrame();
    const geometry = port.geometry();
    raster.setCamera(view);
    drawScene(raster, {
      geometry,
      trajectory: port.trajectory(),
      trail: port.trail,
      frame: { ...frame, target: geometry.target, ee: geometry.ee },
      items: portProps(port.task, port.trajectory()),
      waypointCount: port.anim.waypoints.length,
      home: port.home,
      summary: port.anim.done ? port.summary() : null,
      taskName: port.task,
      taskIndex: PORT_TASKS.findIndex((t) => t.id === port.task),
      taskCount: PORT_TASKS.length,
      show: view,
      title: 'TRUNC ARM',
      subtitle: 'CPU REFERENCE  ·  MATLAB PORT',
    });
    const rgba = raster.resolve();
    if (ctx?.putImageData && typeof ImageData !== 'undefined') {
      ctx.putImageData(new ImageData(rgba, canvas.width, canvas.height), 0, 0);
    }
    state.frames += 1;
    return rgba;
  }

  // ---- left column: tasks, playback, parameters, view -------------------
  const pTask = panel('task (MATLAB generator)');
  left.append(pTask.node);
  const tasks = taskList(pTask.body, PORT_TASKS.map((t) => ({ name: t.label, subtitle: t.note })), {
    onPick: (i) => {
      port.select(PORT_TASKS[i].id);
      tasks.select(i);
      applyPreset('iso');
      view.auto = true;
      syncParams();
      toast(document.getElementById('app'), `${PORT_TASKS[i].id}: ${PORT_TASKS[i].note}`);
      render();
    },
  });
  tasks.select(0);

  const pPlay = panel('playback');
  left.append(pPlay.node);
  const playBtns = buttonRow(pPlay.body, [
    { label: 'pause', kind: 'primary', onClick: () => togglePlay() },
    { label: 'step', onClick: () => { port.step(state.stepsPerFrame); render(); } },
    { label: 'restart', onClick: () => { port.restart(); render(); } },
    { label: 'run to end', onClick: () => { port.runToEnd(); render(); } },
  ]);
  const [pauseBtn] = playBtns;
  const togglePlay = () => {
    state.playing = !state.playing;
    pauseBtn.setLabel(state.playing ? 'pause' : 'play');
  };
  slider(pPlay.body, {
    label: 'steps per frame', min: 1, max: 24, step: 1, value: 1, format: (v) => v.toFixed(0),
    onInput: (v) => { state.stepsPerFrame = v; },
    hint: 'how many 1/60 s simulation steps each redraw advances',
  });
  slider(pPlay.body, {
    label: 'render scale', min: 0.4, max: 1, step: 0.05, value: state.renderScale, format: (v) => `${(v * 100).toFixed(0)}%`,
    onInput: (v) => { state.renderScale = v; resize(); render(); },
    hint: 'the rasteriser runs on the CPU — drop this if the page feels heavy',
  });
  select(pPlay.body, {
    label: 'supersample', options: [{ value: '1', label: 'off' }, { value: '2', label: '2×' }],
    value: String(state.supersample),
    onChange: (v) => { state.supersample = Number(v); raster = new Raster(canvas.width, canvas.height, { supersample: state.supersample }); render(); },
  });

  const pParams = panel('parameter control (AnimationOptions)');
  left.append(pParams.node);
  const paramWidgets = {};
  for (const spec of PARAM_SPECS) {
    paramWidgets[spec.key] = slider(pParams.body, {
      label: spec.label, min: spec.min, max: spec.max, step: spec.step,
      value: DEFAULT_PARAMS[spec.key], unit: spec.unit ?? '',
      format: (v) => v.toFixed(spec.digits ?? 3),
      onInput: (v) => {
        port.setParams({ [spec.key]: v });
        syncParams();
        render();
      },
      hint: `AnimationOptions.${spec.key}`,
    });
    pParams.body.append(el('div'));
  }
  const syncParams = () => {
    for (const spec of PARAM_SPECS) {
      const v = port.params[spec.key];
      if (paramWidgets[spec.key].get() !== v) paramWidgets[spec.key].set(v);
    }
  };
  paramWidgets.servoRate.set(port.params.servoRate);
  const ringSlider = slider(pParams.body, {
    label: 'cable ring radius', min: 0.03, max: 0.065, step: 0.001,
    value: CABLE_RING_M * 1000, unit: ' mm',
    format: (v) => v.toFixed(0),
    onInput: (v) => { port.cableRing = v / 1000; render(); },
    hint: 'the MATLAB cable triangle is 65 mm — lower it for a clearer picture',
  });
  ringSlider.set(CABLE_RING_M * 1000);
  buttonRow(pParams.body, [
    { label: 'reset defaults', onClick: () => { port.setParams(DEFAULT_PARAMS); syncParams(); render(); } },
  ]);

  const pView = panel('view');
  left.append(pView.node);
  for (const key of ['grid', 'tendons', 'guides', 'path', 'trail', 'hud']) {
    toggle(pView.body, {
      label: key, value: view[key], onChange: (v) => { view[key] = v; render(); },
    });
  }
  buttonRow(pView.body, [
    { label: 'iso', onClick: () => { applyPreset('iso'); render(); } },
    { label: 'front', onClick: () => { applyPreset('front'); render(); } },
    { label: 'top', onClick: () => { applyPreset('top'); render(); } },
    { label: 'close', onClick: () => { applyPreset('close'); render(); } },
    { label: 'wide', onClick: () => { applyPreset('wide'); render(); } },
  ]);

  // ---- right column: readouts, cables, verification ---------------------
  const pLive = panel('live state (from the ported model)');
  right.append(pLive.node);
  const live = {};
  for (const [key] of [
    ['phase'], ['time'], ['waypoint'], ['error'], ['tool'], ['target'],
    ['bend'], ['plane'], ['L'], ['motor'], ['cable travel'], ['axis error'],
  ]) {
    live[key] = readout(pLive.body, { label: key, value: '—' });
  }
  const pCable = panel('nine cables — Δ from neutral, mm');
  right.append(pCable.node);
  const cableBars = barBank(pCable.body, {
    labels: ['M1C1', 'M1C2', 'M1C3', 'M2C1', 'M2C2', 'M2C3', 'M3C1', 'M3C2', 'M3C3'],
    min: -80, max: 60, color: '#ffb454', unit: ' mm',
  });
  const pSummary = panel('replay summary');
  right.append(pSummary.node);
  const sumRead = {};
  for (const key of ['waypoints', 'frames', 'seconds', 'mean', 'settled', 'missed', 'pulses', 'motor s', 'travel']) {
    sumRead[key] = readout(pSummary.body, { label: key, value: '—' });
  }
  const sumBtn = button(pSummary.body, { label: 'run whole task now', onClick: () => { port.runToEnd(); render(); update(); } });

  const pCheck = panel('verify every ported function', { open: true });
  right.append(pCheck.node);
  const verdict = el('div', { class: 'verdict', text: 'not run yet' });
  const checkTable = el('div');
  pCheck.body.append(verdict, checkTable);
  const runBtn = button(pCheck.body, {
    label: 'run all checks',
    kind: 'primary',
    onClick: () => runVerification(),
  });
  const progress = el('div', { class: 'verdict', text: '' });

  async function runVerification() {
    if (state.verifying) return;
    state.verifying = true;
    verdict.className = 'verdict';
    verdict.textContent = 'running…';
    checkTable.textContent = '';
    pCheck.body.append(progress);
    const t0 = performance.now();
    try {
      const res = await verifyPort((i, n, label) => {
        progress.textContent = `[${i}/${n}] ${label}`;
      });
      state.verified = res;
      verdict.className = `verdict ${res.passed === res.total ? 'pass' : 'fail'}`;
      verdict.textContent = `${res.passed}/${res.total} checks passed · ${(performance.now() - t0).toFixed(0)} ms · run in this page`;
      checkTable.append(checksTable(res));
      report('verify', `${res.passed}/${res.total}`);
    } catch (err) {
      verdict.className = 'verdict fail';
      verdict.textContent = `verification threw: ${err.message}`;
      report('verify-error', err.stack ?? err.message);
    } finally {
      state.verifying = false;
      progress.textContent = 'tip: this table is the same 44 checks .check/trunc-port.mjs runs headless';
    }
  }

  /** One HTML table from a `{ rows: [{group, name, ok, detail}] }` result. */
  function checksTable(res) {
    const table = el('table', { class: 'checks' });
    let group = null;
    for (const row of res.rows) {
      if (row.group !== group) {
        group = row.group;
        table.append(el('tr', { class: 'group' }, [el('td', { colspan: '3', text: group })]));
      }
      table.append(el('tr', { class: row.ok ? 'pass' : 'fail' }, [
        el('td', { class: 'mark', text: row.ok ? 'ok' : 'FAIL' }),
        el('td', { class: 'name', text: row.name }),
        el('td', { class: 'detail', text: row.detail ?? '' }),
      ]));
    }
    return table;
  }

  // ---- the engine-side checks: the same table, for everything the WebGPU page
  //      is built on that is *not* the MATLAB port (arm, IK, the five jobs, the
  //      two learners, the safety envelope).
  const pEngine = panel('verify the engine (arm · solver · jobs · learners)');
  right.append(pEngine.node);
  const engineVerdict = el('div', { class: 'verdict', text: 'not run yet' });
  const engineTable = el('div');
  const engineProgress = el('div', { class: 'verdict', text: '' });
  pEngine.body.append(engineVerdict, engineTable);
  button(pEngine.body, {
    label: 'run engine checks',
    kind: 'primary',
    onClick: () => runEngineChecks_(),
  });
  pEngine.body.append(engineProgress);

  async function runEngineChecks_() {
    if (state.engineChecking) return;
    state.engineChecking = true;
    engineVerdict.className = 'verdict';
    engineVerdict.textContent = 'running… (the learners take a few seconds)';
    engineTable.textContent = '';
    const t0 = performance.now();
    try {
      const { runEngineChecks } = await import('./engineCheck.js');
      const res = await runEngineChecks((i, n, label) => {
        engineProgress.textContent = `[${i}/${n}] ${label}`;
      }, { quick: true });
      state.engineChecked = res;
      engineVerdict.className = `verdict ${res.passed === res.total ? 'pass' : 'fail'}`;
      engineVerdict.textContent = `${res.passed}/${res.total} engine checks passed · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      engineTable.append(checksTable(res));
      report('engine-check', `${res.passed}/${res.total}`);
    } catch (err) {
      engineVerdict.className = 'verdict fail';
      engineVerdict.textContent = `engine checks threw: ${err.message}`;
      report('engine-check-error', err.stack ?? err.message);
    } finally {
      state.engineChecking = false;
      engineProgress.textContent = 'tip: the same rows run headless in .check/ and inside the single-file build';
    }
  }

  // ---- footer -----------------------------------------------------------
  const footTask = el('span', { text: 'task circle' });
  const footFrame = el('span', { text: '—' });
  const footLink = el('a', { href: './index.html', class: 'btn', style: { flex: '0 0 auto', textDecoration: 'none' }, text: 'WebGPU page →' });
  const foot = el('div', { class: 'cpu-foot' }, [
    el('span', { text: 'CPU reference · software rasteriser' }),
    el('span', { class: 'spacer' }),
    footTask,
    el('span', { text: '·' }),
    footFrame,
    el('span', { class: 'spacer' }),
    footLink,
  ]);
  document.getElementById('app').append(foot);

  // ---- interaction ------------------------------------------------------
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY, pan: e.shiftKey };
    canvas.classList.add('dragging');
    canvas.setPointerCapture?.(e.pointerId);
    view.auto = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    if (dragging.pan) {
      view.target[0] -= dx * 0.0016 * view.dist;
      view.target[1] += dy * 0.0016 * view.dist;
    } else {
      view.yaw -= dx * 0.006;
      view.pitch = Math.max(-1.35, Math.min(1.35, view.pitch + dy * 0.005));
    }
    render();
  });
  const endDrag = () => { dragging = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointerleave', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault?.();
    view.dist = Math.max(0.35, Math.min(6, view.dist * (1 + Math.sign(e.deltaY) * 0.08)));
    view.auto = false;
    render();
  }, { passive: false });

  // keyboard: space = play/pause, arrows = task, r = restart, v = verify
  const onKey = (e) => {
    if (e.key === ' ') { e.preventDefault?.(); togglePlay(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const i = PORT_TASKS.findIndex((t) => t.id === port.task);
      const next = (i + (e.key === 'ArrowRight' ? 1 : PORT_TASKS.length - 1)) % PORT_TASKS.length;
      tasks.nodes[next].dispatch?.('click');
      tasks.select(next);
      port.select(PORT_TASKS[next].id);
      syncParams();
      render();
    } else if (e.key === 'r') { port.restart(); render(); }
    else if (e.key === 'v') { runVerification(); }
    else if (e.key === 'e') { runEngineChecks_(); }
  };
  window.addEventListener('keydown', onKey);

  // ---- loop -------------------------------------------------------------
  let last = 0;
  const update = () => {
    const rows = Object.fromEntries(port.readouts());
    for (const key of Object.keys(live)) live[key].set(rows[key] ?? '—');
    cableBars.set(port.cableBars(), 1);
    const s = port.anim.done ? port.summary() : null;
    if (s) {
      sumRead.waypoints.set(s.waypoints);
      sumRead.frames.set(s.frames);
      sumRead.seconds.set(s.seconds);
      sumRead.mean.set(s.meanError);
      sumRead.settled.set(s.maxSettledError);
      sumRead.missed.set(s.missed);
      sumRead.pulses.set(s.pulses);
      sumRead['motor s'].set(s.motorSeconds);
      sumRead.travel.set(s.cableTravel);
      sumBtn.setDisabled(!port.anim.done);
    }
    if (view.auto) {
      const ext = port.extent();
      const cam = cameraFor(ext);
      view.yaw = cam.yaw; view.pitch = cam.pitch; view.dist = cam.dist; view.target = cam.target.slice();
    }
    const fpsEl = document.getElementById('fps');
    if (fpsEl) fpsEl.textContent = state.fps.toFixed(1);
    const chk = document.getElementById('checks-status');
    if (chk) chk.textContent = state.verified ? `${state.verified.passed}/${state.verified.total}` : (state.verifying ? 'running…' : 'not run');
    footTask.textContent = `task ${port.task}`;
    footFrame.textContent =
      `frame ${state.frames} · fps ${state.fps.toFixed(1)} · sim ${(port.frame?.time ?? 0).toFixed(1)} s`;
  };

  let raf = 0;
  const tick = (now) => {
    const dt = last ? (now - last) : 0;
    last = now;
    if (dt) state.fps = state.fps * 0.85 + (1000 / dt) * 0.15;
    if (state.playing && port.anim.done) state.playing = false;
    if (state.playing) port.step(state.stepsPerFrame);
    render();
    update();
    raf = requestAnimationFrame(tick);
  };

  resize();
  render();
  update();
  if (!hooks.manual) raf = requestAnimationFrame(tick);

  report('cpu-boot', `task ${port.task}, ${PORT_TASKS.length} tasks, raster ${raster.outW}×${raster.outH}`);

  return {
    state, view, port, raster, canvas, ctx,
    render, update, runVerification, togglePlay, applyPreset,
    tasks, paramWidgets, cableBars, live, sumRead, verdict, checkTable,
    engineVerdict, engineTable, runEngineChecks_,
    stop: () => cancelAnimationFrame(raf),
    /** Draw the end-of-run card instead of the scene (used by the checks). */
    renderCard: (rows, totals) => { drawSummaryCard(raster, rows, totals); return raster.resolve(); },
    SCENE,
  };
}

export default bootCpu;
