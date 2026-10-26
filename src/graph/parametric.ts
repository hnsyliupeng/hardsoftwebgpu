// Projection of a source volume onto an arbitrary parametric surface X(u, v) (C1, numerical inverse).
//
// Source coordinates (x, y, z): u = u0 + du x, v = v0 + dv y, and z is the signed offset along the unit normal N(u, v).
// World point: P(x, y, z) = X(u, v) + z N(u, v). The inverse solves P(s) = p by Newton iteration, starting from a
// kind-specific approximate projection of p onto the surface.
//
// Kinds (both analytic):
//   ellipsoid(a, b, c): X = (a cos u sin v, b sin u sin v, c cos v), outward normal;
//   saddle(k):          X = (u, v, k (u^2 - v^2)), normal with positive z.
//
// Lipschitz constant of the inverse: lambda = max(1, 1.02 * sup 1/sigma_min(J)), J = dP/ds, over a grid of the source
// box. This is a sampled bound (21 x 21 x 3 points), not a proof for every point; the 2 % margin covers the sampling.
// Round trips and an independent Jacobian-weighted volume check are in the tests and in scripts.

export type V3 = [number, number, number];
export type EllipsoidParam = { kind: "ellipsoid"; a: number; b: number; c: number; u0?: number; v0: number; du: number; dv: number };
export type SaddleParam = { kind: "saddle"; k: number; u0?: number; v0?: number; du: number; dv: number };
export type ParamSpec = EllipsoidParam | SaddleParam;

/** Validate a parametric spec; returns an error message or null. */
export function paramError(t: ParamSpec): string | null {
  const fin = (...v: unknown[]) => v.every((x) => typeof x === "number" && Number.isFinite(x));
  if (t.kind === "ellipsoid") {
    if (!fin(t.a, t.b, t.c, t.v0, t.du, t.dv) || !(t.a > 0 && t.b > 0 && t.c > 0)) return "ellipsoid: a, b, c must be > 0";
    if (!(t.du !== 0 && t.dv !== 0)) return "ellipsoid: du and dv must be non-zero";
    return null;
  }
  if (t.kind === "saddle") {
    if (!fin(t.k, t.du, t.dv) || !(t.du !== 0 && t.dv !== 0)) return "saddle: k, du, dv must be finite and du, dv non-zero";
    return null;
  }
  return "kind must be ellipsoid or saddle";
}

type Kind = {
  X: (u: number, v: number) => V3;
  Xu: (u: number, v: number) => V3;
  Xv: (u: number, v: number) => V3;
  sign: number;
  guess: (p: V3) => [number, number];
};

function kindOf(t: ParamSpec): Kind {
  if (t.kind === "ellipsoid") {
    const { a, b, c } = t;
    return {
      X: (u, v) => [a * Math.cos(u) * Math.sin(v), b * Math.sin(u) * Math.sin(v), c * Math.cos(v)],
      Xu: (u, v) => [-a * Math.sin(u) * Math.sin(v), b * Math.cos(u) * Math.sin(v), 0],
      Xv: (u, v) => [a * Math.cos(u) * Math.cos(v), b * Math.sin(u) * Math.cos(v), -c * Math.sin(v)],
      sign: -1, // cross(Xu, Xv) points inward on the ellipsoid
      guess: (p) => [Math.atan2(p[1] / b, p[0] / a), Math.atan2(Math.hypot(p[0] / a, p[1] / b), p[2] / c)],
    };
  }
  const k = t.k;
  return {
    X: (u, v) => [u, v, k * (u * u - v * v)],
    Xu: (u) => [1, 0, 2 * k * u],
    Xv: (_u, v) => [0, 1, -2 * k * v],
    sign: 1,
    guess: (p) => [p[0], p[1]],
  };
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Unit normal of the surface at (u, v). Throws if the surface is degenerate there. */
function normalAt(K: Kind, u: number, v: number): V3 {
  const n = cross(K.Xu(u, v), K.Xv(u, v));
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!(len > 1e-12)) throw new Error("parametric surface: degenerate point (zero normal)");
  return [(K.sign * n[0]) / len, (K.sign * n[1]) / len, (K.sign * n[2]) / len];
}

/** Solve the 3 x 3 system A x = b by Cramer's rule. */
function solve3(A: number[][], b: number[]): number[] | null {
  const det = (M: number[][]) =>
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A);
  if (!(Math.abs(d) > 1e-300)) return null;
  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const M = A.map((row, r) => row.map((x, cc) => (cc === c ? b[r] : x)));
    out.push(det(M) / d);
  }
  return out;
}

