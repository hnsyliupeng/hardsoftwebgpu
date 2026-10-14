// Safe arithmetic expression language for heterogeneous profiles, e.g.
//   thickness(u) = 0.3 + 0.2 * sin(2 * pi * u)
// Grammar (no eval, no property access, no assignment):
//   expr    := term (('+'|'-') term)*
//   term    := unary (('*'|'/') unary)*
//   unary   := ('-'|'+') unary | power
//   power   := primary ('^' unary)?
//   primary := NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')'
// Identifiers must be a declared variable (e.g. u) or a constant (pi, e); functions are whitelisted.

export type ExprNode =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "neg"; arg: ExprNode }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: ExprNode; right: ExprNode }
  | { kind: "call"; fn: string; args: ExprNode[] };

export interface CompiledExpr {
  readonly source: string;
  readonly variables: readonly string[];
  eval(vars: Record<string, number>): number;
}

const FUNCTIONS: Record<string, { arity: [number, number]; apply: (a: number[]) => number }> = {
  sin: { arity: [1, 1], apply: (a) => Math.sin(a[0]) },
  cos: { arity: [1, 1], apply: (a) => Math.cos(a[0]) },
  tan: { arity: [1, 1], apply: (a) => Math.tan(a[0]) },
  abs: { arity: [1, 1], apply: (a) => Math.abs(a[0]) },
  sqrt: { arity: [1, 1], apply: (a) => Math.sqrt(a[0]) },
  exp: { arity: [1, 1], apply: (a) => Math.exp(a[0]) },
  log: { arity: [1, 1], apply: (a) => Math.log(a[0]) },
  floor: { arity: [1, 1], apply: (a) => Math.floor(a[0]) },
  min: { arity: [2, 8], apply: (a) => Math.min(...a) },
  max: { arity: [2, 8], apply: (a) => Math.max(...a) },
  pow: { arity: [2, 2], apply: (a) => Math.pow(a[0], a[1]) },
  clamp: { arity: [3, 3], apply: (a) => Math.min(a[2], Math.max(a[1], a[0])) },
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const MAX_SOURCE = 400;

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string } | { t: "end" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new SyntaxError(`bad number at ${i}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if ("+-*/^(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new SyntaxError(`unexpected character '${c}' at ${i}`);
    }
  }
  out.push({ t: "end" });
  return out;
}

class Parser {
  private pos = 0;
  private readonly toks: Tok[];
  private readonly vars: Set<string>;
  constructor(toks: Tok[], vars: Set<string>) {
    this.toks = toks;
    this.vars = vars;
  }
  private peek(): Tok {
    return this.toks[this.pos];
  }
  private next(): Tok {
    return this.toks[this.pos++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === "op" && t.v === v;
  }
  private expect(v: string): void {
    if (!this.isOp(v)) throw new SyntaxError(`expected '${v}'`);
    this.pos++;
  }
  parse(): ExprNode {
    const node = this.expr();
    if (this.peek().t !== "end") throw new SyntaxError("unexpected trailing input");
    return node;
  }
  private expr(): ExprNode {
    let node = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.next() as { v: string }).v as "+" | "-";
      node = { kind: "bin", op, left: node, right: this.term() };
    }
    return node;
  }
  private term(): ExprNode {
    let node = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.next() as { v: string }).v as "*" | "/";
      node = { kind: "bin", op, left: node, right: this.unary() };
    }
    return node;
  }
  private unary(): ExprNode {
    if (this.isOp("-")) {
      this.next();
      return { kind: "neg", arg: this.unary() };
    }
    if (this.isOp("+")) {
      this.next();
      return this.unary();
    }
    return this.power();
  }
  private power(): ExprNode {
    const base = this.primary();
    if (this.isOp("^")) {
      this.next();
      return { kind: "bin", op: "^", left: base, right: this.unary() };
    }
    return base;
  }
  private primary(): ExprNode {
    const t = this.next();
    if (t.t === "num") return { kind: "num", value: t.v };
    if (t.t === "op" && t.v === "(") {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (t.t === "id") {
      if (this.isOp("(")) {
        const fn = FUNCTIONS[t.v];
        if (!fn) throw new SyntaxError(`unknown function '${t.v}'`);
        this.next();
        const args: ExprNode[] = [];
        if (!this.isOp(")")) {
          args.push(this.expr());
          while (this.isOp(",")) {
            this.next();
            args.push(this.expr());
          }
        }
        this.expect(")");
        if (args.length < fn.arity[0] || args.length > fn.arity[1]) throw new SyntaxError(`wrong argument count for ${t.v}`);
        return { kind: "call", fn: t.v, args };
      }
      if (t.v in CONSTANTS && !this.vars.has(t.v)) return { kind: "num", value: CONSTANTS[t.v] };
      if (!this.vars.has(t.v)) throw new SyntaxError(`unknown identifier '${t.v}' (allowed: ${[...this.vars].join(", ")})`);
      return { kind: "var", name: t.v };
    }
    throw new SyntaxError("unexpected token");
  }
}

function evalNode(n: ExprNode, vars: Record<string, number>): number {
  switch (n.kind) {
    case "num":
      return n.value;
    case "var":
      return vars[n.name];
    case "neg":
      return -evalNode(n.arg, vars);
    case "bin": {
      const a = evalNode(n.left, vars);
      const b = evalNode(n.right, vars);
      switch (n.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return Math.pow(a, b);
      }
      break;
    }
    case "call":
      return FUNCTIONS[n.fn].apply(n.args.map((x) => evalNode(x, vars)));
  }
  throw new Error("unreachable expression node");
}

/** Parse and validate an expression over the given variable names. Throws SyntaxError on any problem. */
export function compileExpr(source: string, variables: string[] = ["u"]): CompiledExpr {
  if (typeof source !== "string" || source.trim().length === 0) throw new SyntaxError("empty expression");
  if (source.length > MAX_SOURCE) throw new SyntaxError(`expression longer than ${MAX_SOURCE} characters`);
  const ast = new Parser(tokenize(source), new Set(variables)).parse();
  // Reject expressions that are not finite on the probe grid (e.g. 1/u at u=0).
  for (let k = 0; k <= 8; k++) {
    const vars: Record<string, number> = {};
    for (const v of variables) vars[v] = k / 8;
    const val = evalNode(ast, vars);
    if (!Number.isFinite(val)) throw new SyntaxError(`expression is not finite at ${variables[0]}=${k / 8}`);
  }
  return {
    source,
    variables,
    eval: (vars) => evalNode(ast, vars),
  };
}

const CACHE = new Map<string, CompiledExpr>();
/** Cached compile of a single-variable (u) expression. */
export function compileU(source: string): CompiledExpr {
  let c = CACHE.get(source);
  if (!c) {
    c = compileExpr(source, ["u"]);
    CACHE.set(source, c);
  }
  return c;
}

/**
 * Accepts `thickness(u) = expr`, `radius(u) = expr` or a bare expression in u.
 * Returns the bare expression text, or throws SyntaxError.
 */
export function parseProfileAssignment(text: string): string {
  const m = /^\s*(?:thickness|radius|t|r)\s*\(\s*u\s*\)\s*=\s*(.+?)\s*$/i.exec(text);
  const body = m ? m[1] : text.trim();
  compileU(body);
  return body;
}

/**
 * Extracts the law from free text: the longest prefix after `thickness(u) =` (or `radius(u) =`)
 * that compiles as an expression. Trailing words such as "along z" are returned as `rest`.
 */
export function extractProfileExpression(text: string): { expr: string; rest: string } | null {
  const m = /(?:thickness|radius)\s*\(\s*u\s*\)\s*=\s*/.exec(text);
  if (!m) return null;
  const body = text.slice(m.index + m[0].length).split(/[\n;]/)[0];
  for (let end = body.length; end > 0; end--) {
    const cand = body.slice(0, end).trim();
    if (!cand) continue;
    try {
      compileU(cand);
      return { expr: cand, rest: body.slice(end).trim() };
    } catch {
      // try a shorter prefix
    }
  }
  return null;
}
