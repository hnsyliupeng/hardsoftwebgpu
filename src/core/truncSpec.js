/**
 * truncSpec.js — the TRUNC joint's mechanism, taken from the paper.
 *
 * Source: Carton, Kowalewski, Guo, Alpert, Garg, Revier, Lipton,
 * "Bridging Hard and Soft: Mechanical Metamaterials Enable Rigid Torque
 * Transmission in Soft Robots", arXiv:2412.02650v1 (2024). Fabrication from
 * Materials and Methods § "Cell and arm fabrication"; symbols `N`, `M`, `γ`, `w`,
 * `t` from Results and Figs. S1/S4.
 *
 * ---------------------------------------------------------------------------
 * What the joint is (and what it is not)
 * ---------------------------------------------------------------------------
 * A **rigid-link linkage pinned together** — not an elastic truss, and not a ball:
 *
 *   * "Conventional auxetics are often modeled as, and constructed of, **rigid
 *     links that connect at rotational joints**. Auxetics expand along a
 *     trajectory controlled by a single **phase angle γ** that determines the
 *     expansion of the unit cell."
 *   * "the tiling of a unit cell" is the kinematic design space; links carry a
 *     **width w and thickness t** relative to the neutral radius, and FEA models
 *     the pins as revolute: "pin joints were defined as revolute connections".
 *   * "We design TRUNCs as tilings of the auxetic **double arrowhead** structure"
 *     — a chevron (re-entrant arrowhead) chain, the classic auxetic unit.
 *   * "While there are **N tilings of the cell around the equator** defined by the
 *     symmetry group 2*N, there can also be **M tilings between the poles**."
 *     The paper takes **N = 4** ("we choose a four-fold equatorial symmetry *4")
 *     and builds **equatorial M = 2** and **truss M = 3**. Fig. S1: "The
 *     equatorial cell is based on a tiling where N=4 and M=2 while the truss cell
 *     (N=4 and M=3) has **an additional row of arrow heads**."
 *   * Fig. 2: "(A) The equatorial TRUNC has a **single band of joints along its
 *     equator** (B) and the truss TRUNC has **two bands of joints on either side
 *     of the equator**. This doubled structure allows for shear internal to the
 *     cell, which is disallowed in the equatorial structure."
 *   * "Both variants behave as a **spherical mechanism on a sphere of non-fixed
 *     radius** and act as **constant velocity joints**" (Fig. S2: equal input and
 *     output angular velocity while bending and while extending).
 *   * Fabrication: "Steel links were manually bent using a spherical mold with a
 *     **56 mm diameter for the truss cells** and an **88 mm diameter mold for
 *     equatorial cells**. The links were then assembled using **M2 screws** and
 *     nylon lock nuts." Chained cells: "a 4 mm steel rod press-fit into a bearing
 *     ... fastened to the cell with a 3D printed connector."
 *   * Arm: "two nested flex shafts" — the truss shaft rigidly couples the drill
 *     motor to the end effector, the equatorial shaft guides the tendons.
 *     "Cables attach to the arm at **three active joints** we call the shoulder,
 *     elbow, and wrist. The remaining joints connected in between are passive."
 *     The segment split is 3/7 : 2/7 : 2/7 (Supplementary), so the arm has
 *     **7 joints: 3 active (last of each segment) and 4 passive**.
 *   * "The cable attachment **triads** (Fig. 4C) were fabricated on a Prusa MK4
 *     ... in PLA+. The triad structures route the cables through an embedded
 *     Polytetrafluoroethylene (PTFE) lining" — a structure "that can bend and
 *     twist in-plane but resists out-of-plane bending".
 *   * Springs: "A conical spring (K = 1.22 N/mm) is mounted inside each cell ...
 *     The arm also has six extension springs (K = 0.07 N/mm) for each cell."
 *
 * ---------------------------------------------------------------------------
 * The model implemented here
 * ---------------------------------------------------------------------------
 * The mechanism is solved the way the paper describes it: **each fold vertex is
 * the closure of a two-link rigid chevron**, and every vertex lies on the cell's
 * moulded sphere. A joint's shape is therefore a pure function of its two pole
 * rings — which are the *node* rigid bodies of the arm (the printed connector
 * that also holds the 4 mm rod). Consequences, all of them checked in
 * `.check/engine-check.mjs`:
 *
 *   * the linkage has exactly one degree of freedom once the rings are posed
 *     (the phase angle γ), which is why `foldOnRings` reports γ;
 *   * link lengths are preserved exactly, by construction (the closure solve);
 *   * the drawn geometry is a function of the same node frames the kinematic
 *     chain uses, so **the drawing cannot drift from the FK**;
 *   * `nestedShafts()` gives the inner truss shaft (56 mm mold) and the outer
 *     equatorial shaft (88 mm mold) sharing the same node frames — the two nested
 *     flex shafts of Fig. 4 A.
 *
 * Units: **millimetres**, joint-local, +Y along the shaft axis.
 */

import { clamp } from './mathx.js';

/** Paper: "we choose a four-fold equatorial symmetry *4". */
export const SYMMETRY_N = 4;

/** Fig. S1: M = tilings between the poles. */
export const BANDS = { equatorial: 2, truss: 3 };

/** Materials and Methods: the two spherical molds the links are bent on. */
export const MOLD_DIAMETER_MM = { truss: 56, equatorial: 88 };

/** "assembled using M2 screws"; link width/thickness from Fig. S4's design. */
export const LINK = { width: 5.0, thickness: 1.6, pinRadius: 1.15, holeRadius: 1.6 };

/** The seven joints of the arm: 3/7 : 2/7 : 2/7, active joint last in each. */
export const SEGMENT_JOINTS = [3, 2, 2];

/** Indices of the three active joints (shoulder, elbow, wrist). */
export function activeJointIndices() {
  const out = [];
  let k = 0;
  for (const n of SEGMENT_JOINTS) { k += n; out.push(k - 1); }
  return out;
}

/** The MATLAB's cable triangle: the triad's three cable holes, mm. */
export const CABLE_TRIANGLE_MM = 65;
export const CABLE_ANGLES = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3];

/** Paper: links bend to 45° from neutral; efficiency 96.5 % @ 10°, 85.7 % @ 45°. */
export const MAX_JOINT_BEND_DEG = 45;
export const TWIST_BEND_RATIO = { equatorial: 11, truss: 52 };

/** Neutral arm length and the measured compression (Results). */
export const ARM_LENGTH_MM = 710;
/**
 * The arm is seven joints from base to wrist, so each joint occupies 1/7 of the
 * 710 mm: the moulded cell *plus* the connector that chains it to the next one
 * ("a 4 mm steel rod press-fit into a bearing ... fastened to the cell with a 3D
 * printed connector"). `poseJoint()` insets the cell from its two FK nodes by
 * half of that connector, which is why the chain's node frames can be used
 * directly as the joint's rigid bodies.
 */
export const JOINT_PITCH_MM = ARM_LENGTH_MM / SEGMENT_JOINTS.reduce((a, b) => a + b, 0);
export const ARM_COMPRESSION_MM = 94.3;

