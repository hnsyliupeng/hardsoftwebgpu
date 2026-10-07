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
async function collect(dir, only = null) {
  const out = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await collect(full, only));
    else if (entry.name.endsWith('.js') && (!only || only.includes(entry.name))) {
      out[posix.join(...relative(REPO, full).split(/[\\/]/))] = await readFile(full, 'utf8');
    }
  }
  return out;
}

// The JS the app imports, plus the ported MATLAB modules and the CPU tools —
// all of them are plain ES modules and go in as source text.
const sources = {
  ...(await collect(join(REPO, 'src'))),
  ...(await collect(join(REPO, 'js'))),
  ...(await collect(join(REPO, 'tools'), ['raster.js', 'gif.js'])),
};
const assetNames = ['wgsl/scene.wgsl', 'wgsl/post.wgsl', 'app/app.css'];
const assets = {};
for (const name of assetNames) {
  const full = name.endsWith('.css') ? join(REPO, 'src', name) : join(REPO, 'src/gpu', name);
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
// Inline the stylesheet, so the single file really is single. Pass a *function*:
// the CSS contains `$'`-style sequences (`content: "▸"` neighbours, `$`s in the
// custom properties) and a string replacement would expand them as
// backreferences — that bug shipped once and put the whole payload inside a
// <style> block.
const css = await readFile(join(REPO, 'src/app/app.css'), 'utf8');
if (css.includes('</style')) throw new Error('app.css contains </style — cannot inline');
html = html.replace('<link rel="stylesheet" href="./src/app/app.css">',
  () => `<style>\n/* inlined by tools/bundle.mjs from src/app/app.css */\n${css}\n</style>`);

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

// Same trap again, and this one bit twice: the payload embeds every module's
// source, and a source may contain `$'` or `$&` (the bitmap font has a `$`
// glyph). A string replacement would expand those patterns and splice the rest
// of the page into the middle of the payload. Always pass a function.
html = html.replace('<script type="module">', () => `${loader}\n<script type="module">`);

// ---- self-check: the payload must survive as one line, unexpanded ----------
{
  const i = html.indexOf('window.__SRC = ');
  const j = html.indexOf(';\n', i);
  if (i < 0 || j < 0) throw new Error('bundle.mjs: payload marker missing');
  const payload = html.slice(i, j);
  if (payload.includes('\n')) throw new Error('bundle.mjs: payload was spliced — a replacement backreference expanded');
  if (!payload.includes('src/app/main.js')) throw new Error('bundle.mjs: payload is missing the entry module');
  if (html.indexOf('window.__ASSETS = {') < 0) throw new Error('bundle.mjs: asset payload missing');
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
const modules = Object.keys(sources).length;
console.log(`wrote ${relative(REPO, OUT)} · ${(html.length / 1024).toFixed(0)} kB · ${modules} modules, ${assetNames.length} shaders inlined`);
