import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleField, surfaceNets, vertexNormals } from "../src/geometry/grid.ts";
import { signedVolume } from "../src/geometry/decimate.ts";
import { writeGlb, readGlb } from "../src/export/glb.ts";
import type { Field } from "../src/topology/fields.ts";

const sphere: Field = {
  bounds: { min: [-10, -10, -10], max: [10, 10, 10] },
  expr: "sphere",
  eval: (x, y, z) => Math.hypot(x, y, z) - 8,
};

test("GLB round trip preserves triangles, vertices and volume", () => {
  const raw = surfaceNets(sampleField(sphere, 48));
  const mesh = { ...raw, normals: vertexNormals(raw.positions, raw.indices) };
  const bytes = writeGlb(mesh, "sphere");
  assert.equal(bytes.length % 4, 0, "GLB length must be a multiple of 4");
  const back = readGlb(bytes);
  assert.equal(back.name, "sphere");
  assert.deepEqual(back.indices, mesh.indices);
  assert.deepEqual(back.positions, mesh.positions);
  // The writer normalises normals (glTF requires unit length); compare against the normalised input.
  for (let v = 0; v < back.normals.length; v += 3) {
    const l = Math.hypot(mesh.normals[v], mesh.normals[v + 1], mesh.normals[v + 2]);
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(back.normals[v + a] - mesh.normals[v + a] / l) < 1e-6);
  }
  assert.ok(Math.abs(signedVolume(back.positions, back.indices) - signedVolume(mesh.positions, mesh.indices)) < 1e-6);
});

test("GLB reader rejects a corrupted header", () => {
  const bytes = writeGlb({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array(9),
    indices: new Uint32Array([0, 1, 2]),
  });
  bytes[0] = 0;
  assert.throws(() => readGlb(bytes), /bad magic/);
});
