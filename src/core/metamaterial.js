/**
 * metamaterial.js — mechanical model of the two printed TRUNC cell families.
 * Mirror of `rust/trunc_core/src/metamaterial.rs`.
 *
 *   Truss      : helical lattice  → the torque channel (52× stiffer in torsion
 *                than in bending, up to 45° bend, keeps rotating continuously)
 *   Equatorial : slotted shell    → tendon guide, torsionally soft
 *
 * Numbers are calibrated on the paper's Instron traces (Fig. 2C/D, 3, S5/S6).
 */

import { clamp, deg } from './mathx.js';

export const MAX_BEND_RAD = deg(45);
export const ANGULAR_LIMIT_HARD = deg(48);
export const ANISOTROPY_DEFAULT = 52;

export const CELL_TRUSS = 0;
export const CELL_EQUATORIAL = 1;

export function cellKindName(kind) { return kind === CELL_EQUATORIAL ? 'equatorial' : 'truss'; }
export function cellStrutCount(kind) { return kind === CELL_TRUSS ? 8 : 6; }
export function cellRingCount(kind) { return kind === CELL_TRUSS ? 4 : 3; }

/** Create a cell descriptor (flat object, mirrors the Rust struct). */
export function truncCell(kind, length, outerRadius, opts = {}) {
  return {
    kind,
    length,
    outerRadius,
    innerRadius: opts.innerRadius ?? (kind === CELL_TRUSS ? outerRadius * 0.62 : outerRadius * 0.8),
    wall: opts.wall ?? (kind === CELL_TRUSS ? 0.0016 : 0.0012),
    anisotropy: opts.anisotropy ?? (kind === CELL_TRUSS ? ANISOTROPY_DEFAULT : 6.5),
  };
}

export function cellTruss(length, radius, anisotropy = ANISOTROPY_DEFAULT) {
  const c = truncCell(CELL_TRUSS, length, radius);
  c.anisotropy = anisotropy;
  return c;
}
export function cellEquatorial(length, radius) { return truncCell(CELL_EQUATORIAL, length, radius); }

const R_REF = 0.0245;
const L_REF = 0.08;
/**
 * Reference bending stiffness of one truss cell, N·m/rad.
 *
 * Calibrated on the paper's joint data: a segment (three cells in series) has
 * k_bend ≈ 0.38 N·m/rad, so a 45° joint bend needs ≈0.3 N·m — about 12 N of
 * tendon force on the 24.5 mm cable circle, which is exactly the regime the
 * 6 N preload / high-tension experiments run in. Torsion is `anisotropy` times
 * stiffer (52× for the truss family), which is why 1.4 N·m of fastening torque
 * costs only a few degrees of shaft wind-up.
 */
export const K_TRUSS_REF = 1.35;

/**
 * Assembled-joint stiffness scale.
 *
 * `bendingStiffness()` below predicts one *printed lattice* in isolation: the
 * struts' own bending path. A joint that actually goes on the arm also has the
 * equatorial guide cells, the cable-guide friction, the end fittings and the
 * shared tendon preload all taking part of the moment, so the measured joint is
 * several times stiffer than the bare lattice sum. The value is bounded by the
 * paper's own compliance measurements: at the rated wrench the tool point drifts
 * millimetres, not centimetres (2.1 mm point / 0.4 mm trajectory repeatability),
 * while the joint still reaches its full 45° bend under tendon actuation.
 */
export const ASSEMBLED_JOINT_SCALE = 6;

/** k ∝ R³/L, as for a thin-walled tube of a given lattice topology. */
export function bendingStiffness(cell) {
  const kind = cell.kind === CELL_TRUSS ? 1 : 0.55;
  const r = cell.outerRadius / R_REF;
  return K_TRUSS_REF * ASSEMBLED_JOINT_SCALE * kind * r * r * r * (L_REF / Math.max(cell.length, 1e-4));
}
export function torsionalStiffness(cell) { return bendingStiffness(cell) * cell.anisotropy; }
/** Axial stiffness, N/m: k ∝ R²/L. A segment gives ≈1.5 kN/m, i.e. 94 mm of
 * compression under 145 N of tendon force — the paper's 13.3 % stroke. */
