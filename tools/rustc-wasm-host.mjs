#!/usr/bin/env node
/**
 * rustc-wasm-host.mjs — a tiny WASIX-lite host that runs `rustc.wasm` (LLVM-in-WASM)
 * on top of Node's `node:wasi` bindings, including the `wasi-threads` ABI that
 * rustc needs (it runs codegen on a background thread).
 *
 * Why this exists: the TRUNC WebGPU lab ships a real Rust core (`rust/trunc_core`)
 * so the simulation maths has a single, portable source of truth. Most machines
 * build it with a normal `cargo` (see tools/build-wasm.mjs). Where no native Rust
 * toolchain can be installed, this host compiles/validates the crate with a
 * Rust toolchain that has itself been compiled to WebAssembly.
 *
 * Status (2026-10):
 *   ✅ frontend + borrow check (`--emit=metadata`, `--emit=dep-info`)  — used by `npm run check:rust`
 *   ⚠️  LLVM codegen (`--emit=obj|link`) deadlocks: the guest's `parking_lot`
 *       was built without `target_feature = "atomics"`, so thread parking on the
 *       host thread pool is unsupported. Documented in docs/ARCHITECTURE.md.
 *
 * Usage:
 *   node --experimental-wasi-unstable-preview1 tools/rustc-wasm-host.mjs [rustc args...]
 *   RUSTC_PKG=/path/to/@ai-ecoverse/wasi-rustc/package  (defaults to .toolchain/rustc)
 *   RUSTC_LOG=/tmp/rustc.log   (optional: trace host calls)
 */
import { WASI } from 'node:wasi';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { readFileSync, writeSync, openSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PKG = process.env.RUSTC_PKG || join(ROOT, '.toolchain', 'rustc');
const LOG = process.env.RUSTC_LOG || '';
const logFd = LOG ? openSync(LOG, 'a') : null;
const log = (m) => { if (logFd !== null) writeSync(logFd, `[${Date.now() % 1e6}] ${m}\n`); };

const wasiArgs = process.argv.slice(2);
const ENV = {
  RUST_MIN_STACK: '16777216',
  PATH: '/usr/bin:/bin',
  HOME: '/tmp',
  TMPDIR: '/tmp',
  SYSROOT: PKG,          // probed first by the toolchain's patched sysroot lookup
  RUSTC_SYSROOT: PKG,
};
const PREOPENS = {
  '/tmp': '/tmp',
  '/home/user': '/home/user',
  '/work': ROOT,
};

if (isMainThread) {
  const wasmPath = join(PKG, 'bin', 'rustc.wasm');
  if (!existsSync(wasmPath)) {
    console.error(`rustc-wasm-host: no toolchain at ${wasmPath}\n  run: npm run fetch:toolchain`);
    process.exit(2);
  }
  log('=== main ' + wasiArgs.join(' '));
  const mod = await WebAssembly.compile(readFileSync(wasmPath));
  // Modules built for wasm32-wasip1-threads import a shared memory with a max.
  const memory = new WebAssembly.Memory({ initial: 8192, maximum: 65536, shared: true });
  const wasi = new WASI({ version: 'preview1', args: wasiArgs, env: ENV, preopens: PREOPENS });
  const imports = wasi.getImportObject();
  imports.env = { memory };

  let nextTid = 1;
  const workers = new Set();
  imports.wasi = {
    'thread-spawn': (startArg) => {
      const tid = nextTid++;
      try {
        const w = new Worker(new URL(import.meta.url), { workerData: { memory, tid, startArg, wasiArgs } });
        workers.add(w);
        w.on('error', (e) => log('main: worker error ' + e));
        w.on('exit', (c) => { workers.delete(w); log(`main: worker ${tid} exit ${c}`); });
      } catch (e) { log('main: spawn failed ' + e); return -1; }
      log(`main: spawned tid ${tid}`);
      return tid;
    },
  };
  // WASIX extensions: not needed for in-process compilation, stubbed with ENOSYS.
  imports.wasix_32v1 = {
    fd_pipe: () => 52,
    proc_spawn3: (...a) => { log('main: proc_spawn3 ' + a.join(',')); return 52; },
  };

  const inst = await WebAssembly.instantiate(mod, imports);
  let code = 0;
  try {
    code = wasi.start({ exports: { memory, _start: inst.exports._start } });
  } catch (e) {
    if (typeof e === 'number') code = e;
    else { log('main: threw ' + (e?.stack || e)); code = 1; }
  }
  for (const w of workers) { try { await w.terminate(); } catch {} }
  process.exit(code ?? 0);
} else {
  const { memory, tid, startArg, wasiArgs: wArgs } = workerData;
  log(`[t${tid}] start`);
  const wasi = new WASI({ version: 'preview1', args: wArgs, env: ENV, preopens: PREOPENS });
  const imports = wasi.getImportObject();
  imports.env = { memory };
  imports.wasi = { 'thread-spawn': () => 52 };
  imports.wasix_32v1 = { fd_pipe: () => 52, proc_spawn3: () => 52 };
  const mod = await WebAssembly.compile(readFileSync(join(PKG, 'bin', 'rustc.wasm')));
  const inst = await WebAssembly.instantiate(mod, imports);
  wasi.initialize({ exports: { memory } });
  try {
    inst.exports.wasi_thread_start(tid, startArg);
    log(`[t${tid}] returned`);
  } catch (e) {
    log(`[t${tid}] threw ${e?.stack || e}`);
  }
}
