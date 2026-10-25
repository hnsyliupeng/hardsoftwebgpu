import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHarmonicDisk } from "../src/graph/harmonic.ts";
import { compileGraph, validateGraph, type StructureGraph } from "../src/graph/graph.ts";

const R = 8;
const BOX = { min: [-5, -5] as [number, number], max: [5, 5] as [number, number] };
const H = buildHarmonicDisk({ radius: R, box: BOX, n: 16 });

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
      { id: "out", kind: "structure", name: "harm" },
    ],
    edges: [{ from: "src", to: "t0" }, { from: "t0", to: "out" }],
  };
}
const sphere = { type: "sphere", radius: 5 };
const harmT = { op: "harmonic_disk", radius: R, box: BOX, n: 16 };

test("harmonic: boundary vertices lie on the circle and interior vertices are harmonic", () => {
  assert.ok(H.boundaryError < 1e-12, `boundary error ${H.boundaryError}`);
  assert.ok(H.harmonicResidual < 1e-9, `residual ${H.harmonicResidual}`);
  // Boundary vertices (n = 16 grid: spacing 10/16) map onto the circle; edge midpoints between them do not.
  for (const s of [[-5, -5], [5, -5], [5, 5], [-5, 5], [0, -5], [5, 2.5]] as [number, number][]) {
    const w = H.forward(s);
    assert.ok(Math.abs(Math.hypot(w[0], w[1]) - R) < 1e-9, `boundary point ${s}`);
  }
});

test("harmonic: the map is an embedding (every world triangle has positive area)", () => {
  for (const n of [8, 16, 24]) {
    const h = buildHarmonicDisk({ radius: R, box: BOX, n });
    assert.ok(h.minOrientation > 0, `n=${n}: min orientation ${h.minOrientation}`);
  }
});

test("harmonic: inverse(forward(s)) = s, and forward maps the interior into the disk", () => {
  const rnd = rng(3);
  for (let i = 0; i < 400; i++) {
    const s: [number, number] = [-5 + 10 * rnd(), -5 + 10 * rnd()];
    const w = H.forward(s);
    assert.ok(Math.hypot(w[0], w[1]) <= R + 1e-9);
    const back = H.inverse(w);
    assert.ok(Math.hypot(back[0] - s[0], back[1] - s[1]) < 1e-9, `round trip at ${s}`);
  }
});

test("harmonic: lambda bounds the operator norm of the inverse at random world points", () => {
  const rnd = rng(9);
  const h = 1e-7;
  for (let i = 0; i < 200; i++) {
    const r = R * Math.sqrt(rnd()) * 0.98, th = 2 * Math.PI * rnd();
    const w: [number, number] = [r * Math.cos(th), r * Math.sin(th)];
    const dx = H.inverse([w[0] + h, w[1]]), dxm = H.inverse([w[0] - h, w[1]]);
    const dy = H.inverse([w[0], w[1] + h]), dym = H.inverse([w[0], w[1] - h]);
    const J = [
      [(dx[0] - dxm[0]) / (2 * h), (dy[0] - dym[0]) / (2 * h)],
      [(dx[1] - dxm[1]) / (2 * h), (dy[1] - dym[1]) / (2 * h)],
    ];
    const B00 = J[0][0] ** 2 + J[1][0] ** 2, B11 = J[0][1] ** 2 + J[1][1] ** 2, B01 = J[0][0] * J[0][1] + J[1][0] * J[1][1];
    const tr = B00 + B11, det = B00 * B11 - B01 * B01;
    const sigma = Math.sqrt(tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)));
    assert.ok(sigma <= H.lambda * (1 + 1e-6) + 1e-6, `sigma ${sigma} > lambda ${H.lambda} at ${w}`);
  }
});

test("harmonic: zero set of the sphere maps to the zero set of the field; interior value is scaled", () => {
  const g = compileGraph(graph(sphere, harmT), "out");
  for (const a of [0, 0.8, 2.1, 3.5, 5.0]) {
    const s = [5 * Math.cos(a), 5 * Math.sin(a)] as [number, number];
    const w = H.forward(s);
    assert.ok(Math.abs(g.eval(w[0], w[1], 0)) < 1e-9, `zero at angle ${a}`);
  }
  const s = [2, 1] as [number, number];
  const w = H.forward(s);
  const r = Math.hypot(2, 1, 0) - 5;
  assert.ok(Math.abs(g.eval(w[0], w[1], 0) - r / H.lambda) < 1e-9);
});

test("harmonic: 1-Lipschitz on the disk and outside it (clip keeps continuity)", () => {
  const g = compileGraph(graph(sphere, harmT), "out");
  const rnd = rng(21);
  for (let i = 0; i < 400; i++) {
    const p = [-12 + 24 * rnd(), -12 + 24 * rnd(), -4 + 8 * rnd()] as [number, number, number];
    const d = [p[0] + 0.05 * (rnd() - 0.5), p[1] + 0.05 * (rnd() - 0.5), p[2] + 0.05 * (rnd() - 0.5)] as [number, number, number];
    const dist = Math.hypot(p[0] - d[0], p[1] - d[1], p[2] - d[2]);
    const df = Math.abs(g.eval(p[0], p[1], p[2]) - g.eval(d[0], d[1], d[2]));
    assert.ok(df <= dist + 1e-9, `Lipschitz at ${p}: ${df} > ${dist}`);
  }
  // Continuity across the circle, and positive outside it.
  const a = g.eval(R - 1e-7, 0.5, 0), b = g.eval(R + 1e-7, 0.5, 0);
  assert.ok(Math.abs(a - b) < 1e-5, `jump at the circle: ${a} vs ${b}`);
  assert.ok(g.eval(R + 3, 0, 0) >= 3 - 1e-9);
});

test("harmonic: bounds are the disk; validation rejects bad parameters", () => {
  const g = compileGraph(graph(sphere, harmT), "out");
  assert.deepEqual([g.bounds.min[0], g.bounds.max[0], g.bounds.min[1], g.bounds.max[1]], [-R, R, -R, R]);
  assert.deepEqual(validateGraph(graph(sphere, harmT)), []);
  assert.deepEqual(validateGraph(graph(sphere, { op: "harmonic_disk", radius: R, box: BOX })), []); // n optional
  assert.ok(validateGraph(graph(sphere, { op: "harmonic_disk", radius: 0, box: BOX, n: 16 })).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(graph(sphere, { op: "harmonic_disk", radius: R, box: { min: [1, 1], max: [1, 5] }, n: 16 })).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(graph(sphere, { op: "harmonic_disk", radius: R, box: BOX, n: 2 })).some((i) => i.code === "bad_param"));
});

test("harmonic: the shipped preset validates and compiles", () => {
  const g = JSON.parse(readFileSync(new URL("../presets/sc_harmonic_disk.json", import.meta.url), "utf8")) as StructureGraph;
  assert.deepEqual(validateGraph(g), []);
  const f = compileGraph(g, "out");
  assert.ok(f.bounds.max[0] > f.bounds.min[0]);
});
