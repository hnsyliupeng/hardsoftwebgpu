import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoupled } from "../src/topology/coupled.ts";

test("coupled R9 gated phases: finite field, both phases solid in their zones", () => {
  const L = 20;
  const b = buildCoupled({ round: "R9" }, L);
  for (const [x, y, z] of [[10, 10, 10], [0.5, 0.5, 0.5], [19, 3, 7], [4, 16, 12]] as const) {
    assert.ok(Number.isFinite(b.field.eval(x, y, z)), `field finite at ${x},${y},${z}`);
  }
  const m = b.coupling_metrics as Record<string, number>;
  assert.ok(m.sheet_zone_solid_fraction > 0.05 && m.sheet_zone_solid_fraction < 0.8, "sheet zone solid fraction plausible");
  assert.ok(m.lattice_zone_solid_fraction > 0.05 && m.lattice_zone_solid_fraction < 0.8, "lattice zone solid fraction plausible");
  assert.ok(m.sheet_zone_fraction > 0.3 && m.sheet_zone_fraction < 0.7, "gate splits the box");
});
