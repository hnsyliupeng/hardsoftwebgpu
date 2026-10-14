// CLI: run the full multi-harness pipeline and write artifacts/<name>/ (CPU only).
//   node --experimental-strip-types scripts/run.ts "<prompt>" [name] [resolution]
//   node --experimental-strip-types scripts/run.ts --program <example-name | file.json> [name] [resolution]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline.ts";
import { EXAMPLE_PROGRAMS, parseProgramJson } from "../src/program/index.ts";

const useProgram = process.argv[2] === "--program";
const args = useProgram ? process.argv.slice(3) : process.argv.slice(2);
let prompt = args[0] ?? "Make a helical Bouligand structure with 5 plies, 10 degrees rotation.";
let program: ReturnType<typeof parseProgramJson> | undefined;
if (useProgram) {
  const src = args[0];
  if (!src) throw new Error("--program needs an example name or a JSON file");
  if (src in EXAMPLE_PROGRAMS) program = EXAMPLE_PROGRAMS[src as keyof typeof EXAMPLE_PROGRAMS];
  else program = parseProgramJson(readFileSync(src, "utf8"));
  prompt = `feature program ${program.name}`;
}
const name = args[1] ?? program?.name ?? "design";
const resolution = args[2] ? Number(args[2]) : undefined;
const t0 = Date.now();
const res = await runPipeline(prompt, { name, resolution, program });
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
  porosity: res.validation.metrics.porosity,
  repair_history: res.state.repair_history,
  harness_ok: Object.fromEntries(Object.entries(res.reports).map(([k, v]) => [k, v.ok])),
  exports: ex?.data.manifest ?? [],
};
console.log(JSON.stringify(summary, null, 2));
