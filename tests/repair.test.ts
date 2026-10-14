import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent } from "../src/intent/intent.ts";
import { evaluateSpec } from "../src/evaluate.ts";
import { repairDesign, MAX_REPAIR_ROUNDS } from "../src/repair/repair.ts";

test("repair: a TPMS sheet below the printable floor is thickened within 5 rounds, with history", async () => {
  // Resolution 96 (h = 0.21 mm): a 0.2 mm sheet is only ~1 voxel thick at 64, which is unresolved.
  const spec = parseIntent("gyroid TPMS wall thickness 0.2 mm, 4 mm cell").data;
  spec.constraints.resolution = 96;
  const first = await evaluateSpec(spec);
  assert.ok(first.validation.data.metrics.min_wall_thickness < spec.constraints.min_printable_wall_mm);
  const rep = await repairDesign(first, MAX_REPAIR_ROUNDS);
  assert.ok(rep.data.history.length >= 1 && rep.data.history.length <= MAX_REPAIR_ROUNDS);
  const h = rep.data.history[0];
  assert.equal(h.parameter, "wall_thickness_mm");
  assert.ok(h.to > h.from);
  assert.ok(h.after.min_wall_thickness! > h.before.min_wall_thickness!);
  assert.ok(h.accepted, "first thickening step should be accepted at 96^3");
  assert.ok(rep.data.evaluation.validation.data.metrics.min_wall_thickness >= spec.constraints.min_printable_wall_mm || rep.data.history.length === 5);
  assert.ok(rep.observations.length && rep.limitations.length && rep.evidence);
});

test("repair: no action when all checks already pass", async () => {
  const spec = parseIntent("Make a helical Bouligand structure with 5 plies, 10 degrees rotation.").data;
  spec.constraints.resolution = 48;
  const first = await evaluateSpec(spec);
  const rep = await repairDesign(first, MAX_REPAIR_ROUNDS);
  assert.equal(rep.data.history.length, 0);
  assert.match(rep.data.stopReason, /no repair needed/);
});
