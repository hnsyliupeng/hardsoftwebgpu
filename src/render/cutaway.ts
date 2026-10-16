// Cut-away views and supersampled screenshots (shared by the gallery and render_fine).
// Cut-away: keep the far half of the mesh (by view depth through the bounding-box centre), clipping
// straddling triangles exactly, so the internal structure is visible. Same method as scripts/render_coupled.ts.
import { rasterisePreview } from "./preview.ts";
import { encodePngCompressed } from "./png.ts";
import type { MeshData } from "../types.ts";

/** Cut-away view: keep the far half (by view depth through the bounding-box centre), clipping straddling triangles
 *  exactly, so the internal structure is visible. Same method as scripts/render_coupled.ts (cut mode). */
export function cutAway(mesh: { positions: Float32Array; indices: Uint32Array | number[] }, view: [number, number] = [0.61, 0.44]) {
  const P = mesh.positions, I = mesh.indices;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < P.length; v += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[v + k]); hi[k] = Math.max(hi[k], P[v + k]); }
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  const cosZ = Math.cos(view[0]), sinZ = Math.sin(view[0]), cosX = Math.cos(view[1]), sinX = Math.sin(view[1]);
  const depth = (x: number, y: number, z: number) => (x * sinZ + y * cosZ) * sinX + z * cosX;
  const d0 = depth(c[0], c[1], c[2]);
  const outP: number[] = [], outI: number[] = [];
  const push = (x: number, y: number, z: number) => { outP.push(x, y, z); return outP.length / 3 - 1; };
  for (let t = 0; t < I.length; t += 3) {
    const poly: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const v = I[t + k] * 3;
      poly.push([P[v], P[v + 1], P[v + 2], depth(P[v], P[v + 1], P[v + 2]) - d0]);
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
          clipped.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), 0]);
        }
      }
    }
    const ids = clipped.map((q) => push(q[0], q[1], q[2]));
    for (let k = 1; k + 1 < ids.length; k++) outI.push(ids[0], ids[k], ids[k + 1]);
  }
  return { positions: Float32Array.from(outP), normals: new Float32Array(outP.length), indices: Uint32Array.from(outI) };
}

// Camera directions (rotation about z, then about x), same convention as src/render/preview.ts.
export const VIEWS: Record<string, [number, number]> = {
  iso: [0.61, 0.44],
  top: [0, 0],
  front: [0, Math.PI / 2],
  side: [Math.PI / 2, Math.PI / 2],
};

/**
 * Render one view as a square PNG: rasterise at size*ss, then box-filter down to size.
 * Returns the PNG bytes. `mesh` may be a cut-away mesh (positions, indices).
 */
export function shotPng(mesh: { positions: Float32Array; indices: Uint32Array | number[] }, size: number, ss: number, view: [number, number]): Uint8Array {
  const big = rasterisePreview(mesh as unknown as MeshData, size * ss, view);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let dy = 0; dy < ss; dy++)
          for (let dx = 0; dx < ss; dx++) acc += big.rgba[(((y * ss + dy) * size * ss) + (x * ss + dx)) * 4 + c];
        out[(y * size + x) * 4 + c] = Math.round(acc / (ss * ss));
      }
  return encodePngCompressed(size, size, out);
}
