// Coupled bio-lattice result loader (browser side). The B-Rep itself is built offline by the
// Python package python/bioxlattice (CadQuery / OpenCASCADE): the browser cannot run OCC, so the
// page shows the exact build outputs (metrics, timeline, code, verification, high-resolution mesh).

import type { MeshInput } from "./viewer.ts";

export interface CoupledBundle {
  design: any;
  verify: any;
  timeline: any[];
  code: string;
  mesh: MeshInput;
  meshTriangles: number;
}

/** Parse the mesh binary written by bioxlattice.exporter.write_mesh_bin (little endian). */
export function parseMeshBin(buf: ArrayBuffer): { positions: Float32Array; indices: Uint32Array; normals: Float32Array } {
  const dv = new DataView(buf);
  if (buf.byteLength < 8) throw new Error("mesh.bin too short");
  const nv = dv.getUint32(0, true);
  const nt = dv.getUint32(4, true);
  const expected = 8 + nv * 12 + nt * 12;
  if (buf.byteLength !== expected) throw new Error(`mesh.bin size ${buf.byteLength} != expected ${expected}`);
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) positions[i] = dv.getFloat32(8 + i * 4, true);
  const indices = new Uint32Array(nt * 3);
  const base = 8 + nv * 12;
  for (let i = 0; i < nt * 3; i++) {
    const v = dv.getUint32(base + i * 4, true);
    if (v >= nv) throw new Error(`triangle index ${v} out of range`);
    indices[i] = v;
  }
  return { positions, indices, normals: vertexNormals(positions, indices) };
}

/** Area-weighted vertex normals (smooth shading across the tessellation). */
export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // length = 2 * area
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
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

/**
 * Crease-aware shading. Each triangle corner gets the area-weighted average of only those
 * incident faces whose normal lies within `creaseDeg` of its own face normal. Smooth curved
 * surfaces (fillets, tubes) stay smooth; planar walls and their sharp seams stay crisp. The
 * vertices are expanded per corner (indices are 0..n-1), so each face keeps its own normal at
 * a seam. Plain averaging smears shading across every seam, and refinement adds many seam
 * vertices, which then show up as jagged bands.
 */
export function creaseMesh(
  positions: Float32Array,
  indices: Uint32Array,
  creaseDeg = 40,
): { positions: Float32Array; indices: Uint32Array; normals: Float32Array } {
  const nT = indices.length / 3;
  const nV = positions.length / 3;
  const raw = new Float32Array(nT * 3); // area-weighted (2*area) face normals
  const unit = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    raw[t * 3] = nx; raw[t * 3 + 1] = ny; raw[t * 3 + 2] = nz;
    const l = Math.hypot(nx, ny, nz);
    if (l > 0) {
      unit[t * 3] = nx / l; unit[t * 3 + 1] = ny / l; unit[t * 3 + 2] = nz / l;
    }
  }
  // vertex -> incident triangles (CSR)
  const start = new Uint32Array(nV + 1);
  for (let i = 0; i < indices.length; i++) start[indices[i] + 1]++;
  for (let v = 0; v < nV; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nV);
  const inc = new Uint32Array(indices.length);
  for (let t = 0; t < nT; t++)
    for (let k = 0; k < 3; k++) inc[fill[indices[t * 3 + k]]++] = t;

  const cosT = Math.cos((creaseDeg * Math.PI) / 180);
  const outP = new Float32Array(indices.length * 3);
  const outN = new Float32Array(indices.length * 3);
  const outI = new Uint32Array(indices.length);
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < 3; k++) {
      const corner = t * 3 + k;
      const v = indices[corner];
      let sx = 0, sy = 0, sz = 0;
      for (let q = start[v]; q < start[v + 1]; q++) {
        const u = inc[q];
        const d = unit[u * 3] * unit[t * 3] + unit[u * 3 + 1] * unit[t * 3 + 1] + unit[u * 3 + 2] * unit[t * 3 + 2];
        if (u === t || d >= cosT) {
          sx += raw[u * 3]; sy += raw[u * 3 + 1]; sz += raw[u * 3 + 2];
        }
      }
      const l = Math.hypot(sx, sy, sz);
      outN[corner * 3] = l > 0 ? sx / l : 0;
      outN[corner * 3 + 1] = l > 0 ? sy / l : 0;
      outN[corner * 3 + 2] = l > 0 ? sz / l : 1;
      outP[corner * 3] = positions[v * 3];
      outP[corner * 3 + 1] = positions[v * 3 + 1];
      outP[corner * 3 + 2] = positions[v * 3 + 2];
      outI[corner] = corner;
    }
  }
  return { positions: outP, indices: outI, normals: outN };
}

/** Map the Python timeline to the rows used by the web timeline table. */
export function timelineRows(timeline: any[]): any[] {
  return timeline.map((f, i) => ({
    id: i + 1,
    op: f.feature,
    volume: f.volume,
    area: null,
    ms: Math.round((f.seconds ?? 0) * 1000),
    ok: true,
    note: `${f.solids} solid(s), ${f.faces} faces`,
  }));
}

export async function loadCoupled(baseUrl: string, name = "coupled_bio_lattice"): Promise<CoupledBundle> {
  const get = async (file: string) => {
    const r = await fetch(`${baseUrl}${file}`);
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return r;
  };
  const [design, verify, timeline, code, meshBuf] = await Promise.all([
    get(`design.json`).then((r) => r.json()),
    get(`verify.json`).then((r) => r.json()),
    get(`timeline.json`).then((r) => r.json()),
    get(`design_code.py`).then((r) => r.text()),
    get(`${name}.mesh.bin`).then((r) => r.arrayBuffer()),
  ]);
  const parsed = parseMeshBin(meshBuf);
  const mesh = creaseMesh(parsed.positions, parsed.indices, 40);
  return { design, verify, timeline, code, mesh, meshTriangles: mesh.indices.length / 3 };
}