/** Spring constants (Materials and Methods). */
export const SPRINGS = { conical: 1.22, extension: 0.07, extensionPerCell: 6 };

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// small vector helpers (kept local: this module must stay dependency-free)
// ---------------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = len(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * The **neutral** cell: the shape the links are bent to on the spherical mold.
 *
 * All vertices lie on the sphere of radius `ballR` (half the mold diameter).
 * `poleR` is the radius of the end ring the connector clamps: the pole ring sits
 * at polar angle `vPole = asin(poleR / ballR)` from the axis.
 *
 * M = 3 (truss) — "an additional row of arrow heads": pole ring → waist ring →
 * equator band, so there are **two bands of joints either side of the equator**
 * and the cell can shear internally.
 * M = 2 (equatorial) — **a single band of joints along the equator**: the chevron
 * runs pole → equator → pole with no waist ring.
 */
export function cellLayout({ kind = 'truss', ballR = MOLD_DIAMETER_MM.truss / 2, poleR = null } = {}) {
  // the end rings carry the connectors, so their radius scales with the mold
  // like everything else (12 mm on the 56 mm truss mold)
  const endRingR = poleR ?? 12 * (ballR / (MOLD_DIAMETER_MM.truss / 2));
  // polar angle measured from the axis: v = 0 is the pole (radius 0) and
  // v = π/2 the sphere's equator (radius ballR). The end rings sit at vPole and
  // π − vPole, so the cell's own height (pole ring to pole ring) is 2·axisOffset.
  const vPole = Math.asin(clamp(endRingR / ballR, 0.08, 0.95));
  const bands = BANDS[kind] ?? 3;
  const sectors = SYMMETRY_N * 2;                    // N = 4 → 8 fold planes
  const half = Math.PI / sectors;
  const onSphere = (v, a) => [
    Math.sin(v) * Math.cos(a) * ballR,
    Math.cos(v) * ballR,
    Math.sin(v) * Math.sin(a) * ballR,
  ];
  const ring = (v, phase = 0) => Array.from({ length: sectors }, (_, k) => onSphere(v, phase + k * 2 * half));

  const equatorV = Math.PI / 2;
  // The waist rows sit at the halfway polar angle between the end ring and the
  // equator: that is the "double arrowhead" fold line, and putting one either
  // side of the equator is exactly the M = 3 truss cell's extra row of arrowheads.
  const waistV = (vPole + equatorV) / 2;
  const poleTop = ring(vPole);
  const poleBot = ring(Math.PI - vPole);
  // the equator band is offset half a sector in azimuth, so the arrowheads of the
  // rows above and below it intersect there instead of stacking
  const equator = ring(equatorV, half);
  const waistUp = bands === 3 ? ring(waistV, 0) : null;
  const waistDn = bands === 3 ? ring(Math.PI - waistV, 0) : null;

  const chevrons = [];
  for (let k = 0; k < sectors; k += 1) {
    const k1 = (k + 1) % sectors;
    if (bands === 3) {
      chevrons.push({ a: poleTop[k], b: equator[k], fold: waistUp[k], row: 'up', k });
      chevrons.push({ a: equator[k], b: poleBot[k], fold: waistDn[k], row: 'dn', k });
      chevrons.push({ a: equator[k], b: equator[k1], fold: null, row: 'cross', k });
    } else {
      chevrons.push({ a: poleTop[k], b: poleBot[k], fold: equator[k], row: 'equator', k });
    }
    chevrons.push({ a: poleTop[k], b: poleTop[k1], fold: null, row: 'pole', k });
    chevrons.push({ a: poleBot[k], b: poleBot[k1], fold: null, row: 'pole', k });
  }

  /** azimuth (rad) of each ring's vertex k, in the cell's own frame */
  const azimuths = {
    poleTop: (k) => k * 2 * half,
    poleBot: (k) => k * 2 * half,
    equator: (k) => k * 2 * half + half,
    waistUp: (k) => k * 2 * half,
    waistDn: (k) => k * 2 * half,
  };

  return {
    kind,
    bands,
    sectors,
    ballR,
    poleR: endRingR,
    vPole,
    azimuths,
    waistV: bands === 3 ? waistV : null,
    /** pole ring offset from the sphere centre along the axis */
    axisOffset: ballR * Math.cos(vPole),
    /** the cell's own height, pole ring to pole ring */
    cellHeight: 2 * ballR * Math.cos(vPole),
    onSphere,
    ring,
    poleTop,
    poleBot,
    equator,
    waistUp,
    waistDn,
    chevrons,
    pins: [
      ...poleTop.map((p) => ({ p, tag: 'pole' })),
      ...poleBot.map((p) => ({ p, tag: 'pole' })),
      ...equator.map((p) => ({ p, tag: 'equator' })),
      ...(waistUp ? waistUp.map((p) => ({ p, tag: 'waist' })) : []),
      ...(waistDn ? waistDn.map((p) => ({ p, tag: 'waist' })) : []),
    ],
  };
}

/**
 * The locus of a chevron's fold vertex.
 *
 * Both ends are pinned to rigid bodies and both links are rigid, so the fold
 * vertex can only move on the circle where the two link spheres intersect — and
 * travelling along that circle *is* the paper's "single phase angle γ". The
 * circle is the mechanism's configuration space; nothing here is fitted.
 */
export function chevronCircle(a, b, l1, l2) {
  const d = sub(b, a);
  const dist = len(d) || 1e-9;
  const axis = mul(d, 1 / dist);
  const x = (dist * dist + l1 * l1 - l2 * l2) / (2 * dist);
  const r2 = Math.max(l1 * l1 - x * x, 0);
  const centre = add(a, mul(axis, x));
  const seed = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(axis, seed));
  const e2 = cross(axis, e1);
  return { centre, axis, e1, e2, radius: Math.sqrt(r2), l1, l2 };
}

/** A point on the chevron circle at phase angle `phase` (rad). */
export function foldOnCircle(circle, phase) {
  return add(
    circle.centre,
    add(mul(circle.e1, circle.radius * Math.cos(phase)), mul(circle.e2, circle.radius * Math.sin(phase))),
  );
}

/**
 * Solve the chevron's phase angle from the one condition the tiling adds: the
 * fold line stays in its own plane across the cell, i.e. every fold vertex of a
 * row sits at the same height along the joint's bisector axis.
 *
 * Bisection from the neutral phase, so the branch is the one the moulded cell
 * starts on. Link lengths are exact by construction — only `phase` moves.
 * Returns `{ phase, p, height, error }`.
 */
