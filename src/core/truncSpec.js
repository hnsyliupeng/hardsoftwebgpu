/**
 * truncSpec.js — the TRUNC joint's geometry, taken from the paper.
 *
 * Source: Carton, Kowalewski, Guo, Alpert, Garg, Revier, Lipton,
 * "Bridging Hard and Soft: Mechanical Metamaterials Enable Rigid Torque
 * Transmission in Soft Robots", arXiv:2412.02650v1 (2024).
 *
 * What the paper actually specifies, and where:
 *
 *   * the joint is a **tiling of the auxetic double-arrowhead cell** wrapped on a
 *     sphere, i.e. a spherical mechanism of non-fixed radius  (§ Design and
 *     mechanical analysis, Fig. 2 A/B)
 *   * symmetry is `2*N` (orbifold notation) with **N = 4 chosen four-fold
 *     equatorial symmetry**, so there are four fold pairs around the axis
 *   * two variants differ in the number of bands between the poles:
 *     **equatorial M = 2** (a single band of joints along the equator) and
 *     **truss M = 3** (two bands, one either side of the equator, which allows
 *     shear internal to the cell)
 *   * the truss cells used in the arm are **D = 56 mm** in diameter
 *     (§ Supplementary: "normalized using the truss joints in the arm (D = 56 mm)")
 *   * a joint bends up to **45°** and the cell transmits torque about its axis
 *     (the stiff mode) with a **twist-to-bend stiffness ratio of 52** (truss) and
 *     **11** (equatorial)
 *   * the arm's body is **two nested flex shafts**: the truss shaft is nested
 *     inside the equatorial shaft, which guides the actuation tendons
 *     (§ A soft robotic arm composed of TRUNCs, Fig. 4 A)
 *   * nine cables in three groups of three attach at the **shoulder, elbow and
 *     wrist**; the joints in between are passive (§ same)
 *   * the cables attach through spring structures that bend and twist in-plane
 *     but resist out-of-plane bending (Fig. 4 C) — drawn here as the three-arm
 *     guides the tendons thread through
 *   * the arm is **l = 710 mm** neutral, compresses Δl = 94.3 mm (13.3 %), and
 *     the workspace is a ø600 mm circle in plan
 *   * a **conical spring inside the truss cell** provides the restoring force
 *     without transmitting torque (Fig. 2 E)
 *
 * The kinematic model in `ts/trunc` (from the authors' MATLAB) splits the 695 mm
 * insertable length 3L/7 : 2L/7 : 2L/7 and puts an active joint at each split.
 * This module keeps that segmentation and lays the cells out along it: three
 * cells in the shoulder segment, two in the elbow, two in the wrist — seven
 * nested joint units, each one a truss cell inside an equatorial cell.
 *
 * Everything here is in **millimetres**, cell-local, +Y along the shaft axis.
 */

/** Paper: diameter of the truss cells used in the arm. */
export const CELL_DIAMETER_MM = 56;

/**
 * Four-fold equatorial symmetry `2*4`, as the paper chooses: four fold pairs
 * around the axis, i.e. eight half-sectors of the double-arrowhead tiling.
 */
export const SYMMETRY_N = 4;

/**
 * Band count between the poles: the equatorial variant has one band at the
 * equator (M = 2), the truss variant two, one either side (M = 3).
 */
export const BAND_COUNT = { equatorial: 2, truss: 3 };

/** Neutral arm length and the compression the paper measures. */
export const ARM_LENGTH_MM = 710;
export const ARM_COMPRESSION_MM = 94.3;

/** Cells per segment, matching the MATLAB 3L/7 : 2L/7 : 2L/7 split. */
export const CELLS_PER_SEGMENT = [3, 2, 2];

/** Joint bend limit and the paper's stiffness ratios (twist : bend). */
export const JOINT_BEND_DEG = 45;
export const TWIST_BEND_RATIO = { equatorial: 11, truss: 52 };

const TAU = Math.PI * 2;

/**
 * The double-arrowhead cell, in cell-local millimetres.
 *
 * Built as the paper describes: a tiling about the shaft axis. Each of the
 * `SYMMETRY_N` fold pairs contributes an arrowhead pointing at each pole; the
 * two directions of the tiling meet at the equator, where the jointed pins sit.
 *
 * Returns `{ struts, pins }`:
 *   struts — `[[x,y,z], [x,y,z]]` pairs, the physical links between pins
 *   pins   — the pin joints, where the links rotate
 *
 * @param {'truss'|'equatorial'} kind
 * @param {number} diameter cell diameter, mm (paper: 56)
 * @param {number} height   axial extent of the cell, mm
 * @param {object} opts     `{ waist }` equator radius as a fraction of the rim
 */
