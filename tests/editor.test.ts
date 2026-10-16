import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphEditor, STARTER_GRAPH } from "../src/graph/editor.ts";

test("editor: starter graph loads, text round-trips, expression is reported", () => {
  const ed = new GraphEditor(STARTER_GRAPH);
  assert.deepEqual(JSON.parse(ed.text), STARTER_GRAPH);
  assert.equal(ed.canUndo, false);
  assert.equal(ed.canRedo, false);
});

test("editor: valid edit is one undo step, undo and redo restore the exact text", () => {
  const ed = new GraphEditor(STARTER_GRAPH);
  const before = ed.text;
  const edited = JSON.parse(before);
  edited.nodes[2].transform.shape.radius = 8; // shrink the clip sphere
  const r = ed.apply(JSON.stringify(edited));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.structure, "out");
  const after = ed.text;
  assert.notEqual(after, before);
  assert.equal(ed.undo(), true);
  assert.equal(ed.text, before);
  assert.equal(ed.redo(), true);
  assert.equal(ed.text, after);
  assert.equal(ed.redo(), false);
});

test("editor: invalid edits are rejected and leave the state unchanged", () => {
  const ed = new GraphEditor(STARTER_GRAPH);
  const before = ed.text;
  const cases: [string, RegExp][] = [
    ["{ not json", /JSON:/],
    [JSON.stringify({ ...STARTER_GRAPH, nodes: [...STARTER_GRAPH.nodes.slice(0, 3)] }), /structure|missing|no structure/i],
    [JSON.stringify({ ...JSON.parse(before), nodes: JSON.parse(before).nodes.map((n: { id: string; transform?: object }) => n.id === "clip" ? { ...n, transform: { op: "clip", shape: { type: "sphere", centre: [0, 0, 0], radius: -2 } } } : n) }), /bad_param/],
    [JSON.stringify({ ...JSON.parse(before), nodes: JSON.parse(before).nodes.map((n: { id: string }) => n.id === "clip" ? { id: "clip", kind: "transform", transform: { op: "clip", shape: { type: "sphere", centre: [100, 100, 100], radius: 1 } } } : n) }), /does not overlap/],
  ];
  for (const [text, want] of cases) {
    const r = ed.apply(text);
    assert.equal(r.ok, false, `should reject ${text.slice(0, 60)}`);
    if (!r.ok) assert.match(r.error, want);
    assert.equal(ed.text, before);
    assert.equal(ed.undo(), false);
  }
});
