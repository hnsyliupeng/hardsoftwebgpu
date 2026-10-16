// Safe arithmetic expression parser for the structure-graph `expr` offset transform (B3).
// Grammar (no eval, no property access, no assignment):
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | '/') unary)*
//   unary  := '-' unary | power
//   power  := atom ('^' unary)?
//   atom   := number | 'x' | 'y' | 'z' | 'pi' | 'e' | func '(' expr (',' expr)* ')' | '(' expr ')'
// Functions: sin, cos, tan, abs, sqrt, exp, log, min (2 args), max (2 args).
// Anything else is a parse error, so untrusted preset text cannot run code.

export type ExprFn = (x: number, y: number, z: number) => number;

const UNARY: Record<string, (a: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, log: Math.log,
};
const BINARY: Record<string, (a: number, b: number) => number> = { min: Math.min, max: Math.max };
const CONST: Record<string, number> = { pi: Math.PI, e: Math.E };
const VARS = new Set(["x", "y", "z"]);
// Own-property lookup only: `name in obj` would also match prototype keys such as `constructor`.
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: "x" | "y" | "z" }
  | { k: "un"; f: (a: number) => number; a: Node }
  | { k: "bin"; f: (a: number, b: number) => number; a: Node; b: Node }
  | { k: "neg"; a: Node }
  | { k: "add" | "sub" | "mul" | "div" | "pow"; a: Node; b: Node };

class Parser {
  private pos = 0;
  private readonly s: string;
  constructor(s: string) { this.s = s; }

  parse(): Node {
    const n = this.expr();
    this.ws();
    if (this.pos !== this.s.length) this.fail(`unexpected '${this.s[this.pos]}'`);
    return n;
  }

  private fail(msg: string): never {
    throw new Error(`expr: ${msg} at position ${this.pos} in "${this.s}"`);
  }
  private ws() { while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++; }
  private peek(): string { this.ws(); return this.s[this.pos] ?? ""; }
  private eat(c: string): boolean { if (this.peek() === c) { this.pos++; return true; } return false; }

  private expr(): Node {
    let n = this.term();
    for (;;) {
      if (this.eat("+")) n = { k: "add", a: n, b: this.term() };
      else if (this.eat("-")) n = { k: "sub", a: n, b: this.term() };
      else return n;
    }
  }
  private term(): Node {
    let n = this.unary();
    for (;;) {
      if (this.eat("*")) n = { k: "mul", a: n, b: this.unary() };
      else if (this.eat("/")) n = { k: "div", a: n, b: this.unary() };
      else return n;
    }
  }
  private unary(): Node {
    if (this.eat("-")) return { k: "neg", a: this.unary() };
    if (this.eat("+")) return this.unary();
    return this.power();
  }
  private power(): Node {
    const a = this.atom();
    if (this.eat("^")) return { k: "pow", a, b: this.unary() };
    return a;
  }
  private atom(): Node {
    const c = this.peek();
    if (c === "(") {
      this.pos++;
      const n = this.expr();
      if (!this.eat(")")) this.fail("missing ')'");
      return n;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(this.s.slice(this.pos));
      if (!m) this.fail("bad number");
      this.pos += m[0].length;
      return { k: "num", v: Number(m[0]) };
    }
    if (/[a-zA-Z]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(this.s.slice(this.pos))!;
      const name = m[0];
      this.pos += name.length;
      if (VARS.has(name)) return { k: "var", name: name as "x" | "y" | "z" };
      if (own(CONST, name) && !(this.peek() === "(")) return { k: "num", v: CONST[name] };
      if (this.eat("(")) {
        if (own(UNARY, name)) {
          const a = this.expr();
          if (!this.eat(")")) this.fail("missing ')'");
          return { k: "un", f: UNARY[name], a };
        }
        if (own(BINARY, name)) {
          const a = this.expr();
          if (!this.eat(",")) this.fail(`${name} needs 2 arguments`);
          const b = this.expr();
          if (!this.eat(")")) this.fail("missing ')'");
          return { k: "bin", f: BINARY[name], a, b };
        }
        this.fail(`unknown function '${name}'`);
      }
      this.fail(`unknown name '${name}'`);
    }
    if (c === "") this.fail("unexpected end");
    this.fail(`unexpected '${c}'`);
  }
}

function evalNode(n: Node, x: number, y: number, z: number): number {
  switch (n.k) {
    case "num": return n.v;
    case "var": return n.name === "x" ? x : n.name === "y" ? y : z;
    case "un": return n.f(evalNode(n.a, x, y, z));
    case "bin": return n.f(evalNode(n.a, x, y, z), evalNode(n.b, x, y, z));
    case "neg": return -evalNode(n.a, x, y, z);
    case "add": return evalNode(n.a, x, y, z) + evalNode(n.b, x, y, z);
    case "sub": return evalNode(n.a, x, y, z) - evalNode(n.b, x, y, z);
    case "mul": return evalNode(n.a, x, y, z) * evalNode(n.b, x, y, z);
    case "div": return evalNode(n.a, x, y, z) / evalNode(n.b, x, y, z);
    case "pow": return Math.pow(evalNode(n.a, x, y, z), evalNode(n.b, x, y, z));
  }
}

/** Parse and compile; throws on any syntax error or unknown name. */
export function compileExpr(text: string): ExprFn {
  if (typeof text !== "string" || text.length === 0 || text.length > 300) throw new Error("expr: text must be 1 to 300 characters");
  const tree = new Parser(text).parse();
  return (x, y, z) => evalNode(tree, x, y, z);
}

/** Returns null if the text is valid, otherwise the error message. */
export function checkExpr(text: unknown): string | null {
  try { compileExpr(text as string); return null; } catch (e) { return (e as Error).message; }
}
