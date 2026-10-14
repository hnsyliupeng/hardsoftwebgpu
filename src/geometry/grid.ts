// CPU geometry core for the SDF path: sampling, surface-nets meshing (dual contouring with
// the edge-crossing vertex placement of naive surface nets), mesh integrals, voxel topology
// (components, cavities, Euler characteristic, Betti numbers) and local wall thickness.

import type { Field } from "../topology/fields.ts";
import type { MeshData } from "../types.ts";

export interface Grid {
  nx: number;
  ny: number;
  nz: number;
  origin: [number, number, number];
  h: number;
  /** Node-centred samples (negative inside). Index = i + nx*(j + ny*k). */
  values: Float32Array;
}

export function nodeIndex(g: Pick<Grid, "nx" | "ny">, i: number, j: number, k: number): number {
  return i + g.nx * (j + g.ny * k);
}

/** Sample a field on a regular grid that covers its bounds with `pad` extra nodes on every side. */
export function sampleField(field: Field, resolution: number, pad = 2): Grid {
  const { min, max } = field.bounds;
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const h = extent / resolution;
  const origin: [number, number, number] = [min[0] - pad * h, min[1] - pad * h, min[2] - pad * h];
  const nx = Math.ceil((max[0] - min[0]) / h) + 2 * pad + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 2 * pad + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 2 * pad + 1;
  const values = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = origin[2] + k * h;
    for (let j = 0; j < ny; j++) {
      const y = origin[1] + j * h;
      let idx = nx * (j + ny * k);
      for (let i = 0; i < nx; i++) {
        values[idx++] = field.eval(origin[0] + i * h, y, z);
      }
    }
  }
  return { nx, ny, nz, origin, h, values };
}

/**
 * Box-blur passes on the sampled field (3x3x3 mean, clamped at the border). Rounds convex edges
 * and corners; used for the cellular "smoothlevel" parameter.
 */
export function blurField(g: Grid, passes: number): Grid {
  let src = g.values;
  for (let p = 0; p < passes; p++) {
    const dst = new Float32Array(src.length);
    for (let k = 0; k < g.nz; k++)
      for (let j = 0; j < g.ny; j++)
        for (let i = 0; i < g.nx; i++) {
          let s = 0;
          let c = 0;
          for (let dk = -1; dk <= 1; dk++) {
            const kk = Math.min(g.nz - 1, Math.max(0, k + dk));
            for (let dj = -1; dj <= 1; dj++) {
              const jj = Math.min(g.ny - 1, Math.max(0, j + dj));
              for (let di = -1; di <= 1; di++) {
                const ii = Math.min(g.nx - 1, Math.max(0, i + di));
                s += src[nodeIndex(g, ii, jj, kk)];
                c++;
              }
            }
          }
          dst[nodeIndex(g, i, j, k)] = s / c;
        }
    src = dst;
  }
  return { ...g, values: src };
}

// Cube corner offsets and the 12 edges between them (corner index pairs).
const CORNERS: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Surface nets: one vertex per sign-changing cell (mean of its edge crossings), one quad per
 * sign-changing grid edge. Output is an outward-oriented, closed-by-construction quad mesh
 * triangulated into triangles.
 */
