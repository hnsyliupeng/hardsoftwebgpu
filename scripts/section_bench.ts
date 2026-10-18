// D3 benchmark: sections and measurement on closed meshes of 1e5 to 1e6 triangles (icosphere, radius 10 mm).
// Reports build time, measurement time, section time, and error against the analytic sphere values.
//   node --experimental-strip-types --no-warnings --max-old-space-size=6000 scripts/section_bench.ts
// Output: eval/section_bench.csv (tracked, small).
import { writeFileSync } from "node:fs";
import { icosphereMesh } from "../src/geometry/primitives.ts";
import { sectionSegments, sectionArea } from "../src/geometry/section.ts";
import { measure } from "../src/geometry/measure.ts";

const R = 10;
const rows: string[] = ["subdiv,triangles,build_ms,measure_ms,section_ms_mean,area_err_pct,volume_err_pct,equator_err_pct,offcentre_err_pct,sections"];
for (const k of [6, 7, 8]) {
  const t0 = performance.now();
  const mesh = icosphereMesh(k, R);
  const buildMs = performance.now() - t0;

  const t1 = performance.now();
  const m = measure(mesh);
  const measureMs = performance.now() - t1;

  const offsets = [0, 3, 6.5];
  const times: number[] = [];
  const areas: number[] = [];
  for (const z of offsets) {
    const ts = performance.now();
    const sec = sectionSegments(mesh, 2, z);
    areas.push(sectionArea(sec));
    times.push(performance.now() - ts);
  }
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const areaErr = Math.abs(m.surfaceAreaMm2 / (4 * Math.PI * R * R) - 1) * 100;
  const volErr = Math.abs(m.volumeMm3 / ((4 / 3) * Math.PI * R ** 3) - 1) * 100;
  const eqErr = Math.abs(areas[0] / (Math.PI * R * R) - 1) * 100;
  const offErr = Math.abs(areas[2] / (Math.PI * (R * R - 6.5 * 6.5)) - 1) * 100;
  const row = [k, m.triangles, buildMs.toFixed(0), measureMs.toFixed(1), mean.toFixed(2), areaErr.toFixed(4), volErr.toFixed(4), eqErr.toFixed(4), offErr.toFixed(4), offsets.length].join(",");
  rows.push(row);
  console.log(row);
}
writeFileSync("eval/section_bench.csv", rows.join("\n") + "\n");
console.log("wrote eval/section_bench.csv");
