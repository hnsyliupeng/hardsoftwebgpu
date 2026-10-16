import { test } from "node:test";
import assert from "node:assert/strict";
import { compileGraph, validateGraph, clipDistance, clipBounds, type StructureGraph, type ClipShape } from "../src/graph/graph.ts";

// Source: a sphere SDF of radius 5 at the origin (1-Lipschitz, exact).
function graphWith(shape: unknown, extra: unknown[] = []): StructureGraph {
  const nodes: StructureGraph["nodes"] = [
    { id: "src", kind: "field", source: { type: "sphere", radius: 5 } as never },
  ];
  const edges: StructureGraph["edges"] = [];
  let prev = "src";
  extra.forEach((t, i) => {
    const id = `t${i}`;
    nodes.push({ id, kind: "transform", transform: t as never });
    edges.push({ from: prev, to: id });
    prev = id;
  });
  nodes.push({ id: "clip", kind: "transform", transform: { op: "clip", shape: shape as ClipShape } as never });
  edges.push({ from: prev, to: "clip" });
  nodes.push({ id: "out", kind: "structure", name: "clip-test" });
  edges.push({ from: "clip", to: "out" });
  return { version: 1, nodes, edges };
}

const sphereShape: ClipShape = { type: "sphere", centre: [1, 0, 0], radius: 4 };
const boxShape: ClipShape = { type: "box", min: [-2, -3, -1], max: [2, 3, 6] };

test("clip: sphere intersection is max(f, sd) and leaves no material outside the shape", () => {
  const f = compileGraph(graphWith(sphereShape), "out");
  const src = compileGraph(graphWith({ type: "sphere", centre: [0, 0, 0], radius: 1e9 }), "out");
  void src;
  for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [3, 2, 1], [-2, 0, 0], [6, 0, 0], [1, 4.5, 0], [0, 0, 6]] as [number, number, number][]) {
    const inner = Math.hypot(x, y, z) - 5; // source sphere
    const sd = Math.hypot(x - 1, y, z) - 4;
    assert.ok(Math.abs(f.eval(x, y, z) - Math.max(inner, sd)) < 1e-12, `point ${x},${y},${z}`);
    if (sd > 0) assert.ok(f.eval(x, y, z) > 0, `no material outside the shape at ${x},${y},${z}`);
  }
});

test("clip: box distance is exact inside and outside (face and corner regions)", () => {
  // Box x in [-2, 2], y in [-3, 3], z in [-1, 6].
  // Centre point (0, 0, 2.5): nearest face is x = +-2, 2 away.
  assert.ok(Math.abs(clipDistance(boxShape, [0, 0, 2.5]) - -2) < 1e-12);
  // Inside at x = 0.5: nearest face is x = 2, 1.5 away.
  assert.ok(Math.abs(clipDistance(boxShape, [0.5, 0, 2.5]) - -1.5) < 1e-12);
  // Outside through a face: x = 4 is 2 outside the x = 2 face.
  assert.ok(Math.abs(clipDistance(boxShape, [4, 0, 2]) - 2) < 1e-12);
  // Outside through a corner: (4, 5, 8) is (2, 2, 2) outside the corner (2, 3, 6).
  assert.ok(Math.abs(clipDistance(boxShape, [4, 5, 8]) - Math.hypot(2, 2, 2)) < 1e-12);
});

test("clip: 1-Lipschitz (max of 1-Lipschitz fields), validation, bounds and no-overlap error", () => {
  const f = compileGraph(graphWith(boxShape), "out");
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 12 - 6;
  for (let i = 0; i < 300; i++) {
    const p = [rnd(), rnd(), rnd()], q = [p[0] + 0.05, p[1] - 0.03, p[2] + 0.02];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    assert.ok(Math.abs(f.eval(p[0], p[1], p[2]) - f.eval(q[0], q[1], q[2])) <= d + 1e-9);
  }
  const b = clipBounds(sphereShape);
  assert.deepEqual(b.min, [-3, -4, -4]);
  assert.deepEqual(b.max, [5, 4, 4]);
  // Bounds of the compiled field are the intersection with the source box.
  assert.ok(f.bounds.max[0] <= 2 && f.bounds.min[2] >= -1);

  assert.deepEqual(validateGraph(graphWith(sphereShape)), []);
  assert.ok(validateGraph(graphWith({ type: "sphere", centre: [0, 0, 0], radius: -1 })).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(graphWith({ type: "box", min: [1, 0, 0], max: [0, 1, 1] })).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(graphWith({ type: "cone" })).some((i) => i.code === "bad_param"));
  assert.throws(() => compileGraph(graphWith({ type: "sphere", centre: [100, 100, 100], radius: 1 }), "out"), /does not overlap/);
});
