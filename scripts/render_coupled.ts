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
  // Remove the half of the part nearest the camera (same view rotation as rasterisePreview:
  // 35 deg about z, then 25 deg about x; smaller projected depth = nearer to the viewer).
  // The far half stays, so the internal lattice is visible through the opened side.
  const keep: number[] = [];
  const P = full.positions, I = full.indices;
  const cosZ = Math.cos(0.61), sinZ = Math.sin(0.61), cosX = Math.cos(0.44), sinX = Math.sin(0.44);
  const depth = (x: number, y: number, z: number) => (x * sinZ + y * cosZ) * sinX + z * cosX;
  for (let t = 0; t < I.length; t += 3) {
    let dx = 0, dy = 0, dz = 0;
    for (let k = 0; k < 3; k++) {
      dx += P[I[t + k] * 3]; dy += P[I[t + k] * 3 + 1]; dz += P[I[t + k] * 3 + 2];
    }
    if (depth(dx / 3, dy / 3, dz / 3) >= 0) keep.push(I[t], I[t + 1], I[t + 2]);
  }
  mesh = { positions: P, normals: full.normals, indices: Uint32Array.from(keep) };
}
const t0 = Date.now();
const img = rasterisePreview(mesh, size);
writeFileSync(outPath, encodePngCompressed(size, size, img.rgba));
console.log(`${outPath}: ${mesh.indices.length / 3} of ${full.indices.length / 3} triangles, ${size} px, coverage ${img.coverage.toFixed(3)}, ${Date.now() - t0} ms`);
