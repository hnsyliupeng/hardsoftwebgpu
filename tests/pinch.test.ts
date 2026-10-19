import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeTopology, splitPinchVertices } from "../src/geometry/pinch.ts";
import type { MeshData } from "../src/types.ts";

// Signed volume of a closed triangle mesh (divergence theorem).
function signedVolume(m: MeshData): number {
  const p = m.positions, idx = m.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
    const bx = p[3 * b], by = p[3 * b + 1], bz = p[3 * b + 2];
    const cx = p[3 * c], cy = p[3 * c + 1], cz = p[3 * c + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

// Tetrahedron with outward-facing triangles; `pts` = [a, b, c, d] as xyz triples.
function tetra(pts: number[][], base: number): { pos: number[]; tris: number[] } {
  const [a, b, c, d] = [0, 1, 2, 3];
  const tris = [a, c, b, a, b, d, a, d, c, b, c, d];
  const det =
    (pts[1][0] - pts[0][0]) * ((pts[2][1] - pts[0][1]) * (pts[3][2] - pts[0][2]) - (pts[2][2] - pts[0][2]) * (pts[3][1] - pts[0][1])) -
    (pts[1][1] - pts[0][1]) * ((pts[2][0] - pts[0][0]) * (pts[3][2] - pts[0][2]) - (pts[2][2] - pts[0][2]) * (pts[3][0] - pts[0][0])) +
    (pts[1][2] - pts[0][2]) * ((pts[2][0] - pts[0][0]) * (pts[3][1] - pts[0][1]) - (pts[2][1] - pts[0][1]) * (pts[3][0] - pts[0][0]));
  const out = tris.slice();
  if (det < 0) {
    // Swap b and c in every triangle to flip orientation.
    for (let t = 0; t < out.length; t += 3) [out[t + 1], out[t + 2]] = [out[t + 2], out[t + 1]];
  }
  return { pos: pts.flat(), tris: out.map((i) => i + base) };
}

test("pinch split: two closed tetrahedra sharing an edge become manifold with unchanged volume", () => {
  // Tetra 1 and tetra 2 share the edge a-b (vertices 0 and 1 of each tetra).
  const t1 = tetra([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], 0);
  const t2 = tetra([[0, 0, 0], [1, 0, 0], [0, -1, 0], [0, 0, -1]], 4);
  // Shared vertices: a and b appear twice; merge them so the pinch is a shared edge.
  const pos = [...t1.pos, ...t2.pos.slice(6)]; // drop the duplicate a, b of tetra 2 (indices 4, 5 -> 0, 1)
  const remap = (i: number) => (i === 4 ? 0 : i === 5 ? 1 : i > 5 ? i - 2 : i);
  const idx = Uint32Array.from([...t1.tris, ...t2.tris.map(remap)]);
  const mesh: MeshData = { positions: Float32Array.from(pos), indices: idx, normals: new Float32Array(pos.length) };

  const before = edgeTopology(mesh.indices);
  assert.equal(before.open, 0);
  assert.ok(before.nonManifold > 0, "the test input must be non-manifold");
  const vBefore = signedVolume(mesh);

  const r = splitPinchVertices(mesh);
  const after = edgeTopology(r.mesh.indices);
  assert.equal(after.nonManifold, 0);
  assert.equal(after.open, 0);
  assert.ok(r.splits > 0);
  assert.ok(Math.abs(signedVolume(r.mesh) - vBefore) < 1e-9, "volume must not change");
  assert.equal(r.mesh.normals.length, r.mesh.positions.length);
});

test("pinch split: a manifold mesh is returned unchanged", () => {
  const t = tetra([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], 0);
  const mesh: MeshData = { positions: Float32Array.from(t.pos), indices: Uint32Array.from(t.tris), normals: new Float32Array(t.pos.length) };
  const r = splitPinchVertices(mesh);
  assert.equal(r.splits, 0);
  assert.equal(r.mesh.positions.length, mesh.positions.length);
  assert.deepEqual(Array.from(r.mesh.indices), Array.from(mesh.indices));
});
