// Triangle budget for display meshes (step A2 of docs/TASK_PLAN.md).
//
// Surface nets at resolution N gives ~ N^2 triangles. Interactive display needs ~1e5 to 1e6, so
// the viewer gets a decimated copy and exports keep the full mesh.
//
// Method: vertex clustering. Vertices are binned on a uniform grid of cell size c; each occupied
// bin becomes one vertex at the mean of its members. Triangles whose corners collapse are removed.
// c is found by bisection so the triangle count is at or just below the budget. The method is
// deterministic and cheap (O(V) per trial). It does not preserve the volume exactly: the bias is
// reported (volumeErrPct) and checked in scripts/decimate_check.ts.

import type { MeshData } from "../types.ts";
import { vertexNormals } from "./grid.ts";

export interface DecimateStats {
  budget: number;
  inputTriangles: number;
  outputTriangles: number;
  cellMm: number;
  inputVolumeMm3: number;
  outputVolumeMm3: number;
  volumeErrPct: number;
  timeMs: number;
}

/** Signed volume of a closed triangle mesh (divergence theorem). */
export function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    v +=
      (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
        positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
        positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) /
      6;
  }
  return v;
}

/** One clustering pass at cell size c. Returns the output mesh (without normals). */
function clusterAt(mesh: MeshData, c: number, origin: [number, number, number]): { positions: Float32Array; indices: Uint32Array } {
  const { positions: p, indices: idx } = mesh;
  const nv = p.length / 3;
  const map = new Int32Array(nv);
  const bins = new Map<number, number>();
  const sums: number[] = [];
  const counts: number[] = [];
  // Bin key: indices are in [0, 4096] (origin is the bounding minimum, cell >= extent/4096), so
  // K = 8192 keeps the packed key below 2^39, exact in a double.
  const K = 8192;
  for (let v = 0; v < nv; v++) {
    const ix = Math.floor((p[v * 3] - origin[0]) / c);
    const iy = Math.floor((p[v * 3 + 1] - origin[1]) / c);
    const iz = Math.floor((p[v * 3 + 2] - origin[2]) / c);
    const key = (ix * K + iy) * K + iz;
    let id = bins.get(key);
    if (id === undefined) {
      id = counts.length;
      bins.set(key, id);
      sums.push(0, 0, 0);
      counts.push(0);
    }
    sums[id * 3] += p[v * 3];
    sums[id * 3 + 1] += p[v * 3 + 1];
    sums[id * 3 + 2] += p[v * 3 + 2];
    counts[id]++;
    map[v] = id;
  }
  const nc = counts.length;
  const positions = new Float32Array(nc * 3);
  for (let i = 0; i < nc; i++) {
    positions[i * 3] = sums[i * 3] / counts[i];
    positions[i * 3 + 1] = sums[i * 3 + 1] / counts[i];
    positions[i * 3 + 2] = sums[i * 3 + 2] / counts[i];
  }
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = map[idx[t]], b = map[idx[t + 1]], d = map[idx[t + 2]];
    if (a === b || b === d || a === d) continue;
    out.push(a, b, d);
  }
  return { positions, indices: Uint32Array.from(out) };
}

/** Reduce a mesh to at most `budget` triangles (approximately, from below) by vertex clustering. */
export function decimateToBudget(mesh: MeshData, budget: number): { mesh: MeshData; stats: DecimateStats } {
  const t0 = Date.now();
  const inTris = mesh.indices.length / 3;
  const inVol = signedVolume(mesh.positions, mesh.indices);
  // Bounds for the grid origin.
  const origin: [number, number, number] = [Infinity, Infinity, Infinity];
  const p = mesh.positions;
  for (let v = 0; v < p.length; v += 3) for (let a = 0; a < 3; a++) origin[a] = Math.min(origin[a], p[v + a]);
  let extent = 0;
  for (let v = 0; v < p.length; v += 3) for (let a = 0; a < 3; a++) extent = Math.max(extent, p[v + a] - origin[a]);

  let result: { positions: Float32Array; indices: Uint32Array } = { positions: mesh.positions, indices: mesh.indices };
  let cell = 0;
  if (inTris > budget) {
    // Bisection on log(cell): larger cells -> fewer triangles.
    let lo = extent / 4096; // fine: near the input triangle count
    let hi = extent; // coarse: far fewer triangles than the budget
    let best: { positions: Float32Array; indices: Uint32Array } | null = null;
    let bestCell = hi;
    for (let it = 0; it < 22; it++) {
      const mid = Math.sqrt(lo * hi);
      const r = clusterAt(mesh, mid, origin);
      const tris = r.indices.length / 3;
      if (tris > budget) {
        lo = mid;
      } else {
        hi = mid;
        best = r;
        bestCell = mid;
      }
      if (hi / lo < 1.01) break;
    }
    if (!best) {
      best = clusterAt(mesh, hi, origin);
      bestCell = hi;
    }
    result = best;
    cell = bestCell;
  }
  const normals = vertexNormals(result.positions, result.indices);
  const outVol = signedVolume(result.positions, result.indices);
  const out: MeshData = { positions: result.positions, indices: result.indices, normals };
  return {
    mesh: out,
    stats: {
      budget,
      inputTriangles: inTris,
      outputTriangles: result.indices.length / 3,
      cellMm: cell,
      inputVolumeMm3: inVol,
      outputVolumeMm3: outVol,
      volumeErrPct: inVol === 0 ? 0 : ((outVol - inVol) / inVol) * 100,
      timeMs: Date.now() - t0,
    },
  };
}
