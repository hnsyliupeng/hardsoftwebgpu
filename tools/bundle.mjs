#!/usr/bin/env node
/**
 * bundle.mjs — build a single-file copy of the lab.
 *
 *   node tools/bundle.mjs            → hardsoftwebgpu.html (repo root)
 *
 * Why: the app is normally served by `tools/dev-server.mjs`, but a preview or a
 * sandbox that stops the server leaves the user with nothing to look at. The
 * standalone file opens straight from disk (`file://`), with **no** network, no
 * module fetches and no server: every ES module is embedded as source text and
 * turned into a blob URL at load time, so the browser's own module loader still
 * does the importing and no bundler transform touches export semantics.
 *
 * Three things genuinely need the file system, and all three are inlined:
 *   * the two WGSL shaders the WebGPU path fetches
 *   * the training worker (a module) — handed a blob URL instead of a path
 *   * `import.meta.url`, which has no meaning inside a blob module
 *
 * The output is verified by `.check/bundle-test.mjs`, which runs the very same
 * script text inside Node and boots the app from it.
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '..');
const OUT = resolve(REPO, process.argv[2] ?? 'hardsoftwebgpu.html');

/** Every .js under src/, keyed by its repo-relative POSIX path. */
async function collect(dir) {
  const out = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await collect(full));
    else if (entry.name.endsWith('.js')) out[posix.join(...relative(REPO, full).split(/[\\/]/))] = await readFile(full, 'utf8');
  }
  return out;
}

const sources = await collect(join(REPO, 'src'));
const assetNames = ['wgsl/scene.wgsl', 'wgsl/post.wgsl'];
const assets = {};
for (const name of assetNames) {
  const full = join(REPO, 'src/gpu', name);
  if (!existsSync(full)) throw new Error(`missing asset ${full}`);
  assets[name] = await readFile(full, 'utf8');
}

let html = await readFile(join(REPO, 'index.html'), 'utf8');

// The page boots by dynamically importing the entry module. Keep that structure —
// only the specifier changes (a blob URL created by the loader below). The inline
// script stays `type="module"` so top-level await keeps working from file://.
if (!html.includes("await import('./src/app/main.js')")) {
  throw new Error('index.html no longer imports ./src/app/main.js — update bundle.mjs');
}
html = html.replace("await import('./src/app/main.js')", 'await import(window.__entryUrl)');

// The loader lives in its own file so it can use template literals freely; the
// two placeholders are swapped for JSON literals here.
const loaderSrc = await readFile(join(REPO, 'tools/standalone-loader.js'), 'utf8');
// Two traps, both hit once already:
//   * replace only the *assignment* lines — a bare token replace also rewrites
//     the loader's own documentation, and the payload's comment markers then end
//     that comment and the file stops parsing;
//   * pass a *function*, never a string: `$&`/`$\`` inside the app's template
//     literals are backreference patterns to `String.replace`.
const loader = `<script>\n${loaderSrc
  .replace('window.__SRC = __SOURCES__;', () => `window.__SRC = ${JSON.stringify(sources)};`)
  .replace('window.__ASSETS = __ASSETS__;', () => `window.__ASSETS = ${JSON.stringify(assets)};`)}\n</script>`;
if (loader.includes('__SOURCES__ = ') || /window\.__SRC = __SOURCES__/.test(loader)) {
  throw new Error('bundle.mjs: payload placeholder was not substituted');
}

html = html.replace('<script type="module">', `${loader}\n<script type="module">`);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
const modules = Object.keys(sources).length;
console.log(`wrote ${relative(REPO, OUT)} · ${(html.length / 1024).toFixed(0)} kB · ${modules} modules, ${assetNames.length} shaders inlined`);