/** Eigenvalues of a symmetric 3 x 3 matrix (cyclic Jacobi). */
function eigSym3(M: number[][]): number[] {
  const A = M.map((r) => [...r]);
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += A[i][j] * A[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
      }
  }
  return [A[0][0], A[1][1], A[2][2]];
}

/** Forward map, inverse map, Lipschitz constant and world bounds for a parametric surface projection. */
export function paramMap(t: ParamSpec): {
  forward: (s: V3) => V3;
  inverse: (p: V3) => V3;
  lambda: (box: { min: V3; max: V3 }) => number;
  bounds: (box: { min: V3; max: V3 }) => { min: V3; max: V3 };
} {
  const err = paramError(t);
  if (err) throw new Error(`parametric_project: ${err}`);
  const K = kindOf(t);
  const u0 = t.u0 ?? 0, v0 = t.kind === "ellipsoid" ? t.v0 : t.v0 ?? 0;
  const du = t.du, dv = t.dv;

  const forward = (s: V3): V3 => {
    const u = u0 + du * s[0], v = v0 + dv * s[1];
    const X = K.X(u, v), N = normalAt(K, u, v);
    return [X[0] + s[2] * N[0], X[1] + s[2] * N[1], X[2] + s[2] * N[2]];
  };

  /** dP/ds by central differences (step 1e-6 in source units). */
  const jac = (s: V3): number[][] => {
    const J: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const h = 1e-6;
    for (let c = 0; c < 3; c++) {
      const a = [...s] as V3, b = [...s] as V3;
      a[c] += h;
      b[c] -= h;
      const fa = forward(a), fb = forward(b);
      for (let r = 0; r < 3; r++) J[r][c] = (fa[r] - fb[r]) / (2 * h);
    }
    return J;
  };

  const inverse = (p: V3): V3 => {
    const [u, v] = K.guess(p);
    const X = K.X(u, v), N = normalAt(K, u, v);
    const z = dot([p[0] - X[0], p[1] - X[1], p[2] - X[2]], N);
    let s: V3 = [(u - u0) / du, (v - v0) / dv, z];
    const scale = 1 + Math.hypot(p[0], p[1], p[2]);
    for (let it = 0; it < 60; it++) {
      const f = forward(s);
      const r: V3 = [f[0] - p[0], f[1] - p[1], f[2] - p[2]];
      if (Math.hypot(r[0], r[1], r[2]) < 1e-11 * scale) break;
      const d = solve3(jac(s), [-r[0], -r[1], -r[2]]);
      if (!d) throw new Error("parametric_project: singular Jacobian in the inverse");
      s = [s[0] + d[0], s[1] + d[1], s[2] + d[2]];
    }
    return s;
  };

  const lambda = (box: { min: V3; max: V3 }) => {
    let sup = 0;
    const N = 20;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++)
        for (const z of [box.min[2], (box.min[2] + box.max[2]) / 2, box.max[2]]) {
          const s: V3 = [box.min[0] + ((box.max[0] - box.min[0]) * i) / N, box.min[1] + ((box.max[1] - box.min[1]) * j) / N, z];
          const J = jac(s);
          const M = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J[0][a] * J[0][b] + J[1][a] * J[1][b] + J[2][a] * J[2][b]));
          const smin2 = Math.min(...eigSym3(M));
          if (!(smin2 > 1e-18)) throw new Error("parametric_project: the source box contains a degenerate point of the surface");
          sup = Math.max(sup, 1 / Math.sqrt(smin2));
        }
    return Math.max(1, 1.02 * sup);
  };

  const bounds = (box: { min: V3; max: V3 }) => {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    const N = 40;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++)
        for (const z of [box.min[2], box.max[2]]) {
          const q = forward([box.min[0] + ((box.max[0] - box.min[0]) * i) / N, box.min[1] + ((box.max[1] - box.min[1]) * j) / N, z]);
          for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], q[a]); max[a] = Math.max(max[a], q[a]); }
        }
    for (let a = 0; a < 3; a++) { const pad = 0.01 * (max[a] - min[a]); min[a] -= pad; max[a] += pad; }
    return { min, max };
  };

  return { forward, inverse, lambda, bounds };
}
