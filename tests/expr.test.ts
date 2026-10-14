import { test } from "node:test";
import assert from "node:assert/strict";
import { compileExpr, compileU, extractProfileExpression, parseProfileAssignment } from "../src/expr/expr.ts";
import { heteroValue, makeHeterogeneity, valueAt } from "../src/topology/heterogeneous.ts";

const ev = (src: string, vars: Record<string, number> = { u: 0.25 }) => compileExpr(src, Object.keys(vars)).eval(vars);

test("expression grammar: precedence, associativity, unary minus, constants", () => {
  assert.equal(ev("1+2*3", {}), 7);
  assert.equal(ev("(1+2)*3", {}), 9);
  assert.equal(ev("2^3^2", {}), 512); // right-associative
  assert.equal(ev("-2^2", {}), -4); // unary minus applies to the power
  assert.equal(ev("10/4", {}), 2.5);
  assert.ok(Math.abs(ev("pi", {}) - Math.PI) < 1e-15);
  assert.equal(ev("1e-3*1000", {}), 1);
});

test("expression functions and variables", () => {
  assert.ok(Math.abs(ev("sin(2*pi*u)", { u: 0.25 }) - 1) < 1e-12);
  assert.equal(ev("min(u, 0.1)", { u: 0.25 }), 0.1);
  assert.equal(ev("max(1, u, 0.5)", { u: 0.25 }), 1);
  assert.equal(ev("clamp(u*4, 0, 0.5)", { u: 0.25 }), 0.5);
  assert.equal(ev("abs(-u)", { u: 0.25 }), 0.25);
  assert.equal(ev("pow(2, 3)", {}), 8);
});

test("expression parser rejects anything outside the whitelist", () => {
  const bad = [
    "foo + 1", // unknown identifier
    "constructor", // prototype names are not variables
    "__proto__", // ditto
    "process.exit(1)", // member access
    "eval(u)", // unknown function
    "u; 1", // statement separator
    "1/(u-0.5)", // not finite on the probe grid (u = 0.5)
    "u +", // incomplete
    "(u", // unbalanced
    "u ? 1 : 2", // no ternary
    "u = 2", // no assignment
    "'a'", // strings
    "",
  ];
  for (const src of bad) assert.throws(() => compileU(src), SyntaxError, `should reject: ${src}`);
  assert.throws(() => compileU("0*u".repeat(300)), SyntaxError); // length limit
});

test("thickness(u) = expr assignments are unwrapped and validated", () => {
  assert.equal(parseProfileAssignment("thickness(u) = 0.3 + 0.2*sin(2*pi*u)"), "0.3 + 0.2*sin(2*pi*u)");
  assert.equal(parseProfileAssignment("radius(u)=0.5*u"), "0.5*u");
  assert.equal(parseProfileAssignment("0.2 + u"), "0.2 + u");
  assert.throws(() => parseProfileAssignment("thickness(u) = v"), SyntaxError);
});

test("expr heterogeneity: clamped to [min,max], cached, and stored with the field", () => {
  const f = makeHeterogeneity("expr", "z", 0.2, 0.6, "1 + 10*u");
  assert.equal(f.expression, "1 + 10*u");
  assert.equal(heteroValue("expr", 0, 0.2, 0.6, "1 + 10*u"), 0.6); // 1 clamped to max
  assert.equal(heteroValue("expr", 0, 0.2, 0.6, "u"), 0.2); // 0 clamped to min
  assert.ok(Math.abs(heteroValue("expr", 0.3, 0.2, 0.6, "u") - 0.3) < 1e-12);
  const g = makeHeterogeneity("expr", "z", 0.2, 0.6, "0.2 + 0.2*u");
  assert.ok(Math.abs(valueAt(g, 0.5) - 0.3) < 1e-12);
  assert.throws(() => makeHeterogeneity("expr", "z", 0.2, 0.6), RangeError);
  assert.throws(() => makeHeterogeneity("expr", "z", 0.2, 0.6, "u +"), SyntaxError);
});

test("extractProfileExpression keeps the longest valid law and reports trailing words", () => {
  const a = extractProfileExpression("bcc lattice, thickness(u) = 0.3 + 0.2*sin(2*pi*u) along z, 0.2 to 0.6 mm");
  assert.ok(a);
  assert.equal(a!.expr, "0.3 + 0.2*sin(2*pi*u)");
  assert.ok(a!.rest.startsWith("along z"));
  assert.equal(extractProfileExpression("no law here"), null);
  assert.equal(extractProfileExpression("radius(u) = foo(u)"), null);
});
