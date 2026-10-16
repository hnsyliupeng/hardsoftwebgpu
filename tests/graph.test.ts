import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateGraph, compileGraph, type StructureGraph, type TransformSpec } from "../src/graph/graph.ts";
import { GraphHistory } from "../src/graph/history.ts";
import { savePreset, loadPreset } from "../src/graph/presets.ts";

function chain(transforms: TransformSpec[], source: object = { type: "sphere", radius: 5 }): StructureGraph {
  const nodes: StructureGraph["nodes"] = [{ id: "src", kind: "field", source: source as never }];
  const edges: StructureGraph["edges"] = [];
  let prev = "src";
  transforms.forEach((t, i) => {
    const id = `t${i}`;
    nodes.push({ id, kind: "transform", transform: t });
    edges.push({ from: prev, to: id });
    prev = id;
  });
  nodes.push({ id: "out", kind: "structure", name: "test" });
  edges.push({ from: prev, to: "out" });
  return { version: 1, nodes, edges };
}

function baseField() {
  return compileGraph(chain([]), "out");
}

const pts: [number, number, number][] = [
  [0.3, -1.2, 2.1],
  [-2.5, 0.7, -0.4],
  [1.9, 2.2, 3.3],
  [-0.1, 0.0, 4.5],
];

test("valid graph has no issues", () => {
  assert.deepEqual(validateGraph(chain([{ op: "bend", k: 0.1 }])), []);
});

test("cycle, missing structure, bad arity, unknown op and bad parameters are reported", () => {
  const cyc: StructureGraph = {
    version: 1,
    nodes: [
      { id: "a", kind: "transform", transform: { op: "bend", k: 0.1 } },
      { id: "b", kind: "transform", transform: { op: "bend", k: 0.1 } },
      { id: "out", kind: "structure", name: "x" },
    ],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "b", to: "out" }],
  };
  assert.ok(validateGraph(cyc).some((i) => i.code === "cycle"));
  const noStruct: StructureGraph = { version: 1, nodes: [{ id: "s", kind: "field", source: { type: "sphere", radius: 1 } }], edges: [] };
  assert.ok(validateGraph(noStruct).some((i) => i.code === "no_structure"));
  const unknownOp = chain([{ op: "twist", k: 1 } as never]);
  assert.ok(validateGraph(unknownOp).some((i) => i.code === "unknown_transform"));
  const badStretch = chain([{ op: "stretch", factors: [1, 0, 1] }]);
  assert.ok(validateGraph(badStretch).some((i) => i.code === "bad_param"));
  const badSc = chain([], { type: "sc", cellSize: 4, cells: 5, radius: 3 });
  assert.ok(validateGraph(badSc).some((i) => i.code === "bad_param"));
  const twoInputs: StructureGraph = chain([{ op: "bend", k: 0.1 }]);
  twoInputs.edges.push({ from: "src", to: "t0" });
  assert.ok(validateGraph(twoInputs).some((i) => i.code === "arity" || i.code === "fanout"));
});

test("rotation: f'(R p) = f(p) for a rotation about z", () => {
  const th = 0.7;
  const f = compileGraph(chain([{ op: "rotate", axis: [0, 0, 1], angle: th }]), "out");
  const b = baseField();
  for (const [x, y, z] of pts) {
    // R(theta) p about z; the composed field must match the base field at the unrotated point.
    const Rx = Math.cos(th) * x - Math.sin(th) * y, Ry = Math.sin(th) * x + Math.cos(th) * y;
    assert.ok(Math.abs(f.eval(Rx, Ry, z) - b.eval(x, y, z)) < 1e-9);
  }
});

test("bend: on the z axis the Jacobian is the identity, so f'(B p) = f(p) there", () => {
  const k = 0.05;
  const f = compileGraph(chain([{ op: "bend", k }]), "out");
  const b = baseField();
  for (const z of [-3.1, 0.4, 2.7, 9.0]) {
    // Points on the axis are fixed by the bend rotation: f'(0,0,z) = f(0,0,z) / sigma with sigma = 1.
    assert.ok(Math.abs(f.eval(0, 0, z) - b.eval(0, 0, z)) < 1e-9);
  }
});

// sigma_max of the inverse map, power iteration on J^T J (independent of the module's code).
function sigmaOf(A: number[][]): number {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let r = 0; r < 3; r++) M[i][j] += A[r][i] * A[r][j];
  let v = [1, 1, 1], lambda = 0;
  for (let it = 0; it < 200; it++) {
    const w = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) w[i] += M[i][j] * v[j];
    const n = Math.hypot(w[0], w[1], w[2]);
    lambda = n;
    v = [w[0] / n, w[1] / n, w[2] / n];
  }
  return Math.sqrt(lambda);
}

