import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleField, surfaceNets } from "../src/geometry/grid.ts";
import { decimateToBudget } from "../src/geometry/decimate.ts";
import type { Field } from "../src/topology/fields.ts";

// Sphere of radius 8 mm centred in a 20 mm box: exact SDF.
const sphere: Field = {
  bounds: { min: [-10, -10, -10], max: [10, 10, 10] },
  expr: "sphere r=8",
  eval: (x, y, z) => Math.hypot(x, y, z) - 8,
};

test("decimation keeps the budget and the volume within 2 %", () => {
  const mesh = surfaceNets(sampleField(sphere, 96));
  const inTris = mesh.indices.length / 3;
  const budget = Math.floor(inTris / 4);
  const { mesh: out, stats } = decimateToBudget(mesh, budget);
  assert.ok(stats.outputTriangles <= budget, `triangles ${stats.outputTriangles} > budget ${budget}`);
  assert.ok(stats.outputTriangles > budget * 0.8, "bisection should get close to the budget");
  assert.ok(Math.abs(stats.volumeErrPct) < 2, `volume error ${stats.volumeErrPct}%`);
  assert.equal(out.normals.length, out.positions.length);
});

test("a mesh already under budget is returned unchanged", () => {
  const mesh = surfaceNets(sampleField(sphere, 32));
  const { stats } = decimateToBudget(mesh, 10_000_000);
  assert.equal(stats.outputTriangles, mesh.indices.length / 3);
  assert.equal(stats.cellMm, 0);
});
