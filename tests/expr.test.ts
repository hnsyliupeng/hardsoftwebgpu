import { test } from "node:test";
import assert from "node:assert/strict";
import { compileExpr, checkExpr } from "../src/graph/expr.ts";
import { compileGraph, validateGraph, type StructureGraph, type TransformSpec } from "../src/graph/graph.ts";

const ev = (text: string, x = 0, y = 0, z = 0) => compileExpr(text)(x, y, z);

test("expr: arithmetic precedence, unary minus, power (right-assoc), functions, constants", () => {
  assert.equal(ev("1+2*3"), 7);
  assert.equal(ev("(1+2)*3"), 9);
  assert.equal(ev("-2^2"), -4); // unary minus binds looser than power, as in maths
  assert.equal(ev("2^3^2"), 512); // right-associative
  assert.equal(ev("8/2/2"), 2); // left-associative division
  assert.ok(Math.abs(ev("sin(pi/2)") - 1) < 1e-15);
  assert.equal(ev("max(x, y) - min(x, y)", 3, -1, 0), 4);
  assert.equal(ev("abs(z) + sqrt(4)", 0, 0, -3), 5);
  assert.ok(Math.abs(ev("e") - Math.E) < 1e-15);
  assert.equal(ev("1.5e2 + .5"), 150.5);
});

test("expr: variables x, y, z are the point coordinates", () => {
  assert.equal(ev("0.02*(z-10)", 0, 0, 14), 0.08);
  assert.equal(ev("x*y*z", 2, 3, 4), 24);
});

test("expr: invalid text is rejected with a message, never executed", () => {
  const bad = [
    "", "1+", "foo(x)", "x.constructor", "process.exit(1)", "x; y", "x = 1", "min(x)", "sin(x", "2 $ 3",
    "constructor(x)", "__proto__", "x y", "x[0]", "`x`", "(x)(y)", "1e",
  ];
  for (const t of bad) assert.ok(checkExpr(t) !== null, `should reject ${JSON.stringify(t)}`);
  assert.throws(() => compileExpr("x.y"), /expr:/);
  assert.equal(checkExpr("sin(x)*y - 0.5"), null);
  assert.ok(checkExpr("x".repeat(301)) !== null);
});

function chainWith(t: TransformSpec): StructureGraph {
  return {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: { type: "sphere", radius: 5 } as never },
      { id: "t0", kind: "transform", transform: t },
      { id: "out", kind: "structure", name: "expr-test" },
    ],
    edges: [{ from: "src", to: "t0" }, { from: "t0", to: "out" }],
  };
}

test("expr offset: f' = f - g(x) exactly, and validation reports bad text", () => {
  const base = compileGraph(chainWith({ op: "expr", text: "0" }), "out");
  const g = compileGraph(chainWith({ op: "expr", text: "0.03*(x*y - z) + sin(z)" }), "out");
  for (const [x, y, z] of [[0.3, -1.2, 2.1], [-2.5, 0.7, -0.4], [1.9, 2.2, 3.3]] as [number, number, number][]) {
    const want = base.eval(x, y, z) - (0.03 * (x * y - z) + Math.sin(z));
    assert.ok(Math.abs(g.eval(x, y, z) - want) < 1e-12);
  }
  assert.deepEqual(validateGraph(chainWith({ op: "expr", text: "0.1*x" })), []);
  const issues = validateGraph(chainWith({ op: "expr", text: "process.exit()" }));
  assert.ok(issues.length >= 1);
  assert.ok(issues.some((i) => i.code === "bad_param"));
});
