// Full-chain sweep: every prompt of eval/benchmark.csv (320 rows) through IntentHarness ->
// TopologyHarness -> GeometryHarness -> ValidationHarness -> RepairHarness on the CPU.
// Measures completion, repairs, connectivity and printability per subcategory; it is NOT a
// geometry-quality or paper-accuracy score (no LLM, no reference geometry).
//   node --experimental-strip-types scripts/pipeline_bench.ts [resolution=48] [limit]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runPipeline } from "../src/pipeline.ts";
import { parseCsv } from "./csv.ts";

const resolution = process.argv[2] ? Number(process.argv[2]) : 48;
const limit = process.argv[3] ? Number(process.argv[3]) : Infinity;
const rows = parseCsv(readFileSync("eval/benchmark.csv", "utf8").replace(/^\uFEFF/, "")).slice(0, limit);

interface Rec {
  i: number;
  subcategory: string;
  prompt: string;
  topology: string;
  variant: string;
  ok: boolean;
  error: string | null;
  connectivity: boolean | null;
  volume: number | null;
  min_wall: number | null;
  floor: number | null;
  repairs: number;
  repairs_accepted: number;
  ms: number;
}
const recs: Rec[] = [];
const t0 = Date.now();
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const t = Date.now();
  try {
    const r = await runPipeline(row.prompt, { resolution, exportFiles: false });
    const m = r.state.metrics;
    const h = r.state.repair_history;
    recs.push({
      i,
      subcategory: row.subcategory,
      prompt: row.prompt.slice(0, 120),
      topology: r.state.design_spec.topology,
      variant: r.state.design_spec.variant,
      ok: Object.values(r.reports).every((x) => x.ok),
      error: null,
      connectivity: m.connectivity,
      volume: m.volume,
      min_wall: m.min_wall_thickness,
      floor: r.state.design_spec.constraints.min_printable_wall_mm,
      repairs: h.length,
      repairs_accepted: h.filter((x) => x.accepted).length,
      ms: Date.now() - t,
    });
  } catch (e) {
    recs.push({ i, subcategory: row.subcategory, prompt: row.prompt.slice(0, 120), topology: "", variant: "", ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e), connectivity: null, volume: null, min_wall: null, floor: null, repairs: 0, repairs_accepted: 0, ms: Date.now() - t });
  }
  if (i % 40 === 0) console.log(`${i}/${rows.length} ${Math.round((Date.now() - t0) / 1000)} s`);
}

const bySub: Record<string, Rec[]> = {};
for (const r of recs) (bySub[r.subcategory] ??= []).push(r);
const summary = Object.fromEntries(
  Object.entries(bySub).map(([sub, xs]) => {
    const scored = xs.filter((x) => x.error === null);
    const ms = scored.map((x) => x.ms).sort((a, b) => a - b);
    return [
      sub,
      {
        n: xs.length,
        completed: scored.length,
        exceptions: xs.length - scored.length,
        all_harnesses_ok: xs.filter((x) => x.ok).length,
        connectivity_true: scored.filter((x) => x.connectivity).length,
        designs_with_repairs: scored.filter((x) => x.repairs > 0).length,
        min_wall_at_or_above_floor: scored.filter((x) => x.min_wall !== null && x.floor !== null && x.min_wall >= x.floor).length,
        median_ms: ms.length ? ms[Math.floor(ms.length / 2)] : null,
        topologies: Object.fromEntries(Object.entries(countBy(scored, (x) => x.topology))),
      },
    ];
  }),
);
function countBy<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}
const total = {
  prompts: recs.length,
  completed: recs.filter((x) => x.error === null).length,
  exceptions: recs.filter((x) => x.error !== null).length,
  all_harnesses_ok: recs.filter((x) => x.ok).length,
  connectivity_true: recs.filter((x) => x.connectivity).length,
  designs_with_repairs: recs.filter((x) => x.repairs > 0).length,
  repair_attempts: recs.reduce((a, x) => a + x.repairs, 0),
  total_seconds: Math.round((Date.now() - t0) / 1000),
  resolution,
};
mkdirSync("artifacts/pipeline_benchmark", { recursive: true });
writeFileSync("artifacts/pipeline_benchmark/summary.json", JSON.stringify({ mode: "cpu-only, no LLM", resolution, total, by_subcategory: summary }, null, 2));
writeFileSync("artifacts/pipeline_benchmark/rows.json", JSON.stringify(recs));
console.log(JSON.stringify(total, null, 2));
