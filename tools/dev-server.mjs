#!/usr/bin/env node
/**
 * dev-server.mjs — zero-dependency static server for the lab.
 *
 *   * serves the repo root (index.html + src/**) with correct MIME types
 *   * does NOT send COOP/COEP by default. `require-corp` on a document makes it
 *     un-embeddable inside an iframe whose parent is not itself cross-origin
 *     isolated, which is exactly how the sandbox preview hosts the app — the
 *     symptom is a blank preview panel with no error on either side. The app
 *     needs neither (WebGPU does not use SharedArrayBuffer), so isolation is
 *     opt-in via --isolate for anyone who wants to experiment with threads.
 *   * logs every request into /__status, so "the preview shows nothing" can be
 *     told apart from "the browser never reached the server"
 *   * answers `/__log` (the page's boot diagnostics) and `/__status` (machine
 *     readable state) so a headless run can tell whether the app really started
 *   * binds 0.0.0.0 so the sandbox preview proxy can reach it, and accepts any
 *     Host/Origin (the preview is served from a different host than localhost)
 *
 * Usage: node tools/dev-server.mjs [--port 5173] [--host 0.0.0.0] [--root .]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '..');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(getArg('port', process.env.PORT ?? 5173));
const HOST = getArg('host', '0.0.0.0');
const ROOT = resolve(getArg('root', REPO));
const ISOLATE = args.includes('--isolate');   // opt-in COOP/COEP (see header note)
const requests = [];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.rs': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const log = [];
const logHandler = (req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(body || '{}'); } catch { parsed = { kind: 'raw', text: body.slice(0, 500) }; }
    const entry = { at: new Date().toISOString(), ...parsed };
    log.push(entry);
    if (log.length > 500) log.shift();
    // Mirror page errors to the server console: a headless smoke test can then
    // read them from the process output.
    if (entry.kind && entry.kind !== 'info') console.log(`[page:${entry.kind}] ${String(entry.text).slice(0, 400)}`);
    res.writeHead(204, { 'access-control-allow-origin': '*' });
    res.end();
  });
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const headers = {
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'cache-control': 'no-store',
  };
  if (ISOLATE) {
    headers['cross-origin-opener-policy'] = 'same-origin';
    headers['cross-origin-embedder-policy'] = 'require-corp';
  }
  requests.push({
    at: new Date().toISOString(),
    method: req.method ?? 'GET',
    path: (req.url ?? '/').slice(0, 120),
    host: (req.headers.host ?? '').slice(0, 80),
    ref: (req.headers.referer ?? '').slice(0, 80),
    ua: (req.headers['user-agent'] ?? '').slice(0, 60),
  });
  if (requests.length > 300) requests.shift();

  if (url.pathname === '/__log') {
    if (req.method === 'POST') return logHandler(req, res);
    res.writeHead(200, { ...headers, 'content-type': 'application/json' });
    return res.end(JSON.stringify(log.slice(-200), null, 2));
  }
  if (url.pathname === '/__status') {
    const errors = log.filter((l) => l.kind === 'error' || l.kind === 'boot' || l.kind === 'rejection' || l.kind === 'webgpu' || l.kind === 'worker');
    res.writeHead(200, { ...headers, 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      ok: errors.length === 0,
      entries: log.length,
      booted: log.some((l) => l.kind === 'boot'),
      recent: errors.slice(-12),
      // proof of life: what the browser actually asked for, newest last
      requests: requests.slice(-40),
      isolated: ISOLATE,
    }, null, 2));
  }

  let path = normalize(decodeURIComponent(url.pathname));
  if (path === '/' || path === '\\') path = '/index.html';
  const full = join(ROOT, path);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403, headers);
    return res.end('forbidden');
  }
  try {
    const info = await stat(full);
    const target = info.isDirectory() ? join(full, 'index.html') : full;
    const data = await readFile(target);
    res.writeHead(200, { ...headers, 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(data);
    if (!path.startsWith('/src') && !path.startsWith('/__')) console.log(`${req.method} ${path} → ${data.length} B`);
  } catch (err) {
    res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
    res.end(`not found: ${path}\n${err.code ?? ''}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TRUNC soft-arm lab → http://${HOST}:${PORT}/  (root ${ROOT})`);
  console.log(`  WebGPU page  http://${HOST}:${PORT}/index.html`);
  console.log(`  CPU page     http://${HOST}:${PORT}/cpu.html   (no GPU needed)`);
  console.log(`headers: COOP/COEP ${ISOLATE ? 'ON (--isolate)' : 'off — embeddable in the preview iframe'}`);
  console.log('page diagnostics: POST /__log, requests+boot state: GET /__status');
});
