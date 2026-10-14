import { test } from "node:test";
import assert from "node:assert/strict";
import { smin, cacheField, buildCoupled } from "../src/topology/coupled.ts";
import { sampleField, surfaceNets } from "../src/geometry/grid.ts";
import type { Field } from "../src/topology/fields.ts";

function openEdges(indices: Uint32Array): number {
  const m = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
  let open = 0;
  for (const v of m.values()) if (v === 1) open++;
  return open;
}

test("smooth minimum is below the hard minimum and equals it away from the blend", () => {
  for (const [a, b] of [[0.2, 0.3], [-1, 0.5], [1, 1.2]]) {
    assert.ok(smin(a, b, 0.5) <= Math.min(a, b) + 1e-12);
  }
  assert.equal(smin(-1, 2, 0.5), -1);
  assert.equal(smin(-1, 2, 0), -1);
});

test("trilinear cache reproduces the field to 1e-2 mm on random points", () => {
  const f: Field = {
    bounds: { min: [0, 0, 0], max: [20, 20, 20] },
    expr: "smooth test field",
    eval: (x, y, z) => Math.sin(x / 3) * Math.cos(y / 4) + z / 10 - 1,
  };
  const c = cacheField(f, 160);
  let s = 5;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 300; i++) {
    const x = rnd() * 20, y = rnd() * 20, z = rnd() * 20;
    assert.ok(Math.abs(c.eval(x, y, z) - f.eval(x, y, z)) < 1e-2);
  }
});

test("regression: a solid whose caps stick out 0.4 mm past the bounds is closed inside the grid", () => {
  // Strut caps and sheet edges can extend a fraction of a millimetre past the build box. A 2-cell
  // border at 192 cells (0.21 mm) truncated them and left open surface-net edges; the border is now
  // at least 1 mm, so a 0.4 mm overhang is closed.
  const f: Field = {
    bounds: { min: [0, 0, 0], max: [20, 20, 20] },
    expr: "box with 0.4 mm overhang on every face",
    eval: (x, y, z) => {
      const h = 10.4;
      const qx = Math.abs(x - 10) - h, qy = Math.abs(y - 10) - h, qz = Math.abs(z - 10) - h;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
    },
  };
  const mesh = surfaceNets(sampleField(f, 192));
  assert.equal(openEdges(mesh.indices), 0);
});

test("R3 twist is a point map: solid fraction is nearly independent of the twist angle", () => {
  const frac = (tw: number) => {
    const c = buildCoupled({ round: "R3", params: { twist_deg: tw, skin_mm: 0 } }, 20);
    let s = 0, n = 0, seed = 9;
    for (let i = 0; i < 6000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const x = (seed / 4294967296) * 20;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const y = (seed / 4294967296) * 20;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const z = (seed / 4294967296) * 20;
      n++;
      if (c.field.eval(x, y, z) < 0) s++;
    }
    return s / n;
  };
  const f0 = frac(0), f90 = frac(90);
  assert.ok(f0 > 0.1 && f0 < 0.3);
  assert.ok(Math.abs(f0 - f90) < 0.02, `twist changed solid fraction: ${f0} vs ${f90}`);
});
