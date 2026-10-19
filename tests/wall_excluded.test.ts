import { test } from "node:test";
import assert from "node:assert/strict";
import { rayWallThickness } from "../src/validation/thickness.ts";
import { sampleField, surfaceNets } from "../src/geometry/grid.ts";
import { sdBox } from "../src/topology/fields.ts";
import type { Field } from "../src/topology/fields.ts";

const box = (min: number, max: number, eval_: (x: number, y: number, z: number) => number): Field => ({
  bounds: { min: [min, min, min], max: [max, max, max] },
  eval: eval_,
  expr: "custom",
});

// A solid sphere (r 12) cut by the envelope: the rim where it crosses the faces is excluded, the interior is kept.
test("rayWallThickness counts samples near the envelope faces when a face margin is given", () => {
  const f = box(0, 20, (x, y, z) => Math.hypot(x - 10, y - 10, z - 10) - 12);
  const g = sampleField(f, 64);
  const m = surfaceNets(g);
  const withMargin = rayWallThickness(f, m, g.h, 6000, 0.5);
  const noMargin = rayWallThickness(f, m, g.h, 6000, 0);
  assert.equal(noMargin.excludedNearFaces, 0, "no margin: nothing excluded");
  assert.ok(withMargin.excludedNearFaces > 0, "margin 0.5 mm: rim samples excluded");
  assert.ok(withMargin.chords > 0, "interior samples still give chords");
});

test("rayWallThickness excludes nothing for a solid well inside the envelope", () => {
  const f = box(0, 20, (x, y, z) => sdBox(x - 10, y - 10, z - 10, 4, 4, 4));
  const g = sampleField(f, 64);
  const m = surfaceNets(g);
  const r = rayWallThickness(f, m, g.h, 6000, 0.5);
  assert.equal(r.excludedNearFaces, 0);
});
