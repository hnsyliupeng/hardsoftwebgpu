// Feature-program tests (CPU only): every timeline op against an analytic volume, the B-Rep
// execution against the SDF path, and the validation errors of the program compiler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executeBrepProgram } from "../src/program/brep.ts";
import { compileProgramField, sdRoundedBox, sdCappedSegment, gradedCavities } from "../src/program/sdf.ts";
import { EXAMPLE_PROGRAMS, parseProgramJson, scaleWallThickness } from "../src/program/index.ts";
import { ProgramError, type FeatureProgram, type ProgramOp } from "../src/program/types.ts";
import { sampleField, surfaceNets, meshIntegrals } from "../src/geometry/grid.ts";

const prog = (ops: ProgramOp[], result?: string): FeatureProgram => ({ name: "t", ops, result: result ?? ops[ops.length - 1].id });
const vol = async (p: FeatureProgram) => (await executeBrepProgram(p)).solid.volume;
const close = (a: number, b: number, tol: number, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} got ${a}, expected ${b} (tol ${tol})`);

test("box: exact volume and step report", async () => {
  const r = await executeBrepProgram(prog([{ id: "b", op: "box", size: [20, 20, 20] }]));
  close(r.solid.volume, 8000, 1e-6);
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].ok, true);
  close(r.solid.area, 2400, 1e-6, "area");
});

test("cylinder placed by base centre: through-hole cut removes pi r^2 h", async () => {
  const v = await vol(
    prog([
      { id: "b", op: "box", size: [20, 20, 20] },
      { id: "c", op: "cylinder", radius: 3, height: 40, base: [10, 10, -10] },
      { id: "x", op: "boolean", kind: "cut", a: "b", b: "c" },
    ]),
  );
  close(v, 8000 - Math.PI * 9 * 20, 1e-3);
});

test("boolean union and intersection of overlapping boxes (inclusion-exclusion)", async () => {
  const boxes: ProgramOp[] = [
    { id: "a", op: "box", size: [10, 10, 10] },
    { id: "b", op: "box", size: [10, 10, 10], corner: [5, 5, 5] },
  ];
  close(await vol(prog([...boxes, { id: "u", op: "boolean", kind: "union", a: "a", b: "b" }])), 1875, 1e-6);
  close(await vol(prog([...boxes, { id: "i", op: "boolean", kind: "intersect", a: "a", b: "b" }])), 125, 1e-6);
});

test("fillet r=2 on a 20 mm cube equals the Steiner rounded-box volume", async () => {
  const v = await vol(prog([{ id: "b", op: "box", size: [20, 20, 20] }, { id: "f", op: "fillet", target: "b", radius: 2 }]));
  const a = 16, r = 2;
  const steiner = a ** 3 + 6 * r * a * a + 3 * Math.PI * r * r * a + (4 / 3) * Math.PI * r ** 3;
  close(v, steiner, 1e-3, "fillet");
});

test("shell: open top = 3392, closed = 3904 (analytic)", async () => {
  const base: ProgramOp[] = [{ id: "b", op: "box", size: [20, 20, 20] }];
  close(await vol(prog([...base, { id: "s", op: "shell", target: "b", thickness: 2, open: "top" }])), 3392, 1e-3, "open top");
  close(await vol(prog([...base, { id: "s", op: "shell", target: "b", thickness: 2, open: "none" }])), 3904, 1e-3, "closed");
});

test("offset: +1 gives 22^3 and -2 gives 16^3 (mitred kernel offset)", async () => {
  close(await vol(prog([{ id: "b", op: "box", size: [20, 20, 20] }, { id: "o", op: "offset", target: "b", distance: 1 }])), 10648, 1e-3);
  close(await vol(prog([{ id: "b", op: "box", size: [20, 20, 20] }, { id: "o", op: "offset", target: "b", distance: -2 }])), 4096, 1e-3);
});

test("loft: ruled frustum 20x20 -> 10x10 over 20 mm = (h/3)(A1+A2+sqrt(A1 A2))", async () => {
  const v = await vol(
    prog([
      { id: "l", op: "loft", sections: [{ z: 0, size: [20, 20] }, { z: 20, size: [10, 10] }], ruled: true },
    ]),
  );
  close(v, (20 / 3) * (400 + 100 + 200), 1e-3);
});

test("loft with non-square, offset sections (linear half-sizes -> quadratic area, Simpson exact)", async () => {
  // 20x10 at z=0 -> 10x10 centred at (2,0) at z=10. Half-sizes interpolate linearly, so the
  // section area A(w) = 4*hx(w)*hy(w) is quadratic in w and Simpson's rule is exact.
  const v = await vol(
    prog([{ id: "l", op: "loft", sections: [{ z: 0, size: [20, 10] }, { z: 10, size: [10, 10], center: [2, 0] }] }]),
  );
  const A = (w: number) => 4 * (10 - 5 * w) * (5);
  close(v, (10 / 6) * (A(0) + 4 * A(0.5) + A(1)), 1e-3);
});

test("sweep: straight vertical rod = pi r^2 L; bent rod = pi r^2 (sum of segment lengths)", async () => {
  close(await vol(prog([{ id: "s", op: "sweep", radius: 2, path: [[0, 0, 0], [0, 0, 20]] }])), Math.PI * 4 * 20, 1e-3);
  const L = 10 + Math.SQRT2 * 10;
  close(await vol(prog([{ id: "s", op: "sweep", radius: 2, path: [[0, 0, 0], [0, 0, 10], [10, 0, 20]] }])), Math.PI * 4 * L, 1e-2);
});

test("graded shell: heterogeneous thickness t(u)=0.6+1.4u matches the staircase analytic volume", async () => {
  const v = await vol(
    prog([
      { id: "b", op: "box", size: [24, 24, 24] },
      { id: "g", op: "graded_shell", target: "b", thickness: "thickness(u) = 0.6 + 1.4 * u", slices: 8, open: "top" },
    ]),
  );
  // Independent computation (Python, same staircase): 3169.45 mm^3.
  close(v, 3169.45, 0.01, "graded");
});

test("graded thickness expression is validated per slice", () => {
  assert.throws(
    () => compileProgramField(prog([{ id: "b", op: "box", size: [10, 10, 10] }, { id: "g", op: "graded_shell", target: "b", thickness: "u - 0.5" }])),
    ProgramError,
  );
});

test("each op kind has a deterministic SDF and B-Rep match on the example programs (<= 1.5 %)", async () => {
  for (const [name, p] of Object.entries(EXAMPLE_PROGRAMS)) {
    const brep = (await executeBrepProgram(p)).solid.volume;
    const g = sampleField(compileProgramField(p).field, 120);
    const sdf = meshIntegrals(surfaceNets(g)).volume;
    assert.ok(Math.abs(sdf - brep) / brep < 0.015, `${name}: SDF ${sdf.toFixed(2)} vs B-Rep ${brep.toFixed(2)}`);
  }
});

test("SDF primitives: sign convention and exactness", () => {
  const box = { min: [0, 0, 0] as [number, number, number], max: [2, 2, 2] as [number, number, number], r: 0 };
  assert.ok(Math.abs(sdRoundedBox(1, 1, 1, box) + 1) < 1e-12);
  assert.ok(Math.abs(sdRoundedBox(3, 1, 1, box) - 1) < 1e-12);
  const rounded = { ...box, r: 0.5 };
  // corner distance to a rounded corner: the point (2,2,2) lies at distance sqrt(3)*0.5 - 0.5 ... check negative/positive
  assert.ok(sdRoundedBox(2, 2, 2, rounded) > 0);
  assert.ok(Math.abs(sdCappedSegment([0, 0, 5], [0, 0, 0], [0, 0, 10], 1) + 1) < 1e-12);
  assert.ok(Math.abs(sdCappedSegment([0, 0, 12], [0, 0, 0], [0, 0, 10], 1) - 2) < 1e-12); // flat cap: distance to the cap rim
});

test("graded cavities: one staircase box per slice, open face extends through the top", () => {
  const cav = gradedCavities({ min: [0, 0, 0], max: [10, 10, 10], r: 0 }, { id: "g", slices: 2, open: "top" }, { eval: () => 1 });
  assert.equal(cav.length, 2);
  assert.equal(cav[1].box.max[2], 11); // open top extends beyond the box
  assert.equal(cav[0].box.min[0], 1);
});

test("program compiler reports clear errors", () => {
  const cases: [string, FeatureProgram][] = [
    ["duplicate op id", prog([{ id: "a", op: "box", size: [1, 1, 1] }, { id: "a", op: "box", size: [1, 1, 1] }])],
    ["unknown reference", prog([{ id: "a", op: "fillet", target: "nope", radius: 1 }])],
    ["non-positive size", prog([{ id: "a", op: "box", size: [0, 1, 1] }])],
    ["fillet too large", prog([{ id: "a", op: "box", size: [4, 4, 4] }, { id: "f", op: "fillet", target: "a", radius: 2 }])],
    ["shell too thick", prog([{ id: "a", op: "box", size: [4, 4, 4] }, { id: "s", op: "shell", target: "a", thickness: 2 }])],
    ["graded on non-box", prog([{ id: "a", op: "cylinder", radius: 1, height: 3 }, { id: "g", op: "graded_shell", target: "a", thickness: "0.5" }])],
    ["smooth loft", prog([{ id: "l", op: "loft", sections: [{ z: 0, size: [1, 1] }, { z: 1, size: [1, 1] }], ruled: false }])],
    ["non-increasing loft z", prog([{ id: "l", op: "loft", sections: [{ z: 1, size: [1, 1] }, { z: 0, size: [1, 1] }] }])],
    ["slanted sweep start", prog([{ id: "s", op: "sweep", radius: 1, path: [[0, 0, 0], [5, 0, 5]] }])],
    ["missing result", { name: "t", ops: [{ id: "a", op: "box", size: [1, 1, 1] }], result: "zzz" }],
  ];
  for (const [label, p] of cases) assert.throws(() => compileProgramField(p), ProgramError, label);
});

test("JSON intake: parses valid documents and rejects malformed ones", () => {
  const good = JSON.stringify(EXAMPLE_PROGRAMS.offset_plate);
  assert.equal(parseProgramJson(good).name, "offset_plate");
  assert.throws(() => parseProgramJson("{nope"), ProgramError);
  assert.throws(() => parseProgramJson(JSON.stringify({ name: "x", ops: [{ id: "a", op: "eval" }], result: "a" })), ProgramError);
  assert.throws(() => parseProgramJson(JSON.stringify({ ops: [], result: "a" })), ProgramError);
});

test("repair hook scales the first wall thickness and reports null without one", () => {
  const s = scaleWallThickness(EXAMPLE_PROGRAMS.rounded_hollow_box, 1.5);
  assert.ok(s);
  assert.equal(s!.opId, "hollow");
  const shell = s!.program.ops.find((o) => o.id === "hollow") as { thickness: number };
  assert.equal(shell.thickness, 2.25);
  assert.equal(scaleWallThickness(EXAMPLE_PROGRAMS.offset_plate, 1.2), null);
});
