/**
 * kinematics.ts — the constant-curvature model, ported from kinematics.m.
 *
 * The original MATLAB built the model *symbolically* with `syms` and then
 * substituted numbers; here it is a plain function of the joint state. The
 * structure is kept exactly:
 *
 *   T_shoulder = Seg(t1, t2, -3L/7)
 *   T_elbow    = T_shoulder * Seg(t3, t4, -2L/7)
 *   T_wrist    = T_elbow    * Seg(t5, t6, -2L/7)
 *   T_tool     = T_wrist    * Seg(0, 0, -d_tool)
 *
 * with
 *
 *   Seg(θ1, θ2, d) = Rz(-θ2) · Tz(d) · Rx(θ1) · Rz(θ2)
 *
 * The nine tendons are measured between the corners of a 120°-spaced triangle
 * of radius `cableRadius` (65 mm in the MATLAB) on consecutive segment frames —
 * that triangle is why bending *and* the bending plane both change cable length.
 */

import type { ArmPose, JointState, Mat4, Vec3 } from './types.js';
import {
  add3, apply, identity, mul, norm3, rotX, rotZ, sub3, translation, translationMatrix,
} from './math.js';

/** Dimensions the MATLAB used (millimetres). */
export const TRUNC = {
  /** `L_n = 710 - 15` in kinematics.m */
  length: 695,
  /** tool offset beyond the wrist */
  toolLength: 83,
  /** cable attachment circle radius (kinematics.m `tri_origin`) */
  cableRadius: 65,
  /** segment split of L: shoulder 3/7, elbow 2/7, wrist 2/7 */
  split: [3 / 7, 2 / 7, 2 / 7] as const,
  /** joint bounds from the sweep in kinematics.m */
  maxShoulder: 50,
  maxElbow: 50,
  maxWrist: 40,
  maxCompression: 70,
  /** setup.m safety window for the servo commands */
  servoMin: -250,
  servoMax: 150,
} as const;

export const SEGMENT_NAMES = ['shoulder', 'elbow', 'wrist'] as const;

/** `Segment_transform(theta_1, theta_2, d)` from kinematics.m. */
export function segmentTransform(t1: number, t2: number, d: number): Mat4 {
  const rz = rotZ(t2);
  const rzm = rotZ(-t2);
  const rx = rotX(t1);
  const tz = translationMatrix(d);
  return mul(mul(rzm, tz), mul(rx, rz));
}

/** The cable triangle: four corners at radius `r`, 120° apart, on the segment frame. */
export function cableTriangle(r: number): Mat4 {
  const h = Math.sin(Math.PI / 3);
  const c = Math.cos(Math.PI / 3);
  const m = identity();
  // column-major columns are the four corner points (x, y, z, 1)
  const corners: Vec3[] = [[0, r, 0], [r * h, -r * c, 0], [-r * h, -r * c, 0], [0, r, 0]];
  corners.forEach((p, i) => {
    m[i * 4] = p[0];
    m[i * 4 + 1] = p[1];
    m[i * 4 + 2] = p[2] ?? 0;
    m[i * 4 + 3] = 1;
  });
  return m;
}

/** Cable corner positions of a frame, in world coordinates. */
export function cornersOf(T: Mat4, r: number): Vec3[] {
  const tri = cableTriangle(r);
  return [0, 1, 2].map((i) => apply(T, [tri[i * 4], tri[i * 4 + 1], tri[i * 4 + 2]]));
}

/**
 * The three cable lengths of one segment: distance from the segment's own corner
 * ring to the same corner of the *next* frame — the MATLAB's `cable_space`.
 */
export function segmentCables(from: Mat4, to: Mat4, r: number): Vec3 {
  const a = cornersOf(from, r);
  const b = cornersOf(to, r);
  return [
    norm3(sub3(b[0], a[0])),
    norm3(sub3(b[1], a[1])),
    norm3(sub3(b[2], a[2])),
  ];
}

