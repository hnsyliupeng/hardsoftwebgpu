// Projection of a source volume onto a parametric surface (C1, general surface projection, closed form).
//
// Source coordinates (x, y, z): x and y are arc lengths along the surface, z is the offset along the surface normal.
//   sphere (radius R, centre 0):  phi = phi0 + x/R,  theta = theta0 + y/R,  r = R + z.
//                                 P = r (sin theta cos phi, sin theta sin phi, cos theta).
//   torus (major Rm, minor Rt):   u = u0 + x/Rm,     v = v0 + y/Rt,       r = Rt + z.
//                                 P = ((Rm + r cos v) cos u, (Rm + r cos v) sin u, r sin v).
//
// Both maps have analytic inverses (wrapping the angles into a window). In both, the rows of the Jacobian of the inverse
// are orthogonal, so the operator norm is the largest row norm:
//   sphere: |grad x| = R / (r sin theta), |grad y| = R / r, |grad z| = 1;
//   torus:  |grad x| = Rm / rho,           |grad y| = Rt / r, |grad z| = 1, with rho = Rm + r cos v.
// lambda = max(1, sup of these over the source box). The sup is attained at the corners of the box in (y, z) (the
// quantities are monotone in y and z over the patch), and the grid below includes the corners.
// Points of the world that lie outside the patch map to source coordinates outside the box, where the lattice is empty.

export type V3 = [number, number, number];
export type SphereSurface = { surface: "sphere"; radius: number; phi0?: number; theta0: number };
export type TorusSurface = { surface: "torus"; major: number; minor: number; u0?: number; v0: number };
export type SurfaceSpec = SphereSurface | TorusSurface;

const TAU = 2 * Math.PI;
const wrap2pi = (a: number) => ((a % TAU) + TAU) % TAU;
const wrapPi = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

/** Validate a surface spec; returns an error message or null. */
export function surfaceError(t: SurfaceSpec): string | null {
  if (t.surface === "sphere") {
    if (!(t.radius > 0)) return "radius must be > 0";
    if (!(t.theta0 > 0 && t.theta0 < Math.PI)) return "theta0 must be in (0, pi)";
    return null;
  }
  if (t.surface === "torus") {
    if (!(t.major > 0) || !(t.minor > 0)) return "major and minor must be > 0";
    return null;
  }
  return "surface must be sphere or torus";
}

/**
 * Forward and inverse maps of a surface projection, Lipschitz constant over a source box, and the world bounds.
 * Throws if the box leaves the valid region (sphere: theta leaves (0, pi) or r <= 0; torus: r <= 0 or rho <= 0).
 */
export function surfaceMap(t: SurfaceSpec): {
  forward: (p: V3) => V3;
  inverse: (q: V3) => V3;
  lambda: (box: { min: V3; max: V3 }) => number;
  bounds: (box: { min: V3; max: V3 }) => { min: V3; max: V3 };
} {
  const err = surfaceError(t);
  if (err) throw new Error(`surface_project: ${err}`);

  if (t.surface === "sphere") {
    const R = t.radius, p0 = t.phi0 ?? 0, t0 = t.theta0;
    const forward = (p: V3): V3 => {
      const phi = p0 + p[0] / R, th = t0 + p[1] / R, r = R + p[2];
      return [r * Math.sin(th) * Math.cos(phi), r * Math.sin(th) * Math.sin(phi), r * Math.cos(th)];
    };
    const inverse = (q: V3): V3 => {
      const rho = Math.hypot(q[0], q[1]), r = Math.hypot(rho, q[2]);
      const phi = Math.atan2(q[1], q[0]), th = Math.atan2(rho, q[2]);
      return [R * wrap2pi(phi - p0), R * (th - t0), r - R];
    };
    const lambda = (box: { min: V3; max: V3 }) => {
      let sup = 1;
      for (const y of ticks(box.min[1], box.max[1])) for (const z of ticks(box.min[2], box.max[2])) {
        const th = t0 + y / R, r = R + z;
        if (!(r > 0) || !(th > 0 && th < Math.PI)) throw new Error("surface_project: the source box leaves the sphere patch (theta or radius out of range)");
        sup = Math.max(sup, R / (r * Math.sin(th)), R / r);
      }
      return sup;
    };
    return { forward, inverse, lambda, bounds: (box) => worldBounds(forward, box) };
  }

  const Rm = t.major, Rt = t.minor, u0 = t.u0 ?? 0, v0 = t.v0;
  const forward = (p: V3): V3 => {
    const u = u0 + p[0] / Rm, v = v0 + p[1] / Rt, r = Rt + p[2];
    const rr = Rm + r * Math.cos(v);
    return [rr * Math.cos(u), rr * Math.sin(u), r * Math.sin(v)];
  };
  const inverse = (q: V3): V3 => {
    const rho = Math.hypot(q[0], q[1]);
    const u = Math.atan2(q[1], q[0]), v = Math.atan2(q[2], rho - Rm);
    const r = Math.hypot(rho - Rm, q[2]);
    return [Rm * wrap2pi(u - u0), Rt * wrapPi(v - v0), r - Rt];
  };
  const lambda = (box: { min: V3; max: V3 }) => {
    let sup = 1;
    for (const y of ticks(box.min[1], box.max[1])) for (const z of ticks(box.min[2], box.max[2])) {
      const v = v0 + y / Rt, r = Rt + z;
      const rr = Rm + r * Math.cos(v);
      if (!(r > 0) || !(rr > 0)) throw new Error("surface_project: the source box leaves the torus patch (tube radius or distance from axis not positive)");
      sup = Math.max(sup, Rm / rr, Rt / r);
    }
    return sup;
  };
  return { forward, inverse, lambda, bounds: (box) => worldBounds(forward, box) };
}

/** 21 ticks including both ends (so corners of a box are sampled exactly). */
function ticks(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 20; i++) out.push(a + ((b - a) * i) / 20);
  return out;
}

/** World bounding box of the image of a source box, sampled on a grid and padded by 1 %. */
function worldBounds(forward: (p: V3) => V3, box: { min: V3; max: V3 }): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const x of ticks(box.min[0], box.max[0])) for (const y of ticks(box.min[1], box.max[1])) for (const z of ticks(box.min[2], box.max[2])) {
    const q = forward([x, y, z]);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], q[a]); max[a] = Math.max(max[a], q[a]); }
  }
  for (let a = 0; a < 3; a++) { const pad = 0.01 * (max[a] - min[a]); min[a] -= pad; max[a] += pad; }
  return { min, max };
}
