#!/usr/bin/env node
/**
 * run.mjs — the local Node.js entry point for the lab. Zero dependencies; Node
 * >= 18 is all it needs (nothing to install, nothing to build).
 *
 *   node run.mjs                    serve the browser app on http://localhost:5173
 *   node run.mjs --open             ... and open a browser window
 *   node run.mjs --port 8080        ... on another port
 *   node run.mjs --terminal         run the simulation in this terminal, no browser
 *   node run.mjs --terminal --task 2 --seconds 40
 *   node run.mjs --all              run all five jobs and print a table
 *   node run.mjs --train            train the IK network + transformer, print scores
 *   node run.mjs --selftest         acceptance + training smoke test (exit code)
 *   node run.mjs --bundle           build hardsoftwebgpu-node.mjs (single file)
 *
 * `hardsoftwebgpu-node.mjs` is this same runner with the whole app tree embedded,
 * so it can be copied anywhere and executed with no repo around it:
 *
 *   node hardsoftwebgpu-node.mjs --terminal
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from './tools/node-launcher.js';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)));
const args = process.argv.slice(2);

if (args.includes('--bundle')) {
  const r = spawnSync(
    process.execPath,
    [resolve(REPO, 'tools/node-bundle.mjs'), ...args.filter((a) => a !== '--bundle')],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

await main({ root: REPO, args, label: 'Hard-Soft Arm Lab — local Node runner' });
