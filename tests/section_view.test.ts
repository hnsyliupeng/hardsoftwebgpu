import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionView, toCanvas } from "../web/section.ts";
import { boxMesh } from "../src/geometry/primitives.ts";
import { measure } from "../src/geometry/measure.ts";

test("section view: area and in-plane frame for a box cut at z = 5", () => {
  const box = boxMesh([0, 0, 0], [10, 10, 10]);
  const bbox = measure(box).bbox;
  const v = sectionView(box, 2, 5, bbox);
  assert.ok(Math.abs(v.area - 100) < 1e-9);
  assert.deepEqual(v.inPlane, [0, 1]);
  assert.deepEqual(v.extent, [[0, 10], [0, 10]]);
  // One segment per crossed triangle: each of the four sides is two triangles, all crossed by the plane.
  assert.equal(v.count, 8, "a box cut through its sides has eight segments (two per side triangle pair)");
});

test("section view: canvas mapping keeps the outline inside the canvas and flips y", () => {
  const box = boxMesh([0, 0, 0], [10, 10, 10]);
  const v = sectionView(box, 2, 5, measure(box).bbox);
  const px = toCanvas(v, 360, 360);
  const x0 = px.x(0), x1 = px.x(10), y0 = px.y(0), y1 = px.y(10);
  for (const p of [x0, x1, y0, y1]) assert.ok(p >= 0 && p <= 360);
  assert.ok(y1 < y0, "larger in-plane b is higher on the canvas (smaller y)");
  assert.ok(Math.abs((x1 - x0) - (y0 - y1)) < 1e-9, "square section stays square");
});
