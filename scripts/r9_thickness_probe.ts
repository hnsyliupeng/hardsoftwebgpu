// Probe: R9 gated design at 256 cells, with coupled.params overridden. Uses the same evaluateSpec as the
// gallery, so min_wall_thickness, components and volume are the gallery's own validator numbers.
//   node --experimental-strip-types --no-warnings scripts/r9_thickness_probe.ts [sheet_wall_mm ...]
import { readFileSync } from "node:fs";
import { evaluateSpec } from "../src/evaluate.ts";

const base = JSON.parse(readFileSync("examples/structure_gallery_r9_open_256/deep_R9_gated/design.json", "utf8")).design_spec;
const values = process.argv.slice(2);
const walls = values.length ? values.map(Number) : [0.5];
for (const w of walls) {
  const spec = structuredClone(base);
  spec.coupled.params = { ...spec.coupled.params, sheet_wall_mm: w };
  const ev = await evaluateSpec(spec);
  const m = ev.validation.data.metrics;
  console.log(JSON.stringify({ sheet_wall_mm: w, min_wall_mm: +m.min_wall_thickness.toFixed(4), components: m.components,
    volume_mm3: +m.volume.toFixed(1), connectivity: m.connectivity, genus: m.genus }));
}
