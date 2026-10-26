import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHarmonicDisk } from "../src/graph/harmonic.ts";
import { compileGraph, validateGraph, type StructureGraph } from "../src/graph/graph.ts";

// Superellipse source domain |x/a|^p + |y/b|^p <= 1 (p > 2), centred at (10, 10) with semi-axes (12, 8), onto a disk of radius 14.
const R = 14;
const SE = { centre: [10, 10] as [number, number], semi: [12, 8] as [number, number], power: 4 };
const H = buildHarmonicDisk({ radius: R, superellipse: SE, n: 16 });

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
/** Boundary radius of the superellipse along the ray at angle th (from the centre). */
function rhoSE(th: number): number {
  return (Math.abs(Math.cos(th) / 12) ** 4 + Math.abs(Math.sin(th) / 8) ** 4) ** (-1 / 4);
}
/** The mesh boundary is the inscribed polygon with 2n vertices on the rays: vertex j of an n-ring mesh is at 2 pi j / (2n). */
function vertexSE(n: number, j: number): [number, number] {
  const th = (2 * Math.PI * j) / (2 * n);
  return [10 + rhoSE(th) * Math.cos(th), 10 + rhoSE(th) * Math.sin(th)];
}
/** A random point strictly inside the inscribed polygon (radius up to 0.98 of the boundary ray distance). */
function insideSE(rnd: () => number): [number, number] {
  const th = 2 * Math.PI * rnd(), t = 0.98 * Math.sqrt(rnd());
  return [10 + t * rhoSE(th) * Math.cos(th), 10 + t * rhoSE(th) * Math.sin(th)];
}
function graph(transform: object): StructureGraph {
  return {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: { type: "sc", cellSize: 4, cells: 5, radius: 0.4 } as never },
      { id: "t0", kind: "transform", transform: transform as never },
      { id: "out", kind: "structure", name: "se" },
    ],
    edges: [{ from: "src", to: "t0" }, { from: "t0", to: "out" }],
  };
}
const SE_T = { op: "harmonic_disk", radius: R, superellipse: SE, n: 16 };

test("superellipse: boundary vertices lie on the circle and interior vertices are harmonic", () => {
  assert.ok(H.boundaryError < 1e-12, `boundary error ${H.boundaryError}`);
  assert.ok(H.harmonicResidual < 1e-9, `residual ${H.harmonicResidual}`);
  // Boundary vertices of the 2n-gon (n = 16) map onto the circle. Points on the true outline between vertices lie outside the
  // inscribed polygon, so the test uses vertices only.
  for (const j of [0, 4, 8, 16, 24]) {
    const s = vertexSE(16, j);
    const w = H.forward(s);
    assert.ok(Math.abs(Math.hypot(w[0], w[1]) - R) < 1e-9, `outline vertex ${j}: radius ${Math.hypot(w[0], w[1])}`);
  }
  // The inscribed-polygon sagitta bound: rho_max (1 - cos(pi / 2n)) for n = 16 is about 0.058 mm.
  assert.ok(12 * (1 - Math.cos(Math.PI / 32)) < 0.06);
});

test("superellipse: the map is an embedding (every world triangle has positive area) for n = 8..32", () => {
  for (const n of [8, 16, 24, 32]) {
    const h = buildHarmonicDisk({ radius: R, superellipse: SE, n });
    assert.ok(h.minOrientation > 0, `n=${n}: min orientation ${h.minOrientation}`);
  }
});

test("superellipse: lambda is bounded as the mesh is refined (no corner singularity)", () => {
  const lam = [8, 16, 24, 32].map((n) => buildHarmonicDisk({ radius: R, superellipse: SE, n }).lambda);
  // Converges as n grows: the last refinement changes lambda by less than 2 %, and it stays below 3.6.
  assert.ok(Math.abs(lam[3] - lam[2]) / lam[3] < 0.02, `lambda not converged: ${lam}`);
  assert.ok(Math.max(...lam) < 3.6, `lambda too large: ${lam}`);
});

test("superellipse: inverse(forward(s)) = s for interior points", () => {
  const rnd = rng(3);
  for (let i = 0; i < 400; i++) {
    const s = insideSE(rnd);
    const w = H.forward(s);
    assert.ok(Math.hypot(w[0], w[1]) <= R + 1e-9, "forward maps into the disk");
    const back = H.inverse(w);
    assert.ok(Math.hypot(back[0] - s[0], back[1] - s[1]) < 1e-9, `round trip at ${s}`);
  }
});

test("superellipse: the inverse is lambda-Lipschitz on the disk (random pairs)", () => {
  // The inverse is continuous and piecewise affine on the convex disk, so its Lipschitz constant is the largest
  // singular value over the pieces, which is lambda.
  const rnd = rng(9);
  for (let i = 0; i < 2000; i++) {
    const r1 = R * Math.sqrt(rnd()), t1 = 2 * Math.PI * rnd();
    const r2 = R * Math.sqrt(rnd()), t2 = 2 * Math.PI * rnd();
    const a: [number, number] = [r1 * Math.cos(t1), r1 * Math.sin(t1)];
    const b: [number, number] = [r2 * Math.cos(t2), r2 * Math.sin(t2)];
    const pa = H.inverse(a), pb = H.inverse(b);
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const dsrc = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    assert.ok(dsrc <= H.lambda * dist * (1 + 1e-7) + 1e-9, `pair ${i}: ${dsrc} > ${H.lambda} * ${dist}`);
  }
});

test("superellipse: validation rejects bad parameters and conflicting domains", () => {
  const bad = (t: object) => validateGraph(graph(t)).some((i) => i.code === "bad_param");
  assert.deepEqual(validateGraph(graph(SE_T)), []);
  assert.ok(bad({ ...SE_T, superellipse: { ...SE, power: 2 } }), "power must be > 2");
  assert.ok(bad({ ...SE_T, superellipse: { ...SE, power: NaN } }), "power must be finite");
  assert.ok(bad({ ...SE_T, superellipse: { ...SE, semi: [0, 8] } }), "semi-axes must be > 0");
  assert.ok(bad({ ...SE_T, superellipse: { centre: [0, 0] } }), "semi and power are required");
  assert.ok(bad({ ...SE_T, box: { min: [-5, -5], max: [5, 5] } }), "superellipse and box together");
  assert.ok(bad({ ...SE_T, ellipse: { centre: [0, 0], semi: [1, 1] } }), "superellipse and ellipse together");
  assert.ok(bad({ op: "harmonic_disk", radius: R, n: 16 }), "no domain given");
  assert.throws(() => buildHarmonicDisk({ radius: R, superellipse: { ...SE, power: 1.5 }, n: 8 }), /power/);
});

test("superellipse: the shipped preset validates and compiles to a bounded field", () => {
  const g = JSON.parse(readFileSync(new URL("../presets/sc_superellipse_disk.json", import.meta.url), "utf8")) as StructureGraph;
  assert.deepEqual(validateGraph(g), []);
  const field = compileGraph(g, "out");
  assert.ok(Math.abs(field.bounds.max[0] - R) < 1e-9 && Math.abs(field.bounds.min[1] + R) < 1e-9, "bounds are the disk");
});
