import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHarmonicDisk } from "../src/graph/harmonic.ts";
import { validateGraph, type StructureGraph } from "../src/graph/graph.ts";

const R = 14;
type P = [number, number];

// L-shape with a reflex corner at (10, 10): concave, star-shaped about (5, 5).
const L: P[] = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
const L_CENTRE: P = [5, 5];
// Non-star-shaped C-shape: the notch is open to the right, so no single point sees every edge.
const C: P[] = [[0, 0], [20, 0], [20, 4], [4, 4], [4, 16], [20, 16], [20, 20], [0, 20]];

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Ray-casting point-in-polygon test (strict interior for points away from the boundary). */
function inside(poly: P[], p: P): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Random points in the L-shape, kept away from its boundary. */
function lPoints(seed: number, count: number): P[] {
  const rnd = rng(seed);
  const out: P[] = [];
  while (out.length < count) {
    const p: P = [20 * rnd(), 20 * rnd()];
    if (inside(L, p) && Math.min(...L.map((_, i) => distToSeg(p, L[i], L[(i + 1) % L.length]))) > 0.2) out.push(p);
  }
  return out;
}

function distToSeg(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

test("polygon: the L-shape map is an embedding with boundary on the circle and harmonic interior", () => {
  const H = buildHarmonicDisk({ radius: R, polygon: { vertices: L, centre: L_CENTRE }, n: 16 });
  assert.ok(H.boundaryError < 1e-12, `boundary error ${H.boundaryError}`);
  assert.ok(H.harmonicResidual < 1e-9, `residual ${H.harmonicResidual}`);
  assert.ok(H.minOrientation > 0, `min orientation ${H.minOrientation}`);
  assert.ok(Number.isFinite(H.lambda) && H.lambda >= 1, `lambda ${H.lambda}`);
  // Every polygon vertex, including the reflex corner, lies on the circle.
  for (const v of L) {
    const w = H.forward(v);
    assert.ok(Math.abs(Math.hypot(w[0], w[1]) - R) < 1e-9, `vertex ${v} not on circle`);
  }
});

test("polygon: inverse(forward(s)) = s inside the L-shape, and the image stays in the polygon", () => {
  const H = buildHarmonicDisk({ radius: R, polygon: { vertices: L, centre: L_CENTRE }, n: 16 });
  for (const s of lPoints(5, 300)) {
    const w = H.forward(s);
    assert.ok(Math.hypot(w[0], w[1]) <= R + 1e-9, `image of ${s} outside the disk`);
    const back = H.inverse(w);
    assert.ok(Math.hypot(back[0] - s[0], back[1] - s[1]) < 1e-9, `round trip at ${s}`);
    assert.ok(inside(L, back), `inverse of a disk point ${w} is outside the L-shape`);
  }
});

test("polygon: a clockwise vertex list gives the same map as counter-clockwise", () => {
  const ccw = buildHarmonicDisk({ radius: R, polygon: { vertices: L, centre: L_CENTRE }, n: 12 });
  const cw = buildHarmonicDisk({ radius: R, polygon: { vertices: [...L].reverse(), centre: L_CENTRE }, n: 12 });
  for (const s of lPoints(7, 40)) {
    const a = ccw.forward(s), b = cw.forward(s);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, `orientation changes the map at ${s}`);
  }
});

test("polygon: a centre at a reflex vertex is rejected (the vertex has no angular step)", () => {
  assert.throws(() => buildHarmonicDisk({ radius: R, polygon: { vertices: L, centre: [10, 10] }, n: 8 }), /not star-shaped/);
});

test("polygon: an explicit centre must be a star-shaped kernel point (C-shape with its default centre is triangulated instead)", () => {
  assert.throws(() => buildHarmonicDisk({ radius: R, polygon: { vertices: C, centre: [11, 10] }, n: 8 }), /not star-shaped/);
});