test("stretch and shear: f'(M p) * sigma = f(p), with sigma the largest singular value of M^-1", () => {
  const b = baseField();
  const fac = [1.5, 0.8, 2];
  const st = compileGraph(chain([{ op: "stretch", factors: fac as [number, number, number] }]), "out");
  // M^-1 = diag(1/1.5, 1/0.8, 1/2): sigma_max = 1/0.8, so f' = f * 0.8 at every point.
  const sigSt = sigmaOf([[1 / 1.5, 0, 0], [0, 1 / 0.8, 0], [0, 0, 1 / 2]]);
  assert.ok(Math.abs(sigSt - 1 / 0.8) < 1e-9);
  // Shear: forward x' = x + a y + b z, y' = y + c z. Inverse matrix (rows): [1,-a,ac-b],[0,1,-c],[0,0,1].
  const a = 0.4, bb = -0.3, c = 0.5;
  const sh = compileGraph(chain([{ op: "shear", a, b: bb, c }]), "out");
  const sigSh = sigmaOf([[1, -a, a * c - bb], [0, 1, -c], [0, 0, 1]]);
  for (const [x, y, z] of pts) {
    assert.ok(Math.abs(st.eval(1.5 * x, 0.8 * y, 2 * z) - b.eval(x, y, z) / sigSt) < 1e-9);
    const wx = x + a * y + bb * z, wy = y + c * z, wz = z;
    assert.ok(Math.abs(sh.eval(wx, wy, wz) - b.eval(x, y, z) / sigSh) < 1e-9);
  }
});

test("gradient: f' = f - slope*(x_axis - centre) exactly", () => {
  const b = baseField();
  const g = compileGraph(chain([{ op: "gradient", axis: "z", slope: 0.02, centre: 10 }]), "out");
  for (const [x, y, z] of pts) assert.ok(Math.abs(g.eval(x, y, z) - (b.eval(x, y, z) - 0.02 * (z - 10))) < 1e-12);
});

test("bounds of a bent field contain the bent images of the input box", () => {
  const b = baseField();
  const f = compileGraph(chain([{ op: "bend", k: 0.3 }]), "out");
  // Sample the input box densely; each point's bent image must lie inside the output bounds.
  const { min, max } = f.bounds as { min: number[]; max: number[] };
  const bm = b.bounds as { min: number[]; max: number[] };
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++)
      for (let k = 0; k <= 8; k++) {
        const x = bm.min[0] + ((bm.max[0] - bm.min[0]) * i) / 8;
        const y = bm.min[1] + ((bm.max[1] - bm.min[1]) * j) / 8;
        const z = bm.min[2] + ((bm.max[2] - bm.min[2]) * k) / 8;
        const th = 0.3 * z, c = Math.cos(th), s = Math.sin(th);
        const q = [c * x - s * y, s * x + c * y, z];
        for (let a = 0; a < 3; a++) {
          assert.ok(q[a] >= min[a] - 1e-9 && q[a] <= max[a] + 1e-9, `axis ${a}: ${q[a]} outside [${min[a]}, ${max[a]}]`);
        }
      }
});

test("history: commit, undo, redo, and a new commit clears redo", () => {
  const g0 = chain([{ op: "bend", k: 0.1 }]);
  const h = new GraphHistory(g0);
  const g1 = chain([{ op: "bend", k: 0.2 }]);
  h.commit(g1);
  assert.equal((h.present.nodes[1] as { transform: { k: number } }).transform.k, 0.2);
  assert.ok(h.undo());
  assert.equal((h.present.nodes[1] as { transform: { k: number } }).transform.k, 0.1);
  assert.ok(h.redo());
  assert.equal((h.present.nodes[1] as { transform: { k: number } }).transform.k, 0.2);
  h.undo();
  h.commit(chain([{ op: "bend", k: 0.3 }]));
  assert.equal(h.canRedo, false);
  assert.throws(() => h.commit({ version: 1, nodes: [], edges: [] } as StructureGraph));
});

