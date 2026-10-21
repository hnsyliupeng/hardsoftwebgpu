import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoupled } from "../src/topology/coupled.ts";

test("coupled R11 gate-set iso-level: finite field, level stays inside the gyroid range", () => {
  const L = 20;
  const b = buildCoupled({ round: "R11" }, L);
  for (const [x, y, z] of [[10, 10, 10], [0.5, 0.5, 0.5], [19, 3, 7], [4, 16, 12]] as const) {
    assert.ok(Number.isFinite(b.field.eval(x, y, z)), `field finite at ${x},${y},${z}`);
  }
  const m = b.coupling_metrics as Record<string, number>;
  assert.ok(Math.abs(m.level_max) < 1.5 && Math.abs(m.level_min) < 1.5, "level inside the gyroid extremes (|F| <= 1.5)");
  assert.ok(m.sheet_zone_solid_fraction < m.lattice_zone_solid_fraction, "solid fraction higher on the gate-positive side");
  assert.ok(m.solid_fraction > 0.3 && m.solid_fraction < 0.7, "overall solid fraction plausible");
});