test("polygon: C-shape (not star-shaped) is mapped by ear-clipping triangulation: embedding, boundary, round trip", () => {
  const H = buildHarmonicDisk({ radius: R, polygon: { vertices: C }, n: 16 });
  assert.ok(H.boundaryError < 1e-12, `boundary error ${H.boundaryError}`);
  assert.ok(H.harmonicResidual < 1e-9, `residual ${H.harmonicResidual}`);
  assert.ok(H.minOrientation > 0, `min orientation ${H.minOrientation}`);
  assert.ok(Number.isFinite(H.lambda) && H.lambda >= 1, `lambda ${H.lambda}`);
  for (const v of C) {
    const w = H.forward(v);
    assert.ok(Math.abs(Math.hypot(w[0], w[1]) - R) < 1e-9, `vertex ${v} not on circle`);
  }
  const rnd = rng(13);
  let checked = 0;
  while (checked < 200) {
    const s: P = [20 * rnd(), 20 * rnd()];
    if (!inside(C, s) || Math.min(...C.map((_, i) => distToSeg(s, C[i], C[(i + 1) % C.length]))) < 0.2) continue;
    checked++;
    const w = H.forward(s);
    assert.ok(Math.hypot(w[0], w[1]) <= R + 1e-9, `image of ${s} outside the disk`);
    const back = H.inverse(w);
    assert.ok(Math.hypot(back[0] - s[0], back[1] - s[1]) < 1e-9, `round trip at ${s}`);
    assert.ok(inside(C, back), `inverse of ${w} is outside the C-shape`);
  }
});

test("polygon: the L-shape without a centre (triangulated path) gives the same kind of embedding", () => {
  const H = buildHarmonicDisk({ radius: R, polygon: { vertices: L }, n: 12 });
  assert.ok(H.minOrientation > 0 && H.boundaryError < 1e-12);
  for (const s of lPoints(21, 60)) {
    const back = H.inverse(H.forward(s));
    assert.ok(Math.hypot(back[0] - s[0], back[1] - s[1]) < 1e-9, `round trip at ${s}`);
  }
});

test("polygon: degenerate inputs are rejected", () => {
  assert.throws(() => buildHarmonicDisk({ radius: R, polygon: { vertices: [[0, 0], [1, 0]] }, n: 8 }), /at least 3/);
  assert.throws(() => buildHarmonicDisk({ radius: R, polygon: { vertices: [[0, 0], [1, 0], [2, 0]] }, n: 8 }), /zero area/);
  assert.throws(() => buildHarmonicDisk({ radius: R, polygon: { vertices: [[0, 0], [5, 0], [5, 0], [0, 5]] }, n: 8 }), /repeated vertex/);
});

function polyGraph(transform: object): StructureGraph {
  return {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: { type: "sc", cellSize: 4, cells: 5, radius: 0.4 } as never },
      { id: "t0", kind: "transform", transform: transform as never },
      { id: "out", kind: "structure", name: "poly" },
    ],
    edges: [{ from: "src", to: "t0" }, { from: "t0", to: "out" }],
  };
}

test("polygon: validateGraph accepts a polygon domain and rejects bad or mixed domains", () => {
  const good = { op: "harmonic_disk", radius: R, polygon: { vertices: L, centre: L_CENTRE }, n: 12 };
  assert.deepEqual(validateGraph(polyGraph(good)), []);
  const bad = (t: object) => validateGraph(polyGraph(t)).some((i) => i.code === "bad_param");
  assert.ok(bad({ ...good, polygon: { vertices: [[0, 0], [1, 1]] } }), "two vertices");
  assert.ok(bad({ ...good, polygon: { vertices: L, centre: [1] } }), "centre not a point");
  assert.ok(bad({ ...good, box: { min: [0, 0], max: [1, 1] } }), "polygon together with box");
});

test("polygon: the shipped L-shape and star presets load, validate and compile", async () => {
  const { loadPreset } = await import("../src/graph/presets.ts");
  const { compileGraph, structureIds } = await import("../src/graph/graph.ts");
  for (const name of ["sc_polygon_l", "sc_polygon_star"]) {
    const g = loadPreset(new URL(`../presets/${name}.json`, import.meta.url).pathname);
    const f = compileGraph(g, structureIds(g)[0]);
    assert.ok(Number.isFinite(f.eval(10, 10, 5)), `${name} evaluates`);
  }
});
