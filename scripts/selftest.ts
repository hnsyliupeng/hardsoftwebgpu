// CPU-only self-test of the whole chain (no GPU, no network, no browser).
//   node --experimental-strip-types scripts/selftest.ts
// Writes artifacts/selftest/report.json and exits non-zero if any check fails.
// Unit tests live in tests/*.test.ts (npm test); this script checks the harness chain end to end.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runPipeline } from "../src/pipeline.ts";
import { parseIntent } from "../src/intent/intent.ts";
import { EXAMPLE_PROGRAMS, executeBrepProgram, compileProgramField } from "../src/program/index.ts";
import { evaluateSpec } from "../src/evaluate.ts";
import { sampleField, surfaceNets, meshIntegrals } from "../src/geometry/grid.ts";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

// ---- 1. Feature programs: B-Rep vs SDF, pipeline, copy-executable code ----------------------
for (const [key, prog] of Object.entries(EXAMPLE_PROGRAMS)) {
  const brep = await executeBrepProgram(prog);
  const sdf = meshIntegrals(surfaceNets(sampleField(compileProgramField(prog).field, 96))).volume;
  const err = Math.abs(sdf - brep.solid.volume) / brep.solid.volume;
  check(`program ${key}: B-Rep vs SDF volume within 1.5 %`, err < 0.015, `B-Rep ${brep.solid.volume.toFixed(2)}, SDF ${sdf.toFixed(2)}, ${(err * 100).toFixed(2)} %`);
  check(`program ${key}: every timeline step ok`, brep.steps.every((s) => s.ok), brep.steps.map((s) => `${s.id}:${s.op}`).join(" > "));

  const dir = `artifacts/selftest-${key}`; // two levels below the root, as the emitted imports expect
  mkdirSync(dir, { recursive: true });
  const res = await runPipeline(`feature program ${key}`, { program: prog, resolution: 96, exportFiles: false });
  const file = `${dir}/design.ts`;
  writeFileSync(file, res.code);
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", file], { encoding: "utf8", timeout: 300000 });
  let reproduced = false;
  let vol = NaN;
  if (run.status === 0) {
    try {
      vol = JSON.parse(run.stdout).volume_mm3;
      reproduced = Math.abs(vol - res.state.metrics.volume) < 1e-6;
    } catch {
      reproduced = false;
    }
  }
  check(`program ${key}: emitted code runs and reproduces the volume`, reproduced, run.status === 0 ? `volume ${vol}` : run.stderr.slice(0, 200));
}

// ---- 2. Family coverage through the full pipeline (res 48, CPU) -----------------------------
const FAMILY_PROMPTS: [string, string][] = [
  ["helical", "Make a helical Bouligand structure with 5 plies, 10 degrees rotation."],
  ["tubular", "Make a tubular structure with 16 tubules and cortical layer thickness 0.04."],
  ["cellular", "Create a cellular foam with smooth voronoi cells."],
  ["lattice sc", "simple cubic lattice 20 mm, 4 mm cell, 0.6 mm strut radius"],
  ["lattice bcc", "bcc lattice 20 mm with 4 mm cell"],
  ["lattice fcc", "fcc lattice 20 mm with 4 mm cell"],
  ["lattice fbcc", "fbcc lattice 20 mm with 4 mm cell"],
  ["lattice diamond", "diamond lattice 20 mm with 4 mm cell"],
  ["tpms gyroid", "gyroid TPMS wall thickness 0.4 mm, 4 mm cell"],
  ["tpms schwarz_p", "schwarz P TPMS wall thickness 0.5 mm, 5 mm cell"],
  ["tpms schwarz_d", "schwarz D TPMS wall thickness 0.5 mm, 5 mm cell"],
  ["hybrid", "bcc lattice combined with a cellular foam"],
  ["heterogeneity linear", "BCC lattice 20 mm, 4 mm cell, strut radius 0.5 mm, graded along z from 0.3 mm to 0.9 mm"],
  ["heterogeneity sin", "BCC lattice 20 mm, 4 mm cell, strut radius 0.5 mm, sinusoidal variation along z from 0.3 mm to 0.7 mm"],
  ["heterogeneity parabola", "BCC lattice 20 mm, 4 mm cell, strut radius 0.5 mm, parabolic variation along z from 0.3 mm to 0.7 mm"],
  ["heterogeneity expr", "BCC lattice 20 mm, 4 mm cell, strut radius 0.5 mm, thickness(u) = 0.3 + 0.2*sin(2*pi*u) along z, 0.3 to 0.7 mm"],
  ["porosity target", "bcc lattice 20 mm with 4 mm cell, porosity 80%"],
];
const familyRows: Record<string, unknown>[] = [];
for (const [label, prompt] of FAMILY_PROMPTS) {
  const t0 = Date.now();
  try {
    const res = await runPipeline(prompt, { resolution: 48, exportFiles: false });
    const ok = Object.values(res.reports).every((r) => r.ok);
    const fourFields = Object.values(res.reports).every(
      (r) => Array.isArray(r.observations) && Array.isArray(r.limitations) && Array.isArray(r.unknowns) && typeof r.evidence === "object" && r.evidence !== null,
    );
    const stateKeys = Object.keys(res.state).sort().join(",");
    const expectedKeys = "code,design_spec,limitations,metrics,prompt,render_preview,repair_history,unknowns";
    check(`family ${label}: every harness report has observations/limitations/unknowns/evidence`, fourFields);
    check(`family ${label}: DesignState has the mandated keys`, stateKeys === expectedKeys, stateKeys);
    const m = res.state.metrics;
    familyRows.push({ label, topology: res.state.design_spec.topology, variant: res.state.design_spec.variant, volume: m.volume, min_wall: m.min_wall_thickness, connectivity: m.connectivity, genus: m.genus, repairs: res.state.repair_history.length, ms: Date.now() - t0 });
    check(`family ${label}: pipeline completes with all harnesses ok`, ok, `vol ${m.volume.toFixed(1)} mm3, conn ${m.connectivity}, repairs ${res.state.repair_history.length}`);
  } catch (e) {
    check(`family ${label}: pipeline completes`, false, e instanceof Error ? e.message : String(e));
  }
}

// ---- 3. Hybrid union semantics: max(parts) <= hybrid <= sum(parts) --------------------------
{
  const vol = async (prompt: string) => {
    const ev = await evaluateSpec(parseIntent(prompt).data);
    return meshIntegrals(ev.geometry.data.sdfMesh).volume;
  };
  const lat = await vol("bcc lattice 20 mm with 4 mm cell");
  const bio = await vol("Create a cellular foam with smooth voronoi cells.");
  const hyb = await vol("bcc lattice combined with a cellular foam");
  const lo = Math.max(lat, bio) * 0.97;
  const hi = (lat + bio) * 1.03;
  check("hybrid union: max(parts) <= hybrid <= sum(parts) (3 % tolerance)", hyb >= lo && hyb <= hi, `lattice ${lat.toFixed(0)}, bio ${bio.toFixed(0)}, hybrid ${hyb.toFixed(0)}`);
}

// ---- 4. Summary -------------------------------------------------------------------------------
const failed = checks.filter((c) => !c.ok);
mkdirSync("artifacts/selftest", { recursive: true });
writeFileSync("artifacts/selftest/report.json", JSON.stringify({ generated_by: "scripts/selftest.ts", mode: "cpu-only", checks, families: familyRows }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Report: artifacts/selftest/report.json`);
if (failed.length) process.exitCode = 1;
