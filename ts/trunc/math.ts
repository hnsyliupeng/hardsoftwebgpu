/**
 * math.ts — the linear algebra the MATLAB used, in TypeScript.
 *
 * The MATLAB relied on Robotics System Toolbox helpers (`quat2rotm`,
 * `rotm2quat`, `quatmultiply`, `wrapTo180`) and on MATLAB matrix literals. All
 * of those are reproduced here so the ported model is self-contained and the
 * numbers can be checked against the original outputs.
 */

import type { Mat4, Quat, Vec3 } from './types.js';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const deg2rad = (d: number): number => d * DEG;
export const rad2deg = (r: number): number => r * RAD;

/** MATLAB `wrapTo180`. */
export function wrapTo180(deg: number): number {
  let x = ((deg + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

export const identity = (): Mat4 => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

/**
 * MATLAB-style 4x4 multiply, column-major storage: `A*B`.
 * Written out longhand because this is the inner loop of the whole port.
 */
export function mul(a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  for (let c = 0; c < 4; c += 1) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/** Translation applied to a point (millimetres). */
export function apply(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Rotation-only application (for directions). */
export function applyDir(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ];
}

export const translation = (m: Mat4): Vec3 => [m[12], m[13], m[14]];

export function translationMatrix(d: number): Mat4 {
  const m = identity();
  m[14] = d;   // Tz
  return m;
}

export function rotX(t: number): Mat4 {
  const m = identity();
  const c = Math.cos(t);
  const s = Math.sin(t);
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

export function rotY(t: number): Mat4 {
  const m = identity();
  const c = Math.cos(t);
  const s = Math.sin(t);
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

export function rotZ(t: number): Mat4 {
  const m = identity();
  const c = Math.cos(t);
  const s = Math.sin(t);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

// ------------------------------------------------------------------ quaternions

/** MATLAB `rotm2quat` order: w, x, y, z. */
export function rotm2quat(m: Mat4): Quat {
  // `Mat4` is column-major, and so is `quat2rotm` below, so the off-diagonal
  // differences must be read as R(r,c) = m[c * 4 + r]. Reading them the other
  // way round silently returns the quaternion of the transpose — which is the
  // inverse rotation, so it looks harmless until you compose two of them.
  const trace = m[0] + m[5] + m[10];
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m[6] - m[9]) / s;
    y = (m[8] - m[2]) / s;
    z = (m[1] - m[4]) / s;
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2;
    w = (m[6] - m[9]) / s;
    x = 0.25 * s;
    y = (m[4] + m[1]) / s;
    z = (m[2] + m[8]) / s;
  } else if (m[5] > m[10]) {
    const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2;
    w = (m[8] - m[2]) / s;
    x = (m[1] + m[4]) / s;
    y = 0.25 * s;
    z = (m[9] + m[6]) / s;
  } else {
    const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2;
    w = (m[1] - m[4]) / s;
    x = (m[2] + m[8]) / s;
    y = (m[9] + m[6]) / s;
    z = 0.25 * s;
  }
  return quatNorm([w, x, y, z]);
}

/** MATLAB `quat2rotm`, w-first. */
export function quat2rotm(q: Quat): Mat4 {
  const [w, x, y, z] = quatNorm(q);
  const m = identity();
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + w * z);
  m[2] = 2 * (x * z - w * y);
  m[4] = 2 * (x * y - w * z);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + w * x);
  m[8] = 2 * (x * z + w * y);
  m[9] = 2 * (y * z - w * x);
  m[10] = 1 - 2 * (x * x + y * y);
  return m;
}

/** MATLAB `quatmultiply(a, b)`, w-first. */
export function quatMul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export const quatConj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]] as Quat;

export function quatNorm(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Geometric error between two orientations, degrees (MATLAB `dist` on quats). */
export function quatAngleDeg(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d)) * RAD;
}

/** Axis-angle to quaternion (w-first) — used for the tool twist. */
export function axisAngleToQuat(axis: Vec3, angle: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), (axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s];
}

// ------------------------------------------------------------------------- misc

export const norm3 = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/** MATLAB `mean(A, 1)`. */
export function meanRows(rows: number[][]): number[] {
  if (!rows.length) return [];
  const out = new Array(rows[0].length).fill(0);
  for (const r of rows) for (let i = 0; i < out.length; i += 1) out[i] += r[i] / rows.length;
  return out;
}

/** MATLAB `findpeaks` — local maxima, used by the CV-joint phase analysis. */
export function findPeaks(y: number[]): { locs: number[]; pks: number[] } {
  const locs: number[] = [];
  const pks: number[] = [];
  for (let i = 1; i + 1 < y.length; i += 1) {
    if (y[i] > y[i - 1] && y[i] >= y[i + 1]) { locs.push(i); pks.push(y[i]); }
  }
  return { locs, pks };
}

/** Deterministic RNG matching MATLAB's `rng(seed)` usage well enough for sweeps. */
export function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
