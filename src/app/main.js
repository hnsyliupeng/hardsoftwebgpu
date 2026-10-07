/**
 * main.js — application entry point.
 *
 * Owns: the WebGPU device (or the 2D fallback), the scene assembly for every
 * frame, the fixed-step control loop, all pointer/keyboard input, the training
 * worker and the HUD.
 *
 * The loop is deliberately a *fixed 240 Hz physics step* decoupled from the
 * render rate: the controller, the tendon servos and the contact all care about
 * dt, and the paper's repeatability numbers only hold with a fixed step. Render
 * frames only consume the latest state.
 */

import { OrbitCamera, rayPlane, raySphere } from '../gpu/camera.js';
import { Renderer, FallbackRenderer, SceneBuilder, LIGHT } from '../gpu/renderer.js';
import {
  truncCell, toolMesh, boltMesh, bulbMesh, valveMesh, pegMesh, fixtureMesh, cube, cylinder,
} from '../gpu/meshes.js';
import { Robot, CONTROL_MODE } from '../engine/robot.js';
import { TASK_LIBRARY, benchLayout, stagesOf, FIXTURE } from '../engine/tasks.js';
import { buildHud } from './hud.js';
import { V3, Quat, Transform, clamp, deg, rad } from '../core/mathx.js';
import { defaultConfig } from '../core/arm.js';
import { Mlp, Transformer, Adam, ACT } from '../core/nn.js';
import { ACTUATION_SCALE, taskPhaseSchedule } from '../engine/robot.js';
import { PHASE } from '../core/physics.js';

const FIXED_DT = 1 / 240;
const MAX_SUBSTEPS = 60;

