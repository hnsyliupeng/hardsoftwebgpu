/**
 * hud.js — the whole operator interface, built from the `panels.js` toolkit.
 *
 * Layout:
 *   left   — scenario, control mode / learning, arm + TRUNC material, task
 *            parameters, view
 *   right  — joint state, tendon tensions, telemetry, transformer, safety, drive
 *   footer — the two scrolling charts
 *
 * `buildHud(ctx)` returns a handle the main loop calls once per frame
 * (`update`), plus the command hooks the loop needs (`onReset`, `onTask`, ...).
 * Everything that changes the simulation goes through the `ctx` callbacks so the
 * HUD stays a presentation layer — it never touches the physics directly.
 */

import {
  el, panel, row, slider, toggle, select, button, buttonRow, readout, barBank,
  chart, heatmap, hudLabel, toast,
} from '../ui/panels.js';
import { CONTROL_MODE, ACTUATION_SCALE } from '../engine/robot.js';
import { TASK_LIBRARY, stagesOf, objectiveOf } from '../engine/tasks.js';
import { TASK_KIND } from '../core/physics.js';
import { defaultConfig } from '../core/arm.js';

const MODE_LABEL = {
  [CONTROL_MODE.EXPERT]: 'expert  (scripted, ground truth)',
  [CONTROL_MODE.LEARNED]: 'learned  (transformer plan + solver)',
  [CONTROL_MODE.MANUAL]: 'manual  (GUI target)',
};

