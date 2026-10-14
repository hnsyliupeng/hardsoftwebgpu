// Writes real screenshots of the generated models into examples/<name>/screenshot.png
// (CPU software rasteriser, no GPU, no browser).
// Each design runs through the full pipeline; the mesh the viewer receives is rendered at 800 px
// with the same isometric view and Lambert shading as the CPU preview.
//   node --experimental-strip-types scripts/screenshots.ts [size=800]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { runPipeline } from "../src/pipeline.ts";
import { EXAMPLE_PROGRAMS } from "../src/program/index.ts";
import { rasterisePreview } from "../src/render/preview.ts";

const size = Number(process.argv[2] ?? 800);

// Compressed RGBA PNG (zlib level 9). The kernel-side encoder in src/render/preview.ts writes
// stored (uncompressed) blocks, which is too large for a repository, so screenshots use this one.
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const body = Buffer.concat([head.subarray(4, 8), Buffer.from(data)]); // type + data
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, Buffer.from(data), crc]); // length + type + data + crc
}
function encodePngCompressed(w: number, h: number, rgba: Uint8Array): Buffer {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

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
