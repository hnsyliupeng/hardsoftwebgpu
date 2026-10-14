// Renders a CPU screenshot of a bioxlattice mesh.bin (same software rasteriser as the other
// screenshots, no GPU). Usage:
//   node --experimental-strip-types scripts/render_coupled.ts MESH.bin OUT.png [size] [full|cut]
// "cut" removes the upper half (z > 0, triangle centroids) so the internal lattice shows from above.
import { readFileSync, writeFileSync } from "node:fs";
import { parseMeshBin } from "../web/coupled.ts";
import { rasterisePreview } from "../src/render/preview.ts";
import { encodePngCompressed } from "../src/render/png.ts";

const [, , meshPath, outPath, sizeArg, modeArg] = process.argv;
if (!meshPath || !outPath) throw new Error("usage: render_coupled.ts MESH.bin OUT.png [size] [full|cut]");
const size = Number(sizeArg ?? 800);
const raw = readFileSync(meshPath);
const full = parseMeshBin(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
let mesh = full;
if (modeArg === "cut") {
  // remove the upper half: top skin and upper lattice, leaving the lower lattice visible
  const keep: number[] = [];
  const P = full.positions, I = full.indices;
  for (let t = 0; t < I.length; t += 3) {
    let cz = 0;
    for (let k = 0; k < 3; k++) cz += P[I[t + k] * 3 + 2];
    if (cz / 3 >= 0) keep.push(I[t], I[t + 1], I[t + 2]);
  }
  mesh = { positions: P, normals: full.normals, indices: Uint32Array.from(keep) };
}
const t0 = Date.now();
const img = rasterisePreview(mesh, size);
writeFileSync(outPath, encodePngCompressed(size, size, img.rgba));
console.log(`${outPath}: ${mesh.indices.length / 3} of ${full.indices.length / 3} triangles, ${size} px, coverage ${img.coverage.toFixed(3)}, ${Date.now() - t0} ms`);
