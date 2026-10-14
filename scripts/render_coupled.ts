// Renders a CPU screenshot of a bioxlattice mesh.bin (same software rasteriser as the other
// screenshots, no GPU). Usage:
//   node --experimental-strip-types scripts/render_coupled.ts MESH.bin OUT.png [size=1600] [full|cut]; env RENDER_SS=2
// "cut" removes the upper half (z > 0, triangle centroids) so the internal lattice shows from above.
import { readFileSync, writeFileSync } from "node:fs";
import { parseMeshBin } from "../web/coupled.ts";
import { rasterisePreview } from "../src/render/preview.ts";
import { encodePngCompressed } from "../src/render/png.ts";

const [, , meshPath, outPath, sizeArg, modeArg] = process.argv;
if (!meshPath || !outPath) throw new Error("usage: render_coupled.ts MESH.bin OUT.png [size=1600] [full|cut]; env RENDER_SS=2");
const size = Number(sizeArg ?? 1600);
// Supersampling factor: render at size*SS, then box-filter down to size (anti-aliased edges).
const SS = Math.max(1, Math.round(Number(process.env.RENDER_SS ?? 2)));
const raw = readFileSync(meshPath);
const full = parseMeshBin(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
let mesh = full;
if (modeArg === "cut") {
  // Remove the half of the part nearest the camera (same view rotation as rasterisePreview:
  // 35 deg about z, then 25 deg about x; smaller projected depth = nearer to the viewer).
  // The far half stays, so the internal lattice is visible through the opened side.
  // Triangles straddling the cut plane are clipped exactly (Sutherland-Hodgman against the
  // plane), not dropped by centroid, so the cut edge is straight rather than stepped.
  const cosZ = Math.cos(0.61), sinZ = Math.sin(0.61), cosX = Math.cos(0.44), sinX = Math.sin(0.44);
  const depth = (x: number, y: number, z: number) => (x * sinZ + y * cosZ) * sinX + z * cosX;
  const P = full.positions, I = full.indices;
  const outP: number[] = [];
  const outI: number[] = [];
  const pushVertex = (x: number, y: number, z: number) => {
    outP.push(x, y, z);
    return outP.length / 3 - 1;
  };
  for (let t = 0; t < I.length; t += 3) {
    // polygon as [x, y, z, d] with d = depth; keep the part with d >= 0
    const poly: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const v = I[t + k] * 3;
      poly.push([P[v], P[v + 1], P[v + 2], depth(P[v], P[v + 1], P[v + 2])]);
    }
    const inside = poly.filter((q) => q[3] >= 0).length;
    if (inside === 0) continue;
    let clipped = poly;
    if (inside < 3) {
      clipped = [];
      for (let k = 0; k < 3; k++) {
        const a = poly[k], b = poly[(k + 1) % 3];
        if (a[3] >= 0) clipped.push(a);
        if ((a[3] >= 0) !== (b[3] >= 0)) {
          const f = a[3] / (a[3] - b[3]);
          const q = [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
          clipped.push([q[0], q[1], q[2], 0]);
        }
      }
    }
    const ids = clipped.map((q) => pushVertex(q[0], q[1], q[2]));
    for (let k = 1; k + 1 < ids.length; k++) outI.push(ids[0], ids[k], ids[k + 1]);
  }
  mesh = {
    positions: Float32Array.from(outP),
    normals: new Float32Array(outP.length),
    indices: Uint32Array.from(outI),
  };
}
const t0 = Date.now();
const big = rasterisePreview(mesh, size * SS);
const out = new Uint8Array(size * size * 4);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < SS; dy++)
      for (let dx = 0; dx < SS; dx++) {
        const k = ((y * SS + dy) * size * SS + (x * SS + dx)) * 4;
        r += big.rgba[k]; g += big.rgba[k + 1]; b += big.rgba[k + 2]; n++;
      }
    const o = (y * size + x) * 4;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
  }
const img = { rgba: out, coverage: big.coverage };
writeFileSync(outPath, encodePngCompressed(size, size, img.rgba));
console.log(`${outPath}: ${mesh.indices.length / 3} triangles after cut (input ${full.indices.length / 3}), ${size} px (supersample ${SS}x), coverage ${img.coverage.toFixed(3)}, ${Date.now() - t0} ms`);
