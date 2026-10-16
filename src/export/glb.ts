// Binary glTF 2.0 (GLB) writer and reader for triangle meshes (step A3 of docs/TASK_PLAN.md).
// One mesh, one primitive (TRIANGLES), attributes POSITION (VEC3 float) and NORMAL (VEC3 float),
// indices UNSIGNED_INT. Layout follows the glTF 2.0 spec: 12-byte header, JSON chunk, BIN chunk.
// The reader only accepts this layout; it is for round-trip checks, not a general glTF loader.

import type { MeshData } from "../types.ts";

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

export function writeGlb(mesh: MeshData, name = "design"): Uint8Array {
  const { positions, normals, indices } = mesh;
  const nv = positions.length / 3;
  const ni = indices.length;
  if (normals.length !== positions.length) throw new Error("writeGlb: normals and positions differ in length");
  // Bounds for the POSITION accessor (required by the spec).
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[v * 3 + a]);
      max[a] = Math.max(max[a], positions[v * 3 + a]);
    }
  // glTF requires unit normals. Vertex normals of degenerate triangles (or of vertices merged by
  // decimation) can be zero, so normalise a copy and use +Z where the length is zero.
  const nrm = new Float32Array(normals.length);
  for (let v = 0; v < nv; v++) {
    const x = normals[v * 3], y = normals[v * 3 + 1], z = normals[v * 3 + 2];
    const l = Math.hypot(x, y, z);
    if (l > 1e-12) {
      nrm[v * 3] = x / l;
      nrm[v * 3 + 1] = y / l;
      nrm[v * 3 + 2] = z / l;
    } else {
      nrm[v * 3 + 2] = 1;
    }
  }
  const posBytes = nv * 12;
  const nrmBytes = nv * 12;
  const idxBytes = ni * 4;
  const binLength = posBytes + nrmBytes + idxBytes;
  const json = {
    asset: { version: "2.0", generator: "bioinspired123d-wasm" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    buffers: [{ byteLength: binLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: nrmBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes + nrmBytes, byteLength: idxBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: nv, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: ni, type: "SCALAR" },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4);
  const binPadded = binLength + ((4 - (binLength % 4)) % 4);
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let o = 12;
  dv.setUint32(o, jsonPadded, true);
  dv.setUint32(o + 4, CHUNK_JSON, true);
  out.set(jsonBytes, o + 8);
  for (let i = jsonBytes.length; i < jsonPadded; i++) out[o + 8 + i] = 0x20; // pad JSON with spaces
  o += 8 + jsonPadded;
  dv.setUint32(o, binPadded, true);
  dv.setUint32(o + 4, CHUNK_BIN, true);
  const b = o + 8;
  out.set(new Uint8Array(positions.buffer, positions.byteOffset, posBytes), b);
  out.set(new Uint8Array(nrm.buffer, nrm.byteOffset, nrmBytes), b + posBytes);
  out.set(new Uint8Array(indices.buffer, indices.byteOffset, idxBytes), b + posBytes + nrmBytes);
  return out;
}

export function readGlb(bytes: Uint8Array): MeshData & { name: string } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("readGlb: bad magic");
  if (dv.getUint32(4, true) !== 2) throw new Error("readGlb: unsupported version");
  const total = dv.getUint32(8, true);
  if (total !== bytes.byteLength) throw new Error("readGlb: length mismatch");
  let o = 12;
  const jLen = dv.getUint32(o, true);
  if (dv.getUint32(o + 4, true) !== CHUNK_JSON) throw new Error("readGlb: first chunk is not JSON");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(o + 8, o + 8 + jLen)));
  o += 8 + jLen;
  const bLen = dv.getUint32(o, true);
  if (dv.getUint32(o + 4, true) !== CHUNK_BIN) throw new Error("readGlb: second chunk is not BIN");
  const bin = bytes.subarray(o + 8, o + 8 + bLen);
  const view = (i: number) => json.bufferViews[i] as { byteOffset: number; byteLength: number };
  const acc = (i: number) => json.accessors[i] as { bufferView: number; count: number };
  const copyF32 = (a: number) => {
    const v = view(acc(a).bufferView);
    const n = acc(a).count * 3;
    const out = new Float32Array(n);
    new Uint8Array(out.buffer).set(bin.subarray(v.byteOffset, v.byteOffset + n * 4));
    return out;
  };
  const prim = json.meshes[0].primitives[0];
  const positions = copyF32(prim.attributes.POSITION);
  const normals = copyF32(prim.attributes.NORMAL);
  const iv = view(acc(prim.indices).bufferView);
  const ni = acc(prim.indices).count;
  const indices = new Uint32Array(ni);
  new Uint8Array(indices.buffer).set(bin.subarray(iv.byteOffset, iv.byteOffset + ni * 4));
  return { positions, normals, indices, name: json.nodes[0].name };
}