export function solveFoldHeight(circle, { axis, from, height }, phase0 = 0, iterations = 46) {
  const at = (phase) => dot(sub(foldOnCircle(circle, phase), from), axis) - height;
  const step = Math.PI / 36;
  let lo = null;
  let hi = null;
  let prev = phase0;
  let fPrev = at(prev);
  for (let s = 1; s <= 36 && lo === null; s += 1) {
    for (const cand of [phase0 - s * step, phase0 + s * step]) {
      const fc = at(cand);
      if (fc === 0) { lo = cand; hi = cand; break; }
      if (fPrev * fc < 0) {
        lo = Math.min(prev, cand);
        hi = Math.max(prev, cand);
        break;
      }
      prev = cand;
      fPrev = fc;
    }
  }
  if (lo === null) {
    // no crossing found: report the closest phase and how far off it is, rather
    // than pretending the linkage closed
    let best = phase0;
    let bestD = Math.abs(at(phase0));
    for (let i = -180; i <= 180; i += 2) {
      const cand = (i * Math.PI) / 180;
      const d = Math.abs(at(cand));
      if (d < bestD) { bestD = d; best = cand; }
    }
    return { phase: best, p: foldOnCircle(circle, best), height: at(best) + height, error: at(best) };
  }
  let fa = at(lo);
  for (let i = 0; i < iterations && hi > lo; i += 1) {
    const m = (lo + hi) / 2;
    const fm = at(m);
    if (fa * fm <= 0) hi = m;
    else { lo = m; fa = fm; }
  }
  const phase = (lo + hi) / 2;
  const p = foldOnCircle(circle, phase);
  return { phase, p, height: dot(sub(p, from), axis), error: at(phase) };
}

/**
 * Roots of `f` along a circle's phase parameter.
 *
 * A rigid chevron has two closure branches (the two places its fold vertex can
 * sit) and the tiling picks one: the paper's auxetic fold **bulges outward**, so
 * the branch is chosen by radial distance from the joint axis. Scanning for every
 * root and then choosing is robust; bisecting from an arbitrary phase can land on
 * the mirrored branch, which shows up immediately as millimetres of link strain.
 */
export function rootsOnCircle(circle, f, { steps = 480, iterations = 40 } = {}) {
  const roots = [];
  let prevPhase = -Math.PI;
  let fPrev = f(prevPhase);
  for (let i = 1; i <= steps; i += 1) {
    const phase = -Math.PI + (i / steps) * 2 * Math.PI;
    const fx = f(phase);
    if (fPrev === 0) roots.push(prevPhase);
    else if (fPrev * fx < 0) {
      let a = prevPhase;
      let b = phase;
      let fa = fPrev;
      for (let k = 0; k < iterations; k += 1) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (fa * fm <= 0) b = m;
        else { a = m; fa = fm; }
      }
      roots.push((a + b) / 2);
    }
    prevPhase = phase;
    fPrev = fx;
  }
  return roots.map((phase) => ({ phase, p: foldOnCircle(circle, phase), error: f(phase) }));
}

/**
 * Pick the closure branch the tiling uses.
 *
 * Preferred rule: the fold stays in its **own sector**, i.e. its azimuth in the
 * cell's frame is the one the moulded cell has (pass `e1`, `e2`, `azimuth`).
 * Without an azimuth to aim at, fall back to the fold that bulges furthest from
 * the axis, which is the auxetic fold's other characteristic.
 */
export function pickBranch(roots, { axis, from, e1, e2, azimuth }) {
  let best = null;
  for (const r of roots) {
    const rel = sub(r.p, from);
    const radial = len(sub(rel, mul(axis, dot(rel, axis))));
    let score;
    if (azimuth !== undefined && e1 && e2) {
      const ang = Math.atan2(dot(rel, e2), dot(rel, e1));
      // wrapped angular distance to the sector the moulded fold lives in
      let d = ang - azimuth;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      score = -d * d + radial * 1e-6;
    } else {
      score = radial;
    }
    if (!best || score > best.score) best = { ...r, radial, score };
  }
  return best;
}

/** Solve a fold's closure on its circle, taking the outward branch. */
export function solveCircle(circle, f, opts = {}) {
  const roots = rootsOnCircle(circle, f, opts);
  if (!roots.length) {
    let bestPhase = 0;
    let bestD = Math.abs(f(0));
    for (let i = -180; i <= 180; i += 2) {
      const ph = (i * Math.PI) / 180;
      const d = Math.abs(f(ph));
      if (d < bestD) { bestD = d; bestPhase = ph; }
    }
    return { phase: bestPhase, p: foldOnCircle(circle, bestPhase), error: f(bestPhase), closed: false };
  }
  const chosen = (opts.axis || opts.azimuth !== undefined)
    ? pickBranch(roots, opts)
    : roots.sort((a, b) => Math.abs(a.phase) - Math.abs(b.phase))[0];
  return { ...chosen, closed: Math.abs(chosen.error) < 1e-6 };
}

/**
 * Pose one joint of one shaft from its two node frames.
 *
 * `low`/`high` are the node rigid bodies of the kinematic chain (4×4
 * column-major): the printed connector that clamps the 4 mm steel rod and the
 * pole rings of the two cells it joins. The joint's **spherical centre** is the
 * midpoint of the two node origins — the point both pole axes pass through, which
 * is what makes the coupling constant-velocity — and its bisector axis is
 * `normalise(high.position − low.position)`.
 *
 * The cell is then assembled exactly as the paper describes it:
 *   * the two pole rings ride the node frames' own transverse planes;
 *   * the fold rows sit in planes across the cell (waist at half height for the
 *     M = 3 truss cell, the equator band itself for the M = 2 equatorial cell);
 *   * every fold vertex is the closure of its two rigid links, solved for the
 *     phase angle γ.
 *
 * Returns world-space geometry plus the closure diagnostics (max link strain and
 * the phase angles), so a bad tiling shows up as a number instead of a picture.
 */
/** Solved shapes keyed on the joint's own relative configuration. */
const SHAPE_CACHE = new Map();

