#!/usr/bin/env node
/**
 * ts-emit.mjs — TypeScript → JavaScript, with no TypeScript dependency.
 *
 * Node 22.13+ exposes `module.stripTypeScriptTypes`, i.e. the same transform the
 * runtime uses for `--experimental-strip-types`. This script walks `ts/`, erases
 * the types, and mirrors the tree into `js/` (so `./x.js` specifiers keep
 * resolving), then optionally imports the result to prove it runs as plain
 * JavaScript.
 *
 *   node tools/ts-emit.mjs            # emit js/
 *   node tools/ts-emit.mjs --check    # emit, then import every module
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'ts');
const OUT = join(ROOT, 'js');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

export function emit({ quiet = false } = {}) {
  const files = walk(SRC);
  let bytes = 0;
  const emitted = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const js = stripTypeScriptTypes(src, { mode: 'strip', sourceUrl: file });
    const rel = relative(SRC, file).replace(/\.ts$/, '.js');
    const dest = join(OUT, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `// generated from ts/${relative(SRC, file)} by tools/ts-emit.mjs — do not edit\n${js}`);
    bytes += js.length;
    emitted.push({ rel, bytes: js.length, srcBytes: src.length });
  }
  if (!quiet) {
    const srcBytes = emitted.reduce((a, e) => a + e.srcBytes, 0);
    console.log(`ts-emit: ${emitted.length} modules, ${(srcBytes / 1024).toFixed(1)} kB TypeScript → ` +
      `${(bytes / 1024).toFixed(1)} kB JavaScript in js/`);
    for (const e of emitted) console.log(`  js/${e.rel.padEnd(24)} ${String(e.bytes).padStart(6)} B`);
  }
  return { emitted, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { emitted } = emit();
  if (process.argv.includes('--check')) {
    const mods = ['index.js', 'trunc/index.js', 'trunc/kinematics.js', 'trunc/trajectories.js',
      'trunc/interp.js', 'trunc/robotArm.js', 'trunc/armMotor.js', 'trunc/analysis.js',
      'trunc/setup.js', 'trunc/math.js', 'sim/index.js', 'sim/solver.js', 'sim/animation.js'];
    for (const m of mods) {
      const url = pathToFileURL(join(OUT, m)).href;
      await import(url);
    }
    console.log(`ts-emit --check: imported ${mods.length} emitted modules OK`);
    if (!emitted.length) process.exitCode = 1;
  }
}
