import { test } from "node:test";
import assert from "node:assert/strict";
import { compileGraph, validateGraph, conformalLog, type StructureGraph } from "../src/graph/graph.ts";

const R0 = 16, S = 20;
const map = conformalLog({ r0: R0, scale: S });

function graph(source: object, transform: object): StructureGraph {
  return {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: source as never },
      { id: "t0", kind: "transform", transform: transform as never },
      { id: "out", kind: "structure", name: "conf" },
    ],
    edges: [{ from: "src", to: "t0" }, { from: "t0", to: "out" }],
  };
}
const sphere = { type: "sphere", radius: 5 };
const confT = { op: "conformal_log", r0: R0, scale: S };

test("conformal: the Jacobian of the forward map is (|w|/scale)^2 times the identity (angles preserved)", () => {
  const h = 1e-6;
  for (const q of [[2, 1, 0.5], [-3, 4, -1], [0.5, -2, 2], [4.5, 0.2, 0]] as [number, number, number][]) {
    const J: number[][] = [[0, 0], [0, 0]];
    for (let c = 0; c < 2; c++) {
      const a = [...q] as [number, number, number], b = [...q] as [number, number, number];
      a[c] += h;
      b[c] -= h;
      const fa = map.forward(a), fb = map.forward(b);
      J[0][c] = (fa[0] - fb[0]) / (2 * h);
      J[1][c] = (fa[1] - fb[1]) / (2 * h);
    }
    const w = map.forward(q);
    const m = Math.hypot(w[0], w[1]) / S;
    // J is m * (rotation): J^T J = m^2 I.
    const jtj = [
      [J[0][0] ** 2 + J[1][0] ** 2, J[0][0] * J[0][1] + J[1][0] * J[1][1]],
      [J[0][1] * J[0][0] + J[1][1] * J[1][0], J[0][1] ** 2 + J[1][1] ** 2],
    ];
    assert.ok(Math.abs(jtj[0][0] - m * m) < 1e-6 * m * m, `diag at ${q}`);
    assert.ok(Math.abs(jtj[1][1] - m * m) < 1e-6 * m * m, `diag at ${q}`);
    assert.ok(Math.abs(jtj[0][1]) < 1e-6 * m * m, `off-diagonal at ${q}`);
  }
});

test("conformal: inverse of forward is the identity; z is unchanged", () => {
  for (const q of [[2, 1, 0.5], [-3, 4, -1], [4.5, 0.2, 7]] as [number, number, number][]) {
    const back = map.inverse(map.forward(q));
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(back[a] - q[a]) < 1e-12);
  }
});

test("conformal: zero set of the sphere maps to the zero set of the field; interior value is scaled", () => {
  const g = compileGraph(graph(sphere, confT), "out");
  // Source points on the sphere |q| = 5 (y range stays well inside the angle limit).
  for (const a of [0, 0.7, 1.9, 3.0]) {
    const q = [5 * Math.cos(a), 5 * Math.sin(a), 0] as [number, number, number];
    const p = map.forward(q);
    assert.ok(Math.abs(g.eval(p[0], p[1], p[2])) < 1e-9, `zero at angle ${a}`);
  }
  // Interior point |q| = 2: value (2 - 5) / lambda, lambda = scale / (r0 exp(x_min/scale)) with x_min = -5.
  const lambda = S / (R0 * Math.exp(-5 / S));
  const q = [2, 0, 0] as [number, number, number];
  const p = map.forward(q);
  assert.ok(Math.abs(g.eval(p[0], p[1], p[2]) - (2 - 5) / lambda) < 1e-12);
});

test("conformal: 1-Lipschitz on the image of the source box", () => {
  const g = compileGraph(graph(sphere, confT), "out");
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 10 - 5;
  for (let i = 0; i < 300; i++) {
    const q = [rnd(), rnd(), rnd()] as [number, number, number];
    const d = [q[0] + 0.03, q[1] - 0.02, q[2] + 0.01] as [number, number, number];
    const p = map.forward(q), pp = map.forward(d);
    const dist = Math.hypot(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    const df = Math.abs(g.eval(p[0], p[1], p[2]) - g.eval(pp[0], pp[1], pp[2]));
    assert.ok(df <= dist + 1e-9, `Lipschitz at ${q}: ${df} > ${dist}`);
  }
});

test("conformal: bounds contain the image of the source box corners; validation", () => {
  const g = compileGraph(graph(sphere, confT), "out");
  for (const x of [-5, 5]) for (const y of [-5, 5]) {
    const p = map.forward([x, y, 0]);
    assert.ok(Math.abs(p[0]) <= g.bounds.max[0] && Math.abs(p[1]) <= g.bounds.max[1], `corner (${x},${y}) inside bounds`);
  }
  assert.deepEqual(validateGraph(graph(sphere, confT)), []);
  assert.ok(validateGraph(graph(sphere, { op: "conformal_log", r0: 0, scale: 20 })).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(graph(sphere, { op: "conformal_log", r0: 16, scale: -1 })).some((i) => i.code === "bad_param"));
});
