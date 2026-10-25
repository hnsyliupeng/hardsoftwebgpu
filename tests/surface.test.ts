import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { surfaceMap, type SurfaceSpec } from "../src/graph/surface.ts";
import { compileGraph, validateGraph, type StructureGraph } from "../src/graph/graph.ts";

const BOX = { min: [0, 0, 0] as [number, number, number], max: [20, 20, 20] as [number, number, number] };
const SPH: SurfaceSpec = { surface: "sphere", radius: 16, theta0: 1.0 };
const TOR: SurfaceSpec = { surface: "torus", major: 40, minor: 10, v0: -1.0 };
const TOR_INNER: SurfaceSpec = { surface: "torus", major: 50, minor: 10, v0: 1.2 }; // lambda > 1 (inner side)

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function graph(source: object, transform: object): StructureGraph {
  return {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: source as never },
      { id: "t0", kind: "transform", transform: transform as never },
      { id: "out", kind: "structure", name: "surf" },
    ],
    edges: [{ from: "src", to: "t0" }, { from: "t0", to: "out" }],
  };
}
const sphereSrc = { type: "sphere", radius: 5 };

test("surface: inverse(forward(s)) = s for sphere and torus", () => {
  for (const spec of [SPH, TOR, TOR_INNER]) {
    const M = surfaceMap(spec);
    const rnd = rng(7);
    for (let i = 0; i < 300; i++) {
      const s: [number, number, number] = [20 * rnd(), 20 * rnd(), 20 * rnd()];
      const b = M.inverse(M.forward(s));
      assert.ok(Math.hypot(b[0] - s[0], b[1] - s[1], b[2] - s[2]) < 1e-9, `round trip ${spec.surface} at ${s}`);
    }
  }
});

test("surface: forward points lie on the offset surface (sphere: |P| = R + z; torus: tube distance = Rt + z)", () => {
  const rnd = rng(11);
  const S = surfaceMap(SPH), T = surfaceMap(TOR);
  for (let i = 0; i < 200; i++) {
    const s: [number, number, number] = [20 * rnd(), 20 * rnd(), 20 * rnd()];
    const p = S.forward(s);
    assert.ok(Math.abs(Math.hypot(...p) - (16 + s[2])) < 1e-9, "sphere shell radius");
    const q = T.forward(s);
    const dCore = Math.hypot(Math.hypot(q[0], q[1]) - 40, q[2]);
    assert.ok(Math.abs(dCore - (10 + s[2])) < 1e-9, "torus tube distance");
  }
});

test("surface: lambda bounds the operator norm of the inverse (finite differences)", () => {
  for (const spec of [SPH, TOR_INNER]) {
    const M = surfaceMap(spec);
    const lam = M.lambda(BOX);
    const rnd = rng(19);
    for (let i = 0; i < 150; i++) {
      const s: [number, number, number] = [20 * rnd(), 20 * rnd(), 20 * rnd()];
      const q = M.forward(s), h = 1e-6;
      const J: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let c = 0; c < 3; c++) {
        const a = [...q] as [number, number, number], b = [...q] as [number, number, number];
        a[c] += h; b[c] -= h;
        const ia = M.inverse(a), ib = M.inverse(b);
        for (let r = 0; r < 3; r++) J[r][c] = (ia[r] - ib[r]) / (2 * h);
      }
      // Operator norm: sqrt of the largest eigenvalue of J^T J (power iteration).
      let v = [1, 0.3, 0.2];
      for (let k = 0; k < 80; k++) {
        const Jv = [0, 1, 2].map((r) => J[r][0] * v[0] + J[r][1] * v[1] + J[r][2] * v[2]);
        const w = [0, 1, 2].map((c) => J[0][c] * Jv[0] + J[1][c] * Jv[1] + J[2][c] * Jv[2]);
        const n = Math.hypot(...w);
        v = w.map((x) => x / n);
      }
      const Jv = [0, 1, 2].map((r) => J[r][0] * v[0] + J[r][1] * v[1] + J[r][2] * v[2]);
      assert.ok(Math.hypot(...Jv) <= lam * (1 + 1e-6) + 1e-6, `${spec.surface}: op norm ${Math.hypot(...Jv)} > lambda ${lam}`);
    }
  }
  assert.ok(surfaceMap(TOR_INNER).lambda(BOX) > 1.05, "the inner torus case must exercise lambda > 1");
});

