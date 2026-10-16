import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { paramSlots, setParam, clampParam } from "../src/graph/params.ts";
import { STARTER_GRAPH } from "../src/graph/editor.ts";
import { validateGraph, type StructureGraph } from "../src/graph/graph.ts";

const fractal: StructureGraph = {
  version: 1,
  nodes: [
    { id: "fr", kind: "field", source: { type: "fractal_cube", size: 24, divisor: 2, depth: 3, radius: 0.6, radiusRatio: 0.7 } as never },
    { id: "out", kind: "structure", name: "f" },
  ],
  edges: [{ from: "fr", to: "out" }],
};

test("params: starter graph exposes source and transform scalars with ranges", () => {
  const slots = paramSlots(STARTER_GRAPH);
  const get = (node: string, field: string) => slots.find((s) => s.nodeId === node && s.field === field);
  assert.equal(get("lat", "source.cellSize")?.value, 8);
  assert.equal(get("lat", "source.cells")?.integer, true);
  assert.equal(get("lat", "source.levels")?.value, 2);
  assert.equal(get("grad", "transform.slope")?.value, 0.01);
  assert.equal(get("clip", "transform.shape.radius")?.value, 10);
  for (const s of slots) assert.ok(s.value >= s.min && s.value <= s.max, `${s.nodeId}.${s.field} in range`);
});

test("params: setParam copies the graph, clamps, rounds integers and validates", () => {
  const before = JSON.stringify(STARTER_GRAPH);
  const r = setParam(STARTER_GRAPH, "clip", "transform.shape.radius", 1000);
  assert.equal(r.value, 100); // clamped to the range
  assert.deepEqual(r.issues, []);
  assert.equal(JSON.stringify(STARTER_GRAPH), before); // input untouched
  assert.equal((r.graph.nodes[2] as { transform: { shape: { radius: number } } }).transform.shape.radius, 100);

  const cells = setParam(STARTER_GRAPH, "lat", "source.cells", 2.6);
  assert.equal(cells.value, 3); // integer parameter rounds (range 1..6)
});

test("params: a value that breaks a rule is reported by validation, not silently accepted", () => {
  // Fractal finest subcube size is 24/8 = 3; radius must stay below it.
  const ok = setParam(fractal, "fr", "source.radius", 0.5);
  assert.deepEqual(ok.issues, []);
  const bad = setParam(fractal, "fr", "source.radius", 5);
  assert.ok(bad.issues.some((i) => i.code === "bad_param"));
  // Depth 3 -> 1 (integer) keeps the graph valid.
  const d = setParam(fractal, "fr", "source.depth", 1);
  assert.deepEqual(d.issues, []);
});

test("params: unknown slots throw; clampParam rejects non-finite values", () => {
  assert.throws(() => setParam(STARTER_GRAPH, "lat", "source.nope", 1), /no editable parameter/);
  assert.throws(() => clampParam({ min: 0, max: 1 }, Number.NaN), /finite/);
});

test("params: every preset in presets/ round-trips through each slot to a valid graph", () => {
  const dir = "presets";
  let slotsSeen = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const g = JSON.parse(readFileSync(join(dir, f), "utf8")) as StructureGraph;
    assert.deepEqual(validateGraph(g), [], `${f} validates`);
    for (const s of paramSlots(g)) {
      slotsSeen++;
      const r = setParam(g, s.nodeId, s.field, s.value);
      assert.deepEqual(r.issues, [], `${f}: ${s.nodeId}.${s.field} at its own value stays valid`);
    }
  }
  assert.ok(slotsSeen > 10, `expected many slots across presets, saw ${slotsSeen}`);
});
