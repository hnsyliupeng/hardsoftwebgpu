// Web Worker: runs the full multi-harness pipeline off the main thread (ValidationHarness runs
// here on the CPU). Only JSON-able results and typed arrays are posted back.

import { runPipeline } from "../src/pipeline.ts";
import { parseProgramJson } from "../src/program/index.ts";
import { rasterisePreview } from "../src/render/preview.ts";

// The smlibwasm package is copied next to the bundle (see scripts/build-web.mjs); the kernel
// loader imports it from this URL at runtime.
(globalThis as { __SMLIB_URL?: string }).__SMLIB_URL ??= new URL("./vendor/smlibwasm/dist/index.js", import.meta.url).href;

interface RunRequest {
  type: "run";
  mode?: "prompt" | "program";
  prompt: string;
  /** Feature program JSON text (mode "program"). */
  programJson?: string;
  sizeMm?: number;
  resolution?: number;
  maxRepairRounds?: number;
  minWallMm?: number;
}

self.onmessage = async (ev: MessageEvent<RunRequest>) => {
  const msg = ev.data;
  if (msg.type !== "run") return;
  try {
    const t0 = performance.now();
    const program = msg.mode === "program" ? parseProgramJson(msg.programJson ?? "") : undefined;
    const res = await runPipeline(msg.prompt, {
      sizeMm: msg.sizeMm,
      resolution: msg.resolution,
      maxRepairRounds: msg.maxRepairRounds,
      minWallMm: msg.minWallMm,
      name: program?.name ?? "design",
      program,
    });
    const files: Record<string, Uint8Array | string> = {};
    if (res.exports) for (const [k, v] of Object.entries(res.exports.data.files)) files[k] = v;
    const mesh = res.meshForViewer;
    const geo = res.reports.GeometryHarness.data as { programSteps: unknown[] | null };
    const val = res.reports.ValidationHarness.data as { metrics: { brep_vs_sdf_volume_rel_err?: number | null; porosity: number } };
    const payload = {
      type: "result" as const,
      state: res.state,
      code: res.code,
      harnesses: Object.fromEntries(
        Object.entries(res.reports).map(([k, v]) => [k, { ok: v.ok, observations: v.observations, limitations: v.limitations, unknowns: v.unknowns, evidence: v.evidence }]),
      ),
      timeline: geo.programSteps ?? null,
      crossCheck: val.metrics.brep_vs_sdf_volume_rel_err ?? null,
      porosity: val.metrics.porosity,
      manifest: res.exports?.data.manifest ?? [],
      files,
      mesh: { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices },
      // CPU software render at 640 px: always shown under the viewer, whatever renderer is active.
      snapshot: rasterisePreview(mesh, 640).dataUrl,
      ms: Math.round(performance.now() - t0),
    };
    const transfer: Transferable[] = [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer];
    (self as unknown as Worker).postMessage(payload, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ type: "error", message: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e) });
  }
};
