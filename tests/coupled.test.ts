import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMeshBin, vertexNormals, timelineRows } from "../web/coupled.ts";

// Same layout as python/bioxlattice/exporter.write_mesh_bin: uint32 nv, uint32 nt,
// float32 xyz * nv, uint32 ijk * nt, little endian.
function encode(verts: number[][], tris: number[][]): ArrayBuffer {
  const buf = new ArrayBuffer(8 + verts.length * 12 + tris.length * 12);
  const dv = new DataView(buf);
  dv.setUint32(0, verts.length, true);
  dv.setUint32(4, tris.length, true);
  let o = 8;
  for (const v of verts) for (const c of v) { dv.setFloat32(o, c, true); o += 4; }
  for (const t of tris) for (const i of t) { dv.setUint32(o, i, true); o += 4; }
  return buf;
}

test("parseMeshBin reads positions and indices", () => {
  const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const tris = [[0, 2, 1], [0, 1, 3]];
  const m = parseMeshBin(encode(verts, tris));
  assert.deepEqual(Array.from(m.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(Array.from(m.indices), [0, 2, 1, 0, 1, 3]);
  assert.equal(m.normals.length, m.positions.length);
});

test("parseMeshBin rejects truncated or out-of-range data", () => {
  assert.throws(() => parseMeshBin(new ArrayBuffer(4)), /too short/);
  const bad = encode([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 5]]);
  assert.throws(() => parseMeshBin(bad), /out of range/);
  const trunc = encode([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]).slice(0, 30);
  assert.throws(() => parseMeshBin(trunc), /size/);
});

test("vertexNormals of a flat right triangle point along +z", () => {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idx = new Uint32Array([0, 1, 2]);
  const n = vertexNormals(pos, idx);
  for (let v = 0; v < 3; v++) {
    assert.ok(Math.abs(n[v * 3]) < 1e-6 && Math.abs(n[v * 3 + 1]) < 1e-6);
    assert.ok(Math.abs(n[v * 3 + 2] - 1) < 1e-6);
  }
});

test("timelineRows maps Python timeline entries to table rows", () => {
  const rows = timelineRows([{ feature: "skin_boolean_cut", volume: 11123.2, seconds: 0.01, solids: 1, faces: 20 }]);
  assert.equal(rows[0].op, "skin_boolean_cut");
  assert.equal(rows[0].ms, 10);
  assert.equal(rows[0].note, "1 solid(s), 20 faces");
});