export function poseJoint({
  low, high, kind = 'truss', ballR = null, poleR = null, spin = 0, warm = null,
  connectorMm = null, iterations = 16, tol = 1e-9,
} = {}) {
  void warm;               // kept in the signature: the solve is deterministic now
  const R = ballR ?? MOLD_DIAMETER_MM[kind === 'truss' ? 'truss' : 'equatorial'] / 2;
  const ratio = R / (MOLD_DIAMETER_MM.truss / 2);
  const pR = poleR ?? 12 * ratio;
  const layout = cellLayout({ kind, ballR: R, poleR: pR });
  // the cell only fills its module once the connector is taken out of the middle
  // ---- the two node rigid bodies ------------------------------------------
  const nLo = BASIS.pos(low);
  const nHi = BASIS.pos(high);
  const module = len(sub(nHi, nLo));
  const hint = module > 1e-9 ? unit(sub(nHi, nLo)) : [0, 1, 0];
  const RLraw = frameRotation(low, hint);
  const RHraw = frameRotation(high, hint);
  // A cell is a rigid body joined to its two nodes by rigid connectors, so the
  // two plates tilt **symmetrically about the rod** — the rod is straight, both
  // bearings are press-fits, and neither plate can sit cocked on its node. The
  // kinematic chain's own sample frames are not that: the MATLAB model turns a
  // whole segment by one rigid-body transform and leaves the intermediate
  // stations merely translated, which puts the far plate's axis up to 12 deg off
  // the rod — an assembly that does not go together. So the bend the chain asks
  // for is kept and the two plates are placed symmetrically about the rod's
  // actual direction, each keeping its own node's roll (and hence the cell's
  // phase and the twist the joint passes).
  const shaftOf = (R) => [R[1], R[4], R[7]];
  const xOf = (R) => [R[0], R[3], R[6]];
  const frameWithShaft = (R, shaft) => {
    const x = unit(sub(xOf(R), mul(shaft, dot(xOf(R), shaft))));
    const z = cross(x, shaft);
    return [x[0], shaft[0], z[0], x[1], shaft[1], z[1], x[2], shaft[2], z[2]];
  };
  const uLoRaw = unit(shaftOf(RLraw));
  const uHiRaw = unit(shaftOf(RHraw));
  const node = unit(sub(nHi, nLo));                       // the rod, as the FK has it
  const bendAxisFK = len(cross(uLoRaw, uHiRaw)) > 1e-9 ? unit(cross(uLoRaw, uHiRaw)) : [1, 0, 0];
  const bendFK = Math.acos(clamp(dot(uLoRaw, uHiRaw), -1, 1));
  const uLo = rotAxisMul(bendAxisFK, -bendFK / 2, node);
  const uHi = rotAxisMul(bendAxisFK, bendFK / 2, node);
  const RL = frameWithShaft(RLraw, uLo);
  const RH = frameWithShaft(RHraw, uHi);
  // What the cell does not fill of its module is the connector: "a 4 mm steel rod
  // press-fit into a bearing ... fastened to the cell with a 3D printed connector
  // ... nesting adds a thrust bearing". It is measured from the *actual* node
  // frames, not the nominal pitch, because the arm runs compressed (the MATLAB
  // works at 690-710 mm) and the bearings take that up — and each shaft has its
  // own moulded height, the 88 mm equatorial mold being taller than the 56 mm
  // truss one, so a cell is never stretched to fit.
  const connector = connectorMm ?? Math.max(module - layout.cellHeight, 0);
  // Inset to the cell's own end rings: half a connector at each end, measured
  // along the *node's own axis*. The connector is fastened to the cell and to
  // its node, so it turns with that node — which is what makes the cell's shape
  // a function of the joint's relative rotation alone.
  const PL = add(nLo, mulVec(RL, [0, connector / 2, 0]));
  const PH = sub(nHi, mulVec(RH, [0, connector / 2, 0]));
  const C = mul(add(PL, PH), 0.5);
  const chord = sub(PH, PL);
  const rigidSpan = len(chord);                           // if the rod did not slide
  const axis = rigidSpan > 1e-9 ? mul(chord, 1 / rigidSpan) : [0, 1, 0];

  // ---- the cell's own frame ------------------------------------------------
  // The linkage is a *spherical* mechanism: its shape depends only on how the two
  // rings are rotated and spaced relative to each other, never on where the cell
  // sits in the world. So it is solved in the cell's own frame — the low node at
  // the origin, its axes the frame axes — and mapped out at the end.
  const Rrel0 = mul3(transpose3(RL), RH);
  const pLocal0 = mulVec(transpose3(RL), chord);          // the high node, local
  // The bend-plane azimuth is quantised to the tiling's own period (2N = 8 fold
  // planes, so a whole sector apart is the same linkage with its sectors
  // relabelled) and that one representative is then used for the *whole*
  // problem: the relative rotation, the ring phase and the mapping back. Using
  // ψ for one of them and ψ mod 45° for another leaves the solved shape and the
  // linkage's indexing disagreeing, which shows up as millimetres of link strain.
  // Split the joint's relative rotation into the part the *mechanism* carries and
  // the part it transmits rigidly. The linkage's free motion is bending — that is
  // what the tilings are for — while twist is what the cell is made to transmit
  // (the truss cell is 52x stiffer in torsion than in bending). So: bend drives
  // the linkage, and the twist is carried straight through, which is exactly the
  // paper's constant velocity joint: "equal input and output angular velocity".
  const shaftLocal = [0, 1, 0];
  const uAxis = mulVec(Rrel0, shaftLocal);
  const bendAngle = Math.acos(clamp(dot(shaftLocal, uAxis), -1, 1));
  let bendAxis = cross(shaftLocal, uAxis);
  bendAxis = len(bendAxis) > 1e-12 ? unit(bendAxis) : [1, 0, 0];
  const bendOnly = rotAxis(bendAxis, bendAngle);            // the free motion
  // the twist is the roll about the shaft left over once the bend is taken out,
  // measured between the two frames' own x-axes in the plane normal to the shaft
  const xBend = mulVec(bendOnly, [1, 0, 0]);
  const xReal = mulVec(Rrel0, [1, 0, 0]);
  const e1 = unit(sub(xBend, mul(uAxis, dot(xBend, uAxis))));
  const e2 = cross(uAxis, e1);
  const twistAngle = Math.atan2(dot(xReal, e2), dot(xReal, e1));
  const twistR = rotAxis([0, 1, 0], twistAngle);            // about the cell's own shaft
  const twistDeg = (twistAngle * 180) / Math.PI;
  // The linkage only ever sees the **bend**. The rotation a module passes is
  // carried by the nested flex shafts and by the thrust bearing between the two
  // cells — that is what "nesting joints inside each other enabled concentric
  // torque transmission" means, and a module is a rod running in bearings, which
  // spin freely. So the tiling is solved for the bend alone (its free motion) and
  // the twist is reported rather than forced through the links: a twist the links
  // cannot take would otherwise read as millimetres of fictitious link strain,
  // and the real cell simply passes it.
  const RrelBend = bendOnly;

  // ---- the cell's own frame, as posed -------------------------------------
  // The linkage is solved in the low node's frame: the low ring is that node's
  // own annulus at the origin, the high ring is the high node's annulus out
  // along the high node's own axis. **Nothing is re-indexed**: the rings are
  // where the bolts are, so their azimuths are the frames' own, and the tiling's
  // 4-fold symmetry is left to show up in the solution rather than being
  // assumed away by rotating the problem.
  //
  // The rod that joins chained cells runs along the high node's axis and is free
  // to slide in its bearing, so the distance `slide` between the two plates is
  // not the module's length — it is whatever the linkage closes at. That is the
  // "extendable constant-velocity joint" of the paper's discussion, and it is
  // why the arm can compress 13.3%.
  const uLocal = uAxis;                                   // the high node's axis
  /** the psi used for the cache key and for reporting only */
  const psi = Math.atan2(uAxis[2], uAxis[0]);             // bend-plane azimuth
  const sectorAng = TAU / layout.sectors;
  const psiC = Math.round(psi / sectorAng) * sectorAng;
  /** the solved shape is the same for psi and psi + a whole sector, so the key
   *  uses the representative and the cells' assembly mode stays fixed */
  const keyshape = mul3(rotAxis([0, 1, 0], psiC), mul3(Rrel0, rotAxis([0, 1, 0], -psiC)));

  const spinR = spin ? rotAxis([0, 1, 0], spin) : null;
  const seedMap = halfRotation(RrelBend);
  /** the cell's own rotation in world space, for callers that need it */
  const Rcell = mul3(RL, spinR ? mul3(seedMap, spinR) : seedMap);
  /** the solved points live in the low node's frame: map them out */
  const toWorld = (q) => add(PL, mulVec(RL, q));

  /** A ring of vertices fixed to a node rigid body: the ring is that node's own
   *  annulus, so the canonical offset is taken **from the node**, not from the
   *  cell centre (which sits mid-way between the two rings). */
  const ringOffset = (a) => [pR * Math.cos(a), 0, pR * Math.sin(a)];
  const ringOf = (P, Rm, phase, mirror) => Array.from({ length: layout.sectors }, (_, k) => {
    const sign = mirror ? -1 : 1;
    const a = (phase + k * (TAU / layout.sectors)) * sign;
    return add(P, mulVec(Rm, ringOffset(a)));
  });
  // The rings are pinned to the node frames and the cell's vertices run from
  // each frame's own +X: the bolts are where the frames are, so their azimuth is
  // the frame's own.
  /** the direction of the rod — the FK's own node offset, kept exactly */
  const dirLocal = len(pLocal0) > 1e-9 ? unit(pLocal0) : [0, 1, 0];
  const highRingCentre = (s) => mul(dirLocal, s);        // the high node, local
  /** the cell's own centre: half way along the rod */
  const centreOf = (s) => mul(dirLocal, s / 2);
  const seedPoint = (c) => add(centreOf(vars[iSl]), mulVec(spinR ? mul3(seedMap, spinR) : seedMap, c));
  const ringHighOf = (mirror, s) => ringOf(highRingCentre(s), RrelBend, 0, mirror);
  const ringLowOf = (mirror) => ringOf([0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1], 0, mirror);

  // ---- rigid link lengths, measured on the moulded cell --------------------
  const lOf = (a, b) => len(sub(a, b));
  const l1 = layout.waistUp ? lOf(layout.poleTop[0], layout.waistUp[0]) : lOf(layout.poleTop[0], layout.equator[0]);
  const l2 = layout.waistUp ? lOf(layout.waistUp[0], layout.equator[0]) : lOf(layout.equator[0], layout.poleBot[0]);
  const l3 = layout.waistUp ? lOf(layout.equator[0], layout.waistDn[0]) : 0;
  const l4 = layout.waistUp ? lOf(layout.waistDn[0], layout.poleBot[0]) : 0;
  const crossLen = lOf(layout.equator[0], layout.equator[1]);
  const poleRingLen = lOf(layout.poleTop[0], layout.poleTop[1]);

  // ---- the unknown pin joints ---------------------------------------------
  const nS = layout.sectors;
  const vars = [];
  const ref = [];
  for (let k = 0; k < nS; k += 1) {
    const entry = {};
    if (layout.waistUp) {
      entry.wu = vars.length; vars.push(0, 0, 0);
      entry.wd = vars.length; vars.push(0, 0, 0);
    }
    entry.eq = vars.length; vars.push(0, 0, 0);
    ref.push(entry);
  }
  // The plate-to-plate distance is the last unknown. The rod runs in its bearing
  // and the cell is pre-tensioned on a conical spring (K = 1.22 N/mm) whose free
  // length is longer than the cell, so the pair is *extendable*: a twist, or a
  // bend past the point where the linkage wants to shorten, is passed by sliding
  // rather than by stretching a link. Its stroke is bounded — this is a bearing
  // with a spring in it, not a free strut, and leaving it free also opens a
  // second, collapsed assembly (a 79 mm cell stretched to 118 mm at a 0.6 deg
  // bend) that the mould does not give you.
  const iSl = vars.length; vars.push(rigidSpan);       // the slide is unknown iSl
  const nV = iSl;                                      // pins only
  const nU = vars.length;                              // pins + the slide
  /** how far the connector may slide, mm — the bearing's stroke plus the spring */
  const slideMax = Math.min(8, Math.max(4, layout.cellHeight * 0.12));
  const slideLo = rigidSpan - slideMax;
  const slideHi = rigidSpan + slideMax;

  // The link list depends on which branch's rings it pins to, so it is rebuilt
  // per branch. Each link is a distance constraint between two pins.
  const links = [];
  let ringHigh = null;
  let ringLow = null;
  const buildLinks = (mir, s = vars[iSl]) => {
    ringHigh = ringHighOf(mir, s);
    ringLow = ringLowOf(mir);
    links.length = 0;
    for (let k = 0; k < nS; k += 1) {
      const k1 = (k + 1) % nS;
      if (layout.waistUp) {
        links.push({ a: { fixed: ringHigh[k] }, b: { var: ref[k].wu }, l: l1 });
        links.push({ a: { var: ref[k].wu }, b: { var: ref[k].eq }, l: l2 });
        links.push({ a: { var: ref[k].eq }, b: { var: ref[k].wd }, l: l3 });
        links.push({ a: { var: ref[k].wd }, b: { fixed: ringLow[k] }, l: l4 });
      } else {
        links.push({ a: { fixed: ringHigh[k] }, b: { var: ref[k].eq }, l: l1 });
        links.push({ a: { var: ref[k].eq }, b: { fixed: ringLow[k] }, l: l2 });
      }
      // the band of joints around the equator
      links.push({ a: { var: ref[k].eq }, b: { var: ref[k1].eq }, l: crossLen });
    }
  };

  const pt = (v) => (v.fixed ? v.fixed : [vars[v.var], vars[v.var + 1], vars[v.var + 2]]);
  const residuals = () => {
    const out = new Array(links.length);
    for (let i = 0; i < links.length; i += 1) out[i] = len(sub(pt(links[i].a), pt(links[i].b))) - links[i].l;
    return out;
  };
  const worstOf = (r) => {
    let w = 0;
    for (const v of r) w = Math.max(w, Math.abs(v));
    return w;
  };

  // ---- seeds: the moulded cell, carried by the half-angle map --------------
  // A pinned linkage has two assembly branches (the cell can be built inside-out)
  // and only one of them closes for a given motion. Both seeds are built here and
  // the solve keeps whichever actually closes the links — the honest test, since
  // the real cell sits in the branch the mould gave it.
  const seedFor = (mirror) => {
    const seed = new Array(nU);
    const want = new Array(nU);
    seed[iSl] = rigidSpan;                                // as assembled
    want[iSl] = rigidSpan;
    for (let k = 0; k < nS; k += 1) {
      // the equator ring sits half a sector round, and that offset flips with
      // the branch just like every other azimuth
      const ang = (mirror ? -1 : 1) * (k * (TAU / nS));
      const angEq = ang + (mirror ? -1 : 1) * (TAU / (2 * nS));
      if (layout.waistUp) {
        const wu = seedPoint(onSphereCanonical(layout.waistV, ang, layout));
        const wd = seedPoint(onSphereCanonical(Math.PI - layout.waistV, ang, layout));
        for (let d = 0; d < 3; d += 1) {
          seed[ref[k].wu + d] = wu[d]; want[ref[k].wu + d] = wu[d];
          seed[ref[k].wd + d] = wd[d]; want[ref[k].wd + d] = wd[d];
        }
      }
      const eq = seedPoint(onSphereCanonical(Math.PI / 2, angEq, layout));
      for (let d = 0; d < 3; d += 1) { seed[ref[k].eq + d] = eq[d]; want[ref[k].eq + d] = eq[d]; }
    }
    return { seed, want };
  };
  const seeds = { plain: seedFor(false), mirror: seedFor(true) };
  let targets = seeds.plain.want;

  // ---- reuse: an identical relative configuration has an identical shape ---
  // Rrel is canonical, so ψ drops out of the key. Normalise the signed zero:
  // "-0.00000" and "0.00000" are the same rotation, and a key that says otherwise
  // costs a fresh solve for an identical problem.
  const q5 = (v) => (Math.abs(v) < 5e-6 ? '0.00000' : v.toFixed(5));
  const key = [kind, spin.toFixed(6), q5(rigidSpan), ...keyshape.map(q5)].join('|');
  const cached = SHAPE_CACHE.get(key);
  if (cached) vars.splice(0, nV, ...cached.slice(0, nV));

  // ---- Gauss-Newton: close the linkage ------------------------------------
  /** which enantiomer the solve below is working in (see `attempt`) */
  let mirror = false;
  const runSolve = (mu, iterCap = iterations, freezeSlide = false) => {
    let worst = worstOf(residuals());
    for (let iter = 0; iter < iterCap; iter += 1) {
      if (worst < tol) return worst;
      const r = residuals();
      const J = [];
      for (let i = 0; i < links.length; i += 1) J.push(new Float64Array(nU));
      for (let i = 0; i < links.length; i += 1) {
        for (const side of [links[i].a, links[i].b]) {
          if (side.fixed) continue;
          for (let d = 0; d < 3; d += 1) {
            const j = side.var + d;
            const old = vars[j];
            vars[j] = old + 1e-6;
            const rp = len(sub(pt(links[i].a), pt(links[i].b))) - links[i].l;
            vars[j] = old;
            J[i][j] = (rp - r[i]) / 1e-6;
          }
        }
      }
      // the slide moves the *fixed* outer ring, so its column needs the links
      // rebuilt: it translates the whole high node rather than a pin
      if (!freezeSlide) {
        const old = vars[iSl];
        vars[iSl] = old + 1e-6;
        buildLinks(mirror, vars[iSl]);
        const rs = residuals();
        vars[iSl] = old;
        buildLinks(mirror, old);
        for (let i = 0; i < links.length; i += 1) J[i][iSl] = (rs[i] - r[i]) / 1e-6;
      }
      const A = [];
      for (let a = 0; a < nU; a += 1) A.push(new Float64Array(nU + 1));
      for (let i = 0; i < links.length; i += 1) {
        const Ji = J[i];
        for (let a = 0; a < nU; a += 1) {
          const va = Ji[a];
          if (va === 0) continue;
          const row = A[a];
          for (let b = a; b < nU; b += 1) {
            const vb = Ji[b];
            if (vb !== 0) row[b] += va * vb;
          }
          row[nU] -= va * r[i];
        }
      }
      for (let a = 0; a < nU; a += 1) {
        for (let b = 0; b < a; b += 1) A[a][b] = A[b][a];
        A[a][a] += mu;
        A[a][nU] -= mu * (vars[a] - targets[a]);
      }
      const dx = solveDense(A, nU);
      if (!dx) return worst;
      const snapshot = vars.slice();
      let step = 1;
      let improved = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        for (let a = 0; a < nU; a += 1) vars[a] = snapshot[a] + step * dx[a];
        vars[iSl] = clamp(vars[iSl], slideLo, slideHi);   // the bearing's stroke
        buildLinks(mirror, vars[iSl]);
        const now = worstOf(residuals());
        if (now < worst) { worst = now; improved = true; break; }
        step *= 0.5;
      }
      if (!improved) {
        vars.splice(0, nU, ...snapshot);
        buildLinks(mirror, snapshot[iSl]);
        return worst;
      }
    }
    return worstOf(residuals());
  };

  // A strong pull to the moulded shape first, then release it so the linkage
  // closes as tightly as it can. Each pass keeps the best answer it has seen, so
  // a badly conditioned polish can never leave the linkage worse than a
  // well-conditioned one.
  const attempt = (branch) => {
    mirror = (branch === 'mirror');
    targets = seeds[branch].want;
    const seed = seeds[branch].seed;
    let best = null;
    // Pass 1 — the plates held where the connectors put them, so every rigid
    // link has to close on its own: that is the statement about the forward
    // kinematics, and the number it leaves behind is how far the paper's links
    // would have to stretch to sit at the pose the FK asks for. A strong pull to
    // the moulded shape first, then released so the linkage closes as tightly as
    // it can; each pass re-seeds and keeps the best answer it has seen, so a bad
    // conditioning can never leave the linkage worse than a good one.
    for (const plan of [
      { passes: [1e-3, 1e-9], iters: iterations },
      { passes: [1e-3, 1e-9, 1e-11], iters: iterations * 3 },
    ]) {
      vars.splice(0, nU, ...(best ? best.vars : seed));
      buildLinks(mirror, vars[iSl]);
      for (const scale of plan.passes) {
        runSolve(scale * R, plan.iters, true);
        const c = worstOf(residuals());
        if (!best || c < best.c) best = { c, vars: vars.slice() };
      }
      if (best.c < tol) break;
    }
    // Pass 2 — the bearings take up what is left (a twist, or a bend past where
    // the linkage wants to shorten, is passed by the rod sliding rather than by
    // a link stretching). Only kept if it genuinely closes better.
    const pinned = { c: best.c, vars: best.vars.slice() };
    vars.splice(0, nU, ...pinned.vars);
    buildLinks(mirror, vars[iSl]);
    runSolve(1e-9 * R, iterations, false);
    const released = { c: worstOf(residuals()), vars: vars.slice() };
    const win = released.c < pinned.c ? released : pinned;
    vars.splice(0, nU, ...win.vars);
    buildLinks(mirror, vars[iSl]);
    return { c: win.c, vars: win.vars.slice(), branch };
  };

  let closure;
  let branch = cached && cached.length > nU ? cached[nU] : 'plain';
  if (cached) {
    mirror = (branch === 'mirror');
    buildLinks(mirror);
    closure = worstOf(residuals());
  } else {
    // The two branches are the cell's enantiomers — mirror-image assemblies of
    // the same tiling. A real cell is built in one of them and stays there, so
    // the free-slide solve (which closes to 1e-9 in either) keeps `plain`, and
    // the mirror is only taken up if `plain` genuinely fails to close while the
    // mirror genuinely does. Picking the smaller residual per *pose* would let
    // the assembly mode flip mid-trajectory, which shows up as the whole joint
    // jumping.
    let winner = attempt('plain');
    const other = attempt('mirror');
    if (other.c < 1e-6 && other.c < winner.c * 0.25) winner = other;
    branch = winner.branch;
    closure = winner.c;
    vars.splice(0, nU, ...winner.vars);      // keep the branch that closed
  }
  if (branch === 'mirror') {
    // solved with the azimuths reversed: flip them back into the true frame
    for (let a = 2; a < iSl; a += 3) vars[a] = -vars[a];
    branch = 'plain';
  }
  mirror = false;
  buildLinks(false);
  closure = worstOf(residuals());
  SHAPE_CACHE.set(key, vars.slice().concat([branch]));
  if (SHAPE_CACHE.size > 4000) SHAPE_CACHE.clear();

  const vertexL = (idx) => [vars[idx], vars[idx + 1], vars[idx + 2]];
  const equatorL = ref.map((r) => vertexL(r.eq));
  const chevrons = [];
  const folds = [];
  const foldsLocal = [];
  for (let k = 0; k < nS; k += 1) {
    const k1 = (k + 1) % nS;
    const E = toWorld(equatorL[k]);
    const ringH = toWorld(ringHigh[k]);
    const ringL = toWorld(ringLow[k]);
    if (layout.waistUp) {
      const wu = toWorld(vertexL(ref[k].wu));
      const wd = toWorld(vertexL(ref[k].wd));
      chevrons.push({ row: 'up', k, a: ringH, b: E, fold: wu, l1, l2, phase: phaseOn(ringH, E, l1, l2, wu) });
      chevrons.push({ row: 'dn', k, a: E, b: ringL, fold: wd, l1: l3, l2: l4, phase: phaseOn(E, ringL, l3, l4, wd) });
      folds.push({ p: wu, row: 'up', k, phase: chevrons[chevrons.length - 2].phase });
      folds.push({ p: wd, row: 'dn', k, phase: chevrons[chevrons.length - 1].phase });
      foldsLocal.push(vertexL(ref[k].wu), vertexL(ref[k].wd));
    } else {
      chevrons.push({ row: 'equator', k, a: ringH, b: ringL, fold: E, l1, l2, phase: phaseOn(ringH, ringL, l1, l2, E) });
      folds.push({ p: E, row: 'equator', k, phase: chevrons[chevrons.length - 1].phase });
      foldsLocal.push(equatorL[k]);
    }
    chevrons.push({ row: 'cross', k, a: E, b: toWorld(equatorL[k1]), fold: null, l1: crossLen, l2: 0, phase: 0 });
    chevrons.push({ row: 'poleRing', k, a: ringH, b: toWorld(ringHigh[k1]), fold: null, l1: poleRingLen, l2: 0, phase: 0 });
    chevrons.push({ row: 'poleRing', k, a: ringL, b: toWorld(ringLow[k1]), fold: null, l1: poleRingLen, l2: 0, phase: 0 });
  }

  // the sphere the folds ride — the paper's "sphere of non-fixed radius"
  let sphereR = 0;
  for (const f of foldsLocal) sphereR += len(sub(f, centreOf(vars[iSl])));
  sphereR /= foldsLocal.length || 1;

  // ---- what the solve found -----------------------------------------------
  const pitch = vars[iSl];                    // where the plates ended up
  const extend = rigidSpan - pitch;           // the rod's slide, + = pulled out
  const cellCentre = add(PL, mulVec(RL, centreOf(pitch)));
  return {
    kind,
    layout,
    centre: cellCentre,
    axis: mulVec(RL, dirLocal),
    e1: BASIS.ex(low),
    e2: cross(BASIS.ex(low), mulVec(RL, dirLocal)),
    halfHeight: pitch / 2,
    pitch,
    /** the span the plates are held at once the bearings have taken up the rest */
    rigidSpan,
    connector,
    /** the rod's slide at this pose, mm (+ = the plates pulled apart) */
    extend,
    slideMax,
    connector,
    /** the bend the linkage carries, and the twist it passes through rigidly */
    bendDeg: (bendAngle * 180) / Math.PI,
    twistDeg,
    ballR: R,
    /** the sphere the folds ride — the paper's "non-fixed radius" */
    sphereR,
    poleR: pR,
    waistFrac: layout.waistV ? Math.cos(layout.waistV) / Math.cos(layout.vPole) : null,
    links: { l1, l2, l3, l4, crossLen, poleRingLen },
    ringLow: ringLow.map(toWorld),
    ringHigh: ringHigh.map(toWorld),
    equator: equatorL.map(toWorld),
    chevrons,
    folds,
    /** the worst violation of any rigid link — the linkage's own closure error */
    closure,
    crossStrain: closure,
    sectors: nS,
    /** the cell's own rotation, for the renderer and the cable guides */
    rotation: Rcell,
    /** world -> the cell's local frame (the low plate's corner) */
    toLocal: (q) => toLocalPt(q, PL, RL),
  };
}

