import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionSegments, sectionArea } from "../src/geometry/section.ts";
import { boxMesh, icosphereMesh } from "../src/geometry/primitives.ts";
import { surfaceArea, crossSectionArea, boundingBox, distance, measure } from "../src/geometry/measure.ts";
import { signedVolume } from "../src/geometry/decimate.ts";
import type { MeshData } from "../src/types.ts";

function concat(a: MeshData, b: MeshData): MeshData {
  const off = a.positions.length / 3;
  const positions = new Float32Array(a.positions.length + b.positions.length);
  positions.set(a.positions, 0);
  positions.set(b.positions, a.positions.length);
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices, 0);
  indices.set(Array.from(b.indices, (i) => i + off), a.indices.length);
  return { positions, normals: new Float32Array(positions.length), indices };
}

test("section: box cross-sections are the expected rectangles, and a plane outside gives nothing", () => {
  const box = boxMesh([0, 0, 0], [10, 10, 10]);
  assert.ok(signedVolume(box.positions, box.indices) > 0, "box is outward oriented");
  assert.ok(Math.abs(signedVolume(box.positions, box.indices) - 1000) < 1e-6);
  assert.ok(Math.abs(crossSectionArea(box, 2, 5) - 100) < 1e-9, "z = 5 gives 10 x 10");
  assert.ok(Math.abs(crossSectionArea(box, 0, 3) - 100) < 1e-9, "x = 3 gives 10 x 10");
  assert.equal(sectionSegments(box, 2, 20).count, 0, "plane above the box has no segments");
  assert.equal(crossSectionArea(box, 2, -1), 0);
});

test("section: a cavity is subtracted (cavity normals point inward)", () => {
  const solid = concat(boxMesh([0, 0, 0], [10, 10, 10]), boxMesh([4, 4, 4], [6, 6, 6], true));
  assert.ok(signedVolume(solid.positions, solid.indices) > 0 && Math.abs(signedVolume(solid.positions, solid.indices) - (1000 - 8)) < 1e-6);
  // Cut at z = 5 through the cavity: 10 x 10 minus 2 x 2.
  assert.ok(Math.abs(crossSectionArea(solid, 2, 5) - 96) < 1e-9);
  // Cut at z = 8, above the cavity: full square.
  assert.ok(Math.abs(crossSectionArea(solid, 2, 8) - 100) < 1e-9);
});

test("section: icosphere area, volume and equator match the sphere within 0.5 % (20k faces)", () => {
  const R = 10;
  const s = icosphereMesh(5, R);
  assert.equal(s.indices.length / 3, 20 * 4 ** 5);
  const area = surfaceArea(s), vol = signedVolume(s.positions, s.indices);
  assert.ok(Math.abs(area / (4 * Math.PI * R * R) - 1) < 0.005, `area ${area}`);
  assert.ok(Math.abs(vol / ((4 / 3) * Math.PI * R ** 3) - 1) < 0.005, `volume ${vol}`);
  const eq = crossSectionArea(s, 2, 0);
  assert.ok(Math.abs(eq / (Math.PI * R * R) - 1) < 0.005, `equator ${eq}`);
  // Off-centre section: circle radius sqrt(R^2 - h^2).
  const h = 6, circ = Math.PI * (R * R - h * h);
  assert.ok(Math.abs(crossSectionArea(s, 2, h) / circ - 1) < 0.01, "off-centre section");
  // Same section along any axis, by symmetry.
  assert.ok(Math.abs(crossSectionArea(s, 0, 0) - eq) / eq < 0.01);
});

test("section: segments form closed loops (every segment end meets another segment end)", () => {
  const s = icosphereMesh(3, 5);
  const sec = sectionSegments(s, 2, 1.7);
  const ends = new Map<string, number>();
  const key = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
  for (let k = 0; k < sec.count; k++) {
    const e0 = key(sec.segments[4 * k], sec.segments[4 * k + 1]);
    const e1 = key(sec.segments[4 * k + 2], sec.segments[4 * k + 3]);
    ends.set(e0, (ends.get(e0) ?? 0) + 1);
    ends.set(e1, (ends.get(e1) ?? 0) + 1);
  }
  for (const [, n] of ends) assert.equal(n, 2, "each loop vertex is shared by exactly two segments");
  assert.ok(Math.abs(sectionArea(sec) - crossSectionArea(s, 2, 1.7)) < 1e-12);
});

test("measure: bounding box, distance, and measure() agree with the primitives", () => {
  const box = boxMesh([-1, 2, 3], [4, 5, 9]);
  assert.deepEqual(boundingBox(box).min, [-1, 2, 3]);
  assert.deepEqual(boundingBox(box).max, [4, 5, 9]);
  assert.ok(Math.abs(distance([0, 0, 0], [3, 4, 0]) - 5) < 1e-12);
  const m = measure(box);
  assert.ok(Math.abs(m.surfaceAreaMm2 - 2 * (5 * 3 + 5 * 6 + 3 * 6)) < 1e-6);
  assert.ok(Math.abs(m.volumeMm3 - 5 * 3 * 6) < 1e-6);
  assert.equal(m.triangles, 12);
});