export async function boot(hooks = {}) {
  const setBoot = hooks.setBoot ?? (() => {});
  const hideBoot = hooks.hideBoot ?? (() => {});
  const showError = hooks.showError ?? (() => {});
  const report = hooks.report ?? (() => {});

  setBoot('building meshes…');
  const canvas = document.getElementById('view');
  const root = {
    left: document.getElementById('left'),
    right: document.getElementById('right'),
    overlay: document.getElementById('overlay'),
    footLeft: document.getElementById('foot-left'),
    footRight: document.getElementById('foot-right'),
  };

  // ---------------------------------------------------------------- world
  const robot = new Robot({ tasks: TASK_LIBRARY.map((s) => s.spec) });
  const sim = {
    paused: false,
    speed: 1,
    steps: 0,
    ikIters: 24,      // the value the task suite is validated at (see docs/design.md)
    slew: 0.025,
    authority: 0.25,   // transformer share of the tendon command (rest = IK solver)
    stageIndex: 0,
    autoNext: false,
    spinTest: 0,
    maxSubsteps: MAX_SUBSTEPS,
  };
  const view = {
    grid: true, trail: true, cables: true, cloud: false, fixtures: true,
    shadows: true, labels: true, attention: true, slowMo: false,
    exposure: 1.05, vignette: 0.42, grain: 0.012,
    project: () => null,
    light: true,
  };

  // ---------------------------------------------------------------- renderer
  let renderer = null;
  let fallback = false;
  // `?render=cpu` forces the software path — handy on GPUs where the shader
  // compiles but the draw is dropped (which would otherwise be a black screen)
  const forceCpu = typeof location !== 'undefined' && /[?&]render=cpu/.test(location.search ?? '');
  if (forceCpu) report('boot', 'render=cpu → software rasteriser');
  setBoot('requesting WebGPU adapter…');
  try {
    if (!forceCpu) renderer = await Renderer.create(canvas, { msaa: 4 });
  } catch (err) {
    report('webgpu', err?.message ?? err);
  }
  if (!renderer) {
    fallback = true;
    renderer = new FallbackRenderer(canvas);
  }
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());

  // ---------------------------------------------------------------- meshes
  setBoot('uploading meshes…');
  const meshes = {
    cell_truss: truncCell(0, 0.0789, 0.0244, { struts: 6, rings: 3 }),
    cell_equa: truncCell(1, 0.0789, 0.0260, { struts: 6, rings: 3, thickness: 0.0012 }),
    tool: toolMesh(),
    bolt: boltMesh(0.008, 0.05),
    bulb: bulbMesh(0.03, 0.075),
    valve: valveMesh(0.032),
    peg: pegMesh(0.006, 0.045),
    plate: fixtureMesh(FIXTURE.PLATE, { x: 0.15, y: 0.02, z: 0.15 }),
    bracket: fixtureMesh(FIXTURE.BRACKET, { x: 0.16, y: 0.02, z: 0.16 }),
    lamp: fixtureMesh(FIXTURE.LAMP, { x: 0.075, y: 0.05, z: 0.075 }),
    valve_body: fixtureMesh(FIXTURE.VALVE_BODY, { x: 0.09, y: 0.06, z: 0.09 }),
    bench: cube(1.15, 0.035, 0.95),
    post: cylinder(0.042, 1.0, 16),
    base: cylinder(0.09, 0.05, 24),
  };
  let triangles = 0;
  for (const [name, mesh] of Object.entries(meshes)) {
    triangles += mesh.indices.length / 3;
    renderer.upload(name, mesh);
  }

  // ---------------------------------------------------------------- camera
  const camera = renderer.camera;
  const applyPreset = (name) => {
    const a = robot.spec?.anchor ?? V3.new(0, 0.6, 0);
    if (name === 'iso') { camera.target = V3.new(0, 0.42, 0); camera.yaw = deg(38); camera.pitch = deg(24); camera.dist = 1.5; }
    else if (name === 'front') { camera.target = V3.new(0, 0.45, 0); camera.yaw = deg(0); camera.pitch = deg(8); camera.dist = 1.7; }
    else if (name === 'top') { camera.target = V3.new(0, 0.45, 0); camera.yaw = deg(0); camera.pitch = deg(78); camera.dist = 1.6; }
    else if (name === 'task') { camera.target = V3.clone(a); camera.yaw = Math.atan2(a.x, a.z); camera.pitch = deg(14); camera.dist = 0.62; }
  };
  applyPreset('iso');

  // ------------------------------------------------------------- workspace
  let cloud = null;
  const buildCloud = () => {
    const pts = [];
    const arm = robot.arm;
    for (let i = 0; i < 5000; i += 1) {
      const seg = [0, 1, 2].map(() => ({
        bend: Math.random() * arm.maxBendPerSegment,
        plane: Math.random() * 2 * Math.PI - Math.PI,
        compress: Math.random() * (arm.maxCompression / 3),
      }));
      const t = arm.fk(seg, 0, 0);
      const r = Math.hypot(t.p.x, t.p.z);
      if (r < 0.06) continue;
      pts.push(t.p);
    }
    cloud = pts;
    return pts.length;
  };

  // ----------------------------------------------------------------- hud
  const hud = buildHud({
    robot, view, sim, root,
    onTask: (i) => selectTask(i),
    onRun: () => { sim.paused = false; selectTask(robot.taskIndex, true); },
    onReset: () => { robot.reset(); hud.toast('arm reset'); },
    onPause: () => { sim.paused = !sim.paused; },
    onStep: () => { robot.step(FIXED_DT, stepOpts()); },
    onAutoNext: () => { sim.autoNext = !sim.autoNext; hud.toast(`auto-advance ${sim.autoNext ? 'on' : 'off'}`); },
    onMode: (m) => { robot.setMode(m); hud.toast(`mode: ${m}`); },
    onTrain: (what) => train(what),
    onTrainCancel: () => cancelTraining(),
    onArmParam: (k, v) => { robot.arm.cfg[k] = v; hud.refreshArm(robot.arm.cfg); hud.setStiffness(`${robot.arm.bendingStiffnessAt(robot.arm.cfg.preload).toFixed(2)} N·m/rad`); },
    onArmParamReset: () => { robot.arm.cfg = { ...defaultConfig() }; hud.refreshArm(robot.arm.cfg); },
    onSpecParam: (k, v) => { if (robot.spec) { robot.spec[k] = v; hud.refreshSpec(robot.spec); } },
    onSpecReset: () => { const base = TASK_LIBRARY[robot.taskIndex].spec; Object.assign(robot.spec, base); hud.refreshSpec(robot.spec); },
    onCamera: (n) => applyPreset(n),
    onSpinTest: () => { sim.spinTest = 3; },
  });
  hud.refreshArm(robot.arm.cfg);
  hud.setGpu(fallback ? 'canvas 2D fallback' : 'WebGPU');
  hud.setStiffness(`${robot.arm.bendingStiffnessAt(robot.arm.cfg.preload).toFixed(2)} N·m/rad`);
  hud.setTendon(`${robot.arm.tendonBendingStiffness.toFixed(3)} (winch ${robot.arm.winchBendingStiffness.toFixed(0)}) N·m/rad`);
  hud.setNetState('untrained — expert IK in the loop');
  hud.setPolicyState('untrained — press train');

  function stepOpts() {
    return {
      ikIters: sim.ikIters,
      cableSlew: sim.slew,
      residual: true,
      // `residual` in the robot means "blend the classical solve in"; its weight
      // is the complement of policy authority
      residualWeight: 1 - sim.authority,
      record: true,
      motorSpeedBias: sim.spinTest > 0 ? 6 : 0,
    };
  }

  function selectTask(i, restart = false) {
    robot.selectTask(i);
    sim.stageIndex = 0;
    // multi-stage jobs advance themselves; single jobs just cycle
    sim.autoNext = stagesOf(TASK_LIBRARY[i]).length > 1;
    hud.setTaskIndex(i);
    hud.refreshSpec(robot.spec);
    if (robot.spec) hud.setStiffness(`${robot.arm.bendingStiffnessAt(robot.arm.cfg.preload).toFixed(2)} N·m/rad`);
    hud.toast(`scenario: ${TASK_LIBRARY[i].name}`);
    if (restart) applyPreset('task');
  }

  // ------------------------------------------------------------ training
  let worker = null;
  let workerBusy = false;
  const startWorker = () => {
    if (worker) return worker;
    try {
      worker = new Worker(new URL('../workers/sim.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => onWorkerMessage(e.data);
      worker.onerror = (e) => {
        report('worker', e.message);
        worker = null;
        hud.setTrainState('worker unavailable — training on the main thread');
      };
    } catch (err) {
      worker = null;
      report('worker', err?.message ?? err);
    }
    return worker;
  };

  function train(what) {
    if (what === 'validate') {
      const w = startWorker();
      if (!w) { hud.toast('validation needs the worker (not available here)'); return; }
      hud.setTrainState('validating the task suite…');
      w.postMessage({ type: 'validate', seconds: 24, seed: 3 });
      return;
    }
    if (workerBusy) return;
    workerBusy = true;
    hud.trainButtons(true);
    hud.setTrainState('starting…');
    const w = startWorker();
    if (w) {
      w.postMessage({
        type: 'train',
        what,
        scenario: robot.taskIndex,
        seed: 7,
        mlpEpochs: 60,
        policyEpochs: 24,
      });
    } else {
      trainOnMainThread(what);
    }
  }

  function cancelTraining() {
    if (worker) { worker.terminate(); worker = null; }
    workerBusy = false;
    hud.trainButtons(false);
    hud.setTrainState('idle (cancelled)');
  }

  function onWorkerMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'progress') {
      hud.setTrainState(msg.text);
      return;
    }
    if (msg.type === 'mlp') {
      const net = new Mlp(msg.arch, { act: msg.act ?? ACT.TANH, seed: 1 });
      net.setParams(Float32Array.from(msg.params));
      if (msg.yMean?.length) { net.yMean = Float32Array.from(msg.yMean); net.yStd = Float32Array.from(msg.yStd); }
      robot.net = net;
      hud.setNetState(`trained · ${net.paramCount} params · mae ${(msg.mae ?? 0).toFixed(4)}`);
      hud.toast('inverse-kinematics network installed');
      return;
    }
    if (msg.type === 'policy') {
      const policy = new Transformer(msg.cfg, msg.vocab, msg.condIn, 1);
      policy.setParams(Float32Array.from(msg.params));
      if (msg.yMean?.length) { policy.yMean = Float32Array.from(msg.yMean); policy.yStd = Float32Array.from(msg.yStd); }
      if (msg.planInterval) policy.planInterval = msg.planInterval;
      robot.policy = policy;
      robot.policySeqLen = msg.cfg.seqLen ?? 48;
      const sc = msg.score;
      hud.setPolicyState(`trained · ${policy.paramCount} params · loss ${(msg.loss ?? 0).toFixed(5)}`);
      if (sc) {
        // the three-arm ablation, straight from the worker: what the learned plan
        // does alone, what it does with the solver closing the loop, and the teacher
        const arm = (a) => `${a.turns.toFixed(2)} turns ${a.success ? 'ok' : a.phase}`;
        hud.toast(`rollout — plan alone ${arm(sc.pure)} · plan+solver ${arm(sc.hybrid)} · expert ${arm(sc.expert)}`, 9000);
      } else {
        hud.toast('transformer policy installed');
      }
      return;
    }
    if (msg.type === 'validation') {
      const rows = msg.rows ?? [];
      const ok = rows.reduce((a, r) => a + r.ok, 0);
      const runs = rows.reduce((a, r) => a + r.runs, 0);
      for (const r of rows) hud.toast(`${r.name}: ${r.ok}/${r.runs} solved · ${r.turns.toFixed(2)} turns · ${r.peakForceN.toFixed(1)} N peak`, 5200);
      hud.setTrainState(`validation: ${ok}/${runs} episodes solved`);
      return;
    }
    if (msg.type === 'done') {
      workerBusy = false;
      hud.trainButtons(false);
      hud.setTrainState('idle');
      return;
    }
    if (msg.type === 'error') {
      report('worker', msg.text);
      hud.setTrainState(`error: ${msg.text}`);
      workerBusy = false;
      hud.trainButtons(false);
    }
  }

  /** Fallback trainer — same jobs, chunked on the main thread with rAF yields. */
  async function trainOnMainThread(what) {
    try {
      const { buildMlpDataset, buildPolicyDataset, trainMlp, trainPolicy } = await import('../workers/trainers.js');
      hud.setTrainState('building dataset…');
      await new Promise((r) => requestAnimationFrame(r));
      const ds = buildMlpDataset(robot, { samples: 900, seed: 7 });
      hud.setTrainState(`training network (${ds.n} samples)…`);
      await new Promise((r) => requestAnimationFrame(r));
      const { net, history } = trainMlp(ds, { epochs: 60, onEpoch: (e) => hud.setTrainState(`network epoch ${e}`) });
      robot.net = net;
      hud.setNetState(`trained · ${net.paramCount} params · loss ${history[history.length - 1].toFixed(5)}`);
      if (what === 'both' || what === 'policy') {
        hud.setTrainState('building policy dataset…');
        await new Promise((r) => requestAnimationFrame(r));
        const pds = buildPolicyDataset(robot, { episodes: 3, seed: 7 });
        hud.setTrainState(`training transformer (${pds.samples} episodes)…`);
        await new Promise((r) => requestAnimationFrame(r));
        const { policy, loss } = trainPolicy(pds, { epochs: 6, onEpoch: (e) => hud.setTrainState(`transformer epoch ${e}`) });
        robot.policy = policy;
        hud.setPolicyState(`trained · ${policy.paramCount} params · loss ${loss.toFixed(5)}`);
      }
      hud.setTrainState('idle (main thread)');
    } catch (err) {
      report('train', err?.stack ?? err);
      hud.setTrainState(`error: ${err.message}`);
    } finally {
      workerBusy = false;
      hud.trainButtons(false);
    }
  }

  // ------------------------------------------------------------- scene build
  const scene = new SceneBuilder();
  const bench = benchLayout();
  const benchCenter = bench.center;
  const gridY = bench.center.y + bench.size.y / 2 + 0.001;

  function pushFixture(anchor, axis, meshName, size, color, partMesh, active) {
    // the fixture body is mounted on a post that rises from the bench to just
    // under the part, so every part sits inside the arm's reachable shell
    const bodyCenter = V3.sub(anchor, V3.scale(axis, size * 0.5));
    scene.mesh(meshName, { p: bodyCenter, q: Quat.fromYTo(axis) }, color, [0.45, 0.6, 0.0, 1]);
    const baseY = benchCenter.y + bench.size.y / 2;
    const postH = Math.max(0.06, bodyCenter.y - size * 0.35 - baseY);
    scene.mesh('post', { p: V3.new(bodyCenter.x, baseY + postH / 2, bodyCenter.z), q: null, scale: postH },
      active ? [0.46, 0.5, 0.56, 1] : [0.3, 0.32, 0.36, 1], [0.5, 0.5, 0, 1]);
    if (partMesh) {
      scene.mesh(partMesh, { p: anchor, q: Quat.fromYTo(axis), scale: 1 },
        active ? [0.95, 0.88, 0.62, 1] : [0.5, 0.48, 0.4, 1], [0.25, 0.4, 0.05, 1]);
    }
  }

  function buildScene() {
    scene.reset();
    const st = robot.state;

    // ---- bench
    if (view.fixtures) {
      scene.mesh('bench', { p: bench.center, q: null, scale: 1 }, [0.30, 0.30, 0.33, 1], [0.05, 0.75, 0, 1]);
    }
    if (view.grid) {
      const n = bench.gridLines;
      const sx = bench.size.x / n;
      const sz = bench.size.z / n;
      const y = gridY;
      const col = [0.20, 0.45, 0.62, 0.55];
      for (let i = 0; i <= n; i += 1) {
        const x = bench.center.x - bench.size.x / 2 + i * sx;
        scene.line(V3.new(x, y, bench.center.z - bench.size.z / 2), V3.new(x, y, bench.center.z + bench.size.z / 2), col);
        const z = bench.center.z - bench.size.z / 2 + i * sz;
        scene.line(V3.new(bench.center.x - bench.size.x / 2, y, z), V3.new(bench.center.x + bench.size.x / 2, y, z), col);
      }
    }

    // ---- fixtures and parts for every scenario (the workshop scene)
    if (view.fixtures) {
      const partFor = { bolt: 'bolt', bulb: 'bulb', valve: 'valve', peg: 'peg' };
      const fixFor = { bolt: 'bracket', bulb: 'lamp', valve: 'valve_body', peg: 'plate' };
      const active = TASK_LIBRARY[robot.taskIndex];
      for (const scenario of TASK_LIBRARY) {
        for (const stage of stagesOf(scenario)) {
          const spec = stage.spec;
          const axis = V3.norm(spec.axis);
          const size = (stage.fixture?.size?.x ?? 0.12);
          const isActive = scenario === active;
          const tint = isActive ? 1.05 : 0.42;
          pushFixture(spec.anchor, axis, fixFor[stage.id] ?? 'plate', size,
            [tint, tint, tint * 0.95, 1], partFor[stage.id], isActive);
        }
      }
    }

    // ---- the arm itself: one TRUNC cell per printed cell, tool on the wrist
    const bones = robot.bones();
    for (const b of bones) {
      const name = b.kind === 0 ? 'cell_truss' : 'cell_equa';
      const s = b.length > 0 ? clamp(b.length / 0.0789, 0.2, 2) : 0.35;
      scene.mesh(name, { p: b.transform.p, q: b.transform.q, scale: s }, [0.72, 0.76, 0.82, 1], [0.15, 0.45, 0.05, 1]);
    }
    const tool = bones[bones.length - 1];
    if (tool) {
      scene.mesh('tool', { p: tool.transform.p, q: tool.transform.q, scale: 1 }, [0.55, 0.58, 0.64, 1], [0.9, 0.25, 0.0, 1]);
    }
    // ---- base pedestal: the arm stands on the floor, not on the bench
    // (its kinematics start at y = 0 — measured, the drawn chain ends on the tool)
    scene.mesh('base', { p: V3.new(0, 0.022, 0), q: null, scale: 1 }, [0.5, 0.52, 0.58, 1], [0.7, 0.3, 0, 1]);

    // ---- floor grid: depth cue for the fallback rasteriser, which has no depth
    // buffer and therefore draws its polylines over the shaded triangles
    if (view.grid !== false) {
      const half = 0.9;
      const step = 0.15;
      const gcol = [0.26, 0.34, 0.44, 0.5];
      for (let g = -half; g <= half + 1e-6; g += step) {
        scene.polyline([V3.new(g, 0.001, -half), V3.new(g, 0.001, half)], gcol);
        scene.polyline([V3.new(-half, 0.001, g), V3.new(half, 0.001, g)], gcol);
      }
    }

    // ---- tendons
    if (view.cables) {
      for (const c of robot.cables()) {
        const t = clamp((c.tension - 20) / 200, 0, 1);
        const col = [0.25 + 0.75 * t, 0.85 - 0.6 * t, 0.35 + 0.2 * (1 - t), 0.95];
        scene.polyline(c.points, col);
      }
    }

    // ---- trail
    if (view.trail && robot.trail.length > 1) {
      scene.polyline(robot.trail.map((p) => p.p), [0.35, 0.9, 1.0, 0.75]);
    }

    // ---- workspace cloud
    if (view.cloud) {
      if (!cloud) buildCloud();
      if (cloud) for (const p of cloud) scene.sprite(p, 0.0035, 0.7);
    }

    // ---- sprites: anchor marker + tip marker
    if (robot.spec) {
      scene.sprite(robot.spec.anchor, 0.02, 2.4);
      scene.sprite(V3.add(robot.spec.anchor, V3.scale(V3.norm(robot.spec.axis), 0.02)), 0.006, 1.0);
    }
    scene.sprite(st.tool.p, 0.008, robot.mode === CONTROL_MODE.MANUAL ? 2.2 : 1.1);

    // ---- manual target gizmo
    if (robot.mode === CONTROL_MODE.MANUAL && robot.manual.target) {
      const t = robot.manual.target.p;
      const a = 0.03;
      scene.line(V3.add(t, V3.new(-a, 0, 0)), V3.add(t, V3.new(a, 0, 0)), [1, 0.4, 0.2, 1]);
      scene.line(V3.add(t, V3.new(0, -a, 0)), V3.add(t, V3.new(0, a, 0)), [1, 0.4, 0.2, 1]);
      scene.line(V3.add(t, V3.new(0, 0, -a)), V3.add(t, V3.new(0, 0, a)), [1, 0.4, 0.2, 1]);
      scene.sprite(t, 0.01, 2.0);
    }
    return scene;
  }

  // ------------------------------------------------------------------ input
  let dragging = null;
  let moved = 0;
  const pickables = () => {
    const list = [];
    for (const scenario of TASK_LIBRARY) {
      for (const stage of stagesOf(scenario)) {
        list.push({ p: stage.spec.anchor, index: TASK_LIBRARY.indexOf(scenario) });
      }
    }
    return list;
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = { x: e.clientX, y: e.clientY, button: e.button };
    moved = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (dragging.button === 0 && !e.shiftKey) camera.orbit(-dx * 0.006, dy * 0.006);
    else if (dragging.button === 1 || dragging.button === 2 || (dragging.button === 0 && e.shiftKey)) camera.pan(dx, dy, canvas.clientHeight);
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasDrag = moved > 5;
    dragging = null;
    if (wasDrag) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const ray = camera.ray(nx * 2 - 1, -(ny * 2 - 1));
    if (e.shiftKey) {
      // place the manual target on the bench plane
      const hit = rayPlane(ray, benchCenter.y + 0.02);
      if (hit) {
        robot.setManualTarget(hit, V3.up(), {});
        robot.setMode(CONTROL_MODE.MANUAL);
        hud.setMode(CONTROL_MODE.MANUAL);
        hud.toast('manual target placed — drive it with the sliders below');
      }
      return;
    }
    // pick a fixture: nearest anchor ray-sphere hit
    let best = null;
    for (const p of pickables()) {
      const hit = raySphere(ray, p.p, 0.055);
      if (hit && (!best || hit.t < best.t)) best = { t: hit.t, index: p.index };
    }
    if (best) selectTask(best.index, false);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoom(Math.exp(e.deltaY * 0.0012));
  }, { passive: false });

  // manual joystick sliders (shown only in manual mode)
  const manualPanel = document.createElement('div');
  manualPanel.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);width:min(560px,80vw);';
  manualPanel.style.display = 'none';
  root.overlay.style.pointerEvents = 'none';
  manualPanel.style.pointerEvents = 'auto';
  document.getElementById('stage').append(manualPanel);

  window.addEventListener('keydown', (e) => {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { sim.paused = !sim.paused; e.preventDefault(); }
    else if (k === 'r') robot.reset();
    else if (k >= '1' && k <= '5') selectTask(Number(k) - 1);
    else if (k === 'e') { robot.setMode(CONTROL_MODE.EXPERT); hud.setMode(CONTROL_MODE.EXPERT); }
    else if (k === 'l') { robot.setMode(CONTROL_MODE.LEARNED); hud.setMode(CONTROL_MODE.LEARNED); }
    else if (k === 'm') { robot.setMode(CONTROL_MODE.MANUAL); hud.setMode(CONTROL_MODE.MANUAL); hud.toast('manual: shift+click to place the target'); }
    else if (k === 't') view.trail = !view.trail;
    else if (k === 'c') view.cables = !view.cables;
    else if (k === 'w') { view.cloud = !view.cloud; hud.toast(`workspace cloud ${view.cloud ? 'on' : 'off'}`); }
    else if (k === 'g') view.grid = !view.grid;
    else if (k === 'a') view.attention = !view.attention;
    else if (k === 'p') {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `trunc-lab-${Date.now()}.png`;
      a.click();
      hud.toast('viewport saved as PNG');
    } else if (k === 'h') {
      document.getElementById('help').classList.toggle('show');
    }
  });
  document.getElementById('help-btn').addEventListener('click', () => document.getElementById('help').classList.toggle('show'));
  document.getElementById('help').addEventListener('click', () => document.getElementById('help').classList.remove('show'));

  // ------------------------------------------------------------------- loop
  let acc = 0;
  let last = performance.now();
  let fpsAcc = 0;
  let gpuEmptyFrames = 0;   // consecutive frames the GPU renderer produced nothing
  let fpsFrames = 0;
  let spsWindow = 0;
  let spsSteps = 0;
  const fpsEl = document.getElementById('fps');
  const spsEl = document.getElementById('sps');
  const modeEl = document.getElementById('mode-status');
  const timeEl = document.getElementById('sim-time');
  const gpuEl = document.getElementById('gpu-status');
  gpuEl.textContent = fallback ? 'fallback' : 'webgpu';
  gpuEl.className = fallback ? 'bad' : 'ok';

  // pointer-events for the overlay labels
  function frame(now) {
    const rawDt = Math.min((now - last) / 1000, 0.25);
    last = now;
    const speed = sim.speed * (view.slowMo ? 0.1 : 1);

    if (!sim.paused) {
      acc += rawDt * speed;
      let steps = 0;
      const budget = Math.max(1, Math.min(sim.maxSubsteps, Math.ceil(acc / FIXED_DT)));
      while (acc >= FIXED_DT && steps < budget) {
        robot.step(FIXED_DT, stepOpts());
        acc -= FIXED_DT;
        sim.steps += 1;
        steps += 1;
        spsSteps += 1;
        // multi-stage scenarios: hand the next stage to the same controller
        if (sim.autoNext) {
          const m = robot.metrics();
          if ((m.phase === 5 || m.phase === 6) && robot.taskState.phaseTime > 0.6) {
            const stages = stagesOf(TASK_LIBRARY[robot.taskIndex]);
            if (sim.stageIndex + 1 < stages.length) {
              sim.stageIndex += 1;
              robot.setSpec(stages[sim.stageIndex].spec, { keepTime: true });
              hud.toast(`stage ${sim.stageIndex + 1}/${stages.length}: ${stages[sim.stageIndex].name}`);
            }
          }
        }
      }
      if (sim.spinTest > 0) sim.spinTest = Math.max(0, sim.spinTest - rawDt);
    }

    buildScene();
    renderer.present(scene, {
      exposure: view.exposure,
      vignette: view.vignette,
      grain: view.grain,
      lightScale: view.light ? 1 : 0.2,
    });
    // Self-healing: a WebGPU context can initialise yet draw nothing (driver or
    // iframe restrictions). Rather than leave a black rectangle in the preview,
    // switch to the rasteriser after a second of empty frames.
    if (!fallback && renderer?.stats) {
      if (renderer.stats.draws === 0) {
        gpuEmptyFrames += 1;
        if (gpuEmptyFrames > 30) {
          fallback = true;
          renderer = new FallbackRenderer(canvas);
          renderer.resize();
          report('webgpu', 'GPU renderer produced no draws for 30 frames — switched to the CPU rasteriser');
          hud.toast('WebGPU drew nothing — using the CPU rasteriser', 6000);
        }
      } else {
        gpuEmptyFrames = 0;
      }
    }
    view.project = (p) => camera.project(p);
    hud.update(rawDt);

    // manual mode: show the joystick strip
    if (robot.mode === CONTROL_MODE.MANUAL && manualPanel.style.display === 'none') {
      manualPanel.style.display = 'block';
      manualPanel.innerHTML = '';
      const bar = document.createElement('div');
      bar.style.cssText = 'background:rgba(10,15,24,0.9);border:1px solid rgba(96,130,175,0.3);border-radius:10px;padding:8px 10px;display:flex;gap:12px;align-items:center;font:11px ui-monospace,monospace;color:#dce7f5;';
      const mk = (label, min, max, value, onInput) => {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1';
        const name = document.createElement('span');
        name.textContent = label;
        name.style.color = '#8ea3bf';
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min); input.max = String(max); input.step = String((max - min) / 100); input.value = String(value);
        input.oninput = () => onInput(Number(input.value));
        wrap.append(name, input);
        return wrap;
      };
      bar.append(
        mk('tool spin rad/s', -6, 6, 0, (v) => { robot.manual.motorSpeed = v; }),
        mk('hold', 0, 1, 0, (v) => { robot.manual.hold = v > 0.5; }),
        mk('operator push N', 0, 12, 0, (v) => { robot.state.humanForce = v; }),
      );
      const hint = document.createElement('span');
      hint.textContent = 'shift+click a point to move the target';
      hint.style.color = '#8ea3bf';
      bar.append(hint);
      manualPanel.append(bar);
    } else if (robot.mode !== CONTROL_MODE.MANUAL && manualPanel.style.display === 'block') {
      manualPanel.style.display = 'none';
    }

    // ---- status readouts
    fpsAcc += rawDt;
    fpsFrames += 1;
    spsWindow += rawDt;
    if (fpsAcc > 0.5) {
      fpsEl.textContent = (fpsFrames / fpsAcc).toFixed(0);
      spsEl.textContent = (spsSteps / spsWindow).toFixed(0);
      fpsAcc = 0; fpsFrames = 0; spsWindow = 0; spsSteps = 0;
    }
    modeEl.innerHTML = `mode <b>${robot.mode}</b>`;
    timeEl.innerHTML = `t <b>${robot.time.toFixed(2)} s</b>`;

    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ start
  selectTask(0);
  hud.setTrainState('idle');
  setBoot('warming up…');
  // a couple of control steps so the first frame is not a straight arm
  for (let i = 0; i < 240; i += 1) robot.step(FIXED_DT, stepOpts());
  hideBoot();
  window.__app = { robot, sim, view, camera, renderer, scene, meshes, hud, triangles, buildCloud };
  report('boot', `booted: ${fallback ? 'fallback renderer' : 'webgpu'}, ${triangles.toFixed(0)} triangles, ${Object.keys(meshes).length} meshes`);
  requestAnimationFrame(frame);
  return window.__app;
}

export { FIXED_DT };