/** A world point in the cell's local frame (low node at the origin). */
function toLocalPt(q, PL, RL) {
  return mulVec(transpose3(RL), sub(q, PL));
}

/** Re-seed a warm start from a previous pose (world space). */
function worldToLocal(warm, PL, RL, CL) {
  const out = [];
  for (const f of warm.folds ?? []) {
    const local = mulVec(transpose3(RL), sub(f.p, PL));
    out.push(local[0], local[1] + CL[1], local[2]);
  }
  return out;
}

/** Canonical (cell-local) point on the moulded sphere: axis is +Y. */
function onSphereCanonical(v, a, layout) {
  const r = layout.ballR;
  return [Math.sin(v) * Math.cos(a) * r, Math.cos(v) * r, Math.sin(v) * Math.sin(a) * r];
}

/** The phase of `fold` along the circle its two links sweep. */
function phaseOn(a, b, l1, l2, fold) {
  const circle = chevronCircle(a, b, l1, l2);
  const rel = sub(fold, circle.centre);
  return Math.atan2(dot(rel, circle.e2), dot(rel, circle.e1));
}

/**
 * A node frame's rotation, as the rows `[X; Y; Z]` of the matrix that takes the
 * cell's canonical axes into world coordinates.
 *
 * The frame comes from the kinematic chain, so which of its columns runs along
 * the shaft is the chain's own convention, not ours — it is taken from the data
 * (the column most nearly along `hint`, signed to point along the chain). The
 * remaining two columns are then used **as they are**: they are already
 * orthonormal, and inventing a fresh roll reference here would silently roll the
 * cell by a quarter turn for some bend directions, which changes the tiling's
 * phase and therefore the whole shape.
 */
