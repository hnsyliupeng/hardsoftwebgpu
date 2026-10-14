// Signed-distance (SDF) field primitives. Convention: f < 0 inside the solid, f > 0 outside.
// All coordinates are millimetres in the design frame; the build volume is [0, size]^3.

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** A scalar field with a sign convention and a bounding box that contains its solid. */
export interface Field {
  readonly bounds: Bounds;
  /** Signed distance (or a Lipschitz-bounded approximation) at a point. */
  eval(x: number, y: number, z: number): number;
  /** Human-readable expression for evidence / reproduction. */
  readonly expr: string;
}

export function sdBox(x: number, y: number, z: number, hx: number, hy: number, hz: number): number {
  const qx = Math.abs(x) - hx;
  const qy = Math.abs(y) - hy;
  const qz = Math.abs(z) - hz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0);
}

/** Finite cylinder along the x axis, radius r, half-length h, centred at the origin. */
export function sdCylinderX(x: number, y: number, z: number, r: number, h: number): number {
  const dr = Math.hypot(y, z) - r;
  const dx = Math.abs(x) - h;
  return Math.min(Math.max(dr, dx), 0) + Math.hypot(Math.max(dr, 0), Math.max(dx, 0));
}

/** Infinite cylinder along z (used for through-holes), centred at (cx, cy). */
export function sdCylinderZ(x: number, y: number, cx: number, cy: number, r: number): number {
  return Math.hypot(x - cx, y - cy) - r;
}

/** Approximate signed distance to an axis-aligned ellipse of semi-axes (a, b) centred at (cx, cy). */
export function sdEllipseZ(x: number, y: number, cx: number, cy: number, a: number, b: number): number {
  const qx = (x - cx) / a;
  const qy = (y - cy) / b;
  return (Math.hypot(qx, qy) - 1) * Math.min(a, b);
}

/** Distance from point p to segment ab (3D). */
export function distSegment(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const vz = bz - az;
  const wx = px - ax;
  const wy = py - ay;
  const wz = pz - az;
  const vv = vx * vx + vy * vy + vz * vz;
  let t = vv > 0 ? (wx * vx + wy * vy + wz * vz) / vv : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - vx * t;
  const dy = wy - vy * t;
  const dz = wz - vz * t;
  return Math.hypot(dx, dy, dz);
}

/** Intersection (max) of two SDFs. */
export function sdIntersect(a: number, b: number): number {
  return Math.max(a, b);
}
/** Union (min) of two SDFs. */
export function sdUnion(a: number, b: number): number {
  return Math.min(a, b);
}
/** Difference a \ b. */
export function sdSubtract(a: number, b: number): number {
  return Math.max(a, -b);
}

/** Axis-aligned box field [0, size]^3 used as the build volume clip. */
export function boxBounds(size: number): Bounds {
  return { min: [0, 0, 0], max: [size, size, size] };
}

/** Wrap a field so it is clipped to the build volume [0,size]^3. */
export function clipToBox(inner: Field, size: number): Field {
  const h = size / 2;
  return {
    bounds: boxBounds(size),
    expr: `max(${inner.expr}, sdBox(p - ${h}, ${h}))`,
    eval(x, y, z) {
      return sdIntersect(inner.eval(x, y, z), sdBox(x - h, y - h, z - h, h, h, h));
    },
  };
}
