// Writes real screenshots of the generated models into examples/<name>/screenshot.png
// (CPU software rasteriser, no GPU, no browser).
// Each design runs through the full pipeline; the mesh the viewer receives is rendered at 800 px
// with the same isometric view and Lambert shading as the CPU preview.
//   node --experimental-strip-types scripts/screenshots.ts [size=800]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline.ts";
import { EXAMPLE_PROGRAMS } from "../src/program/index.ts";
import { rasterisePreview } from "../src/render/preview.ts";
import { encodePngCompressed } from "../src/render/png.ts";

const size = Number(process.argv[2] ?? 800);


const DESIGNS: { name: string; prompt?: string; program?: keyof typeof EXAMPLE_PROGRAMS; resolution: number }[] = [
  { name: "gyroid_repair", prompt: "gyroid TPMS wall thickness 0.2 mm, 4 mm cell", resolution: 96 },
  { name: "helix_demo", prompt: "Make a helical Bouligand structure with 5 plies, 10 degrees rotation.", resolution: 96 },
  { name: "tubular_demo", prompt: "Make a tubular structure with 16 tubules and cortical layer thickness 0.04.", resolution: 96 },
  { name: "sandwich_demo", prompt: "Write Blender code to make a cellular bioinspired structure with sandwich top and bottom layers", resolution: 96 },
  { name: "bcc_graded", prompt: "BCC lattice 20 mm, 4 mm cell, strut radius 0.5 mm, graded along z from 0.3 mm to 0.9 mm", resolution: 96 },
  { name: "rounded_hollow_box", program: "rounded_hollow_box", resolution: 96 },
];

for (const d of DESIGNS) {
  const outDir = join("examples", d.name);
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  const prompt = d.program ? `feature program ${d.program}` : (d.prompt as string);
  const res = await runPipeline(prompt, {
    resolution: d.resolution,
    exportFiles: false,
    program: d.program ? EXAMPLE_PROGRAMS[d.program] : undefined,
  });
  const img = rasterisePreview(res.meshForViewer, size);
  const file = join(outDir, "screenshot.png");
  writeFileSync(file, encodePngCompressed(size, size, img.rgba));
  const m = res.state.metrics;
  console.log(
    `${d.name}: ${file} | vol ${m.volume.toFixed(1)} mm3 | triangles ${res.meshForViewer.indices.length / 3} | coverage ${(img.coverage * 100).toFixed(1)} % | repairs ${res.state.repair_history.length} | ${Date.now() - t0} ms`,
  );
}
