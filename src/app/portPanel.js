/**
 * portPanel.js — the MATLAB port's GUI, as a self-contained panel.
 *
 * It is deliberately separate from `hud.js`: the port has its own task set, its
 * own parameters and its own verification table, and it can be dropped into any
 * page that has the panel toolkit. `main.js` mounts it under the WebGPU GUI;
 * the CPU page reuses `verifyPort()` directly.
 */
import { panel, slider, button, buttonRow, readout, select, taskList, toggle, el } from '../ui/panels.js';
import { PORT_TASKS, PARAM_SPECS, DEFAULT_PARAMS, CABLE_RING_M } from './matlabPort.js';

export function buildPortPanel(parent, hooks = {}) {
  const pPort = panel('MATLAB port — TRUNC replay', { open: false, badge: 'TS + JS' });
  parent.append(pPort.node);

  const note = el('div', {
    class: 'readout',
    style: { 'font-size': '10.5px', color: 'var(--dim)', display: 'block', 'line-height': '1.4' },
  }, [el('span', { text: 'The original MATLAB model, ported to TypeScript and JavaScript: constant-curvature FK, the five trajectory generators, the waypoint densifier, the servo and relay state machines, and the same DLS inverse kinematics.' })]);
  pPort.body.append(note);

  const enable = toggle(pPort.body, {
    label: 'show the port arm (hides the engine arm)',
    value: false,
    onChange: (v) => hooks.onEnable?.(v),
    hint: 'draw the ported replay instead of the inverse-kinematics engine',
  });

  const tasks = taskList(pPort.body, PORT_TASKS.map((t) => ({ name: t.label, subtitle: t.note })), {
    onPick: (i) => { tasks.select(i); hooks.onTask?.(PORT_TASKS[i].id); },
  });
  tasks.select(0);

  const play = buttonRow(pPort.body, [
    { label: 'play', kind: 'primary', onClick: () => hooks.onPlay?.() },
    { label: 'step', onClick: () => hooks.onStep?.() },
    { label: 'restart', onClick: () => hooks.onRestart?.() },
  ]);
  const playState = readout(pPort.body, { label: 'replay', value: 'paused' });

  const pParams = panel('port parameters', { open: false });
  pPort.body.append(pParams.node);
  const widgets = {};
  for (const spec of PARAM_SPECS) {
    widgets[spec.key] = slider(pParams.body, {
      label: spec.label, min: spec.min, max: spec.max, step: spec.step,
      value: DEFAULT_PARAMS[spec.key], unit: spec.unit ?? '',
      format: (v) => v.toFixed(spec.digits ?? 3),
      onInput: (v) => hooks.onParam?.({ [spec.key]: v }),
      hint: `AnimationOptions.${spec.key}`,
    });
  }
  widgets.cableRing = slider(pParams.body, {
    label: 'cable ring', min: 30, max: 65, step: 1, value: CABLE_RING_M * 1000, unit: ' mm',
    onInput: (v) => hooks.onParam?.({ cableRing: v / 1000 }),
    hint: 'the MATLAB cable triangle is 65 mm',
  });

  const readGrid = el('div', { style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '4px' } });
  pPort.body.append(readGrid);
  const reads = {};
  for (const key of ['phase', 'waypoint', 'error', 'settled', 'tool', 'target', 'bend', 'L', 'motor', 'axis error']) {
    reads[key] = readout(readGrid, { label: key, value: '—' });
  }

  const verifyRow = buttonRow(pPort.body, [
    { label: 'verify port (all functions)', kind: 'warn', onClick: () => hooks.onVerify?.() },
  ]);
  const verdict = el('div', { class: 'readout', style: { display: 'block', color: 'var(--dim)' } },
    [el('span', { text: 'not run — runs every ported module in this page' })]);
  pPort.body.append(verdict);

  const summary = readout(pPort.body, { label: 'last replay', value: '—', wide: true });

  return {
    node: pPort.node,
    tasks,
    enable,
    widgets,
    verdict,
    summary,
    setPlaying: (playing) => {
      playState.set(playing ? 'running' : 'paused');
      play[0].setLabel(playing ? 'pause' : 'play');
    },
    setEnabled: (v) => { enable.node.querySelector('input').checked = !!v; },
    update: (rows, s) => {
      for (const key of Object.keys(reads)) reads[key].set(rows?.[key] ?? '—');
      if (s) {
        summary.set(`${s.frames} frames · ${s.seconds.toFixed(1)} s · settled ${s.maxSettledError.toFixed(2)} mm · missed ${s.missed} · motor ${s.motorSeconds.toFixed(1)} s`);
      }
    },
    setVerdict: (text, cls = '') => { verdict.textContent = text; verdict.className = `readout ${cls}`; },
  };
}
