import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent } from "../src/intent/intent.ts";

test("intent: family and topology detection", () => {
  assert.equal(parseIntent("Make a helical Bouligand structure with 5 plies, 10 degrees rotation.").data.topology, "helical");
  assert.equal(parseIntent("Make a tubular structure with 16 tubules and cortical layer thickness 0.04.").data.topology, "tubular");
  assert.equal(parseIntent("gyroid TPMS wall thickness 0.5 mm").data.topology, "tpms");
  assert.equal(parseIntent("做一个 gyroid TPMS 结构, wall thickness 0.5 mm").data.topology, "tpms");
});

test("intent: lattice cell vs strut radius are not confused", () => {
  const spec = parseIntent("Create a BCC lattice 20 mm cube with 4 mm cell and 0.6 mm strut radius, graded along z from 0.3 mm to 0.9 mm").data;
  assert.equal(spec.topology, "lattice");
  assert.equal(spec.parameters.cell_size_mm, 4);
  assert.equal(spec.parameters.strut_radius_mm, 0.6);
  assert.equal(spec.heterogeneity_field?.direction, "z");
  assert.equal(spec.heterogeneity_field?.min, 0.3);
  assert.equal(spec.heterogeneity_field?.max, 0.9);
});

test("intent: the word 'cell' alone does not select the cellular family", () => {
  assert.equal(parseIntent("BCC lattice with 4 mm cell").data.topology, "lattice");
});

test("intent: explicit lattice + bio family is a hybrid", () => {
  const spec = parseIntent("cellular foam with a BCC lattice inside").data;
  assert.equal(spec.topology, "hybrid");
});

test("intent: unstated values are recorded as unknowns", () => {
  const spec = parseIntent("gyroid TPMS wall thickness 0.5 mm").data;
  assert.ok(spec.unknowns.some((u) => /Unit cell size/.test(u)));
  assert.ok(spec.unknowns.some((u) => /Printability floor/.test(u)));
});
