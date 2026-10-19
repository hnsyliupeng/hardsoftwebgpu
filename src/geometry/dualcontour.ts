// Manifold dual contouring on the node-centred grid used by surfaceNets().
//
// Why: surface nets puts one vertex in each sign-changing cell. Where two sheets cross inside one cell (a union
// crease), the two sheets share that vertex, and grid edges end up shared by four triangles (non-manifold).
// Here each cell is split into surface patches, one vertex per patch, so the sheets get separate vertices.
//
// Patch rule (per cell): the sign-changing cell edges are linked through the cell faces. On a face with two
// crossings the two crossings are linked. On a face with four crossings (the ambiguous checker pattern) each
// inside corner is cut off, linking the two crossings around it. A face is shared by its two cells and its
// rule depends only on its own corners, so neighbouring cells agree. Patches are the connected components of
// the links. Each patch vertex is the least-squares point of its crossings' tangent planes (normals from the
// node gradient), clamped to the cell. Each sign-changing grid edge gives one quad from the four cells around it.

import type { MeshData } from "../types.ts";
import type { Grid } from "./grid.ts";
import { vertexNormals } from "./grid.ts";

// Corner offsets; corner index = dx + 2*dy + 4*dz.
const CORNERS: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
// The 12 cube edges as corner pairs.
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];
// EI[a*8+b] = edge index joining corners a and b (or -1).
const EI = new Int8Array(64).fill(-1);
EDGES.forEach(([a, b], e) => {
  EI[a * 8 + b] = e;
  EI[b * 8 + a] = e;
});
// The six faces as corner cycles (each consecutive pair is a cube edge).
const FACES: [number, number, number, number][] = [
  [0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [0, 1, 3, 2], [4, 5, 7, 6],
];

/** Eigen-decomposition of a symmetric 3x3 matrix by cyclic Jacobi rotations. Returns eigenvalues and columns. */
function eigenSym3(a: number[]): { w: number[]; v: number[][] } {
  const m = [
    [a[0], a[1], a[2]],
    [a[1], a[3], a[4]],
    [a[2], a[4], a[5]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 12; sweep++) {
    const off = Math.abs(m[0][1]) + Math.abs(m[0][2]) + Math.abs(m[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      if (Math.abs(m[p][q]) < 1e-18) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const mkp = m[k][p];
        const mkq = m[k][q];
        m[k][p] = c * mkp - s * mkq;
        m[k][q] = s * mkp + c * mkq;
      }
      for (let k = 0; k < 3; k++) {
        const mpk = m[p][k];
        const mqk = m[q][k];
        m[p][k] = c * mpk - s * mqk;
        m[q][k] = s * mpk + c * mqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { w: [m[0][0], m[1][1], m[2][2]], v };
}

/**
 * Least-squares vertex for planes (n_i, p_i), regularised toward the mass point `mp`.
 * Singular values below 0.1 of the largest are dropped (the usual QEF truncation). Result clamped to [lo, hi].
 */
function qefVertex(
  rows: { n: number[]; b: number }[],
  mp: number[],
  lo: number[],
  hi: number[],
): number[] {
  const ata = [0, 0, 0, 0, 0, 0]; // xx xy xz yy yz zz
  const atb = [0, 0, 0];
  for (const { n, b } of rows) {
    ata[0] += n[0] * n[0];
    ata[1] += n[0] * n[1];
    ata[2] += n[0] * n[2];
    ata[3] += n[1] * n[1];
    ata[4] += n[1] * n[2];
    ata[5] += n[2] * n[2];
    atb[0] += n[0] * b;
    atb[1] += n[1] * b;
    atb[2] += n[2] * b;
  }
  // Work relative to the mass point: solve for d with A d = b - A mp.
  const am = [
    ata[0] * mp[0] + ata[1] * mp[1] + ata[2] * mp[2],
    ata[1] * mp[0] + ata[3] * mp[1] + ata[4] * mp[2],
    ata[2] * mp[0] + ata[4] * mp[1] + ata[5] * mp[2],
  ];
  const rhs = [atb[0] - am[0], atb[1] - am[1], atb[2] - am[2]];
  const { w, v } = eigenSym3(ata);
  const wmax = Math.max(Math.abs(w[0]), Math.abs(w[1]), Math.abs(w[2]));
  const d = [0, 0, 0];
  if (wmax > 1e-12) {
    for (let i = 0; i < 3; i++) {
      if (Math.abs(w[i]) < 0.1 * wmax) continue;
      const proj = v[0][i] * rhs[0] + v[1][i] * rhs[1] + v[2][i] * rhs[2];
      const f = proj / w[i];
      d[0] += f * v[0][i];
      d[1] += f * v[1][i];
      d[2] += f * v[2][i];
    }
  }
  return [
    Math.min(hi[0], Math.max(lo[0], mp[0] + d[0])),
    Math.min(hi[1], Math.max(lo[1], mp[1] + d[1])),
    Math.min(hi[2], Math.max(lo[2], mp[2] + d[2])),
  ];
}

export function dualContourManifold(g: Grid): MeshData {
  const { nx, ny, nz, values: v, h, origin } = g;
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const nNodes = nx * ny * nz;

  // Node gradients (central differences, one-sided at the grid boundary), stored as separate arrays.
  const gx = new Float32Array(nNodes);
  const gy = new Float32Array(nNodes);
  const gz = new Float32Array(nNodes);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const n = i + nx * (j + ny * k);
        const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1);
        const j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1);
        const k0 = Math.max(0, k - 1), k1 = Math.min(nz - 1, k + 1);
        gx[n] = (v[i1 + nx * (j + ny * k)] - v[i0 + nx * (j + ny * k)]) / ((i1 - i0) || 1);
        gy[n] = (v[i + nx * (j1 + ny * k)] - v[i + nx * (j0 + ny * k)]) / ((j1 - j0) || 1);
        gz[n] = (v[i + nx * (j + ny * k1)] - v[i + nx * (j + ny * k0)]) / ((k1 - k0) || 1);
      }

  const cellEdgeVert = new Int32Array(Math.max(0, cx * cy * cz) * 12).fill(-1);
  const pos: number[] = [];

  // Scratch for one cell.
  const cval = new Float64Array(8);
  const cglobal = new Int32Array(8);
  const sc = new Uint8Array(12);
  const parent = new Int8Array(12);
  const find = (e: number): number => {
    while (parent[e] !== e) e = parent[e];
    return e;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const cross = new Float64Array(72); // per edge (12): point x,y,z (0..2), normal x,y,z (3..5)

  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = CORNERS[c];
          const n = i + dx + nx * (j + dy + ny * (k + dz));
          cglobal[c] = n;
          cval[c] = v[n];
          if (cval[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;

        let anyCross = false;
        for (let e = 0; e < 12; e++) {
          const [a, b] = EDGES[e];
          sc[e] = cval[a] < 0 !== cval[b] < 0 ? 1 : 0;
          if (sc[e]) anyCross = true;
          parent[e] = e;
        }
        if (!anyCross) continue;

        // Link crossings through the faces.
        for (const [c0, c1, c2, c3] of FACES) {
          const cyc = [c0, c1, c2, c3];
          const eid = [EI[c0 * 8 + c1], EI[c1 * 8 + c2], EI[c2 * 8 + c3], EI[c3 * 8 + c0]];
          const crossing = eid.filter((e) => sc[e]).length;
          if (crossing === 2) {
            const list = eid.filter((e) => sc[e]);
            unite(list[0], list[1]);
          } else if (crossing === 4) {
            for (let m = 0; m < 4; m++) {
              const corner = cyc[m];
              if (cval[corner] < 0) unite(eid[(m + 3) % 4], eid[m]);
            }
          }
        }

        // Per-edge crossing point (cell-local, grid units) and normal.
        for (let e = 0; e < 12; e++) {
          if (!sc[e]) continue;
          const [a, b] = EDGES[e];
          const va = cval[a], vb = cval[b];
          const t = va / (va - vb);
          const [ax, ay, az] = CORNERS[a];
          const [bx, by, bz] = CORNERS[b];
          cross[e * 6 + 0] = ax + t * (bx - ax);
          cross[e * 6 + 1] = ay + t * (by - ay);
          cross[e * 6 + 2] = az + t * (bz - az);
          const na = cglobal[a], nb = cglobal[b];
          let nxv = gx[na] + t * (gx[nb] - gx[na]);
          let nyv = gy[na] + t * (gy[nb] - gy[na]);
          let nzv = gz[na] + t * (gz[nb] - gz[na]);
          const l = Math.hypot(nxv, nyv, nzv) || 1;
          nxv /= l;
          nyv /= l;
          nzv /= l;
          cross[e * 6 + 3] = nxv;
          cross[e * 6 + 4] = nyv;
          cross[e * 6 + 5] = nzv;
        }

        // Group crossings into patches (union-find roots) and place one vertex per patch.
        const rootSlot = new Int8Array(12).fill(-1);
        const slots: { edges: number[] }[] = [];
        for (let e = 0; e < 12; e++) {
          if (!sc[e]) continue;
          const r = find(e);
          if (rootSlot[r] < 0) {
            rootSlot[r] = slots.length;
            slots.push({ edges: [] });
          }
          slots[rootSlot[r]].edges.push(e);
        }
        for (const slot of slots) {
          const rows: { n: number[]; b: number }[] = [];
          const mp = [0, 0, 0];
          for (const e of slot.edges) {
            const p = [cross[e * 6], cross[e * 6 + 1], cross[e * 6 + 2]];
            const n = [cross[e * 6 + 3], cross[e * 6 + 4], cross[e * 6 + 5]];
            rows.push({ n, b: n[0] * p[0] + n[1] * p[1] + n[2] * p[2] });
            mp[0] += p[0] / slot.edges.length;
            mp[1] += p[1] / slot.edges.length;
            mp[2] += p[2] / slot.edges.length;
          }
          const q = qefVertex(rows, mp, [0, 0, 0], [1, 1, 1]);
          const vid = pos.length / 3;
          pos.push(origin[0] + h * (i + q[0]), origin[1] + h * (j + q[1]), origin[2] + h * (k + q[2]));
          const cell = i + cx * (j + cy * k);
          for (const e of slot.edges) cellEdgeVert[cell * 12 + e] = vid;
        }
      }

  // Quads: one per sign-changing grid edge, from the four cells around it.
  const tris: number[] = [];
  const ring: Record<number, { u: number; v: number }> = {
    0: { u: 1, v: 2 },
    1: { u: 2, v: 0 },
    2: { u: 0, v: 1 },
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
          const vp = v[i + nx * (j + ny * k)];
          const vq = v[q[0] + nx * (q[1] + ny * q[2])];
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
            // Local corners of the cell c for this grid edge: node p = local (p - c), node q = local (p - c) + e_axis.
            const la = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
            const lb = [la[0], la[1], la[2]];
            la[axis] = 0;
            lb[axis] = 1;
            const ca = la[0] + 2 * la[1] + 4 * la[2];
            const cb = lb[0] + 2 * lb[1] + 4 * lb[2];
            const e = EI[ca * 8 + cb];
            const vid = cellEdgeVert[(c[0] + cx * (c[1] + cy * c[2])) * 12 + e];
            if (vid < 0) {
              ok = false;
              break;
            }
            ids.push(vid);
          }
          if (!ok) continue;
          const [a, b, c2, d] = ids;
          if (vp >= 0) tris.push(a, d, c2, a, c2, b);
          else tris.push(a, b, c2, a, c2, d);
        }
  }

  const positions = Float32Array.from(pos);
  const indices = Uint32Array.from(tris);
  return { positions, indices, normals: vertexNormals(positions, indices) };
}