export function buildHud(ctx) {
  const { robot, view, sim, root } = ctx;
  const left = root.left;
  const right = root.right;
  const footLeft = root.footLeft;
  const footRight = root.footRight;
  const overlay = root.overlay;
  const labels = [];
  const status = {};

  // ============================================================ scenario panel
  const pTask = panel('scenario', { open: true });
  left.append(pTask.node);
  const taskSel = select(pTask.body, {
    label: 'job',
    options: TASK_LIBRARY.map((s, i) => ({ value: String(i), label: `${i + 1}. ${s.name}` })),
    value: '0',
    onChange: (v) => ctx.onTask(Number(v)),
  });
  const taskHint = readout(pTask.body, { label: 'stage', value: '—' });
  const objective = el('div', { class: 'objective', text: '—' });
  pTask.body.append(objective);
  const taskBlurb = el('div', { class: 'hint', text: '' });
  pTask.body.append(taskBlurb);
  buttonRow(pTask.body, [
    { label: 'run', kind: 'primary', onClick: () => ctx.onRun() },
    { label: 'reset (R)', onClick: () => ctx.onReset() },
  ]);
  buttonRow(pTask.body, [
    { label: 'pause (space)', onClick: () => ctx.onPause() },
    { label: 'step', onClick: () => ctx.onStep() },
    { label: 'auto-next', onClick: () => ctx.onAutoNext() },
  ]);
  const metrics = {
    phase: readout(pTask.body, { label: 'phase' }),
    turns: readout(pTask.body, { label: 'turns', unit: 'rev' }),
    depth: readout(pTask.body, { label: 'depth', unit: 'mm' }),
    torque: readout(pTask.body, { label: 'shaft torque', unit: 'N·m' }),
    force: readout(pTask.body, { label: 'contact force', unit: 'N' }),
    misalign: readout(pTask.body, { label: 'lateral error', unit: 'mm' }),
    absorbed: readout(pTask.body, { label: 'absorbed', unit: 'mm' }),
    safety: readout(pTask.body, { label: 'safety index' }),
    time: readout(pTask.body, { label: 'episode time', unit: 's' }),
  };

  // ========================================================= control / learning
  const pCtrl = panel('control & learning', { open: true });
  left.append(pCtrl.node);
  const modeSel = select(pCtrl.body, {
    label: 'mode',
    options: [
      { value: CONTROL_MODE.EXPERT, label: MODE_LABEL[CONTROL_MODE.EXPERT] },
      { value: CONTROL_MODE.LEARNED, label: MODE_LABEL[CONTROL_MODE.LEARNED] },
      { value: CONTROL_MODE.MANUAL, label: MODE_LABEL[CONTROL_MODE.MANUAL] },
    ],
    value: CONTROL_MODE.EXPERT,
    onChange: (v) => ctx.onMode(v),
  });
  // The learned plan is feed-forward; the solver closes the loop. Measured
  // ablation (docs/design.md): the open-loop transformer plan alone seats
  // neither bolt nor bulb, and this slider's default (75 % solver) completes
  // every task — so the split is exposed rather than hidden.
  const authority = slider(pCtrl.body, {
    label: 'policy authority', min: 0, max: 1, step: 0.05, value: 0.25,
    onInput: (v) => { sim.authority = v; },
    hint: 'how much of the loop the transformer owns vs. the IK solver',
  });
  const ikIters = slider(pCtrl.body, {
    label: 'IK iterations', min: 4, max: 40, step: 1, value: 24, format: (v) => v.toFixed(0),
    onInput: (v) => { sim.ikIters = v; },
    hint: 'damped-least-squares iterations per control step',
  });
  const slew = slider(pCtrl.body, {
    label: 'winch slew limit', min: 0.004, max: 0.12, step: 0.002, value: 0.025, unit: ' m/s',
    onInput: (v) => { sim.slew = v; },
    hint: 'how fast a tendon setpoint may move — the paper\'s 0.4 mm trajectory repeatability depends on it',
  });
  const speed = slider(pCtrl.body, {
    label: 'sim speed', min: 0.05, max: 4, step: 0.05, value: 1, unit: '×',
    onInput: (v) => { sim.speed = v; },
  });
  const trainRow = buttonRow(pCtrl.body, [
    { label: 'train policy (worker)', kind: 'primary', onClick: () => ctx.onTrain('both') },
    { label: 'validate', onClick: () => ctx.onTrain('validate') },
    { label: 'cancel', onClick: () => ctx.onTrainCancel() },
  ]);
  const trainState = readout(pCtrl.body, { label: 'trainer', value: 'idle' });
  const netState = readout(pCtrl.body, { label: 'ik network', value: 'untrained' });
  const policyState = readout(pCtrl.body, { label: 'transformer', value: 'untrained' });

  // ======================================================== arm / TRUNC material
  const pArm = panel('arm & TRUNC material', { open: true });
  left.append(pArm.node);
  const cfg = defaultConfig();
  const armSliders = {};
  const armSpecs = [
    ['payloadKg', 'payload', 0, 1, 0.05, ' kg'],
    ['compliance', 'compliance', 0.3, 1.4, 0.05, '×'],
    ['preload', 'tendon preload', 5, 120, 1, ' N'],
    ['servoSpeed', 'winch speed', 0.05, 1.2, 0.05, ' m/s'],
    ['servoBandwidth', 'winch bandwidth', 20, 600, 10, ' /s'],
    ['tendonStiffness', 'tendon stiffness', 200, 4000, 50, ' N/m'],
    ['winchStiffness', 'winch stiffness', 2e5, 6e6, 1e5, ' N/m'],
    ['damping', 'joint damping', 0, 0.4, 0.01, ''],
    ['hysteresis', 'hysteresis', 0, 1, 0.05, ''],
    ['sensorNoise', 'sensor noise', 0, 0.002, 0.00005, ' m'],
    ['motorTorque', 'motor torque', 0.2, 6, 0.1, ' N·m'],
    ['motorSpeed', 'motor speed', 4, 120, 2, ' rad/s'],
  ];
  for (const [key, label, min, max, step, unit] of armSpecs) {
    armSliders[key] = slider(pArm.body, {
      label, min, max, step, value: cfg[key], unit,
      onInput: (v) => ctx.onArmParam(key, v),
    });
  }
  const trussInfo = readout(pArm.body, { label: 'shoulder stiffness', value: '—' });
  const tensionInfo = readout(pArm.body, { label: 'tendon bending term', value: '—' });
  buttonRow(pArm.body, [
    { label: 'reset material', onClick: () => ctx.onArmParamReset() },
  ]);

  // ============================================================== task physics
  const pSpec = panel('task parameters', { open: false });
  left.append(pSpec.node);
  const specSliders = {};
  const specSpecs = [
    ['pitch', 'thread pitch', 0.0005, 0.004, 0.00005, ' m'],
    ['turnsRequired', 'turns required', 1, 8, 0.1, ' rev'],
    ['clearance', 'radial clearance', 0.0002, 0.003, 0.00005, ' m'],
    ['friction', 'friction', 0.02, 0.6, 0.01, ''],
    ['torqueLimit', 'torque limit', 0.1, 3, 0.05, ' N·m'],
    ['forceLimit', 'force limit', 5, 80, 1, ' N'],
    ['stiction', 'stiction', 0, 1, 0.05, ' N·m'],
    ['disturbance', 'human disturbance', 0, 8, 0.2, ' N'],
  ];
  for (const [key, label, min, max, step, unit] of specSpecs) {
    specSliders[key] = slider(pSpec.body, {
      label, min, max, step, value: TASK_LIBRARY[0].spec[key], unit,
      onInput: (v) => ctx.onSpecParam(key, v),
    });
  }
  buttonRow(pSpec.body, [{ label: 'reload task defaults', onClick: () => ctx.onSpecReset() }]);

  // ==================================================================== view
  const pView = panel('view', { open: false });
  left.append(pView.node);
  const viewToggles = {
    grid: toggle(pView.body, { label: 'bench grid', value: true, onChange: (v) => { view.grid = v; } }),
    trail: toggle(pView.body, { label: 'tool trail (T)', value: true, onChange: (v) => { view.trail = v; } }),
    cables: toggle(pView.body, { label: 'tendon polylines (C)', value: true, onChange: (v) => { view.cables = v; } }),
    cloud: toggle(pView.body, { label: 'workspace cloud (W)', value: false, onChange: (v) => { view.cloud = v; } }),
    fixtures: toggle(pView.body, { label: 'fixtures & parts', value: true, onChange: (v) => { view.fixtures = v; } }),
    shadows: toggle(pView.body, { label: 'shadow pass', value: true, onChange: (v) => { view.shadows = v; } }),
    labels: toggle(pView.body, { label: 'hud labels', value: true, onChange: (v) => { view.labels = v; } }),
    slow: toggle(pView.body, { label: '×0.1 time (fine look)', value: false, onChange: (v) => { view.slowMo = v; } }),
  };
  slider(pView.body, {
    label: 'exposure', min: 0.4, max: 2.2, step: 0.05, value: 1.05,
    onInput: (v) => { view.exposure = v; },
  });
  slider(pView.body, {
    label: 'vignette', min: 0, max: 1, step: 0.05, value: 0.42,
    onInput: (v) => { view.vignette = v; },
  });
  slider(pView.body, {
    label: 'grain', min: 0, max: 0.06, step: 0.002, value: 0.012,
    onInput: (v) => { view.grain = v; },
  });
  const camRow = buttonRow(pView.body, [
    { label: 'isometric', onClick: () => ctx.onCamera('iso') },
    { label: 'front', onClick: () => ctx.onCamera('front') },
    { label: 'top', onClick: () => ctx.onCamera('top') },
    { label: 'task close-up', onClick: () => ctx.onCamera('task') },
  ]);
  const gpuInfo = readout(pView.body, { label: 'renderer', value: '—' });

  // ============================================================== joint state
  const pJoints = panel('joint state', { open: true });
  right.append(pJoints.node);
  const bendBars = barBank(pJoints.body, { labels: ['sh 1', 'el 2', 'wr 3'], min: 0, max: 45, unit: '°', color: '#5ac8fa' });
  const compressBars = barBank(pJoints.body, { labels: ['sq 1', 'sq 2', 'sq 3'], min: 0, max: 32, unit: 'mm', color: '#ffd166' });
  const planeRead = readout(pJoints.body, { label: 'bending plane', value: '—' });
  const tipRead = readout(pJoints.body, { label: 'tip (x,y,z)', value: '—' });
  const reachRead = readout(pJoints.body, { label: 'reach |R|', value: '—', unit: 'm' });
  const twistRead = readout(pJoints.body, { label: 'shaft wind-up', value: '—', unit: '°' });
  const limitRead = readout(pJoints.body, { label: 'joint stop', value: '—' });

  // ================================================================ tendons
  const pCables = panel('tendon tensions', { open: true });
  right.append(pCables.node);
  const cableBars = barBank(pCables.body, {
    labels: Array.from({ length: 9 }, (_, i) => `c${i + 1}`), min: 0, max: 260, unit: ' N', color: '#4ade80',
  });
  const speedRead = readout(pCables.body, { label: 'tendon speed', value: '—', unit: ' m/s' });

  // ============================================================== telemetry
  const pTel = panel('telemetry', { open: true });
  right.append(pTel.node);
  const torqueRead = readout(pTel.body, { label: 'shaft torque', value: '—', unit: ' N·m' });
  const loadRead = readout(pTel.body, { label: 'task load torque', value: '—', unit: ' N·m' });
  const effRead = readout(pTel.body, { label: 'torque efficiency', value: '—' });
  const ikRead = readout(pTel.body, { label: 'ik ms / step', value: '—' });
  const stepRead = readout(pTel.body, { label: 'sim steps', value: '—' });

  // ============================================================ transformer
  const pPolicy = panel('transformer policy', { open: true });
  right.append(pPolicy.node);
  const policyMode = readout(pPolicy.body, { label: 'source', value: '—' });
  const tokenRead = readout(pPolicy.body, { label: 'plan token', value: '—' });
  const condRead = readout(pPolicy.body, { label: 'conditioning', value: '—' });
  const attnMap = heatmap(pPolicy.body, { rows: 12, cols: 12, size: 250 });
  const attnHint = el('div', { class: 'hint', text: 'causal self-attention of the last layer — rows are plan tokens, columns the steps each one attends to.' });
  pPolicy.body.append(attnHint);

  // ================================================================ safety
  const pSafe = panel('safety & compliance', { open: true });
  right.append(pSafe.node);
  const safetyRead = readout(pSafe.body, { label: 'safety index', value: '—' });
  const peakRead = readout(pSafe.body, { label: 'peak force', value: '—', unit: ' N' });
  const workRead = readout(pSafe.body, { label: 'compliance work', value: '—', unit: ' mJ' });
  const humanRead = readout(pSafe.body, { label: 'operator push', value: '—', unit: ' N' });
  const damageRead = readout(pSafe.body, { label: 'last failure', value: '—' });

  // ================================================================= drive
  const pDrive = panel('drive train', { open: false });
  right.append(pDrive.node);
  const motorRead = readout(pDrive.body, { label: 'motor angle', value: '—', unit: ' rad' });
  const motorSpeedRead = readout(pDrive.body, { label: 'motor speed', value: '—', unit: ' rad/s' });
  const spinRead = readout(pDrive.body, { label: 'tool speed', value: '—', unit: ' rpm' });
  const ratioRead = readout(pDrive.body, { label: 'turns transmitted', value: '—' });
  const weldRead = readout(pDrive.body, { label: 'cable circle', value: '—', unit: ' mm' });
  buttonRow(pDrive.body, [{ label: 'spin test 3 s', onClick: () => ctx.onSpinTest() }]);

  // ============================================================ footer charts
  const footA = chart(footLeft, { width: 620, height: 100, series: 3, labels: ['force N', 'torque ×10', 'error mm'] });
  const footB = chart(footRight, { width: 300, height: 100, series: 2, labels: ['depth mm', 'turns rev'] });

  // ================================================================ hud labels
  const toolLabel = hudLabel(overlay, { text: 'tool', color: '#8ff0ff' });
  const taskLabel = hudLabel(overlay, { text: 'part', color: '#ffd166' });
  labels.push(toolLabel, taskLabel);
  const baseLabel = hudLabel(overlay, { text: 'base', color: '#9fb4cc' });
  labels.push(baseLabel);

  // chatty event feed — the "what just happened" line under the header
  let lastPhase = -1;

  // ==================================================================== update
  function update(dt) {
    const st = robot.state;
    const m = robot.metrics();
    const tel = robot.telemetry;

    // --- scenario
    const scenario = TASK_LIBRARY[robot.taskIndex];
    const stages = stagesOf(scenario);
    taskHint.set(`${stages.length} stage${stages.length > 1 ? 's' : ''} · ${scenario.subtitle ?? ''}`);
    objective.textContent = objectiveOf(scenario, sim.stageIndex);
    taskBlurb.textContent = scenario.blurb ?? '';
    status.mode = robot.mode;

    metrics.phase.set(m.phaseName ?? '—');
    metrics.turns.set(m.turns.toFixed(3));
    metrics.depth.set(m.depthMm.toFixed(2));
    metrics.torque.set(st.toolTorque.toFixed(3));
    metrics.force.set((robot.reaction?.force ? Math.hypot(robot.reaction.force.x, robot.reaction.force.y, robot.reaction.force.z) : 0).toFixed(2));
    metrics.misalign.set(m.misalignMm.toFixed(2));
    metrics.absorbed.set(m.absorbedMm.toFixed(2));
    metrics.safety.set(m.safety.toFixed(3));
    metrics.time.set(robot.time.toFixed(2));

    // --- joints
    bendBars.set(st.seg.map((s) => (s.bend * 180) / Math.PI));
    compressBars.set(st.seg.map((s) => s.compress * 1000));
    planeRead.set(st.seg.map((s) => ((s.plane * 180) / Math.PI).toFixed(0)).join(' / ') + '°');
    tipRead.set(`${st.tool.p.x.toFixed(3)}, ${st.tool.p.y.toFixed(3)}, ${st.tool.p.z.toFixed(3)}`);
    reachRead.set(Math.hypot(st.tool.p.x, st.tool.p.y, st.tool.p.z).toFixed(3));
    twistRead.set(((st.shaftTwist * 180) / Math.PI).toFixed(2));
    limitRead.set(st.atLimit ? 'AT 45° STOP' : 'free');

    // --- tendons
    cableBars.set(st.tension);
    speedRead.set(st.cableSpeed.toFixed(4));

    // --- telemetry
    torqueRead.set(st.toolTorque.toFixed(4));
    loadRead.set((m.loadTorque ?? 0).toFixed(4));
    effRead.set((robot.arm.efficiency ?? 0).toFixed?.(2) ?? '—');
    ikRead.set((tel.ikMs ?? 0).toFixed(2));
    stepRead.set(String(sim.steps));

    // --- policy
    const policyOn = robot.mode === CONTROL_MODE.LEARNED;
    policyMode.set(!policyOn ? 'expert / manual'
      : robot.policy ? (robot.policyFallback ? 'untrained → expert' : 'transformer rollout') : 'no policy loaded');
    tokenRead.set(policyOn && robot.policyPlan ? `#${robot.policyStep} : ${robot.policyTokenFor(robot.spec?.kind ?? 0, robot.policyStep)}` : '—');
    condRead.set(robot.spec ? robot.policyCond().slice(0, 6).map((v) => v.toFixed(2)).join(' ') : '—');
    if (view.attention && robot.policyAttn && robot.policyAttn.length) {
      // attention of the first head of the last layer, subsampled to the map
      const a = robot.policyAttn[robot.policyAttn.length - 1];
      const heads = robot.policy.cfg.nHeads;
      const t = Math.round(Math.sqrt(a.length / heads));
      const rows = Math.min(12, t);
      const out = [];
      for (let i = 0; i < rows; i += 1) {
        const r = [];
        for (let j = 0; j < rows; j += 1) {
          const ti = Math.floor((i / rows) * t);
          const tj = Math.floor((j / rows) * t);
          r.push(a[ti * t + tj]);
        }
        out.push(r);
      }
      attnMap.set(out);
    }

    // --- safety
    safetyRead.set(m.safety.toFixed(3));
    peakRead.set(m.peakForceN.toFixed(2));
    workRead.set((tel.complianceWork * 1000).toFixed(1));
    humanRead.set((robot.taskState.humanForceApplied ?? 0).toFixed(2));
    damageRead.set(robot.taskState.failReason || (m.damaged ? 'damaged' : 'none'));

    // --- drive
    motorRead.set(st.motorAngle.toFixed(3));
    motorSpeedRead.set(st.motorSpeed.toFixed(3));
    spinRead.set(((st.motorSpeed * 60) / (2 * Math.PI)).toFixed(2));
    ratioRead.set((st.motorAngle / (2 * Math.PI)).toFixed(2));
    weldRead.set((robot.arm.cfg.cableRadius * 1000).toFixed(1));

    // --- charts
    if (sim.steps % 4 === 0) {
      footA.push([
        Math.hypot(robot.reaction?.force?.x ?? 0, robot.reaction?.force?.y ?? 0, robot.reaction?.force?.z ?? 0),
        st.toolTorque * 10,
        tel.trackError * 1000,
      ]);
      footB.push([m.depthMm ?? 0, m.turns ?? 0]);
    }

    // --- labels
    if (view.labels) {
      const put = (lbl, p) => {
        const s = view.project(p);
        lbl.place(s, !!s && s.w > 0);
      };
      put(toolLabel, st.tool.p);
      put(baseLabel, { x: 0, y: 0.02, z: 0 });
      put(taskLabel, robot.spec?.anchor ?? { x: 0, y: 0, z: 0 });
    } else {
      toolLabel.place(null, false);
      taskLabel.place(null, false);
      baseLabel.place(null, false);
    }

    // --- events
    const phase = m.phase;
    if (phase !== lastPhase) {
      if (phase === 5) toast(overlay, `✅ ${scenario.name} complete — ${m.turns.toFixed(2)} turns, ${m.depthMm.toFixed(1)} mm`, 3400);
      else if (phase === 6) toast(overlay, `⚠ ${scenario.name} failed — ${robot.taskState.failReason || 'see safety panel'}`, 4200);
      lastPhase = phase;
    }
  }

  return {
    update,
    toast: (msg, ms) => toast(overlay, msg, ms),
    setTrainState: (s) => trainState.set(s),
    setNetState: (s) => netState.set(s),
    setPolicyState: (s) => policyState.set(s),
    setGpu: (s) => gpuInfo.set(s),
    setTaskIndex: (i) => { taskSel.set(String(i)); },
    setMode: (m) => { modeSel.set(m); },
    refreshSpec: (spec) => { for (const k of Object.keys(specSliders)) if (spec?.[k] !== undefined) specSliders[k].set(spec[k]); },
    refreshArm: (a) => { for (const k of Object.keys(armSliders)) if (a?.[k] !== undefined) armSliders[k].set(a[k]); },
    setStiffness: (label) => { trussInfo.set(label); },
    setTendon: (label) => { tensionInfo.set(label); },
    trainButtons: (busy) => { trainRow.forEach((b) => b.setDisabled(busy)); },
    get sim() { return sim; },
    get view() { return view; },
  };
}