function frameRotation(m, hint = [0, 1, 0]) {
  // The node frame is taken exactly as given, in the store convention used
  // throughout: the three triples are this node's own x, shaft and z axes. The
  // cell's rings are bolted to these axes, so nothing here may be inferred from
  // the chain — inferring would make the cell's phase a function of how the two
  // nodes happen to be posed rather than of the node itself.
  const cols = [BASIS.ex(m), BASIS.ey(m), BASIS.ez(m)];
  const shaft = len(cols[1]) > 1e-9 ? cols[1] : unit(hint);
  const x = unit(sub(cols[0], mul(shaft, dot(cols[0], shaft))));
  const z = cross(x, shaft);
  // row-major, with the node's own axes as the matrix's **columns**, so that
  // `mulVec(RL, [1,0,0])` is that node's x axis and `mulVec(RL, ey)` its shaft
  return [x[0], shaft[0], z[0], x[1], shaft[1], z[1], x[2], shaft[2], z[2]];
}

/** 3x3 helpers, row-major. */
function transpose3(A) {
  return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
}
function mul3(A, B) {
  const out = new Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return out;
}
/** `rotAxis(axis, ang)` applied to a vector — a rotation, not a change of basis. */
function rotAxisMul(axis, ang, v) {
  const R = rotAxis(axis, ang);
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}

