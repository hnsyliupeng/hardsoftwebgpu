// End-to-end tests (CPU only, no network): the full harness chain, the porosity repair path,
// the thickness(u) law parser, and the programmatic API. Resolution is kept low (48) for speed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../src/pipeline.ts";
import { runDesign } from "../src/api.ts";
import { EXAMPLE_PROGRAMS } from "../src/program/index.ts";
import { parseProfileAssignment, extractProfileExpression } from "../src/expr/expr.ts";
import { parseIntent } from "../src/intent/intent.ts";

const STATE_KEYS = "code,design_spec,limitations,metrics,prompt,render_preview,repair_history,unknowns";

function assertFourFields(name: string, rep: { observations: unknown; limitations: unknown; unknowns: unknown; evidence: unknown }) {
  assert.ok(Array.isArray(rep.observations), `${name}: observations`);
  assert.ok(Array.isArray(rep.limitations), `${name}: limitations`);
  assert.ok(Array.isArray(rep.unknowns), `${name}: unknowns`);
  assert.ok(rep.evidence && typeof rep.evidence === "object", `${name}: evidence`);
}

test("example feature program runs through every harness and matches its analytic volume", async () => {
  const { state, code, result } = await runDesign({
    program: EXAMPLE_PROGRAMS.rounded_hollow_box,
    resolution: 48,
    exportFiles: false,
  });
  assert.equal(Object.keys(state).sort().join(","), STATE_KEYS);
  for (const [name, rep] of Object.entries(result.reports)) {
    assert.equal(rep.ok, true, `harness ${name} failed`);
    assertFourFields(name, rep);
  }
  assert.equal(state.metrics.connectivity, true);
  // Analytic rounded-box shell at res 48 is within a few percent of the exact B-Rep value (2860.06).
  const rel = Math.abs(state.metrics.volume - 2860.062) / 2860.062;
  assert.ok(rel < 0.05, `volume ${state.metrics.volume} off by ${(rel * 100).toFixed(2)} %`);
  assert.match(code, /export|function|import/, "emitted code is non-empty TypeScript");
});

test("BCC lattice with porosity 80 % is repaired towards the target (repair history kept)", async () => {
  const res = await runPipeline("bcc lattice 20 mm with 4 mm cell, porosity 80%", { resolution: 48, exportFiles: false });
  assert.equal(Object.keys(res.state).sort().join(","), STATE_KEYS);
  assert.ok(res.state.repair_history.length >= 1, "a porosity target away from the initial guess must trigger repair");
  for (const step of res.state.repair_history) {
    assert.ok(step.round >= 1 && step.round <= 5, "at most 5 rounds");
    assert.ok(typeof step.accepted === "boolean");
    assert.ok(typeof step.trigger === "string" && step.trigger.length > 0);
  }
  const porosity = res.validation.metrics.porosity;
  assert.ok(Math.abs(porosity - 0.8) < 0.03, `porosity ${porosity} should be close to 0.80`);
  assert.equal(res.state.metrics.connectivity, true);
  for (const rep of Object.values(res.reports)) assertFourFields("porosity", rep);
});

test("thickness(u) = ... law is parsed, clamped to a valid expression, and stored in the design spec", () => {
  assert.equal(parseProfileAssignment("thickness(u) = 0.3 + 0.2*sin(2*pi*u)"), "0.3 + 0.2*sin(2*pi*u)");
  assert.throws(() => parseProfileAssignment("thickness(u) = 1/u"), SyntaxError, "1/u is not finite at u=0");
  const free = extractProfileExpression("BCC lattice thickness(u) = 0.3 + 0.2*u along z, 0.3 to 0.7 mm");
  assert.ok(free);
  assert.equal(free.expr, "0.3 + 0.2*u");
  assert.match(free.rest, /^along z/);

  const spec = parseIntent("BCC lattice 20 mm, 4 mm cell, strut radius 0.5 mm, thickness(u) = 0.3 + 0.2*sin(2*pi*u) along z, 0.3 to 0.7 mm").data;
  assert.equal(spec.heterogeneity_field?.rule, "expr");
  assert.equal(spec.heterogeneity_field?.direction, "z");
});

test("runDesign from a prompt returns the full DesignState plus copy-executable code", async () => {
  const { state, code } = await runDesign({ prompt: "simple cubic lattice 20 mm, 4 mm cell, 0.6 mm strut radius", resolution: 48, exportFiles: false });
  assert.equal(state.prompt, "simple cubic lattice 20 mm, 4 mm cell, 0.6 mm strut radius");
  assert.equal(state.design_spec.topology, "lattice");
  assert.ok(state.metrics.volume > 0);
  assert.ok(code.includes("../../src/"), "code imports the kernel relative to artifacts/<name>/design.ts");
});

test("runDesign rejects a request with neither prompt nor program", async () => {
  await assert.rejects(() => runDesign({}), /needs a prompt or a feature program/);
});
