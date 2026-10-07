/**
 * camera.js — column-major matrices for WGSL plus the orbit camera used by both
 * the WebGPU renderer and the 2D canvas fallback (so the framing is identical).
 */

import { V3, clamp, deg } from '../core/mathx.js';

export function identity() {
  return Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return Float32Array.from([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function ortho(l, r, b, t, near, far) {
  const lr = 1 / (l - r);
  const bt = 1 / (b - t);
  const nf = 1 / (near - far);
  return Float32Array.from([
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, 2 * nf, 0,
    (l + r) * lr, (t + b) * bt, (far + near) * nf, 1,
  ]);
}

export function lookAt(eye, target, up = V3.up()) {
  const f = V3.norm(V3.sub(target, eye));
  const s = V3.norm(V3.cross(f, up));
  const u = V3.cross(s, f);
  return Float32Array.from([
    s.x, u.x, -f.x, 0,
    s.y, u.y, -f.y, 0,
    s.z, u.z, -f.z, 0,
    -V3.dot(s, eye), -V3.dot(u, eye), V3.dot(f, eye), 1,
  ]);
}

export function modelFromTRS(p, q = null, scale = 1) {
  const x = q ? quatX(q) : V3.new(1, 0, 0);
  const y = q ? quatY(q) : V3.new(0, 1, 0);
  const z = q ? quatZ(q) : V3.new(0, 0, 1);
  return Float32Array.from([
    x.x * scale, x.y * scale, x.z * scale, 0,
    y.x * scale, y.y * scale, y.z * scale, 0,
    z.x * scale, z.y * scale, z.z * scale, 0,
    p.x, p.y, p.z, 1,
  ]);
}

function quatX(q) {
  const { x, y, z, w } = q;
  return V3.new(1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y));
}
function quatY(q) {
  const { x, y, z, w } = q;
  return V3.new(2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x));
}
function quatZ(q) {
  const { x, y, z, w } = q;
  return V3.new(2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y));
}

/** Orbit camera: spherical position around `target`, clamped pitch. */
export class OrbitCamera {
  constructor({ yaw = 0.66, pitch = 0.36, dist = 1.15, target = V3.new(0, 0.36, 0) } = {}) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.dist = dist;
    this.target = V3.clone(target);
    this.fov = deg(42);
    this.near = 0.05;
    this.far = 60;
    this.aspect = 1;
    this.home = { yaw, pitch, dist, target: V3.clone(target) };
  }

  eye() {
    const cp = Math.cos(this.pitch);
    return V3.new(
      this.target.x + this.dist * cp * Math.sin(this.yaw),
      this.target.y + this.dist * Math.sin(this.pitch),
      this.target.z + this.dist * cp * Math.cos(this.yaw),
    );
  }

  view() { return lookAt(this.eye(), this.target); }
  proj() { return perspective(this.fov, this.aspect, this.near, this.far); }
  viewProj() { return multiply(this.proj(), this.view()); }

  orbit(dx, dy) {
    this.yaw -= dx * 0.007;
    this.pitch = clamp(this.pitch + dy * 0.006, deg(-12), deg(78));
  }

  pan(dx, dy) {
    const view = this.view();
    const right = V3.new(view[0], view[4], view[8]);
    const up = V3.new(view[1], view[5], view[9]);
    const k = this.dist * 0.0016;
    this.target = V3.add(this.target, V3.add(V3.scale(right, -dx * k), V3.scale(up, dy * k)));
  }

  zoom(delta) { this.dist = clamp(this.dist * (1 + delta * 0.0012), 0.35, 8); }

  reset() {
    this.yaw = this.home.yaw; this.pitch = this.home.pitch; this.dist = this.home.dist;
    this.target = V3.clone(this.home.target);
  }

  /** Project a world point to normalised device coords (for the DOM overlay). */
  project(p) {
    const m = this.viewProj();
    const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
    const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
    const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (w <= 0) return null;
    return { x: (x / w) * 0.5 + 0.5, y: 0.5 - (y / w) * 0.5, w };
  }

  /** Ray from the camera through a normalised screen position. */
  ray(nx, ny) {
    const eye = this.eye();
    const tanHalf = Math.tan(this.fov / 2);
    const view = this.view();
    const right = V3.new(view[0], view[4], view[8]);
    const up = V3.new(view[1], view[5], view[9]);
    const forward = V3.norm(V3.sub(this.target, eye));
    const dir = V3.norm(V3.add(forward, V3.add(
      V3.scale(right, nx * tanHalf * this.aspect),
      V3.scale(up, ny * tanHalf),
    )));
    return { origin: eye, dir };
  }
}

/** Ray/plane intersection; returns null when the ray is parallel. */
export function rayPlane(ray, planeY) {
  const dy = ray.dir.y;
  if (Math.abs(dy) < 1e-6) return null;
  const t = (planeY - ray.origin.y) / dy;
  if (t <= 0) return null;
  return V3.add(ray.origin, V3.scale(ray.dir, t));
}

/** Ray/sphere intersection (used for picking task props). */
export function raySphere(ray, center, radius) {
  const oc = V3.sub(ray.origin, center);
  const b = V3.dot(oc, ray.dir);
  const c = V3.dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return null;
  return { t, p: V3.add(ray.origin, V3.scale(ray.dir, t)) };
}
