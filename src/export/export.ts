// ExportHarness: STL (binary + ASCII), glTF 2.0 (embedded buffer), STEP (B-Rep designs only),
// parametric JSON, and a WebGPU-ready interleaved vertex / index buffer pair.
// All outputs are produced in memory; writing to disk is done by scripts/ (Node only).

import type { MeshData, DesignState, HarnessResult, DesignSpec } from "../types.ts";
import type { BrepSolid } from "../geometry/brep.ts";
import { toBase64 } from "../render/preview.ts";

export interface ExportFile {
  name: string;
  format: "json" | "stl-binary" | "stl-ascii" | "gltf" | "step" | "webgpu-bin" | "webgpu-json";
  bytes: number;
  checksum: string;
}

export function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function faceNormal(p: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

export function binaryStl(mesh: MeshData, header = "Bioinspired123D-WASM"): Uint8Array {
  const tris = mesh.indices.length / 3;
  const out = new Uint8Array(84 + tris * 50);
  const dv = new DataView(out.buffer);
  const hdr = new TextEncoder().encode(header.slice(0, 80));
  out.set(hdr, 0);
  dv.setUint32(80, tris, true);
  const p = mesh.positions;
  for (let t = 0; t < tris; t++) {
    const a = mesh.indices[t * 3], b = mesh.indices[t * 3 + 1], c = mesh.indices[t * 3 + 2];
    const n = faceNormal(p, a, b, c);
    const o = 84 + t * 50;
    [n[0], n[1], n[2]].forEach((v, k) => dv.setFloat32(o + k * 4, v, true));
    [a, b, c].forEach((vi, v) => {
      for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + v * 12 + k * 4, p[vi * 3 + k], true);
    });
    dv.setUint16(o + 48, 0, true);
  }
  return out;
}

export function asciiStl(mesh: MeshData, name = "design"): string {
  const lines = [`solid ${name}`];
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const a = mesh.indices[t * 3], b = mesh.indices[t * 3 + 1], c = mesh.indices[t * 3 + 2];
    const n = faceNormal(p, a, b, c);
    lines.push(`  facet normal ${n.map((v) => v.toExponential(6)).join(" ")}`, "    outer loop");
    for (const vi of [a, b, c])
      lines.push(`      vertex ${p[vi * 3].toExponential(6)} ${p[vi * 3 + 1].toExponential(6)} ${p[vi * 3 + 2].toExponential(6)}`);
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n") + "\n";
}

/** glTF 2.0 JSON with the three buffers embedded as a base64 data URI (units: mm, as authored). */
function maxIndex(idx: Uint32Array): number {
  let m = 0;
  for (let i = 0; i < idx.length; i++) if (idx[i] > m) m = idx[i];
  return m;
}

