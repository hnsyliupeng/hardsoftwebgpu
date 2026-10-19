// Pinch resolution for triangle meshes from dual contouring.
//
// Why: even with per-patch vertices, two sheets that touch inside one grid cell can still leave a pair of
// vertices shared by two separate sheets, so an edge gets four triangles (non-manifold). Here each vertex is
// split into "fans": the triangles around the vertex are grouped by connecting them through manifold edges
// only (edges used by exactly two triangles). Every fan after the first gets its own copy of the vertex.
// Positions are unchanged, so the surface and the enclosed volume are unchanged; only the topology is cut at
// the pinch. Repeated until no non-manifold edge is left (or the pass limit is hit).
//
// Memory: all work is per vertex on its own triangle list (CSR adjacency, typed arrays). Every triangle that
// contains an edge (v, o) also contains v, so the edge multiplicity is read from v's local list alone.

import type { MeshData } from "../types.ts";
import { vertexNormals } from "./grid.ts";

export interface EdgeTopology {
  edges: number;
  open: number; // edges used by exactly one triangle
  nonManifold: number; // edges used by three or more triangles
}

interface Adjacency {
  start: Uint32Array; // CSR offsets, length nVert + 1
  tris: Uint32Array; // triangle ids per vertex
}

function maxIndex(indices: Uint32Array): number {
  let m = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] > m) m = indices[i];
  return m;
}

function buildAdjacency(indices: Uint32Array, nVert: number): Adjacency {
  const start = new Uint32Array(nVert + 1);
  for (let i = 0; i < indices.length; i++) start[indices[i] + 1]++;
  for (let v = 0; v < nVert; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nVert);
  const tris = new Uint32Array(indices.length);
  for (let t = 0; t < indices.length / 3; t++) {
    for (let e = 0; e < 3; e++) tris[fill[indices[3 * t + e]]++] = t;
  }
  return { start, tris };
}

/** Distinct neighbours o of v (other corners of v's triangles) with the number of local triangles that contain o. */
function neighbourCounts(
  indices: Uint32Array,
  v: number,
  locals: Uint32Array,
  names: number[],
  counts: number[],
): void {
  names.length = 0;
  counts.length = 0;
  for (let i = 0; i < locals.length; i++) {
    const t = locals[i];
    for (let e = 0; e < 3; e++) {
      const o = indices[3 * t + e];
      if (o === v) continue;
      const k = names.indexOf(o);
      if (k < 0) {
        names.push(o);
        counts.push(1);
      } else {
        counts[k]++;
      }
    }
  }
  // A triangle has at most one corner equal to o, so counts[k] is the number of local triangles that contain o.
}

/** Counts open and non-manifold edges of a triangle list. */
export function edgeTopology(indices: Uint32Array): EdgeTopology {
  const nVert = indices.length ? maxIndex(indices) + 1 : 0;
  const adj = buildAdjacency(indices, nVert);
  const names: number[] = [];
  const counts: number[] = [];
  let edges = 0, open = 0, nonManifold = 0;
  for (let v = 0; v < nVert; v++) {
    const s = adj.start[v], e = adj.start[v + 1];
    if (e - s === 0) continue;
    neighbourCounts(indices, v, adj.tris.subarray(s, e), names, counts);
    for (let k = 0; k < names.length; k++) {
      if (names[k] <= v) continue; // count each edge once, from its smaller endpoint
      edges++;
      if (counts[k] === 1) open++;
      else if (counts[k] > 2) nonManifold++;
    }
  }
  return { edges, open, nonManifold };
}

/**
 * One pass: split every vertex whose triangles form more than one fan.
 * Returns the new index list, the positions of the new copies (xyz triples) and the split count.
 */
function splitOnce(
  positions: Float32Array,
  indices: Uint32Array,
): { indices: Uint32Array; extra: number[]; splits: number } {
  const nVert = positions.length / 3;
  const adj = buildAdjacency(indices, nVert);
  const out = Uint32Array.from(indices);
  const extra: number[] = [];
  const names: number[] = [];
  const counts: number[] = [];
  let splits = 0;
  let nextId = nVert;

  for (let v = 0; v < nVert; v++) {
    const s = adj.start[v], e = adj.start[v + 1];
    const d = e - s;
    if (d < 2) continue;
    const locals = adj.tris.subarray(s, e);
    neighbourCounts(indices, v, locals, names, counts);

    // Union-find over the local triangles. Two local triangles are joined when they share a neighbour o whose
    // edge (v, o) is manifold (exactly two triangles).
    const parent = new Int32Array(d);
    for (let i = 0; i < d; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const manifoldNeighbour = (o: number): boolean => {
      const k = names.indexOf(o);
      return k >= 0 && counts[k] === 2;
    };
    for (let i = 0; i < d; i++) {
      const ti = locals[i];
      for (let j = i + 1; j < d; j++) {
        const tj = locals[j];
        // Shared neighbour of the two triangles (other than v).
        let shared = -1;
        for (let a = 0; a < 3 && shared < 0; a++) {
          const oa = indices[3 * ti + a];
          if (oa === v) continue;
          for (let b = 0; b < 3; b++) {
            if (indices[3 * tj + b] === oa) {
              shared = oa;
              break;
            }
          }
        }
        if (shared >= 0 && manifoldNeighbour(shared)) {
          const ri = find(i), rj = find(j);
          if (ri !== rj) parent[ri] = rj;
        }
      }
    }

    // Fan roots in order of first appearance; the first fan keeps v, later fans get new copies of v.
    const fanTarget = new Map<number, number>();
    for (let i = 0; i < d; i++) {
      const root = find(i);
      if (fanTarget.has(root)) continue;
      if (fanTarget.size === 0) {
        fanTarget.set(root, v);
      } else {
        fanTarget.set(root, nextId++);
        extra.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
        splits++;
      }
    }
    if (fanTarget.size < 2) continue;
    for (let i = 0; i < d; i++) {
      const target = fanTarget.get(find(i))!;
      if (target === v) continue;
      const t = locals[i];
      for (let c = 0; c < 3; c++) {
        if (out[3 * t + c] === v) out[3 * t + c] = target;
      }
    }
  }
  return { indices: out, extra, splits };
}

/**
 * Splits pinch vertices until the mesh has no non-manifold edges (or `maxPasses` is reached).
 * Positions of the copies equal the original vertex, so geometry and enclosed volume are unchanged.
 * Normals are recomputed from the new topology.
 */
export function splitPinchVertices(mesh: MeshData, maxPasses = 8): { mesh: MeshData; splits: number; passes: number } {
  let positions = mesh.positions;
  let indices = mesh.indices;
  let totalSplits = 0;
  let passes = 0;
  for (; passes < maxPasses; passes++) {
    const topo = edgeTopology(indices);
    if (topo.nonManifold === 0) break;
    const r = splitOnce(positions, indices);
    if (r.splits === 0) break;
    const merged = new Float32Array(positions.length + r.extra.length);
    merged.set(positions, 0);
    merged.set(r.extra, positions.length);
    positions = merged;
    indices = r.indices;
    totalSplits += r.splits;
  }
  return {
    mesh: { positions, indices, normals: vertexNormals(positions, indices) },
    splits: totalSplits,
    passes,
  };
}
