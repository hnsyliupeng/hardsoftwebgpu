import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { paramMap, type ParamSpec } from "../src/graph/parametric.ts";
import { compileGraph, validateGraph, type StructureGraph } from "../src/graph/graph.ts";

type V3 = [number, number, number];
const BOX = { min: [0, 0, 0] as V3, max: [20, 20, 20] as V3 };
const ELL: ParamSpec = { kind: "ellipsoid", a: 24, b: 18, c: 14, u0: -0.4, v0: 0.9, du: 0.04, dv: 0.04 };
const SAD: ParamSpec = { kind: "saddle", k: 0.02, u0: -10, v0: -10, du: 1, dv: 1 };

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const srcLattice = { type: "sc", cellSize: 4, cells: 5, radius: 0.4 };
function graph(transform: object): StructureGraph {
  return {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: srcLattice as never },
      { id: "t0", kind: "transform", transform: transform as never },
      { id: "out", kind: "structure", name: "par" },
    ],
    edges: [{ from: "src", to: "t0" }, { from: "t0", to: "out" }],
  };
}
const sourceOnly: StructureGraph = {
  version: 1,
  nodes: [
    { id: "src", kind: "field", source: srcLattice as never },
    { id: "out", kind: "structure", name: "src" },
  ],
  edges: [{ from: "src", to: "out" }],
};
const TR = (spec: ParamSpec) => ({ op: "parametric_project", ...spec });

test("parametric: inverse(forward(s)) = s to 1e-7 (ellipsoid and saddle)", () => {
  for (const spec of [ELL, SAD]) {
    const M = paramMap(spec);
    const rnd = rng(7);
    for (let i = 0; i < 300; i++) {
      const s: V3 = [20 * rnd(), 20 * rnd(), 20 * rnd()];
      const b = M.inverse(M.forward(s));
      const err = Math.hypot(b[0] - s[0], b[1] - s[1], b[2] - s[2]);
      assert.ok(err < 1e-7, `${spec.kind}: round trip error ${err} at ${s}`);
    }
  }
});

test("parametric: z = 0 points lie on the surface", () => {
  const rnd = rng(11);
  const E = paramMap(ELL), S = paramMap(SAD);
  for (let i = 0; i < 200; i++) {
    const s: V3 = [20 * rnd(), 20 * rnd(), 0];
    const p = E.forward(s);
    const f = (p[0] / 24) ** 2 + (p[1] / 18) ** 2 + (p[2] / 14) ** 2;
    assert.ok(Math.abs(f - 1) < 1e-9, `ellipsoid: implicit value ${f - 1}`);
    const q = S.forward(s);
    const u = -10 + s[0], v = -10 + s[1];
    assert.ok(Math.abs(q[2] - 0.02 * (u * u - v * v)) < 1e-9, "saddle: height");
    assert.ok(Math.abs(q[0] - u) < 1e-9 && Math.abs(q[1] - v) < 1e-9, "saddle: x, y");
  }
});

test("parametric: z is the signed offset along the normal (ellipsoid: |P| grows outward)", () => {
  const M = paramMap(ELL);
  const p0 = M.forward([5, 5, 0]), p1 = M.forward([5, 5, 2]);
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  assert.ok(Math.abs(d - 2) < 1e-9, "unit normal: offset length equals z");
  // Outward: the implicit function increases.
  const F = (p: V3) => (p[0] / 24) ** 2 + (p[1] / 18) ** 2 + (p[2] / 14) ** 2;
  assert.ok(F(p1) > F(p0), "offset is outward");
});

