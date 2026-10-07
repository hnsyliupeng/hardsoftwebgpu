/**
 * node-launcher.js — everything the local runner does, in one place.
 *
 * This file is used twice:
 *   * `run.mjs` imports it straight from the repo;
 *   * `tools/node-bundle.mjs` embeds it as text into the single-file build
 *     `hardsoftwebgpu-node.mjs`, which extracts the app to a temp directory and
 *     calls `main()` with that directory as `rootDir`.
 *
 * Modes (all zero-dependency, Node >= 18):
 *   (default)   serve the browser app and print the URLs to open
 *   --terminal  run the simulation headlessly with a live terminal dashboard
 *   --all       run the five job acceptance suite and print a table
 *   --train     train the IK network and the transformer policy, print the scores
 *   --selftest  acceptance suite + training smoke test, exit non-zero on failure
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Load a module from inside the app tree. */
export const load = (root, rel) => import(pathToFileURL(join(root, rel)).href);

const flag = (args, name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (args, name) => args.includes(`--${name}`);

// --------------------------------------------------------------------- server

export function serve(root, { port = 5173, host = '0.0.0.0', quiet = false } = {}) {
  const log = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const headers = {
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'cache-control': 'no-store',
    };
    // Deliberately no COOP/COEP: `require-corp` makes the page un-embeddable in
    // an iframe whose parent is not cross-origin isolated, which shows up as a
    // blank preview panel rather than an error.
    if (url.pathname === '/__log' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      return req.on('end', () => {
        try {
          const entry = JSON.parse(body || '{}');
          log.push({ at: new Date().toISOString(), ...entry });
          if (log.length > 400) log.shift();
          if (entry.kind && entry.kind !== 'info' && !quiet) console.log(`[page:${entry.kind}] ${String(entry.text).slice(0, 300)}`);
        } catch { /* ignore malformed */ }
        res.writeHead(204, headers); res.end();
      });
    }
    if (url.pathname === '/__status') {
      res.writeHead(200, { ...headers, 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        booted: log.some((l) => l.kind === 'boot'),
        entries: log.length,
        recent: log.slice(-12),
      }, null, 2));
    }
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === '/' || path === '\\') path = '/index.html';
    const full = join(root, path);
    if (!full.startsWith(root)) { res.writeHead(403, headers); return res.end('forbidden'); }
    try {
      const info = await stat(full);
      const target = info.isDirectory() ? join(full, 'index.html') : full;
      const data = await readFile(target);
      res.writeHead(200, { ...headers, 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
      res.end(data);
    } catch (err) {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end(`not found: ${path} (${err.code ?? ''})\n`);
    }
  });
  server.listen(port, host);
  return server;
}

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(`http://${ni.address}:${port}/`);
    }
  }
  return out;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch { /* no browser / no opener — the printed URL is enough */ }
}

// ------------------------------------------------------------------ dashboard

const BAR = '█';
const EMPTY = '░';
const bar = (frac, width = 14) => {
  const f = Math.max(0, Math.min(1, frac));
  const n = Math.round(f * width);
  return BAR.repeat(n) + EMPTY.repeat(width - n);
};

