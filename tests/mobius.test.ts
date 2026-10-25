import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileGraph, validateGraph, mobiusMaps, type StructureGraph, type MobiusSpec } from "../src/graph/graph.ts";

const T: MobiusSpec = { a: [1, 0], b: [0, 0], c: [-0.02, 0.01], d: [1, 0] };
const map = mobiusMaps(T);
const SPHERE_BOX = { min: [-5, -5, -5], max: [5, 5, 5] } as never;

function graph(source: object, transform: object): StructureGraph {
  return {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: source as never },
      { id: "t0", kind: "transform", transform: transform as never },
      { id: "out", kind: "structure", name: "mob" },
    ],
    edges: [{ from: "src", to: "t0" }, { from: "t0", to: "out" }],
  };
}
const sphere = { type: "sphere", radius: 5 };
const mobT = { op: "mobius", ...T };

test("mobius: the Jacobian of the forward map is |f'| times a rotation (conformal), z unchanged", () => {
  const h = 1e-6;
  for (const q of [[2, 1, 0.5], [-3, 4, -1], [0.5, -2, 2], [7, 3, 0]] as [number, number, number][]) {
    const J = [[0, 0], [0, 0]];
    for (let c = 0; c < 2; c++) {
      const a = [...q] as [number, number, number], b = [...q] as [number, number, number];
      a[c] += h;
      b[c] -= h;
      const fa = map.forward(a), fb = map.forward(b);
      J[0][c] = (fa[0] - fb[0]) / (2 * h);
      J[1][c] = (fa[1] - fb[1]) / (2 * h);
    }
    // |f'(s)| = |det| / |c s + d|^2 with det = a d - b c = 1 here.
    const cs = [T.c[0] * q[0] - T.c[1] * q[1] + T.d[0], T.c[0] * q[1] + T.c[1] * q[0] + T.d[1]];
    const fp = 1 / (cs[0] * cs[0] + cs[1] * cs[1]);
    const jtj = [
      [J[0][0] ** 2 + J[1][0] ** 2, J[0][0] * J[0][1] + J[1][0] * J[1][1]],
      [J[0][1] * J[0][0] + J[1][1] * J[1][0], J[0][1] ** 2 + J[1][1] ** 2],
    ];
    assert.ok(Math.abs(jtj[0][0] - fp * fp) < 1e-6 * fp * fp, `diag at ${q}`);
    assert.ok(Math.abs(jtj[1][1] - fp * fp) < 1e-6 * fp * fp, `diag at ${q}`);
    assert.ok(Math.abs(jtj[0][1]) < 1e-6 * fp * fp, `off-diagonal at ${q}`);
    assert.equal(map.forward(q)[2], q[2]);
  }
});

test("mobius: inverse of forward is the identity (complex coefficients, non-trivial b)", () => {
  const m = mobiusMaps({ a: [0.7, 0.2], b: [1.5, -0.4], c: [0.03, -0.02], d: [1, 0.3] });
  for (const q of [[2, 1, 0.5], [-3, 4, -1], [9, -6, 7]] as [number, number, number][]) {
    const back = m.inverse(m.forward(q));
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(back[a] - q[a]) < 1e-9, `component ${a} at ${q}`);
  }
});

test("mobius: zero set of the sphere maps to the zero set of the field; interior value is scaled", () => {
  const g = compileGraph(graph(sphere, mobT), "out");
  for (const a of [0, 0.7, 1.9, 3.0, 4.4]) {
    const q = [5 * Math.cos(a), 5 * Math.sin(a), 0] as [number, number, number];
    const p = map.forward(q);
    assert.ok(Math.abs(g.eval(p[0], p[1], p[2])) < 1e-9, `zero at angle ${a}`);
  }
  const lambda = map.lambda(SPHERE_BOX);
  const q = [2, 1, 0] as [number, number, number];
  const p = map.forward(q);
  const r = Math.hypot(q[0], q[1], q[2]) - 5;
  assert.ok(Math.abs(g.eval(p[0], p[1], p[2]) - r / lambda) < 1e-12);
});

test("mobius: lambda is at least the largest inverse derivative on the image (checked on a dense grid)", () => {
  const lambda = map.lambda(SPHERE_BOX);
  let gridMax = 0;
  const n = 200;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const q = [-5 + (10 * i) / n, -5 + (10 * j) / n, 0] as [number, number, number];
      const w = map.forward(q);
      // |D inverse| at w = |det| / |a - c w|^2 with a = 1, c = T.c, det = 1.
      const cw = [T.c[0] * w[0] - T.c[1] * w[1], T.c[0] * w[1] + T.c[1] * w[0]];
      const den = (1 - cw[0]) ** 2 + cw[1] ** 2;
      gridMax = Math.max(gridMax, 1 / den);
    }
  assert.ok(lambda >= gridMax, `lambda ${lambda} < grid sup ${gridMax}`);
  assert.ok(lambda <= 1.05 * gridMax, `lambda ${lambda} is much larger than grid sup ${gridMax}`);
});

test("mobius: 1-Lipschitz on the image of the source box", () => {
  const g = compileGraph(graph(sphere, mobT), "out");
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 8 - 4;
  for (let i = 0; i < 300; i++) {
    const q = [rnd(), rnd(), rnd()] as [number, number, number];
    const d = [q[0] + 0.03, q[1] - 0.02, q[2] + 0.01] as [number, number, number];
    const p = map.forward(q), pp = map.forward(d);
    const dist = Math.hypot(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    const df = Math.abs(g.eval(p[0], p[1], p[2]) - g.eval(pp[0], pp[1], pp[2]));
    assert.ok(df <= dist + 1e-9, `Lipschitz at ${q}: ${df} > ${dist}`);
  }
});

test("mobius: bounds contain the image of the source box; validation", () => {
  const g = compileGraph(graph(sphere, mobT), "out");
  for (const x of [-5, 5]) for (const y of [-5, 5]) {
    const p = map.forward([x, y, 0]);
    assert.ok(p[0] >= g.bounds.min[0] && p[0] <= g.bounds.max[0] && p[1] >= g.bounds.min[1] && p[1] <= g.bounds.max[1], `corner (${x},${y}) inside bounds`);
  }
  assert.deepEqual(validateGraph(graph(sphere, mobT)), []);
  // det = a d - b c = 0 is rejected.
  assert.ok(validateGraph(graph(sphere, { op: "mobius", a: [1, 0], b: [1, 0], c: [1, 0], d: [1, 0] })).some((i) => i.code === "bad_param"));
  // A non-finite coefficient is rejected.
  assert.ok(validateGraph(graph(sphere, { op: "mobius", a: [1, 0], b: [0, 0], c: [Number.NaN, 0], d: [1, 0] })).some((i) => i.code === "bad_param"));
});

test("mobius: a source box that contains the pole -d/c is rejected", () => {
  // Pole at -d/c = -1/0.5 = -2 on the real axis, inside the sphere box [-5, 5]^2.
  const bad = { op: "mobius", a: [1, 0], b: [0, 0], c: [0.5, 0], d: [1, 0] };
  assert.throws(() => compileGraph(graph(sphere, bad), "out"), /pole/);
});

test("mobius: the shipped preset validates and compiles", () => {
  const g = JSON.parse(readFileSync(new URL("../presets/sc_mobius.json", import.meta.url), "utf8")) as StructureGraph;
  assert.deepEqual(validateGraph(g), []);
  const field = compileGraph(g, "out");
  assert.ok(field.bounds.max[0] > field.bounds.min[0]);
});