test("parametric: lambda bounds the operator norm of the inverse (finite differences)", () => {
  for (const spec of [ELL, SAD]) {
    const M = paramMap(spec);
    const lam = M.lambda(BOX);
    const rnd = rng(19);
    for (let i = 0; i < 150; i++) {
      const s: V3 = [20 * rnd(), 20 * rnd(), 20 * rnd()];
      const q = M.forward(s), h = 1e-6;
      const J: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let c = 0; c < 3; c++) {
        const a = [...q] as V3, b = [...q] as V3;
        a[c] += h;
        b[c] -= h;
        const ia = M.inverse(a), ib = M.inverse(b);
        for (let r = 0; r < 3; r++) J[r][c] = (ia[r] - ib[r]) / (2 * h);
      }
      // Operator norm of J by power iteration on J^T J.
      let v = [1, 0.3, 0.2];
      for (let k = 0; k < 80; k++) {
        const Jv = [0, 1, 2].map((r) => J[r][0] * v[0] + J[r][1] * v[1] + J[r][2] * v[2]);
        const w = [0, 1, 2].map((c) => J[0][c] * Jv[0] + J[1][c] * Jv[1] + J[2][c] * Jv[2]);
        const n = Math.hypot(...w);
        v = w.map((x) => x / n);
      }
      const Jv = [0, 1, 2].map((r) => J[r][0] * v[0] + J[r][1] * v[1] + J[r][2] * v[2]);
      assert.ok(Math.hypot(...Jv) <= lam * (1 + 1e-6) + 1e-6, `${spec.kind}: op norm ${Math.hypot(...Jv)} > lambda ${lam}`);
    }
  }
});

test("parametric: identity field equals the source over lambda at each image point", () => {
  const inner = compileGraph(sourceOnly, "src");
  const spec: ParamSpec = ELL;
  const g = compileGraph(graph(TR(spec)), "out");
  const M = paramMap(spec);
  const lam = M.lambda({ min: inner.bounds.min as V3, max: inner.bounds.max as V3 });
  const rnd = rng(23);
  for (let i = 0; i < 100; i++) {
    const s: V3 = [20 * rnd(), 20 * rnd(), 20 * rnd()];
    const p = M.forward(s);
    const got = g.eval(p[0], p[1], p[2]);
    const want = inner.eval(s[0], s[1], s[2]) / lam;
    assert.ok(Math.abs(got - want) < 1e-9, `identity at ${s}: ${got} vs ${want}`);
  }
});

test("parametric: compiled field is 1-Lipschitz on the image (saddle and ellipsoid)", () => {
  for (const spec of [ELL, SAD]) {
    const g = compileGraph(graph(TR(spec)), "out");
    const M = paramMap(spec);
    const rnd = rng(29);
    for (let i = 0; i < 300; i++) {
      const s: V3 = [20 * rnd(), 20 * rnd(), 20 * rnd()];
      const d: V3 = [s[0] + 0.02 * (rnd() - 0.5), s[1] + 0.02 * (rnd() - 0.5), s[2] + 0.02 * (rnd() - 0.5)];
      const p = M.forward(s), pp = M.forward(d);
      const dist = Math.hypot(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      const df = Math.abs(g.eval(p[0], p[1], p[2]) - g.eval(pp[0], pp[1], pp[2]));
      assert.ok(df <= dist + 1e-9, `${spec.kind}: Lipschitz at ${s}: ${df} > ${dist}`);
    }
  }
});

test("parametric: validation rejects bad parameters", () => {
  const bad = (t: object) => validateGraph(graph(t)).some((i) => i.code === "bad_param");
  assert.deepEqual(validateGraph(graph(TR(ELL))), []);
  assert.deepEqual(validateGraph(graph(TR(SAD))), []);
  assert.ok(bad({ op: "parametric_project", kind: "ellipsoid", a: 0, b: 1, c: 1, v0: 1, du: 0.04, dv: 0.04 }), "a must be > 0");
  assert.ok(bad({ op: "parametric_project", kind: "ellipsoid", a: 1, b: -1, c: 1, v0: 1, du: 0.04, dv: 0.04 }), "b must be > 0");
  assert.ok(bad({ op: "parametric_project", kind: "ellipsoid", a: 1, b: 1, c: 1, v0: 1, du: 0, dv: 0.04 }), "du must be non-zero");
  assert.ok(bad({ op: "parametric_project", kind: "saddle", k: NaN, du: 1, dv: 1 }), "k must be finite");
  assert.ok(bad({ op: "parametric_project", kind: "cone", a: 1, b: 1, c: 1, v0: 1, du: 1, dv: 1 }), "unknown kind");
});

test("parametric: the shipped presets validate and compile", () => {
  for (const f of ["sc_ellipsoid_shell", "sc_saddle_sheet"]) {
    const g = JSON.parse(readFileSync(new URL(`../presets/${f}.json`, import.meta.url), "utf8")) as StructureGraph;
    assert.deepEqual(validateGraph(g), [], f);
    const field = compileGraph(g, "out");
    assert.ok(field.bounds.max[0] > field.bounds.min[0], f);
  }
});
