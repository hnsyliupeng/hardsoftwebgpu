#!/usr/bin/env node
/**
 * dev-server.mjs — zero-dependency static server for the lab.
 *
 *   * serves the repo root (index.html + src/**) with correct MIME types
 *   * sends COOP/COEP so `SharedArrayBuffer` and `crossOriginIsolated` work if a
 *     later build wants threads — WebGPU itself does not need them
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
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'cross-origin',
    'cache-control': 'no-store',
  };

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
  console.log('page diagnostics: POST /__log, state: GET /__status');
});