async function terminal(root, { taskIndex = 0, seconds = 30, fps = 12, mode = 'expert' } = {}) {
  const { Robot, CONTROL_MODE } = await load(root, 'src/engine/robot.js');
  const { TASK_LIBRARY, stagesOf } = await load(root, 'src/engine/tasks.js');
  const { PHASE } = await load(root, 'src/core/physics.js');

  const scenario = TASK_LIBRARY[taskIndex % TASK_LIBRARY.length];
  const stage = stagesOf(scenario)[0];
  const robot = new Robot({ tasks: [stage.spec] });
  robot.selectTask(0);
  robot.setMode(mode === 'learned' ? CONTROL_MODE.LEARNED : mode === 'manual' ? CONTROL_MODE.MANUAL : CONTROL_MODE.EXPERT);

  const dt = 1 / 240;
  const frames = Math.round(seconds / dt);
  const perFrame = Math.max(1, Math.floor(frames / (seconds * fps)));
  const tty = process.stdout.isTTY;
  const started = Date.now();

  const render = (m) => {
    const tel = robot.telemetry;
    const t = robot.state.tool.p;
    const turnsReq = stage.spec.turnsRequired ?? 1;
    const depthReq = (stage.spec.turnsRequired ?? 1) * (stage.spec.pitch ?? 0.001);
    const lines = [
      `Hard-Soft Arm Lab — headless terminal run (Node ${process.version}, no browser)`,
      '',
      `job      ${scenario.name}  ·  ${stage.name}`,
      `phase    ${String(m.phaseName).padEnd(9)} ${bar(m.phase / 5)}  ${m.phase}/5`,
      `turns    ${m.turns.toFixed(2).padStart(5)} / ${turnsReq.toFixed(2)} rev   ${bar(turnsReq ? m.turns / turnsReq : 0)}`,
      `depth    ${(m.depthMm / 1000).toFixed(4)} / ${depthReq.toFixed(4)} m     ${bar(depthReq ? (m.depthMm / 1000) / depthReq : 0)}`,
      `time     ${robot.time.toFixed(2).padStart(6)} s   (${(frames * dt).toFixed(0)} s requested)`,
      '',
      `tip      x ${t.x.toFixed(3)}  y ${t.y.toFixed(3)}  z ${t.z.toFixed(3)}  m`,
      `errors   lateral ${(m.misalignMm ?? 0).toFixed(2)} mm   tilt ${(m.tiltError ?? 0).toFixed(3)} rad`,
      `contact  ${(tel.contactForce ?? 0).toFixed(2)} N   shaft torque ${(robot.state.toolTorque ?? 0).toFixed(2)} N·m   safety ${(m.safety ?? 0).toFixed(3)}`,
      '',
      `bend     ${robot.state.seg.map((s) => s.bend.toFixed(2).padStart(5)).join(' | ')} rad   (limit ${(45 * Math.PI / 180).toFixed(2)})`,
      `tension  ${[0, 1, 2].map((i) => [0, 1, 2].map((c) => robot.state.tension[i * 3 + c].toFixed(0).padStart(3)).join(' ')).join('  |  ')} N`,
      `winch    ${[0, 1, 2].map((i) => [0, 1, 2].map((c) => (robot.state.cableCmd[i * 3 + c] * 1000).toFixed(0).padStart(4)).join(' ')).join('  |  ')} mm`,
      '',
      `last frame ${(1000 / fps).toFixed(0)} ms of sim per tick · ${((Date.now() - started) / 1000).toFixed(1)} s wall`,
      `(ctrl-c to stop)`,
    ];
    return lines.join('\n');
  };

  let i = 0;
  for (; i < frames; i += 1) {
    robot.step(dt, { ikIters: 24, cableSlew: 0.025, residual: true, residualWeight: 0.75 });
    const m = robot.metrics();
    if (i % perFrame === 0) {
      const frame = render(m);
      if (tty) process.stdout.write(`\x1b[H\x1b[J${frame}\n`);
      else if (i % (perFrame * fps) === 0) console.log(`t ${robot.time.toFixed(1)}s  ${m.phaseName.padEnd(9)} turns ${m.turns.toFixed(2)}  depth ${m.depthMm.toFixed(2)} mm  contact ${(robot.telemetry.contactForce ?? 0).toFixed(2)} N`);
    }
    if (m.phase === PHASE.DONE || m.phase === PHASE.FAILED) break;
  }
  const m = robot.metrics();
  if (tty) process.stdout.write('\x1b[H\x1b[J');
  console.log(`${scenario.id}: ${m.phaseName} ${m.success ? 'OK' : 'FAIL'} · turns ${m.turns.toFixed(2)} · depth ${m.depthMm.toFixed(2)} mm · peak ${m.peakForceN.toFixed(1)} N · safety ${m.safety.toFixed(2)} · damage ${m.damaged ? 'yes' : 'no'} · ${robot.time.toFixed(2)} s`);
  return m;
}