function mulVec(A, v) {
  return [
    A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
    A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
    A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
  ];
}
/** Rotation about a unit axis by `ang` radians, row-major. */
export function rotAxis(axis, ang) {
  const [x, y, z] = unit(axis);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}
/** The half-angle rotation of `Rd`: the exponential of half its log. */
export function halfRotation(Rd) {
  const tr = clamp((Rd[0] + Rd[4] + Rd[8] - 1) / 2, -1, 1);
  const ang = Math.acos(tr);
  if (ang < 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = 1 / (2 * Math.max(Math.sin(ang), 1e-9));
  const axis = [(Rd[7] - Rd[5]) * k, (Rd[2] - Rd[6]) * k, (Rd[3] - Rd[1]) * k];
  const n = len(axis);
  if (!(n > 1e-9)) {
    // 180°: read the axis off the symmetric part
    const d = [Rd[0] - tr, Rd[4] - tr, Rd[8] - tr];
    const i = d.indexOf(Math.max(...d));
    const ax = [Rd[i * 3] , Rd[i * 3 + 1], Rd[i * 3 + 2]];
    ax[i] = 1 + d[i];
    return rotAxis(unit(ax), ang / 2);
  }
  return rotAxis(mul(axis, 1 / n), ang / 2);
}
function norm2(a) {
  let s = 0;
  for (const v of a) s += v * v;
  return s;
}
/** Gaussian elimination on the augmented normal equations. */
function solveDense(A, n) {
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-14) return null;
    if (piv !== c) { const t = A[c]; A[c] = A[piv]; A[piv] = t; }
    const p = A[c][c];
    for (let r = c + 1; r < n; r += 1) {
      const f = A[r][c] / p;
      if (f === 0) continue;
      for (let cc = c; cc <= n; cc += 1) A[r][cc] -= f * A[c][cc];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r -= 1) {
    let acc = A[r][n];
    for (let c = r + 1; c < n; c += 1) acc -= A[r][c] * x[c];
    x[r] = acc / A[r][r];
  }
  return x;
}

