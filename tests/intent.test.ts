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

test("intent: a prompt with no structure keyword is not forced into a bioinspired family", () => {
  const general = [
    "Make a 30 mm phone stand that holds the phone at 60 degrees.",
    "A small gear with 20 teeth and a 5 mm bore.",
    "Build a shelf bracket that carries 5 kg.",
    "Create a hollow cylinder with a thread for a bottle cap.",
  ];
  for (const p of general) {
    const r = parseIntent(p);
    assert.equal(r.ok, false, `ok must be false for: ${p}`);
    assert.equal(r.data.topology, "lattice", p);
    assert.equal(r.data.confidence, 0.1, p);
    assert.ok(!["helical", "tubular", "cellular"].includes(r.data.topology), p);
    assert.ok(r.unknowns.some((u) => /No structure keyword recognised/.test(u)), p);
  }
});

test("intent: bioinspired and lattice prompts still report ok with their family", () => {
  const bio = parseIntent("Make a helical Bouligand structure with 5 plies, 10 degrees rotation.");
  assert.equal(bio.ok, true);
  assert.equal(bio.data.topology, "helical");
  const lat = parseIntent("Make a BCC lattice with a 4 mm cell and 0.4 mm struts.");
  assert.equal(lat.ok, true);
  assert.equal(lat.data.topology, "lattice");
});

test("intent: mounting holes are not a tubular cue; tubular prompts with holes still route to tubular", () => {
  const mech = parseIntent("Design a bracket with three mounting holes and fillets.");
  assert.equal(mech.ok, false, "mechanical holes must not be routed to a bio family");
  assert.notEqual(mech.data.topology, "tubular");
  const tub = parseIntent("Make a tubular structure with 16 holes and radius 0.05.");
  assert.equal(tub.ok, true);
  assert.equal(tub.data.topology, "tubular");
});
