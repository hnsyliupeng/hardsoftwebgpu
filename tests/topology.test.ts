import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleField, surfaceNets, voxelTopology, meshIntegrals, occupancy, type Grid } from "../src/geometry/grid.ts";
import { tpmsValueGrad, strutLattice, tpmsShell } from "../src/topology/lattice.ts";
import { heteroValue } from "../src/topology/heterogeneous.ts";
import { makeRng } from "../src/util/rng.ts";
import { resolveParams } from "../src/bio/catalog.ts";
import type { Field } from "../src/topology/fields.ts";

const mkField = (min: number, max: number, eval_: (x: number, y: number, z: number) => number, expr = "custom"): Field => ({
  bounds: { min: [min, min, min], max: [max, max, max] },
  eval: eval_,
  expr,
});

/** Euler characteristic and edge count of a closed triangle mesh (surface chi = V - E + F). */
function surfaceChi(indices: Uint32Array, nv: number): number {
  const edges = new Set<string>();
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      edges.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
  return nv - edges.size + indices.length / 3;
}

test("TPMS analytic gradient matches central finite differences", () => {
  const types = ["gyroid", "schwarz_p", "schwarz_d"] as const;
  const e = 1e-6;
  for (const type of types) {
    for (const [X, Y, Z] of [
      [0.3, 1.1, -0.7],
      [2.0, -0.4, 0.9],
      [-1.3, 0.2, 2.5],
    ]) {
      const [F, gx, gy, gz] = tpmsValueGrad(type, X, Y, Z);
      const fx = (tpmsValueGrad(type, X + e, Y, Z)[0] - tpmsValueGrad(type, X - e, Y, Z)[0]) / (2 * e);
      const fy = (tpmsValueGrad(type, X, Y + e, Z)[0] - tpmsValueGrad(type, X, Y - e, Z)[0]) / (2 * e);
      const fz = (tpmsValueGrad(type, X, Y, Z + e)[0] - tpmsValueGrad(type, X, Y, Z - e)[0]) / (2 * e);
      assert.ok(Number.isFinite(F));
      assert.ok(Math.abs(gx - fx) < 1e-5, `${type} dX ${gx} vs ${fx}`);
      assert.ok(Math.abs(gy - fy) < 1e-5, `${type} dY ${gy} vs ${fy}`);
      assert.ok(Math.abs(gz - fz) < 1e-5, `${type} dZ ${gz} vs ${fz}`);
    }
  }
});

test("sphere: solid is a 3-ball (euler 1, handles 0) and its surface has chi = 2", () => {
  const f = mkField(-8, 8, (x, y, z) => Math.hypot(x, y, z) - 5);
  const g: Grid = sampleField(f, 48);
  const topo = voxelTopology(g, occupancy(g));
  assert.equal(topo.components, 1);
  assert.equal(topo.cavities, 0);
  assert.equal(topo.euler, 1);
  assert.equal(topo.handles, 0);
  const m = surfaceNets(g);
  assert.equal(surfaceChi(m.indices, m.positions.length / 3), 2);
  const vol = meshIntegrals(m).volume;
  assert.ok(Math.abs(vol - (4 / 3) * Math.PI * 125) / ((4 / 3) * Math.PI * 125) < 0.03, `sphere volume ${vol}`);
});

test("torus: handles = 1 and surface chi = 0", () => {
  const R = 6, r = 2;
  const f = mkField(-10, 10, (x, y, z) => Math.hypot(Math.hypot(x, y) - R, z) - r);
  const g = sampleField(f, 64);
  const topo = voxelTopology(g, occupancy(g));
  assert.equal(topo.components, 1);
  assert.equal(topo.handles, 1);
  const m = surfaceNets(g);
  assert.equal(surfaceChi(m.indices, m.positions.length / 3), 0);
});

test("simple-cubic strut lattice: solid fraction is below the sum-of-cylinders bound 3*pi*r^2/a^2 by the node overlap", () => {
  const a = 10, r = 1; // r/a = 0.1
  const f = strutLattice({ type: "sc", cellSize: a, cells: [4, 4, 4], radius: r, heterogeneity: null });
  // Monte-Carlo sampling of the interior (2x2x2 cells, away from the build-box truncation).
  // A regular sampling grid aliases against the strut lines, so a seeded random sample is used.
  const rng = makeRng(1);
  const N = 60000;
  let inside = 0;
  for (let t = 0; t < N; t++) if (f.eval(a + 2 * a * rng.next(), a + 2 * a * rng.next(), a + 2 * a * rng.next()) < 0) inside++;
  const frac = inside / N;
  const theory = (3 * Math.PI * r * r) / (a * a);
  // Union <= sum of cylinders; at r/a = 0.1 the six struts meeting at each node overlap by ~12 %
  // (converged value 0.0830 from 400k samples and grid 120^3; see the evidence notes).
  assert.ok(frac <= theory, `fraction ${frac} exceeds sum-of-cylinders bound ${theory}`);
  assert.ok(frac >= 0.85 * theory && frac <= 0.92 * theory, `fraction ${frac} outside the expected node-overlap band of ${theory}`);
});

test("TPMS shell: the solid fraction of a gyroid sheet is in a plausible band", () => {
  const f = tpmsShell({ type: "gyroid", cellSize: 5, cells: [2, 2, 2], thickness: 0.6 });
  let inside = 0, total = 0;
  for (let i = 0; i < 30; i++)
    for (let j = 0; j < 30; j++)
      for (let k = 0; k < 30; k++) {
        total++;
        if (f.eval((10 * (i + 0.5)) / 30, (10 * (j + 0.5)) / 30, (10 * (k + 0.5)) / 30) < 0) inside++;
      }
  const frac = inside / total;
  assert.ok(frac > 0.15 && frac < 0.5, `gyroid fraction ${frac}`);
});

test("heteroValue: endpoints, sin midpoint and parabola peak", () => {
  assert.ok(Math.abs(heteroValue("linear", 0, 0.3, 0.9) - 0.3) < 1e-12);
  assert.ok(Math.abs(heteroValue("linear", 1, 0.3, 0.9) - 0.9) < 1e-12);
  assert.ok(Math.abs(heteroValue("linear", 0.5, 0.3, 0.9) - 0.6) < 1e-12);
  assert.equal(heteroValue("uniform", 0.7, 0.5, 0.5), 0.5);
  assert.ok(Math.abs(heteroValue("sin", 0.5, 0.2, 0.8) - 0.5) < 1e-12);
  assert.ok(Math.abs(heteroValue("parabola", 0.5, 0.2, 0.8) - (0.8 + 0.2)) < 1e-12);
  // Values are clamped to the unit interval parameter.
  assert.ok(Math.abs(heteroValue("linear", -3, 0.3, 0.9) - 0.3) < 1e-12);
});

test("rng is deterministic per seed and bounded to [0,1)", () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const xs = Array.from({ length: 50 }, () => a.next());
  const ys = Array.from({ length: 50 }, () => b.next());
  const zs = Array.from({ length: 50 }, () => c.next());
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, zs);
  assert.ok(xs.every((v) => v >= 0 && v < 1));
});

test("resolveParams clamps to catalog ranges and reports what it changed", () => {
  const r = resolveParams("helical_generic", { num_plies: 50, rotation: 1 });
  assert.equal(r.values.num_plies, 15);
  assert.equal(r.values.rotation, 3);
  assert.ok(r.clamped.length >= 2);
  const d = resolveParams("helical_generic", {});
  assert.ok(d.defaulted.includes("num_plies"));
});
