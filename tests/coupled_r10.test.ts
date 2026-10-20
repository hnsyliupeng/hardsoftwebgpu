import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoupled } from "../src/topology/coupled.ts";

test("coupled R10 gated dominance: both phases present, thickness bounds respected", () => {
  const L = 20;
  const b = buildCoupled({ round: "R10" }, L);
  for (const [x, y, z] of [[10, 10, 10], [0.5, 0.5, 0.5], [19, 3, 7], [4, 16, 12]] as const) {
    assert.ok(Number.isFinite(b.field.eval(x, y, z)), `field finite at ${x},${y},${z}`);
  }
  const m = b.coupling_metrics as Record<string, number>;
  assert.ok(m.min_sheet_thickness_mm >= 0.5 - 1e-9, "sheet thickness floor 0.5 mm");
  assert.ok(m.min_strut_radius_mm >= 0.3 - 1e-9, "strut radius floor 0.3 mm");
  assert.ok(m.sheet_zone_mean_thickness_mm > m.lattice_zone_mean_thickness_mm, "sheet thicker on the sheet side");
  assert.ok(m.lattice_zone_mean_strut_radius_mm > m.sheet_zone_mean_strut_radius_mm, "struts thicker on the lattice side");
});
