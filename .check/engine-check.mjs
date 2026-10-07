// quick driver for runEngineChecks
/**
 * The engine-side acceptance, headless — the same `runEngineChecks()` the CPU
 * page and the WebGPU port panel run, so every table in the browser has a CLI twin.
 *
 *   node --disable-warning=ExperimentalWarning .check/engine-check.mjs          # quick
 *   node --disable-warning=ExperimentalWarning .check/engine-check.mjs --full   # every row
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { runEngineChecks } = await import(join(ROOT, 'src/app/engineCheck.js'));
const FULL = process.argv.includes('--full');
const t0 = Date.now();
const res = await runEngineChecks((i, n, label) => {
  if (i === 1 || i % 4 === 0 || i === n) process.stdout.write(`\r[${i}/${n}] ${label.padEnd(52)}`);
}, { quick: !FULL });
const rows = res.rows ?? res;
const pass = rows.filter((r) => r.ok).length;
console.log(`\n\n${pass}/${rows.length} engine checks passed in ${((Date.now() - t0) / 1000).toFixed(1)} s (${FULL ? 'full' : 'quick'} profile)`);
process.exitCode = pass === rows.length ? 0 : 1;
for (const r of rows) if (!r.ok) console.log(`  FAIL  ${r.group}/${r.name}: ${r.detail}`);