export function surfaceNets(g: Grid): MeshData {
  const { nx, ny, nz, values: v, h, origin } = g;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVert = new Int32Array(Math.max(0, cx * cy * cz)).fill(-1);
  const pos: number[] = [];
  const cellIdx = (i: number, j: number, k: number) => i + cx * (j + cy * k);
  const corner = new Float64Array(8);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = CORNERS[c];
          const val = v[nodeIndex(g, i + dx, j + dy, k + dz)];
          corner[c] = val;
          if (val < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const [ax, ay, az] = CORNERS[a];
          const [bx, by, bz] = CORNERS[b];
          sx += ax + t * (bx - ax);
          sy += ay + t * (by - ay);
          sz += az + t * (bz - az);
          n++;
        }
        cellVert[cellIdx(i, j, k)] = pos.length / 3;
        pos.push(
          origin[0] + h * (i + sx / n),
          origin[1] + h * (j + sy / n),
          origin[2] + h * (k + sz / n),
        );
      }

  const tris: number[] = [];
  const addQuad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) {
      tris.push(a, d, c, a, c, b);
    } else {
      tris.push(a, b, c, a, c, d);
    }
  };
  // Edge along axis `axis` from node P to P+e_axis. The four cells sharing the edge form a ring
  // in the (u,v) plane with u x v = e_axis; ring offsets are ccw seen from +axis.
  const ring: Record<number, { u: number; v: number }> = {
    0: { u: 1, v: 2 }, // x-edge: (y,z)
    1: { u: 2, v: 0 }, // y-edge: (z,x)
    2: { u: 0, v: 1 }, // z-edge: (x,y)
  };
  const offs: [number, number][] = [
    [-1, -1],
    [0, -1],
    [0, 0],
    [-1, 0],
  ];
  for (let axis = 0; axis < 3; axis++) {
    const { u: ua, v: va } = ring[axis];
    const lim = [nx, ny, nz];
    const delta = [0, 0, 0];
    delta[axis] = 1;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const p = [i, j, k];
          if (p[axis] + 1 >= lim[axis]) continue;
          const q = [i + delta[0], j + delta[1], k + delta[2]];
          const vp = v[nodeIndex(g, p[0], p[1], p[2])];
          const vq = v[nodeIndex(g, q[0], q[1], q[2])];
          if (vp < 0 === vq < 0) continue;
          const ids: number[] = [];
          let ok = true;
          for (const [ou, ov] of offs) {
            const c = [p[0], p[1], p[2]];
            c[ua] += ou;
            c[va] += ov;
            if (c[0] < 0 || c[1] < 0 || c[2] < 0 || c[0] >= cx || c[1] >= cy || c[2] >= cz) {
              ok = false;
              break;
            }
            ids.push(cellVert[cellIdx(c[0], c[1], c[2])]);
          }
          if (!ok) continue;
          addQuad(ids[0], ids[1], ids[2], ids[3], vp >= 0);
        }
  }

  const positions = Float32Array.from(pos);
  const indices = Uint32Array.from(tris);
  return { positions, indices, normals: vertexNormals(positions, indices) };
}

export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const o of [a, b, c]) {
      n[o] += nx;
      n[o + 1] += ny;
      n[o + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

export interface MeshIntegrals {
  volume: number; // signed volume (positive for outward normals)
  area: number;
  centroid: [number, number, number];
  triangles: number;
  bbox: [[number, number, number], [number, number, number]];
}

export function meshIntegrals(mesh: { positions: Float32Array; indices: Uint32Array }): MeshIntegrals {
  const { positions: p, indices: idx } = mesh;
  let vol = 0;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[i + a]);
      max[a] = Math.max(max[a], p[i + a]);
    }
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ax = p[a];
    const ay = p[a + 1];
    const az = p[a + 2];
    const bx = p[b];
    const by = p[b + 1];
    const bz = p[b + 2];
    const qx = p[c];
    const qy = p[c + 1];
    const qz = p[c + 2];
    // Signed tetrahedron volume with the origin.
    const v6 = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    const tv = v6 / 6;
    vol += tv;
    cx += tv * (ax + bx + qx) / 4;
    cy += tv * (ay + by + qy) / 4;
    cz += tv * (az + bz + qz) / 4;
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = qx - ax;
    const e2y = qy - ay;
    const e2z = qz - az;
    area += 0.5 * Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
  }
  const centroid: [number, number, number] = vol !== 0 ? [cx / vol, cy / vol, cz / vol] : [0, 0, 0];
  return {
    volume: vol,
    area,
    centroid,
    triangles: idx.length / 3,
    bbox: [
      [min[0], min[1], min[2]],
      [max[0], max[1], max[2]],
    ],
  };
}

/** Occupancy: a node is solid when its SDF value is negative. */
export function occupancy(g: Grid): Uint8Array {
  const out = new Uint8Array(g.values.length);
  for (let i = 0; i < out.length; i++) out[i] = g.values[i] < 0 ? 1 : 0;
  return out;
}

export interface VoxelTopology {
  /** Connected components of the solid (26-connectivity of occupied nodes). */
  components: number;
  /** Bounded cavities of the solid (6-connected empty regions not touching the grid border). */
  cavities: number;
  /** Euler characteristic of the cubical complex formed by the occupied nodes. */
  euler: number;
  /** First Betti number (independent handles / tunnels): b1 = b0 + b2 - chi. */
  handles: number;
  /** Number of occupied nodes. */
  solidNodes: number;
}

