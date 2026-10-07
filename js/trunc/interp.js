// generated from ts/trunc/interp.ts by tools/ts-emit.mjs — do not edit
/**
 * interp.ts — `interp_waypoints.m`, the waypoint densifier.
 *
 * Signature and semantics follow the MATLAB helper: take a sparse waypoint
 * list (position, quaternion, pause, motor) and produce `n` points along it.
 * "cubic" uses the MATLAB `pchip` shape-preserving cubic per axis, "linear"
 * walks the segments uniformly. Quaternions are interpolated with a hemisphere-
 * corrected slerp so the tool never flips through a long way round.
 */

                                                 
import { quatNorm } from './math.js';

/** MATLAB `pchip` slopes (Fritsch–Carlson) for one axis. */
function pchipSlopes(xs          , ys          )           {
  const n = ys.length;
  const h           = [];
  const delta           = [];
  for (let i = 0; i < n - 1; i += 1) {
    h.push(xs[i + 1] - xs[i]);
    delta.push(h[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / h[i]);
  }
  const d = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    if (delta[i - 1] * delta[i] <= 0) {
      d[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  // MATLAB's pchip end-point rule (one-sided three-point estimate, monotone-limited)
  const endSlope = (i        , j        ) => {
    const s = ((2 * h[i] + h[j]) * delta[i] - h[i] * delta[j]) / (h[i] + h[j]);
    if (s * delta[i] <= 0) return 0;
    if (delta[i] * delta[j] < 0 && Math.abs(s) > Math.abs(3 * delta[i])) return 3 * delta[i];
    return s;
  };
  if (n >= 3) {
    d[0] = endSlope(0, 1);
    d[n - 1] = endSlope(n - 2, n - 3);
  } else {
    d[0] = d[n - 1] = n > 1 ? (ys[1] - ys[0]) / (xs[1] - xs[0]) : 0;
  }
  return d;
}

/** Evaluate one pchip-interpolated axis at parameter u in [0, n-1]. */
function pchipEval(xs          , ys          , d          , u        )         {
  const n = ys.length;
  const clamped = Math.max(0, Math.min(n - 1, u));
  let i = Math.floor(clamped);
  if (i >= n - 1) i = n - 2;
  const h = xs[i + 1] - xs[i];
  const s = (clamped - i) * h / (h || 1) * (h ? 1 : 0) + (clamped - i) * h;
  const t = (clamped - i);
  const t2 = t * t;
  const t3 = t2 * t;
  // Hermite basis
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  void s;
  return h00 * ys[i] + h10 * h * d[i] + h01 * ys[i + 1] + h11 * h * d[i + 1];
}

function slerp(a      , b      , t        )       {
  let bb = b;
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (dot < 0) {
    bb = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    return quatNorm([
      a[0] + t * (bb[0] - a[0]),
      a[1] + t * (bb[1] - a[1]),
      a[2] + t * (bb[2] - a[2]),
      a[3] + t * (bb[3] - a[3]),
    ]);
  }
  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sin0 = Math.sin(theta0);
  const s0 = Math.sin(theta0 - theta) / sin0;
  const s1 = Math.sin(theta) / sin0;
  return quatNorm([
    a[0] * s0 + bb[0] * s1,
    a[1] * s0 + bb[1] * s1,
    a[2] * s0 + bb[2] * s1,
    a[3] * s0 + bb[3] * s1,
  ]);
}

/**
 * Resample a waypoint list to `n` points.
 * `method` is "cubic" (pchip per axis) or "linear".
 */
export function interpWaypoints(
  waypoints            ,
  n        ,
  method                     = 'cubic',
)             {
  if (waypoints.length === 0) return [];
  if (waypoints.length === 1 || n <= 1) return waypoints.slice(0, Math.max(1, n));

  const m = waypoints.length;
  const xs = Array.from({ length: m }, (_, i) => i);
  const axis = (k           ) => waypoints.map((w) => w.p[k]);
  const slopes             = [];
  for (let k = 0; k < 3; k += 1) {
    slopes.push(method === 'cubic' ? pchipSlopes(xs, axis(k             )) : new Array(m).fill(0));
  }

  const out             = [];
  for (let i = 0; i < n; i += 1) {
    const u = (i / (n - 1)) * (m - 1);
    const seg = Math.min(m - 2, Math.floor(u));
    const t = u - seg;
    const p = [0, 1, 2].map((k) => (
      method === 'cubic'
        ? pchipEval(xs, axis(k             ), slopes[k], u)
        : waypoints[seg].p[k] + t * (waypoints[seg + 1].p[k] - waypoints[seg].p[k])
    ))                            ;
    // The pause and motor flags belong to the block boundary they were written
    // against, not to the whole segment: a drill pulse fires once, at the
    // waypoint that asked for it. The loop below puts them back on the exact
    // boundary waypoints.
    out.push({
      p,
      q: slerp(waypoints[seg].q, waypoints[seg + 1].q, t),
      pause: 0,
      motor: 0,
    });
  }
  // The MATLAB marks the exact block boundaries so the execution loop can pause
  // there; keep the flags on the waypoints closest to each original index.
  for (let k = 0; k < m; k += 1) {
    const idx = Math.round((k / (m - 1)) * (n - 1));
    out[idx].pause = waypoints[k].pause;
    out[idx].motor = waypoints[k].motor;
    out[idx].p = waypoints[k].p.slice()                            ;
  }
  return out;
}


//# sourceURL=/home/user/hardsoftwebgpu/ts/trunc/interp.ts