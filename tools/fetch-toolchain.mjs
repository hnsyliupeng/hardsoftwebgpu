#!/usr/bin/env node
/**
 * fetch-toolchain.mjs — download the WebAssembly Rust toolchain used by
 * `npm run check:rust` / `npm run build:wasm:wasm-host`.
 *
 * Source: @ai-ecoverse/wasi-rustc (npm) — rustc + wasm32-wasip1 std, both
 * compiled to WebAssembly. Unpacked it is ~210 MB, so it is fetched on demand
 * into `.toolchain/` (git-ignored) instead of being committed.
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEST = join(ROOT, '.toolchain');
const PKG = 'wasi-rustc';
const VERSION = process.env.RUSTC_WASM_VERSION || 'latest';

const meta = JSON.parse(
  execFileSync('npm', ['view', `@ai-ecoverse/${PKG}@${VERSION}`, '--json'], { encoding: 'utf8' })
);
const tarball = meta.dist.tarball;
console.log(`fetch-toolchain: ${meta.name}@${meta.version} → ${DEST}`);
mkdirSync(DEST, { recursive: true });

const tgz = join(DEST, `${PKG}.tgz`);
if (!existsSync(tgz)) {
  const res = await fetch(tarball);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${tarball}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tgz));
}
rmSync(join(DEST, 'rustc'), { recursive: true, force: true });
mkdirSync(join(DEST, 'rustc'), { recursive: true });
execFileSync('tar', ['xzf', tgz, '-C', join(DEST, 'rustc'), '--strip-components=1']);
writeFileSync(join(DEST, 'rustc', 'VERSION'), `${meta.name}@${meta.version}\n`);
console.log('fetch-toolchain: done — try `npm run check:rust`');
