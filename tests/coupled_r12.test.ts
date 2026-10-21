import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoupled } from "../src/topology/coupled.ts";

test("coupled R12 one-sided gate-set iso-level: finite field, level stays in [0, 0.35]", () => {
  const L = 20;
  const b = buildCoupled({ round: "R12" }, L);
  for (const [x, y, z] of [[10, 10, 10], [0.5, 0.5, 0.5], [19, 3, 7], [4, 16, 12]] as const) {
    assert.ok(Number.isFinite(b.field.eval(x, y, z)), `field finite at ${x},${y},${z}`);
  }
  const m = b.coupling_metrics as Record<string, number>;
  assert.equal(m.level_min, 0);
  assert.equal(m.level_max, 0.35);
  assert.ok(m.solid_fraction > 0.5, "one-sided level gives more solid than the symmetric baseline");
  assert.ok(m.lattice_zone_solid_fraction > m.sheet_zone_solid_fraction, "solid fraction higher on the gate-positive side");
});
