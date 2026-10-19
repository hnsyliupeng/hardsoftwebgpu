import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleField, surfaceNets, meshIntegrals } from "../src/geometry/grid.ts";
import { dualContourManifold } from "../src/geometry/dualcontour.ts";
import type { Field } from "../src/topology/fields.ts";

const field = (eval_: (x: number, y: number, z: number) => number): Field => ({
  bounds: { min: [0, 0, 0], max: [20, 20, 20] },
  eval: eval_,
  expr: "custom",
});

function edgeStats(idx: Uint32Array) {
  const count = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * 67108864 + b : b * 67108864 + a);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const k of [key(a, b), key(b, c), key(c, a)]) count.set(k, (count.get(k) ?? 0) + 1);
  }
  let open = 0, nonman = 0;
  for (const c of count.values()) {
    if (c === 1) open++;
    else if (c > 2) nonman++;
  }
  return { open, nonman };
}

test("manifold dual contouring: a sphere is closed, manifold and has the right volume", () => {
  const r = 6;
  const f = field((x, y, z) => Math.hypot(x - 10, y - 10, z - 10) - r);
  const g = sampleField(f, 64);
  const m = dualContourManifold(g);
  const { open, nonman } = edgeStats(m.indices);
  assert.equal(open, 0, "no open edges");
  assert.equal(nonman, 0, "no non-manifold edges");
  const vol = meshIntegrals(m).volume;
  const exact = (4 / 3) * Math.PI * r ** 3;
  assert.ok(Math.abs(vol - exact) / exact < 0.015, `volume ${vol} vs ${exact}`);
});

test("manifold dual contouring: a union of two overlapping spheres has no more non-manifold edges than surface nets", () => {
  const f = field((x, y, z) =>
    Math.min(Math.hypot(x - 8, y - 10, z - 10) - 5, Math.hypot(x - 12, y - 10, z - 10) - 5),
  );
  const g = sampleField(f, 96);
  const dc = edgeStats(dualContourManifold(g).indices);
  const sn = edgeStats(surfaceNets(g).indices);
  assert.equal(dc.open, 0, "no open edges");
  assert.ok(dc.nonman <= sn.nonman, `dc ${dc.nonman} vs surface nets ${sn.nonman}`);
});

test("manifold dual contouring: output indices are valid and the normals are unit length", () => {
  const f = field((x, y, z) => Math.hypot(x - 10, y - 10, z - 10) - 4);
  const m = dualContourManifold(sampleField(f, 48));
  const nv = m.positions.length / 3;
  for (const i of m.indices) assert.ok(i < nv, "index in range");
  for (let i = 0; i < m.normals.length; i += 3) {
    const l = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
    assert.ok(Math.abs(l - 1) < 1e-4 || l === 0, `normal length ${l}`);
  }
});
