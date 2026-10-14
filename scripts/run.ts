// CLI: run the full multi-harness pipeline on one prompt and write artifacts/<name>/.
//   node --experimental-strip-types scripts/run.ts "<prompt>" [name] [resolution]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline.ts";

const prompt = process.argv[2] ?? "Make a helical Bouligand structure with 5 plies, 10 degrees rotation.";
const name = process.argv[3] ?? "design";
const resolution = process.argv[4] ? Number(process.argv[4]) : undefined;
const t0 = Date.now();
const res = await runPipeline(prompt, { name, resolution });
// Small deliverables (design JSON, code) go to artifacts/<name>/. Mesh exports can be large, so
// OUT_DIR may redirect them elsewhere (the workspace snapshot has a size budget).
const dir = join("artifacts", name);
const meshDir = process.env.OUT_DIR ?? dir;
mkdirSync(dir, { recursive: true });
mkdirSync(meshDir, { recursive: true });
const ex = res.exports;
if (ex) {
  for (const [file, data] of Object.entries(ex.data.files)) {
    const target = file.endsWith(".design.json") ? dir : meshDir;
    writeFileSync(join(target, file), data);
  }
}
writeFileSync(join(dir, "design.ts"), res.code);
const summary = {
  prompt,
  elapsed_ms: Date.now() - t0,
  metrics: res.state.metrics,
  repair_history: res.state.repair_history,
  harness_ok: Object.fromEntries(Object.entries(res.reports).map(([k, v]) => [k, v.ok])),
  exports: ex?.data.manifest ?? [],
};
console.log(JSON.stringify(summary, null, 2));