// --------------------------------------------------------------- acceptance

async function acceptance(root, { seconds = 40 } = {}) {
  const { Robot, CONTROL_MODE } = await load(root, 'src/engine/robot.js');
  const { TASK_LIBRARY, stagesOf } = await load(root, 'src/engine/tasks.js');
  const { PHASE } = await load(root, 'src/core/physics.js');
  const rows = [];
  for (const scenario of TASK_LIBRARY) {
    const stage = stagesOf(scenario)[0];
    const robot = new Robot({ tasks: [stage.spec] });
    robot.selectTask(0);
    robot.setMode(CONTROL_MODE.EXPERT);
    const dt = 1 / 240;
    for (let i = 0; i < Math.round(seconds / dt); i += 1) {
      robot.step(dt, { ikIters: 24, cableSlew: 0.025, record: false });
      const m = robot.metrics();
      if (m.phase === PHASE.DONE || m.phase === PHASE.FAILED) break;
    }
    const m = robot.metrics();
    rows.push({
      id: scenario.id, ok: m.success, phase: m.phaseName, turns: m.turns, depth: m.depthMm,
      peak: m.peakForceN, safety: m.safety, damaged: m.damaged, time: robot.time,
    });
    console.log(`${scenario.id.padEnd(9)} ${m.success ? 'OK  ' : 'FAIL'} ${m.phaseName.padEnd(9)} turns ${m.turns.toFixed(2).padStart(5)}  depth ${m.depthMm.toFixed(2).padStart(6)} mm  peak ${m.peakForceN.toFixed(1).padStart(4)} N  safety ${m.safety.toFixed(2)}  ${robot.time.toFixed(2)} s`);
  }
  const ok = rows.every((r) => r.ok && !r.damaged);
  console.log(ok ? `acceptance: ${rows.length}/${rows.length} jobs completed, no damage` : 'acceptance: FAILURES present');
  return { rows, ok };
}

// ----------------------------------------------------------------- training

async function training(root, { mlpEpochs = 60, policyEpochs = 12, score = 1 } = {}) {
  const T = await load(root, 'src/workers/trainers.js');
  const { Robot } = await load(root, 'src/engine/robot.js');
  // the dataset builder samples the *arm* it is handed — it is the teacher
  const teacher = new Robot({ seed: 3 });
  const t0 = Date.now();
  const ds = T.buildMlpDataset(teacher, { samples: 2000, seed: 7 });
  const f = Date.now();
  const { mae } = T.trainMlp(ds, { epochs: mlpEpochs, seed: 3 });
  const t1 = Date.now();
  let baseline = 0;
  {
    const { MLP_OUT } = T;
    const mean = new Float32Array(MLP_OUT);
    for (let i = 0; i < ds.n; i += 1) for (let k = 0; k < MLP_OUT; k += 1) mean[k] += ds.y[i * MLP_OUT + k] / ds.n;
    for (let i = 0; i < ds.n; i += 1) for (let k = 0; k < MLP_OUT; k += 1) baseline += Math.abs(ds.y[i * MLP_OUT + k] - mean[k]);
    baseline /= ds.n * MLP_OUT;
  }
  console.log(`ik network (${ds.n} samples, ${mlpEpochs} epochs): mean |error| ${mae.toFixed(5)} = ${(mae * 60).toFixed(2)} mm tendon`);
  console.log(`  constant predictor would be ${baseline.toFixed(5)} = ${(baseline * 60).toFixed(2)} mm  →  ${(baseline / mae).toFixed(2)}× better`);
  console.log(`  dataset ${((f - t0) / 1000).toFixed(1)} s · training ${((t1 - f) / 1000).toFixed(1)} s`);

  const p0 = Date.now();
  const pds = T.buildPolicyDataset(teacher, { episodes: 5, seed: 11 });
  const p1 = Date.now();
  const { policy, loss, rms } = T.trainPolicy(pds, { epochs: policyEpochs, batch: 32, lr: 0.006, seed: 5 });
  const p2 = Date.now();
  console.log(`\ntransformer policy (${pds.samplesCount} state→chunk pairs, ${policyEpochs} epochs): mse ${loss.toFixed(5)} (rms ${rms.toFixed(3)}σ)`);
  console.log(`  distillation ${((p1 - p0) / 1000).toFixed(1)} s · training ${((p2 - p1) / 1000).toFixed(1)} s`);
  for (let i = 0; i < Math.min(4, score); i += 1) {
    const s = T.rolloutScore(policy, i, { seconds: 34 });
    console.log(`  ${s.pure.id.padEnd(9)} plan alone ${s.pure.turns.toFixed(2).padStart(5)} turns (${s.pure.phase}) | plan+solver ${s.hybrid.turns.toFixed(2).padStart(5)} turns (${s.hybrid.phase}) | expert ${s.expert.turns.toFixed(2)} turns`);
  }
  return { mae, baseline, loss, rms };
}

