import { test } from "node:test";
import assert from "node:assert/strict";
import { unitCellSegments, scInstancedValue, scShaderSource } from "../src/topology/instanced.ts";
import { strutLattice } from "../src/topology/lattice.ts";

const A = 4, R = 0.4, N = 4; // 4 x 4 x 4 cells of 4 mm

// Brute force over every cell of the lattice (no neighbourhood assumption).
function brute(p: [number, number, number]): number {
  let best = Infinity;
  const segs = unitCellSegments();
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    for (const [s0, s1] of segs) {
      const a = [i * A + s0[0] * A, j * A + s0[1] * A, k * A + s0[2] * A];
      const b = [i * A + s1[0] * A, j * A + s1[1] * A, k * A + s1[2] * A];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2));
      const d = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]) - R;
      if (d < best) best = d;
    }
  }
  return best;
}

let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * (N * A - 1) + 0.5;

test("instanced: unit cell is the 12 cube edges of length a", () => {
  const segs = unitCellSegments();
  assert.equal(segs.length, 12);
  for (const [s0, s1] of segs) {
    const L = Math.hypot(s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]);
    assert.ok(Math.abs(L - 1) < 1e-12, "unit-cube edge length 1");
  }
});

test("instanced: equals brute force wherever the nearest strut is within a - r, and agrees in sign everywhere", () => {
  const lat = { a: A, r: R, cells: [N, N, N] as [number, number, number] };
  for (let n = 0; n < 400; n++) {
    const p: [number, number, number] = [rnd(), rnd(), rnd()];
    const want = brute(p), got = scInstancedValue(p, lat);
    if (want < A - R) assert.ok(Math.abs(got - want) < 1e-9, `point ${p}: ${got} vs ${want}`);
    assert.equal(got < 0, want < 0, `sign at ${p}`);
  }
});

test("instanced: matches strutLattice (the existing SC field) at random interior points", () => {
  const f = strutLattice({ type: "sc", cellSize: A, cells: [N, N, N], radius: R });
  const lat = { a: A, r: R, cells: [N, N, N] as [number, number, number] };
  for (let n = 0; n < 300; n++) {
    const p: [number, number, number] = [rnd(), rnd(), rnd()];
    assert.ok(Math.abs(scInstancedValue(p, lat) - f.eval(p[0], p[1], p[2])) < 1e-9, `point ${p}`);
  }
});

test("instanced: the WGSL shader carries exactly the reference segment table", () => {
  const src = scShaderSource();
  const nums = (name: string) => {
    const start = src.indexOf(`const ${name} = array<vec3<f32>, 12>(`);
    assert.ok(start >= 0, `${name} present`);
    const body = src.slice(start, src.indexOf(");", start));
    return [...body.matchAll(/vec3<f32>\(([^)]*)\)/g)].map((m) => m[1].split(",").map((x) => Number(x.trim())));
  };
  const segs = unitCellSegments();
  assert.deepEqual(nums("SEG0"), segs.map((s) => [...s[0]]));
  assert.deepEqual(nums("SEG1"), segs.map((s) => [...s[1]]));
  assert.ok(src.includes("@compute @workgroup_size(4, 4, 4)"));
  assert.ok(src.includes("fn main(@builtin(global_invocation_id) id: vec3<u32>)"));
});

test("instanced: CPU grid reference uses the index order of the WGSL kernel", async () => {
  const { cpuScGrid } = await import("../web/compute/scField.ts");
  const { SC_FIELD_WGSL } = await import("../web/compute/sc_field_wgsl.ts");
  const lat = { a: A, r: R, cells: [N, N, N] as [number, number, number] };
  const g = { origin: [0.3, 0.7, 1.1] as [number, number, number], spacing: 1.7, dims: [5, 4, 3] as [number, number, number], lattice: lat };
  const grid = cpuScGrid(g);
  for (const [i, j, k] of [[0, 0, 0], [4, 3, 2], [2, 1, 1]]) {
    const p: [number, number, number] = [g.origin[0] + g.spacing * i, g.origin[1] + g.spacing * j, g.origin[2] + g.spacing * k];
    // The grid is stored as Float32, so compare at float32 precision (about 1e-7 at these magnitudes).
    assert.ok(Math.abs(grid[i + 5 * (j + 4 * k)] - scInstancedValue(p, lat)) < 1e-6);
  }
  assert.equal(SC_FIELD_WGSL, scShaderSource(), "generated WGSL module matches the reference (regenerate with scripts/gen_sc_shader.ts)");
});