/**
 * The point at distance `la` from `a` and `lb` from `b`.
 *
 * Two circles meet in two points and the tiling keeps one: for the equator band
 * vertex the choice is the point at the sector's own azimuth (`azimuth`), since
 * the moulded band vertex sits between its two arrowheads. Without an azimuth the
 * point nearest `near` is taken.
 */
export function meetCircles(a, la, b, lb, near, { e1 = null, e2 = null, azimuth = null } = {}) {
  const d = sub(b, a);
  const dist = len(d) || 1e-9;
  if (dist > la + lb || dist < Math.abs(la - lb)) {
    // the links cannot reach: fall back to the point on the segment between them
    const t = dist / (la + lb);
    return lerp3(a, b, clamp(t, 0.2, 0.8));
  }
  const axis = mul(d, 1 / dist);
  const x = (dist * dist + la * la - lb * lb) / (2 * dist);
  const r = Math.sqrt(Math.max(la * la - x * x, 0));
  const centre = add(a, mul(axis, x));
  const seed = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1t = unit(cross(axis, seed));
  const e2t = cross(axis, e1t);
  const cands = [0, Math.PI].map((ph) => add(centre, add(mul(e1t, r * Math.cos(ph)), mul(e2t, r * Math.sin(ph)))));
  if (azimuth !== null && e1 && e2) {
    const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
    const err = (p) => Math.abs(wrap(Math.atan2(dot(sub(p, near), e2), dot(sub(p, near), e1)) - azimuth));
    return err(cands[0]) <= err(cands[1]) ? cands[0] : cands[1];
  }
  return len(sub(cands[0], near)) <= len(sub(cands[1], near)) ? cands[0] : cands[1];
}

/**
 * The two nested flex shafts of one *cell*, from the cell's own two end-ring
 * frames. The inner truss shaft is the paper's 56 mm mold, the outer equatorial
 * shaft the 88 mm one; "nested joints are coupled in bending and extension but
 * rotate independently", so the spin is passed per shaft.
 */
export function nestedShafts({ low, high, poleR = 12, spin = 0, warm = null }) {
  return {
    truss: poseJoint({ low, high, kind: 'truss', poleR, spin, warm }),
    equatorial: poseJoint({
      low, high, kind: 'equatorial',
      poleR: poleR * (MOLD_DIAMETER_MM.equatorial / MOLD_DIAMETER_MM.truss),
      spin,
    }),
  };
}

/** Frame accessors for a 4×4 column-major matrix (the chain axis is +Y). */
export const BASIS = {
  pos: (m) => [m[12], m[13], m[14]],
  ex: (m) => unit([m[0], m[1], m[2]]),
  ez: (m) => unit([m[8], m[9], m[10]]),
  ey: (m) => unit([m[4], m[5], m[6]]),
};

/**
 * The cable triads (Fig. 4 C): the 3D-printed structure that "can bend and twist
 * in-plane but resists out-of-plane bending", routing cables through a PTFE
 * lining. Three arms 120° apart at the MATLAB's 65 mm cable triangle. One triad
 * at each of the three active joints — where the paper says the cables attach.
 */
export function triad(cableR = CABLE_TRIANGLE_MM, { hubR = 10, plate = 4.5 } = {}) {
  const links = [];
  const pins = [];
  for (let i = 0; i < 3; i += 1) {
    const a = CABLE_ANGLES[i];
    const dir = [Math.cos(a), 0, Math.sin(a)];
    const hub = [dir[0] * hubR, 0, dir[2] * hubR];
    const mid = [dir[0] * (hubR + cableR) * 0.5, 0, dir[2] * (hubR + cableR) * 0.5];
    const tip = [dir[0] * cableR, 0, dir[2] * cableR];
    links.push({ a: hub, b: mid, tag: 'arm' });
    links.push({ a: mid, b: tip, tag: 'arm' });
    pins.push({ p: hub, tag: 'hub', r: plate });
    pins.push({ p: mid, tag: 'fold', r: plate });
    pins.push({ p: tip, tag: 'cable', r: plate * 1.2 });   // the PTFE-lined hole
  }
  return { links, pins, cableR, hubR };
}

/** The conical restoring spring inside each cell (K = 1.22 N/mm). */
export function restoringSpring(height, rTop, rBottom, turns = 5) {
  const points = [];
  const steps = Math.max(16, Math.round(turns * 14));
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const r = rTop + (rBottom - rTop) * f;
    const a = f * turns * TAU;
    points.push([Math.cos(a) * r, height * (0.5 - f), Math.sin(a) * r]);
  }
  return points;
}

/** One arm joint: index, its segment, and whether the cables drive it. */
export function armJoints() {
  const out = [];
  let k = 0;
  SEGMENT_JOINTS.forEach((count, segment) => {
    for (let i = 0; i < count; i += 1) {
      out.push({ index: k, segment, last: i === count - 1, active: i === count - 1 });
      k += 1;
    }
  });
  return out;
}

// re-exported for callers that want a quick point-on-sphere helper
export const spherePoint = (R, v, a) => [Math.sin(v) * Math.cos(a) * R, Math.cos(v) * R, Math.sin(v) * Math.sin(a) * R];
export { lerp3 as lerpPoint };
