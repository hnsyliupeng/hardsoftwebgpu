// Closed test meshes with analytic area and volume (D3). Outward-oriented triangles, counter-clockwise
// seen from outside, so signedVolume > 0 and sectionSegments orient the loops correctly.

import type { MeshData } from "../types.ts";
import { signedVolume } from "./decimate.ts";

function finish(positions: number[], indices: number[], flipAll = false): MeshData {
  const P = new Float32Array(positions);
  const I = new Uint32Array(indices);
  if (flipAll) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
  return { positions: P, normals: new Float32Array(P.length), indices: I };
}

/**
 * Axis-aligned box [min, max]. inward = true gives a cavity (normals point into the box), which is
 * how a hole in a solid is represented when it is cut from another box.
 */
export function boxMesh(min: [number, number, number], max: [number, number, number], inward = false): MeshData {
  const v = (i: number, j: number, k: number) => [i ? max[0] : min[0], j ? max[1] : min[1], k ? max[2] : min[2]];
  const quads: [number[], number[], number[], number[]][] = [
    [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)], // -x
    [v(1, 0, 0), v(1, 0, 1), v(1, 1, 1), v(1, 1, 0)], // +x
    [v(0, 0, 0), v(0, 0, 1), v(1, 0, 1), v(1, 0, 0)], // -y
    [v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)], // +y
    [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)], // -z
    [v(0, 0, 1), v(0, 1, 1), v(1, 1, 1), v(1, 0, 1)], // +z
  ];
  const centre = [0, 1, 2].map((c) => (min[c] + max[c]) / 2);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [a, b, c, d] of quads) {
    for (const tri of [[a, b, c], [a, c, d]]) {
      // Orient the triangle so its normal points away from the box centre (or into it for a cavity).
      const e1 = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]];
      const e2 = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const cen = [0, 1, 2].map((k) => (tri[0][k] + tri[1][k] + tri[2][k]) / 3 - centre[k]);
      const outward = n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] > 0;
      const base = positions.length / 3;
      const order = outward !== inward ? tri : [tri[0], tri[2], tri[1]];
      for (const p of order) positions.push(p[0], p[1], p[2]);
      indices.push(base, base + 1, base + 2);
    }
  }
  return finish(positions, indices);
}

/** Icosphere of radius R with 20 * 4^subdiv triangles, outward oriented. */
export function icosphereMesh(subdiv: number, R: number): MeshData {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => { const n = Math.hypot(p[0], p[1], p[2]); return [p[0] / n, p[1] / n, p[2] / n]; });
  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map<number, number>();
    const mid = (a: number, b: number): number => {
      const key = Math.min(a, b) * 4_000_000 + Math.max(a, b);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const pa = verts[a], pb = verts[b];
      const m = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      const n = Math.hypot(m[0], m[1], m[2]);
      verts.push([m[0] / n, m[1] / n, m[2] / n]);
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const positions: number[] = [];
  for (const p of verts) positions.push(p[0] * R, p[1] * R, p[2] * R);
  const indices: number[] = [];
  for (const f of faces) indices.push(f[0], f[1], f[2]);
  const mesh = finish(positions, indices);
  // Orientation check: the signed volume of an outward mesh is positive.
  if (signedVolume(mesh.positions, mesh.indices) < 0) return finish(positions, indices, true);
  return mesh;
}