export function voxelTopology(g: Grid, occ = occupancy(g)): VoxelTopology {
  const { nx, ny, nz } = g;
  const N = nx * ny * nz;
  // ---- components of solid (26-connectivity) and cavities of background (6-connectivity)
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  let solidNodes = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const id = nodeIndex(g, i, j, k);
        if (!occ[id]) continue;
        solidNodes++;
        for (let dk = -1; dk <= 1; dk++)
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              if (di === 0 && dj === 0 && dk === 0) continue;
              // only "forward" neighbours to avoid double work
              if (di < 0 || (di === 0 && (dj < 0 || (dj === 0 && dk < 0)))) continue;
              const ii = i + di;
              const jj = j + dj;
              const kk = k + dk;
              if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
              const nid = nodeIndex(g, ii, jj, kk);
              if (occ[nid]) union(id, nid);
            }
      }
  const solidRoots = new Set<number>();
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const id = nodeIndex(g, i, j, k);
        if (occ[id]) solidRoots.add(find(id));
      }
  const components = solidRoots.size;

  // Background: reset parents for empty nodes, 6-connectivity, components touching the border are "outside".
  for (let i = 0; i < N; i++) parent[i] = i;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const id = nodeIndex(g, i, j, k);
        if (occ[id]) continue;
        if (i + 1 < nx && !occ[id + 1]) union(id, id + 1);
        if (j + 1 < ny && !occ[id + nx]) union(id, id + nx);
        if (k + 1 < nz && !occ[id + nx * ny]) union(id, id + nx * ny);
      }
  const outsideRoots = new Set<number>();
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (i !== 0 && j !== 0 && k !== 0 && i !== nx - 1 && j !== ny - 1 && k !== nz - 1) continue;
        const id = nodeIndex(g, i, j, k);
        if (!occ[id]) outsideRoots.add(find(id));
      }
  const backgroundRoots = new Set<number>();
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const id = nodeIndex(g, i, j, k);
        if (!occ[id]) backgroundRoots.add(find(id));
      }
  let cavities = 0;
  for (const r of backgroundRoots) if (!outsideRoots.has(r)) cavities++;

  // ---- Euler characteristic of the union of closed unit cubes centred on occupied nodes.
  // Cube p spans [p, p+1]^3 on the dual lattice of size (nx+1, ny+1, nz+1).
  const VX = nx + 1;
  const VY = ny + 1;
  const VZ = nz + 1;
  const M = VX * VY * VZ;
  const vmark = new Uint8Array(M);
  const ex = new Uint8Array(M);
  const ey = new Uint8Array(M);
  const ez = new Uint8Array(M);
  const fx = new Uint8Array(M);
  const fy = new Uint8Array(M);
  const fz = new Uint8Array(M);
  const I = (x: number, y: number, z: number) => x + VX * (y + VY * z);
  let C = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!occ[nodeIndex(g, i, j, k)]) continue;
        C++;
        for (let dz = 0; dz <= 1; dz++)
          for (let dy = 0; dy <= 1; dy++)
            for (let dx = 0; dx <= 1; dx++) vmark[I(i + dx, j + dy, k + dz)] = 1;
        for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) ex[I(i, j + dy, k + dz)] = 1;
        for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) ey[I(i + dx, j, k + dz)] = 1;
        for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) ez[I(i + dx, j + dy, k)] = 1;
        fx[I(i, j, k)] = 1;
        fx[I(i + 1, j, k)] = 1;
        fy[I(i, j, k)] = 1;
        fy[I(i, j + 1, k)] = 1;
        fz[I(i, j, k)] = 1;
        fz[I(i, j, k + 1)] = 1;
      }
  let V = 0;
  let E = 0;
  let F = 0;
  for (let t = 0; t < M; t++) {
    V += vmark[t];
    E += ex[t] + ey[t] + ez[t];
    F += fx[t] + fy[t] + fz[t];
  }
  const euler = V - E + F - C;
  const handles = components + cavities - euler;
  return { components, cavities, euler, handles, solidNodes };
}

/**
 * Local wall thickness estimate. Squared Euclidean distance transform (Felzenszwalb-Huttenlocher)
 * of the solid to the nearest empty node; medial candidates are local maxima of the distance.
 * Thickness at a medial point ~ (2d - 1) h. Returns the 1st-percentile (robust) and the raw min.
 */