// --------------------------------------------------------------------- main

export async function main({ root, args = process.argv.slice(2), label = 'Hard-Soft Arm Lab' } = {}) {
  const port = Number(flag(args, 'port', process.env.PORT ?? 5173));
  const host = flag(args, 'host', '0.0.0.0');
  const taskIndex = Number(flag(args, 'task', 0));
  const seconds = Number(flag(args, 'seconds', 30));

  if (!existsSync(join(root, 'index.html'))) {
    console.error(`no index.html in ${root} — is this the extracted app tree?`);
    process.exitCode = 1;
    return;
  }

  if (has(args, 'terminal') || has(args, 'headless')) {
    console.log(`${label} — terminal mode\n`);
    await terminal(root, { taskIndex, seconds, mode: flag(args, 'mode', 'expert') });
    return;
  }
  if (has(args, 'all')) {
    console.log(`${label} — acceptance suite (all five jobs, expert controller)\n`);
    const { ok } = await acceptance(root, { seconds: Math.max(seconds, 40) });
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (has(args, 'train')) {
    console.log(`${label} — training run\n`);
    await training(root, {
      mlpEpochs: Number(flag(args, 'mlp-epochs', 60)),
      policyEpochs: Number(flag(args, 'policy-epochs', 12)),
      score: Number(flag(args, 'score', 1)),
    });
    return;
  }
  if (has(args, 'selftest')) {
    console.log(`${label} — selftest\n`);
    const { ok } = await acceptance(root, { seconds: Math.max(seconds, 40) });
    const tr = await training(root, { mlpEpochs: 40, policyEpochs: 4, score: 0 });
    const sane = ok && tr.mae < tr.baseline && Number.isFinite(tr.loss);
    console.log(sane ? '\nselftest: PASS' : '\nselftest: FAIL');
    process.exitCode = sane ? 0 : 1;
    return;
  }

  // default: serve the app
  const server = serve(root, { port, host });
  const urls = [`http://localhost:${port}/`, ...lanAddresses(port)];
  console.log(`\n${label}\n`);
  console.log(`  serving ${root}`);
  console.log(`  open: ${urls.join('\n        ')}`);
  console.log(`\n  the HUD badge shows whether the browser gave us WebGPU; add ?render=cpu to force`);
  console.log(`  the software rasteriser. page diagnostics land in GET /__status.\n`);
  if (has(args, 'open')) openBrowser(urls[0]);
  // keep the process alive; Ctrl-C stops it
  process.on('SIGINT', () => { server.close(); console.log('\nstopped'); });
  return server;
}
