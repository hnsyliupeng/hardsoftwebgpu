/**
 * mathx.js — vectors, quaternions, transforms, PRNG.
 *
 * Mirror of `rust/trunc_core/src/mathx.rs`; the two are kept numerically identical
 * (see tests/parity.test.mjs). Plain objects instead of classes so the state can be
 * structured-cloned between the main thread and the training worker.
 */

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const deg = (d) => (d * PI) / 180;
export const rad = (r) => (r * 180) / PI;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
export const approach = (cur, target, maxDelta) => {
  const d = target - cur;
  return Math.abs(d) <= maxDelta ? target : cur + sign(d) * maxDelta;
};

export const V3 = {
  new: (x = 0, y = 0, z = 0) => ({ x, y, z }),
  splat: (v) => ({ x: v, y: v, z: v }),
  zero: () => ({ x: 0, y: 0, z: 0 }),
  up: () => ({ x: 0, y: 1, z: 0 }),
  fromArray: (a) => ({ x: a[0], y: a[1], z: a[2] }),
  toArray: (a) => [a.x, a.y, a.z],
  clone: (a) => ({ x: a.x, y: a.y, z: a.z }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  mul: (a, b) => ({ x: a.x * b.x, y: a.y * b.y, z: a.z * b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  neg: (a) => ({ x: -a.x, y: -a.y, z: -a.z }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  lenXZ: (a) => Math.hypot(a.x, a.z),
  norm: (a) => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? V3.scale(a, 1 / l) : V3.zero(); },
  lerp: (a, b, t) => V3.add(a, V3.scale(V3.sub(b, a), t)),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  anyOrtho: (a) => {
    const ref = Math.abs(a.x) < 0.9 ? V3.new(1, 0, 0) : V3.new(0, 1, 0);
    return V3.norm(V3.cross(a, ref));
  },
  rotateAxis: (v, axis, angle) => Quat.rotate(Quat.fromAxisAngle(axis, angle), v),
  finite: (a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z),
};

export const Quat = {
  new: (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w }),
  identity: () => ({ x: 0, y: 0, z: 0, w: 1 }),
  fromArray: (a) => Quat.norm({ x: a[0], y: a[1], z: a[2], w: a[3] }),
  toArray: (q) => [q.x, q.y, q.z, q.w],
  clone: (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w }),
  fromAxisAngle: (axis, angle) => {
    const a = V3.norm(axis);
    const h = angle * 0.5;
    const s = Math.sin(h);
    return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) };
  },
  /** yaw about +Y, then pitch about +X, then roll about +Z */
  fromEuler: (yaw, pitch, roll) => Quat.mul(
    Quat.mul(Quat.fromAxisAngle(V3.up(), yaw), Quat.fromAxisAngle(V3.new(1, 0, 0), pitch)),
    Quat.fromAxisAngle(V3.new(0, 0, 1), roll),
  ),
  mul: (a, b) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }),
  conj: (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w,
  norm: (q) => { const l = Math.hypot(q.x, q.y, q.z, q.w); return l > 1e-9 ? { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l } : Quat.identity(); },
  rotate: (q, v) => {
    const u = { x: q.x, y: q.y, z: q.z };
    const t = V3.scale(V3.add(V3.cross(u, v), V3.scale(v, q.w)), 2);
    return V3.add(v, V3.cross(u, t));
  },
  inverseRotate: (q, v) => Quat.rotate(Quat.conj(q), v),
  /** rotation taking +Y onto dir */
  fromYTo: (dir) => {
    const d = V3.norm(dir);
    const up = V3.up();
    const c = clamp(V3.dot(up, d), -1, 1);
    if (c > 0.999999) return Quat.identity();
    if (c < -0.999999) return Quat.fromAxisAngle(V3.new(0, 0, 1), PI);
    return Quat.fromAxisAngle(V3.norm(V3.cross(up, d)), Math.acos(c));
  },
  twistAbout: (q, axis) => {
    const a = V3.norm(axis);
    const s = q.x * a.x + q.y * a.y + q.z * a.z;
    return 2 * Math.atan2(s, clamp(q.w, -1, 1));
  },
  slerp: (a, b, t) => {
    let d = Quat.dot(a, b);
    let bb = b;
    if (d < 0) { d = -d; bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }; }
    if (d > 0.9995) return Quat.norm({ x: lerp(a.x, bb.x, t), y: lerp(a.y, bb.y, t), z: lerp(a.z, bb.z, t), w: lerp(a.w, bb.w, t) });
    const th0 = Math.acos(d);
    const th = th0 * t;
    const s0 = Math.sin(th0 - th) / Math.sin(th0);
    const s1 = Math.sin(th) / Math.sin(th0);
    return { x: a.x * s0 + bb.x * s1, y: a.y * s0 + bb.y * s1, z: a.z * s0 + bb.z * s1, w: a.w * s0 + bb.w * s1 };
  },
  /** rotation matrix as column-major 3×3 array (for WGSL / canvas fallback) */
  toMat3Array: (q) => {
    const { x, y, z, w } = q;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
      2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
      2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y),
    ];
  },
};