test("preset save/load round trip and the repository presets validate", () => {
  const dir = mkdtempSync(join(tmpdir(), "preset-"));
  try {
    const g = chain([{ op: "rotate", axis: [1, 1, 1], angle: 0.3 }]);
    const p = join(dir, "p.json");
    savePreset(p, g);
    assert.deepEqual(loadPreset(p), g);
    for (const f of ["sc_rotated_gradient.json", "gyroid_bent_sheared.json"]) {
      const loaded = loadPreset(join(process.cwd(), "presets", f));
      assert.ok(compileGraph(loaded, "out").expr.length > 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Lipschitz normalisation: for a base SDF (sphere, |grad| = 1), every transformed field must stay
// 1-Lipschitz, so that thicknesses and offsets keep their meaning. Un-normalised f o M^-1 fails for bend.
test("bend, stretch and shear keep a sphere SDF 1-Lipschitz", () => {
  const specs: TransformSpec[][] = [
    [{ op: "bend", k: 0.3 }],
    [{ op: "stretch", factors: [1.5, 0.8, 2] }],
    [{ op: "shear", a: 0.4, b: -0.3, c: 0.5 }],
  ];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 20 - 10;
  for (const spec of specs) {
    const f = compileGraph(chain(spec, { type: "sphere", radius: 5 }), "out");
    for (let n = 0; n < 400; n++) {
      const p = [rnd(), rnd(), rnd()], q = [p[0] + 0.05 * rnd(), p[1] + 0.05 * rnd(), p[2] + 0.05 * rnd()];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      const df = Math.abs(f.eval(p[0], p[1], p[2]) - f.eval(q[0], q[1], q[2]));
      assert.ok(df <= d * 1.02 + 1e-9, `${spec[0].op}: |df|=${df} > |dp|=${d}`);
    }
  }
});

test("radial, polynomial and gradient offsets are exact: f' = f - g", () => {
  const b = baseField();
  const rad = compileGraph(chain([{ op: "radial", slope: 0.03, centre: [1, -2, 0.5], radius0: 4 }]), "out");
  const poly = compileGraph(chain([{ op: "polynomial", axis: "y", coeffs: [0.5, -0.1, 0.02] }]), "out");
  for (const [x, y, z] of pts) {
    const r = Math.hypot(x - 1, y + 2, z - 0.5);
    assert.ok(Math.abs(rad.eval(x, y, z) - (b.eval(x, y, z) - 0.03 * (r - 4))) < 1e-12);
    assert.ok(Math.abs(poly.eval(x, y, z) - (b.eval(x, y, z) - (0.5 - 0.1 * y + 0.02 * y * y))) < 1e-12);
  }
});

test("noise: deterministic for a seed, bounded by the amplitude, Lipschitz, seed-dependent", () => {
  const A = 0.2, F = 0.3;
  const n1 = compileGraph(chain([{ op: "noise", amplitude: A, frequency: F, seed: 7 }]), "out");
  const n2 = compileGraph(chain([{ op: "noise", amplitude: A, frequency: F, seed: 7 }]), "out");
  const n3 = compileGraph(chain([{ op: "noise", amplitude: A, frequency: F, seed: 8 }]), "out");
  const b = baseField();
  let differs = false;
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 40 - 20;
  for (let i = 0; i < 300; i++) {
    const p = [rnd(), rnd(), rnd()];
    const g1 = b.eval(p[0], p[1], p[2]) - n1.eval(p[0], p[1], p[2]);
    assert.ok(Math.abs(g1) <= A + 1e-12, `offset ${g1} exceeds amplitude ${A}`);
    assert.equal(n1.eval(p[0], p[1], p[2]), n2.eval(p[0], p[1], p[2]));
    if (Math.abs(n1.eval(p[0], p[1], p[2]) - n3.eval(p[0], p[1], p[2])) > 1e-9) differs = true;
    const q = [p[0] + 1e-3, p[1] - 1e-3, p[2] + 1e-3];
    const dg = Math.abs((b.eval(p[0], p[1], p[2]) - n1.eval(p[0], p[1], p[2])) - (b.eval(q[0], q[1], q[2]) - n1.eval(q[0], q[1], q[2])));
    assert.ok(dg <= 7 * A * F * Math.hypot(1e-3, 1e-3, 1e-3) + 1e-9, `noise not Lipschitz: ${dg}`);
  }
  assert.ok(differs, "different seeds should give different noise");
});

test("validation: radial centre, polynomial axis, noise frequency", () => {
  assert.ok(validateGraph(chain([{ op: "radial", slope: 1, centre: [0, 0] as never, radius0: 1 }])).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(chain([{ op: "polynomial", axis: "w" as never, coeffs: [1] }])).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(chain([{ op: "noise", amplitude: 0.1, frequency: 0, seed: 1 }])).some((i) => i.code === "bad_param"));
  assert.deepEqual(validateGraph(chain([{ op: "noise", amplitude: 0.1, frequency: 0.5, seed: 1 }])), []);
});

// Hierarchical SC (C2): union of self-similar SC levels, field = min over levels.
test("hierarchical SC: min over levels, same box at every level, validation", async () => {
  const { strutLattice } = await import("../src/topology/lattice.ts");
  const src = { type: "hierarchical_sc" as const, cellSize: 4, cells: 5, radius: 0.4, levels: 2, divisor: 2 };
  const h = compileGraph(chain([], src as never), "out");
  const l0 = strutLattice({ type: "sc", cellSize: 4, cells: [5, 5, 5], radius: 0.4 } as never);
  const l1 = strutLattice({ type: "sc", cellSize: 2, cells: [10, 10, 10], radius: 0.2 } as never);
  for (const [x, y, z] of [[1.3, 2.2, 0.4], [7.9, 3.1, 11.0], [19.5, 0.2, 5.5]] as [number, number, number][]) {
    assert.ok(Math.abs(h.eval(x, y, z) - Math.min(l0.eval(x, y, z), l1.eval(x, y, z))) < 1e-12);
  }
  const bl0 = (l0.bounds as { max: number[] }).max, bl1 = (l1.bounds as { max: number[] }).max;
  assert.deepEqual(bl0, bl1, "all levels span the same box");
  assert.ok(validateGraph(chain([], { ...src, levels: 5 } as never)).some((i) => i.code === "bad_param"));
  assert.ok(validateGraph(chain([], { ...src, divisor: 4 } as never)).some((i) => i.code === "bad_param"));
});
