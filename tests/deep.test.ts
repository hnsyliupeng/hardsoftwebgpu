import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeepField } from "../src/topology/deep.ts";
import type { DeepKind } from "../src/types.ts";

const KINDS: DeepKind[] = ["channel_lattice", "ply_tpms", "graded_tpms", "foam_lattice", "ply_graded_tpms"];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("deep fields are finite, and the coupled and naive variants differ for every kind", () => {
  const rnd = lcg(3);
  for (const kind of KINDS) {
    const coupled = buildDeepField({ kind }, 20).field;
    const naive = buildDeepField({ kind, naive: true }, 20).field;
    let differ = 0;
    for (let i = 0; i < 1500; i++) {
      const x = rnd() * 20;
      const y = rnd() * 20;
      const z = rnd() * 20;
      const a = coupled.eval(x, y, z);
      const b = naive.eval(x, y, z);
      assert.ok(Number.isFinite(a) && Number.isFinite(b), `${kind}: non-finite value`);
      if (a < 0 !== b < 0) differ++;
    }
    assert.ok(differ > 0, `${kind}: removing the coupling changes no sample point`);
  }
});

test("channel lattice: matrix is solid between channels, and the channel axis is empty when naive", () => {
  const naive = buildDeepField({ kind: "channel_lattice", naive: true }, 20).field;
  assert.ok(naive.eval(10, 10, 10) < 0, "matrix between the channels should be solid");
  assert.ok(naive.eval(5, 5, 10) > 0, "channel axis should be empty without the lattice");
});

test("ply TPMS: the field is bounded by the box (outside the box it is positive)", () => {
  const f = buildDeepField({ kind: "ply_tpms" }, 20).field;
  assert.ok(f.eval(-1, 10, 10) > 0);
  assert.ok(f.eval(10, 10, 21) > 0);
});
