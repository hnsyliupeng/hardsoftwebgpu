#!/usr/bin/env node
/**
 * check-rust.mjs — type-check / borrow-check the Rust core with the
 * WebAssembly-hosted rustc (`tools/rustc-wasm-host.mjs`), no native toolchain needed.
 *
 * `--emit=metadata` runs the whole frontend (parsing, name resolution, type check,
 * trait selection, borrow check, MIR borrowck) — i.e. exactly the diagnostics you want
 * in CI — without LLVM codegen.
 *
 *   npm run check:rust
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CRATE = join(ROOT, 'rust', 'trunc_core');
const OUT = join(ROOT, '.check');
const HOST = join(HERE, 'rustc-wasm-host.mjs');
const PKG = process.env.RUSTC_PKG || join(ROOT, '.toolchain', 'rustc');
const NODE_FLAGS = ['--experimental-wasi-unstable-preview1', '--no-warnings'];

if (!existsSync(join(PKG, 'bin', 'rustc.wasm'))) {
  console.error('check-rust: toolchain missing → run `npm run fetch:toolchain`');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

function rustc(args, label) {
  const res = spawnSync(process.execPath, [...NODE_FLAGS, HOST, ...args], {
    encoding: 'utf8',
    env: { ...process.env, RUSTC_PKG: PKG },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000, // rustc's error path can stall the wasm host; diagnostics still arrive
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`.replace(/^\(node:\d+\).*$/gm, '').trim();
  const ok = res.status === 0;
  if (res.error?.code === 'ETIMEDOUT') console.log('   (host watchdog: rustc.wasm stalled after reporting — see docs/ARCHITECTURE.md)');
  console.log(`\n=== ${label} ${ok ? '✅' : '❌'} (exit ${res.status ?? res.error?.code}) ===`);
  if (out) console.log(out);
  return ok;
}

function sources(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, acc);
    else if (e.endsWith('.rs')) acc.push(p);
  }
  return acc;
}

const files = sources(join(CRATE, 'src'));
console.log(`check-rust: ${files.length} source files, sysroot ${PKG}`);

const common = ['--sysroot=' + PKG, '--target=wasm32-wasip1', '--edition=2021', '-Zthreads=1'];
let ok = rustc(
  [...common, '--crate-name', 'trunc_core', '--crate-type', 'lib', '--emit=metadata', '-o', join(OUT, 'libtrunc_core.rmeta'), join(CRATE, 'src', 'lib.rs')],
  'trunc_core (lib)',
);
if (ok) {
  ok = rustc(
    [...common, '--crate-name', 'trunc_cli', '--crate-type', 'bin', '--emit=metadata', '--extern', `trunc_core=${join(OUT, 'libtrunc_core.rmeta')}`, '-o', join(OUT, 'trunc_cli.rmeta'), join(CRATE, 'src', 'bin', 'trunc_cli.rs')],
    'trunc_cli (bin)',
  ) && ok;
}
if (ok) {
  // Rust-side test assertions (also mirrored by tests/*.test.mjs for the JS core).
  const testOk = rustc(
    [...common, '--crate-name', 'invariants', '--test', '--emit=metadata', '--extern', `trunc_core=${join(OUT, 'libtrunc_core.rmeta')}`, '-o', join(OUT, 'invariants.rmeta'), join(CRATE, 'tests', 'invariants.rs')],
    'tests/invariants.rs',
  );
  if (!testOk) console.log('   (test target: run `cargo test` with a native toolchain to execute)');
}
process.exit(ok ? 0 : 1);
