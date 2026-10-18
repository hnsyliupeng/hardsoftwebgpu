// Planar sections of a triangle mesh (D3). A plane is axis-aligned: coordinate `axis` = `offset`.
//
// Each triangle that the plane crosses gives one segment. Crossing is decided with a half-open rule
// (vertex is "above" if its coordinate >= offset), so a segment ends exactly where the neighbouring
// triangle's segment starts: the segments form closed loops for a closed mesh, with no gaps at
// shared edges or vertices.
//
// Each segment is oriented with the triangle normal so that, for a closed outward-oriented mesh, the
// loops run counter-clockwise around material. Then the section area is the shoelace sum over the
// segments, which needs no chaining: outer boundaries add area, cavities subtract it.

import type { MeshData } from "../types.ts";

export type Axis = 0 | 1 | 2;

export interface Section {
  /** Segments, four numbers per segment: x0, y0, x1, y1 in the two in-plane coordinates. */
  segments: Float64Array;
  /** In-plane axes: [a, b] with a = (axis + 1) % 3 and b = (axis + 2) % 3. */
  inPlane: [number, number];
  count: number;
}

/** Segments of the plane coordinate[axis] = offset through the mesh. Cost is linear in the triangle count. */
export function sectionSegments(mesh: Pick<MeshData, "positions" | "indices">, axis: Axis, offset: number): Section {
  const P = mesh.positions, I = mesh.indices;
  const a = (axis + 1) % 3, b = (axis + 2) % 3;
  const nTri = I.length / 3;
  const out = new Float64Array(nTri * 4);
  let count = 0;
  for (let t = 0; t < nTri; t++) {
    const i0 = I[3 * t] * 3, i1 = I[3 * t + 1] * 3, i2 = I[3 * t + 2] * 3;
    const s = [P[i0 + axis] - offset, P[i1 + axis] - offset, P[i2 + axis] - offset];
    const above = s.map((x) => x >= 0);
    if (above[0] === above[1] && above[1] === above[2]) continue; // no crossing
    // Points where the two sides differ; the two crossing edges are (i,j) with above[i] != above[j].
    const idx = [i0, i1, i2];
    const pts: number[][] = [];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
      if (above[i] === above[j]) continue;
      const tt = s[i] / (s[i] - s[j]);
      const p: number[] = [0, 0, 0];
      for (let c = 0; c < 3; c++) p[c] = P[idx[i] + c] + tt * (P[idx[j] + c] - P[idx[i] + c]);
      pts.push(p);
    }
    if (pts.length !== 2) continue; // degenerate triangle lying in the plane: no segment
    // Triangle normal (unnormalised) in the in-plane components decides the segment direction.
    const e1 = [P[i1] - P[i0], P[i1 + 1] - P[i0 + 1], P[i1 + 2] - P[i0 + 2]];
    const e2 = [P[i2] - P[i0], P[i2 + 1] - P[i0 + 1], P[i2 + 2] - P[i0 + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    // Direction d = (-n_b, n_a) puts the material on the left of the segment.
    const dA = -n[b], dB = n[a];
    let p = pts[0], q = pts[1];
    if ((q[a] - p[a]) * dA + (q[b] - p[b]) * dB < 0) [p, q] = [q, p];
    out[4 * count] = p[a];
    out[4 * count + 1] = p[b];
    out[4 * count + 2] = q[a];
    out[4 * count + 3] = q[b];
    count++;
  }
  return { segments: out.subarray(0, 4 * count), inPlane: [a, b], count };
}

/** Area enclosed by the section (signed sum over segments, outer boundaries positive, cavities negative). */
export function sectionArea(section: Section): number {
  const s = section.segments;
  let twice = 0;
  for (let k = 0; k < section.count; k++) {
    twice += s[4 * k] * s[4 * k + 3] - s[4 * k + 2] * s[4 * k + 1];
  }
  return twice / 2;
}
