import { test } from "node:test";
import assert from "node:assert/strict";
import { fractalStruts, fractalField, type FractalSpec } from "../src/graph/fractal.ts";
import { compileGraph, validateGraph, type StructureGraph } from "../src/graph/graph.ts";

const spec = (depth: number, extra: Partial<FractalSpec> = {}): FractalSpec =>
  ({ size: 24, divisor: 2, depth, radius: 0.6, radiusRatio: 0.7, ...extra });

// Brute-force reference: min over all struts of (distance - radius).
function brute(s: FractalSpec, p: [number, number, number]): number {
  let best = Infinity;
  for (const st of fractalStruts(s)) {
    const ab = st.b.map((v, i) => v - st.a[i]) as [number, number, number];
    const ap = p.map((v, i) => v - st.a[i]) as [number, number, number];
    const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2));
    const d = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
    best = Math.min(best, d - st.r);
  }
  return best;
}

test("fractal: strut counts 12, 108, 876 for depth 1, 2, 3 (d = 2), radii shrink by the ratio", () => {
  assert.equal(fractalStruts(spec(1)).length, 12);
  assert.equal(fractalStruts(spec(2)).length, 108);
  assert.equal(fractalStruts(spec(3)).length, 876);
  const radii = [...new Set(fractalStruts(spec(3)).map((s) => s.r))].sort((a, b) => b - a);
  assert.equal(radii.length, 3);
  assert.ok(Math.abs(radii[1] / radii[0] - 0.7) < 1e-12);
  assert.ok(Math.abs(radii[2] / radii[0] - 0.49) < 1e-12);
});

test("fractal: tiled cubes draw tiles^3 copies; bucket field equals brute force on the tiled extent", () => {
  const t = spec(2, { tiles: 2 });
  assert.equal(fractalStruts(t).length, 8 * 108);
  const f = fractalField(t);
  assert.deepEqual(f.bounds.max.map((v) => Math.round(v * 1e6) / 1e6), [48.6, 48.6, 48.6]);
  // Bucket width is size / divisor^depth = 6; clamp T = w - r0.
  const w = 24 / 4, T = w - 0.6;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 48;
  for (let i = 0; i < 300; i++) {
    const p: [number, number, number] = [rnd(), rnd(), rnd()];
    const want = Math.min(brute(t, p), T);
    assert.ok(Math.abs(f.eval(p[0], p[1], p[2]) - want) < 1e-9, `tiled point ${p}`);
  }
});

test("fractal: tiles default to 1 (unchanged) and tiles outside 1..4 are reported", () => {
  assert.equal(fractalStruts(spec(2, { tiles: 1 })).length, fractalStruts(spec(2)).length);
  const g = (tiles: number): StructureGraph => ({
    version: 1,
    nodes: [
      { id: "fr", kind: "field", source: { type: "fractal_cube", size: 24, divisor: 2, depth: 2, radius: 0.6, radiusRatio: 0.7, tiles } as never },
      { id: "out", kind: "structure", name: "t" },
    ],
    edges: [{ from: "fr", to: "out" }],
  });
  assert.deepEqual(validateGraph(g(2)), []);
  assert.ok(validateGraph(g(0)).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(g(5)).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(g(1.5)).some((i) => i.code === "bad_param"));
});

test("fractal: bucket field equals brute force within the clamp; exact on a level-0 edge", () => {
  const s = spec(3);
  const f = fractalField(s);
  // Point on the level-0 edge x-axis at y = z = 0: distance 0, so f = -r0 (the largest radius wins).
  assert.ok(Math.abs(f.eval(12, 0, 0) - -0.6) < 1e-12);
  // Cube centre is a vertex of corner subcubes at levels 1 and 2; the minimum takes the largest radius (level 1).
  assert.ok(Math.abs(f.eval(12, 12, 12) - -0.6 * 0.7) < 1e-9);
  // Random interior points: bucket value equals min(brute, T) with T = w - r0.
  const w = 24 / 8, T = w - 0.6;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 24;
  for (let i = 0; i < 400; i++) {
    const p: [number, number, number] = [rnd(), rnd(), rnd()];
    const want = Math.min(brute(s, p), T);
    assert.ok(Math.abs(f.eval(p[0], p[1], p[2]) - want) < 1e-9, `point ${p}`);
  }
});

test("fractal: 1-Lipschitz (min of distance functions, clamped)", () => {
  const f = fractalField(spec(2));
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 24;
  for (let i = 0; i < 300; i++) {
    const p = [rnd(), rnd(), rnd()], q = p.map((v) => v + (rnd() - 12) * 0.01);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    assert.ok(Math.abs(f.eval(p[0], p[1], p[2]) - f.eval(q[0], q[1], q[2])) <= d + 1e-9);
  }
});

test("fractal: graph source validates and compiles; bad parameters are reported", () => {
  const g: StructureGraph = {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: { type: "fractal_cube", size: 24, divisor: 2, depth: 2, radius: 0.6, radiusRatio: 0.7 } as never },
      { id: "out", kind: "structure", name: "fractal" },
    ],
    edges: [{ from: "src", to: "out" }],
  };
  assert.deepEqual(validateGraph(g), []);
  const field = compileGraph(g, "out");
  assert.ok(field.eval(12, 0, 0) < 0);
  const bad = structuredClone(g);
  (bad.nodes[0] as { source: object }).source = { type: "fractal_cube", size: 24, divisor: 2, depth: 4, radius: 0.6, radiusRatio: 0.7 };
  assert.ok(validateGraph(bad).some((i) => i.code === "bad_param"));
  const thick = structuredClone(g);
  (thick.nodes[0] as { source: object }).source = { type: "fractal_cube", size: 24, divisor: 2, depth: 3, radius: 3.5, radiusRatio: 0.7 };
  assert.ok(validateGraph(thick).some((i) => i.code === "bad_param"));
});