test("surface: compiled field equals the source field over lambda at each image point (identity)", () => {
  const g = compileGraph(graph(sphereSrc, { op: "surface_project", surface: "sphere", radius: 16, theta0: 1.0 }), "out");
  const inner = compileGraph({ ...graph(sphereSrc, { op: "surface_project", surface: "sphere", radius: 16, theta0: 1.0 }), nodes: [{ id: "src", kind: "field", source: sphereSrc as never }, { id: "out", kind: "structure", name: "surf" }], edges: [{ from: "src", to: "out" }] } as StructureGraph, "out");
  const M = surfaceMap({ surface: "sphere", radius: 16, theta0: 1.0 });
  const lam = M.lambda({ min: [-5, -5, -5], max: [5, 5, 5] });
  const rnd = rng(23);
  // x is an arc length in the window [0, 2 pi R): the seam at x = 0 is the box face, so sample x > 0 only.
  for (let i = 0; i < 100; i++) {
    const s: [number, number, number] = [5 * rnd(), -5 + 10 * rnd(), -5 + 10 * rnd()];
    const p = M.forward(s);
    assert.ok(Math.abs(g.eval(p[0], p[1], p[2]) - inner.eval(s[0], s[1], s[2]) / lam) < 1e-9, `identity at ${s}`);
  }
});

test("surface: 1-Lipschitz on the image of the source box (sphere source is an SDF)", () => {
  const g = compileGraph(graph(sphereSrc, { op: "surface_project", surface: "torus", major: 50, minor: 10, v0: 1.2 }), "out");
  const M = surfaceMap(TOR_INNER);
  const rnd = rng(29);
  for (let i = 0; i < 300; i++) {
    // x kept inside the window (0, 2 pi Rm) away from the seam at x = 0.
    const s: [number, number, number] = [0.5 + 7 * rnd(), -4 + 8 * rnd(), -4 + 8 * rnd()];
    const d: [number, number, number] = [s[0] + 0.02 * (rnd() - 0.5), s[1] + 0.02 * (rnd() - 0.5), s[2] + 0.02 * (rnd() - 0.5)];
    const p = M.forward(s), pp = M.forward(d);
    const dist = Math.hypot(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    const df = Math.abs(g.eval(p[0], p[1], p[2]) - g.eval(pp[0], pp[1], pp[2]));
    assert.ok(df <= dist + 1e-9, `Lipschitz at ${s}: ${df} > ${dist}`);
  }
});

test("surface: validation and patch limits", () => {
  assert.deepEqual(validateGraph(graph(sphereSrc, { op: "surface_project", surface: "sphere", radius: 16, theta0: 1.0 })), []);
  assert.deepEqual(validateGraph(graph(sphereSrc, { op: "surface_project", surface: "torus", major: 40, minor: 10, v0: -1.0 })), []);
  assert.ok(validateGraph(graph(sphereSrc, { op: "surface_project", surface: "sphere", radius: 16, theta0: 0 })).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(graph(sphereSrc, { op: "surface_project", surface: "sphere", radius: 0, theta0: 1 })).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(graph(sphereSrc, { op: "surface_project", surface: "torus", major: 40, minor: 0, v0: 0 })).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(graph(sphereSrc, { op: "surface_project", surface: "cone", radius: 1, theta0: 1 })).some((i) => i.code === "bad_param"));
  // The sphere patch must stay inside 0 < theta < pi: theta0 = 3 with a 20 mm box leaves the range.
  assert.throws(() => compileGraph(graph(sphereSrc, { op: "surface_project", surface: "sphere", radius: 16, theta0: 3.0 }), "out"), /theta/);
});

test("surface: the shipped presets validate and compile", () => {
  for (const f of ["sc_sphere_shell", "sc_torus_shell"]) {
    const g = JSON.parse(readFileSync(new URL(`../presets/${f}.json`, import.meta.url), "utf8")) as StructureGraph;
    assert.deepEqual(validateGraph(g), [], f);
    const field = compileGraph(g, "out");
    assert.ok(field.bounds.max[0] > field.bounds.min[0], f);
  }
});
