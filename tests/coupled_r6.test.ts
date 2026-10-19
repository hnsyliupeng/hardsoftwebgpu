import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoupled } from "../src/topology/coupled.ts";

test("coupled R6 morph: finite field, both phases present, core and shell differ", () => {
  const L = 20;
  const b = buildCoupled({ round: "R6" }, L);
  const f = b.field;
  for (const [x, y, z] of [[10, 10, 10], [0.5, 0.5, 0.5], [19, 3, 7], [4, 16, 12]] as const) {
    assert.ok(Number.isFinite(f.eval(x, y, z)), `field finite at ${x},${y},${z}`);
  }
  const m = b.coupling_metrics as Record<string, number>;
  assert.ok(m.core_solid_fraction > 0 && m.core_solid_fraction < 1, "core solid fraction in (0,1)");
  assert.ok(m.shell_solid_fraction > 0 && m.shell_solid_fraction < 1, "shell solid fraction in (0,1)");
  // The two phases differ: the gyroid core and the BCC shell do not have the same solid fraction.
  assert.ok(Math.abs(m.core_solid_fraction - m.shell_solid_fraction) > 0.01);
  // The field expression names both phases.
  assert.ok(f.expr.includes("gyroid sheet") && f.expr.includes("bcc lattice"), "expression names both phases");
});
