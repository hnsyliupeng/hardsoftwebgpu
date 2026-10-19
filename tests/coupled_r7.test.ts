import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoupled } from "../src/topology/coupled.ts";

test("coupled R7 grading: finite field, graded metrics recorded, solid in each third", () => {
  const L = 20;
  const b = buildCoupled({ round: "R7" }, L);
  for (const [x, y, z] of [[10, 10, 10], [0.5, 0.5, 0.5], [19, 3, 7], [4, 16, 12]] as const) {
    assert.ok(Number.isFinite(b.field.eval(x, y, z)), `field finite at ${x},${y},${z}`);
  }
  const m = b.coupling_metrics as Record<string, number>;
  assert.equal(m.period_z_bottom_mm, 3);
  assert.equal(m.period_z_top_mm, 7);
  assert.equal(m.period_xy_mm, 5);
  for (const k of ["solid_fraction_bottom_third", "solid_fraction_middle_third", "solid_fraction_top_third"]) {
    assert.ok(m[k] > 0.1 && m[k] < 0.6, `${k} in (0.1, 0.6)`);
  }
});