/** Forward kinematics + cable lengths for a joint state. */
export function forward(state: JointState, cableRadius = TRUNC.cableRadius): ArmPose {
  const [s0, s1, s2] = TRUNC.split;
  const T1 = segmentTransform(state.t1, state.t2, -s0 * state.L);
  const T2 = mul(T1, segmentTransform(state.t3, state.t4, -s1 * state.L));
  const T3 = mul(T2, segmentTransform(state.t5, state.t6, -s2 * state.L));
  const T4 = mul(T3, segmentTransform(0, 0, -state.toolLength));

  const shoulder = segmentCables(identity(), T1, cableRadius);
  const elbow = segmentCables(T1, T2, cableRadius);
  const wrist = segmentCables(T2, T3, cableRadius);

  // MATLAB output order in cable_space(): [w1, e1, s1, w2, e2, s2, w3, e3, s3]
  const cables = [
    wrist[0], elbow[0], shoulder[0],
    wrist[1], elbow[1], shoulder[1],
    wrist[2], elbow[2], shoulder[2],
  ];

  return {
    T: [T1, T2, T3, T4],
    segments: [shoulder, elbow, wrist],
    cables,
    position: [T4[12], T4[13], T4[14]],
  };
}

/** Convenience: tool position only. */
export function toolPosition(state: JointState): Vec3 {
  return forward(state).position;
}

/** A zeroed joint state (straight arm, tool offset included). */
export function homeState(overrides: Partial<JointState> = {}): JointState {
  return {
    t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, t6: 0,
    L: TRUNC.length, toolLength: TRUNC.toolLength, ...overrides,
  };
}

/**
 * Greedy nearest-neighbour tour over sampled tool positions — the "Greedy
 * solution to TSP" in kinematics.m, which is what makes the trajectory
 * continuous instead of jumping around the workspace.
 */
export function greedyTour<T extends { position: Vec3 }>(samples: T[]): T[] {
  if (samples.length < 3) return samples.slice();
  const used = new Array(samples.length).fill(false);
  const out: T[] = [samples[0]];
  used[0] = true;
  let cur = 0;
  for (let k = 1; k < samples.length; k += 1) {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < samples.length; j += 1) {
      if (used[j]) continue;
      const d = norm3(sub3(samples[j].position, samples[cur].position));
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best < 0) break;
    used[best] = true;
    out.push(samples[best]);
    cur = best;
  }
  return out;
}

/**
 * Random configuration sweep — the `%% Sweep over configuration space` block of
 * kinematics.m. The bounds are degrees (as the MATLAB wrote them) and the
 * returned joint state is radians, matching `JointState`. A full reproduction
 * of MATLAB's Mersenne Twister is out of scope; the caller passes the RNG, so
 * results are reproducible either way.
 */
export function sweepConfigurations(count: number, rand: () => number, bounds = {
  maxShoulder: TRUNC.maxShoulder,
  maxElbow: TRUNC.maxElbow,
  maxWrist: TRUNC.maxWrist,
  maxCompression: TRUNC.maxCompression,
}): JointState[] {
  const out: JointState[] = [];
  const spread = (max: number) => (rand() - 0.5) * 2 * max;
  for (let i = 0; i < count; i += 1) {
    const t1 = i === 0 ? 0 : spread(bounds.maxShoulder) * Math.PI / 180;
    const t2 = i === 0 ? 0 : spread(bounds.maxShoulder) * Math.PI / 180;
    const t3 = t1;
    const t4 = t2;
    const t5 = i === 0 ? 0 : spread(bounds.maxWrist) * Math.PI / 180;
    const t6 = i === 0 ? 0 : spread(bounds.maxWrist) * Math.PI / 180;
    const L = i === 0 ? TRUNC.length : TRUNC.length - rand() * bounds.maxCompression;
    out.push({ t1, t2, t3, t4, t5, t6, L, toolLength: TRUNC.toolLength });
  }
  return out;
}

/** Spine polyline through the four frames (base, shoulder, elbow, wrist, tool). */
export function spinePoints(pose: ArmPose): Vec3[] {
  return [
    [0, 0, 0],
    apply(pose.T[0], [0, 0, 0]),
    apply(pose.T[1], [0, 0, 0]),
    apply(pose.T[2], [0, 0, 0]),
    pose.position,
  ];
}

/** Attachment corners for every frame, for drawing the tendons. */
export function tendonPaths(pose: ArmPose, cableRadius = TRUNC.cableRadius): Vec3[][] {
  const frames = [identity(), pose.T[0], pose.T[1], pose.T[2]];
  const out: Vec3[][] = [];
  for (let c = 0; c < 3; c += 1) {
    out.push(frames.map((T) => {
      const corners = cornersOf(T, cableRadius);
      return corners[c];
    }));
  }
  return out;
}

/** Centroid of a cable triangle (used by the animation for the "ring" markers). */
export function ringCentre(T: Mat4, cableRadius = TRUNC.cableRadius): Vec3 {
  const c = cornersOf(T, cableRadius);
  return add3(add3(c[0], c[1]), c[2]).map((v) => v / 3) as Vec3;
}
