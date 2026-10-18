// Measurement on triangle meshes (D3): surface area, volume, bounding box, point distance and section area.
// Volume uses the divergence theorem (signedVolume, decimate.ts): valid for closed, outward-oriented meshes.

import type { MeshData } from "../types.ts";
import { signedVolume } from "./decimate.ts";
import { sectionSegments, sectionArea, type Axis } from "./section.ts";

export interface Measurements {
  surfaceAreaMm2: number;
  volumeMm3: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  triangles: number;
}

/** Total triangle area. Summed in double precision. */
export function surfaceArea(mesh: Pick<MeshData, "positions" | "indices">): number {
  const P = mesh.positions, I = mesh.indices;
  let total = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    total += Math.hypot(cx, cy, cz) / 2;
  }
  return total;
}

export function boundingBox(mesh: Pick<MeshData, "positions">): { min: [number, number, number]; max: [number, number, number] } {
  const P = mesh.positions;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      if (P[i + c] < min[c]) min[c] = P[i + c];
      if (P[i + c] > max[c]) max[c] = P[i + c];
    }
  }
  return { min, max };
}

export function distance(p: [number, number, number], q: [number, number, number]): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Area of the cross-section of the mesh by the plane coordinate[axis] = offset. */
export function crossSectionArea(mesh: Pick<MeshData, "positions" | "indices">, axis: Axis, offset: number): number {
  return sectionArea(sectionSegments(mesh, axis, offset));
}

export function measure(mesh: Pick<MeshData, "positions" | "indices">): Measurements {
  return {
    surfaceAreaMm2: surfaceArea(mesh),
    volumeMm3: signedVolume(mesh.positions as Float32Array, mesh.indices as Uint32Array),
    bbox: boundingBox(mesh),
    triangles: mesh.indices.length / 3,
  };
}