export const Transform = {
  new: (p, q) => ({ p: V3.clone(p), q: q ? Quat.clone(q) : Quat.identity() }),
  identity: () => ({ p: V3.zero(), q: Quat.identity() }),
  fromPos: (p) => ({ p: V3.clone(p), q: Quat.identity() }),
  clone: (t) => ({ p: V3.clone(t.p), q: Quat.clone(t.q) }),
  apply: (t, v) => V3.add(Quat.rotate(t.q, v), t.p),
  applyDir: (t, v) => Quat.rotate(t.q, v),
  inverseApply: (t, v) => Quat.inverseRotate(t.q, V3.sub(v, t.p)),
  mul: (a, b) => ({ q: Quat.mul(a.q, b.q), p: Transform.apply(a, b.p) }),
  inverse: (t) => ({ q: Quat.conj(t.q), p: Quat.inverseRotate(t.q, V3.neg(t.p)) }),
  translated: (t, local) => ({ q: Quat.clone(t.q), p: Transform.apply(t, local) }),
  rotated: (t, local) => ({ q: Quat.mul(t.q, local), p: V3.clone(t.p) }),
  forward: (t) => Quat.rotate(t.q, V3.new(0, 0, 1)),
  up: (t) => Quat.rotate(t.q, V3.up()),
  right: (t) => Quat.rotate(t.q, V3.new(1, 0, 0)),
  /** column-major 4×4 for WebGPU (same layout as WGSL mat4x4<f32>) */
  toMat4Array: (t) => {
    const r = Quat.toMat3Array(t.q);
    return [
      r[0], r[1], r[2], 0,
      r[3], r[4], r[5], 0,
      r[6], r[7], r[8], 0,
      t.p.x, t.p.y, t.p.z, 1,
    ];
  },
  fromMat4Array: (m) => {
    const q = Quat.norm(Quat.fromMat3(m));
    return { q, p: V3.new(m[12], m[13], m[14]) };
  },
};

Quat.fromMat3 = (m) => {
  const tr = m[0] + m[4] + m[8];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return { x: (m[5] - m[7]) / s, y: (m[6] - m[2]) / s, z: (m[1] - m[3]) / s, w: 0.25 * s };
  }
  if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    return { x: 0.25 * s, y: (m[1] + m[3]) / s, z: (m[6] + m[2]) / s, w: (m[5] - m[7]) / s };
  }
  if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    return { x: (m[1] + m[3]) / s, y: 0.25 * s, z: (m[5] + m[7]) / s, w: (m[6] - m[2]) / s };
  }
  const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
  return { x: (m[6] + m[2]) / s, y: (m[5] + m[7]) / s, z: 0.25 * s, w: (m[1] - m[3]) / s };
};

/** PCG32 — identical stream to `mathx.rs`. */
export class Rng {
  constructor(seed = 1) {
    this.state = 0n;
    this.inc = ((BigInt(seed >>> 0) << 1n) | 1n) & 0xffffffffffffffffn;
    this.nextU32();
    this.state = (this.state + (BigInt(seed >>> 0) ^ 0x9e3779b97f4a7c15n)) & 0xffffffffffffffffn;
    this.nextU32();
  }
  nextU32() {
    const old = this.state;
    this.state = (old * 6364136223846793005n + this.inc) & 0xffffffffffffffffn;
    const xor = Number(((old >> 18n) ^ old) >> 27n) & 0xffffffff;
    const rot = Number(old >> 59n) & 31;
    return ((xor >>> rot) | (xor << ((32 - rot) & 31))) >>> 0;
  }
  nextF32() { return (this.nextU32() >>> 8) / 16777216; }
  range(lo, hi) { return lo + (hi - lo) * this.nextF32(); }
  signed() { return this.nextF32() * 2 - 1; }
  normal() {
    const u1 = Math.max(this.nextF32(), 1e-7);
    const u2 = this.nextF32();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
  }
  chance(p) { return this.nextF32() < p; }
  pick(n) { return n === 0 ? 0 : this.nextU32() % n; }
}

export const dirFromPlane = (plane) => V3.new(Math.cos(plane), 0, Math.sin(plane));