export function cellLattice(kind, diameter = CELL_DIAMETER_MM, height = CELL_DIAMETER_MM, opts = {}) {
  const R = diameter / 2;
  const half = height / 2;
  const bands = BAND_COUNT[kind] ?? 3;
  // The pole caps and the equator ring: the auxetic cell is widest at the
  // equator and narrows towards the two poles, which is what makes the mechanism
  // a spherical joint.
  const rPole = R * (opts.pole ?? 0.30);
  const rWaist = R * (opts.waist ?? 0.92);
  const n = SYMMETRY_N;              // fold pairs around the axis
  const sectors = n * 2;             // half-sectors of the tiling

  const at = (r, angle, y) => [Math.cos(angle) * r, y, Math.sin(angle) * r];
  const struts = [];
  const pins = [];

  /** One double-arrowhead band: pole ring → equator → pole ring. */
  const band = (yTop, yBot, rOuter, yMid, rMid, phase) => {
    for (let i = 0; i < sectors; i += 1) {
      const a0 = (i / sectors) * TAU + phase;
      const aMid = ((i + 0.5) / sectors) * TAU + phase;
      const pole0 = at(rPole, a0, yTop);
      const waist = at(rMid, aMid, yMid);
      const pole1 = at(rPole, a0 + TAU / sectors, yBot);
      // the arrowhead: two links meeting at the mid-pin, which is the "double
      // arrowhead" vertex of the auxetic tiling
      struts.push([pole0, waist]);
      struts.push([waist, pole1]);
      pins.push(waist);
      pins.push(pole0);
    }
  };

  if (bands === 2) {
    // equatorial: one band of joints along the equator (Fig. 2 A)
    band(half, -half, R, 0, rWaist, 0);
  } else {
    // truss: two bands either side of the equator (Fig. 2 B). The extra internal
    // degree of freedom is what lets the cell shear.
    band(half, 0, R, half * 0.5, rWaist, 0);
    band(0, -half, R, -half * 0.5, rWaist, TAU / sectors / 2);
    pins.push(at(rWaist, 0, 0));
  }

  // short links joining the equator pins of one band to the next, which is what
  // makes the band a closed lattice rather than a set of independent chevrons
  for (let i = 0; i < sectors; i += 1) {
    const a0 = (i / sectors) * TAU;
    const a1 = ((i + 1) / sectors) * TAU;
    struts.push([at(rWaist, a0 + TAU / sectors / 2, 0), at(rWaist, a1 + TAU / sectors / 2, 0)]);
  }
  // pole rings: the cell's two hubs, which is where consecutive cells key in
  for (let i = 0; i < sectors; i += 1) {
    const a0 = (i / sectors) * TAU;
    const a1 = ((i + 1) / sectors) * TAU;
    struts.push([at(rPole, a0, half), at(rPole, a1, half)]);
    struts.push([at(rPole, a0, -half), at(rPole, a1, -half)]);
  }

  return { struts, pins, radius: R, height };
}

/**
 * The three-arm cable guide (paper Fig. 4 C): a structure that bends and twists
 * in-plane but resists out-of-plane bending, and carries the actuation tendons.
 * Three arms at 120°, which is the cable triangle the authors' MATLAB uses.
 *
 * @param {number} cableRadius mm — the MATLAB cable triangle is 65 mm
 * @param {number} hubRadius   mm
 */
export function guideArms(cableRadius = 65, hubRadius = 9) {
  const struts = [];
  const pins = [];
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU + Math.PI / 2;
    const hub = [Math.cos(a) * hubRadius, 0, Math.sin(a) * hubRadius];
    const tip = [Math.cos(a) * cableRadius, 0, Math.sin(a) * cableRadius];
    const mid = [Math.cos(a) * (hubRadius + cableRadius) * 0.5, 0, Math.sin(a) * (hubRadius + cableRadius) * 0.5];
    struts.push([hub, mid]);
    struts.push([mid, tip]);
    pins.push(mid);
    pins.push(tip);
  }
  // the hub ring the arms grow from
  for (let i = 0; i < 6; i += 1) {
    const a0 = (i / 6) * TAU;
    const a1 = ((i + 1) / 6) * TAU;
    struts.push([
      [Math.cos(a0) * hubRadius, 0, Math.sin(a0) * hubRadius],
      [Math.cos(a1) * hubRadius, 0, Math.sin(a1) * hubRadius],
    ]);
  }
  return { struts, pins, cableRadius };
}

/** Where the nine tendons attach, in cell-local mm (3 per active joint). */
export function cableAngles() {
  return [0, 1, 2].map((i) => (i / 3) * TAU + Math.PI / 2);
}

/**
 * A conical spring for inside the truss cell (paper Fig. 2 E): it restores the
 * arm without transmitting torque, because a coil has no torsional constraint.
 */
export function conicalSpring(height, rTop, rBottom, turns = 5) {
  const points = [];
  const steps = Math.max(16, Math.round(turns * 12));
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const r = rTop + (rBottom - rTop) * f;
    const a = f * turns * TAU;
    points.push([Math.cos(a) * r, height * (0.5 - f), Math.sin(a) * r]);
  }
  return points;
}