export const K_AXIAL_REF = 5200;
export function axialStiffness(cell) {
  const kind = cell.kind === CELL_TRUSS ? 1 : 0.62;
  const r = cell.outerRadius / R_REF;
  return K_AXIAL_REF * kind * r * r * (L_REF / Math.max(cell.length, 1e-4));
}

/** Restoring bending torque τ(φ); stiffens as the cell approaches its 45° stop. */
export function bendingTorque(cell, bend) {
  const k = bendingStiffness(cell);
  const t = bend / MAX_BEND_RAD;
  return k * (bend + 0.45 * bend * t * t);
}

/** Inverse of `bendingTorque` — bend produced by a bending torque. */
export function bendForTorque(cell, torque) {
  const k = Math.max(bendingStiffness(cell), 1e-6);
  let phi = torque / k;
  for (let i = 0; i < 6; i += 1) {
    const t = phi / MAX_BEND_RAD;
    const f = k * (phi + 0.45 * phi * t * t) - torque;
    const df = Math.max(k * (1 + 1.35 * t * t), 1e-6);
    phi -= f / df;
  }
  return clamp(phi, -ANGULAR_LIMIT_HARD, ANGULAR_LIMIT_HARD);
}

/** Elastic wind-up of the truss shaft under a transmitted torque. */
export function twistForTorque(cell, torque) {
  const k = Math.max(torsionalStiffness(cell), 1e-6);
  const lin = torque / k;
  return lin + 0.08 * lin ** 3;
}

export function axialForce(cell, compression) {
  const k = axialStiffness(cell);
  const c = Math.max(compression, 0);
  return k * c * (1 + 0.9 * c / 0.03);
}

/** Transmission efficiency from the paper's efficiency study (bend + speed losses). */
export function efficiency(cell, bend, rpm) {
  const bendPen = 0.16 * Math.abs(bend / MAX_BEND_RAD) ** 1.4;
  const speedPen = 0.1 * Math.abs(rpm / 300) ** 1.6;
  const base = cell.kind === CELL_TRUSS ? 0.97 : 0.86;
  return clamp(base - bendPen - speedPen, 0.4, 0.995);
}

export function torsionalStiffnessAtBend(cell, bend) {
  const s = Math.min(Math.abs(bend / MAX_BEND_RAD), 1.4);
  return torsionalStiffness(cell) * Math.max(1 - 0.22 * s * s, 0.35);
}

/** Parasitic tip rotation when a bent shaft spins (measured cross-coupling). */
export function crossCoupling(cell, bend) { return 0.01 * (bend / MAX_BEND_RAD) ** 2; }

export function hysteresisDeadband() { return 0.004; }

/** A chain of identical cells (series springs) — one active segment / tendon guide. */
export function cellChain(cell, count) {
  return {
    cell,
    count,
    length: () => cell.length * count,
    bendingStiffness: () => bendingStiffness(cell) / count,
    torsionalStiffness: () => torsionalStiffness(cell) / count,
    axialStiffness: () => axialStiffness(cell) / count,
    torsionalStiffnessAtBend: (bend) => torsionalStiffnessAtBend(cell, bend) / count,
    maxBend: () => (MAX_BEND_RAD * count) / 3,
    efficiency: (bend, rpm) => efficiency(cell, bend, rpm),
    distribute: (bend) => bend / Math.max(count, 1),
    damping: () => bendingStiffness(cell) * 0.04,
  };
}

/** The printed cell families used by the arm. */
export function presetArmCells(segmentLength, radius) {
  return {
    truss: cellChain(cellTruss(segmentLength / 3, radius * 0.94), 3),
    equatorial: cellChain(cellEquatorial(segmentLength / 4, radius), 4),
  };
}