export function gltfJson(mesh: MeshData, name = "design"): object {
  const nIdx = mesh.indices.length;
  const nVtx = mesh.positions.length / 3;
  const idxBytes = new Uint8Array(new Uint32Array(mesh.indices).buffer);
  const posBytes = new Uint8Array(new Float32Array(mesh.positions).buffer);
  const nrmBytes = new Uint8Array(new Float32Array(mesh.normals.length === mesh.positions.length ? mesh.normals : new Float32Array(mesh.positions.length)).buffer);
  const all = new Uint8Array(idxBytes.length + posBytes.length + nrmBytes.length);
  all.set(idxBytes, 0);
  all.set(posBytes, idxBytes.length);
  all.set(nrmBytes, idxBytes.length + posBytes.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.positions[i + k]);
      max[k] = Math.max(max[k], mesh.positions[i + k]);
    }
  const posOff = idxBytes.length;
  const nrmOff = posOff + posBytes.length;
  return {
    asset: { version: "2.0", generator: "Bioinspired123D-WASM ExportHarness" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, mode: 4 }] }],
    buffers: [{ byteLength: all.length, uri: `data:application/octet-stream;base64,${toBase64(all)}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxBytes.length, target: 34963 },
      { buffer: 0, byteOffset: posOff, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmBytes.length, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5125, count: nIdx, type: "SCALAR", max: [maxIndex(mesh.indices)], min: [0] },
      { bufferView: 1, componentType: 5126, count: nVtx, type: "VEC3", min, max },
      { bufferView: 2, componentType: 5126, count: nVtx, type: "VEC3" },
    ],
  };
}

/**
 * WebGPU-ready geometry: interleaved float32 vertices (position xyz, normal xyz; stride 24 bytes)
 * and uint32 triangle indices. Layout for createRenderPipeline: attribute 0 = float32x3 @ 0,
 * attribute 1 = float32x3 @ 12.
 */
export function webgpuBuffers(mesh: MeshData): { vertices: Float32Array; indices: Uint32Array; stride: number; vertexCount: number } {
  const n = mesh.positions.length / 3;
  const v = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    v[i * 6] = mesh.positions[i * 3];
    v[i * 6 + 1] = mesh.positions[i * 3 + 1];
    v[i * 6 + 2] = mesh.positions[i * 3 + 2];
    v[i * 6 + 3] = mesh.normals[i * 3] ?? 0;
    v[i * 6 + 4] = mesh.normals[i * 3 + 1] ?? 0;
    v[i * 6 + 5] = mesh.normals[i * 3 + 2] ?? 1;
  }
  return { vertices: v, indices: new Uint32Array(mesh.indices), stride: 24, vertexCount: n };
}

export function designJson(state: Omit<DesignState, "render_preview">, spec: DesignSpec): string {
  return JSON.stringify({ ...state, design_spec: spec }, null, 2);
}

/** Bundle of exported artefacts plus the ExportHarness report. */
export interface ExportBundle {
  files: Record<string, Uint8Array | string>;
  manifest: ExportFile[];
}

/** Produce the STEP text for a B-Rep solid (kernel is loaded lazily). */
export async function prepareStep(brep: BrepSolid): Promise<string> {
  const { loadKernel } = await import("../geometry/brep.ts");
  const K = await loadKernel();
  return (K as any).toStep(brep.shape) as string;
}

export function exportAll(
  name: string,
  mesh: MeshData,
  stateJson: string,
  step: string | null,
  kernelBrep: boolean,
): HarnessResult<ExportBundle> {
  const files: Record<string, Uint8Array | string> = {};
  const manifest: ExportFile[] = [];
  const add = (fname: string, format: ExportFile["format"], data: Uint8Array | string) => {
    files[fname] = data;
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    manifest.push({ name: fname, format, bytes: bytes.length, checksum: fnv1a(bytes) });
  };
  add(`${name}.design.json`, "json", stateJson);
  add(`${name}.stl`, "stl-binary", binaryStl(mesh, name));
  add(`${name}.gltf`, "gltf", JSON.stringify(gltfJson(mesh, name)));
  const wg = webgpuBuffers(mesh);
  add(`${name}.webgpu.vertices.bin`, "webgpu-bin", new Uint8Array(wg.vertices.buffer));
  add(`${name}.webgpu.indices.bin`, "webgpu-bin", new Uint8Array(wg.indices.buffer));
  const observations = [`Exported ${manifest.length} files; ${mesh.indices.length / 3} triangles in the render mesh.`];
  const limitations = ["STL/glTF units are millimetres as authored; no unit scaling is applied."];
  const unknowns: string[] = [];
  if (step !== null) {
    add(`${name}.step`, "step", step);
    observations.push("STEP exported from the smlibwasm B-Rep (exact NURBS).");
  } else {
    limitations.push("STEP is not available for this design (no exact B-Rep; SDF / surface-net mesh only).");
    unknowns.push("Confirm whether an SDF-derived mesh is acceptable as the deliverable.");
  }
  return {
    harness: "ExportHarness",
    ok: manifest.length > 0,
    data: { files, manifest },
    observations,
    limitations,
    unknowns,
    evidence: {
      name,
      formats: manifest.map((m) => m.format),
      kernel_brep: kernelBrep,
      reproducible_params: { name, triangles: mesh.indices.length / 3 },
      checksums: Object.fromEntries(manifest.map((m) => [m.name, m.checksum])),
    },
  };
}
