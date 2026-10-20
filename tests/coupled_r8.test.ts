import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoupled } from "../src/topology/coupled.ts";

test("coupled R8 radius: radius range bounded by r0 +/- amp, both structures present", () => {
  const L = 20;
  const b = buildCoupled({ round: "R8" }, L);
  for (const [x, y, z] of [[10, 10, 10], [0.5, 0.5, 0.5], [19, 3, 7], [4, 16, 12]] as const) {
    assert.ok(Number.isFinite(b.field.eval(x, y, z)), `field finite at ${x},${y},${z}`);
  }
  const m = b.coupling_metrics as Record<string, number>;
  assert.ok(m.radius_min_mm >= 0.45 - 0.1 - 1e-9, "radius above r0 - amp");
  assert.ok(m.radius_max_mm <= 0.45 + 0.1 + 1e-9, "radius below r0 + amp");
  assert.ok(m.radius_max_mm - m.radius_min_mm > 0.1, "radius varies across the box");
  assert.ok(m.solid_fraction > 0.05 && m.solid_fraction < 0.6, "solid fraction plausible");
});
