// Deep structural coupling: one structure's geometry is driven by another structure's field, so the
// parts are not simply unioned. Five rounds, each adding a different coupling dimension:
//
//   R1 thickness  : TPMS (gyroid) wall thickness is set by the distance to a cellular (Voronoi foam) field.
//                   Parameter coupling across families.
//   R2 nested     : Kelvin lattice grows inside the pores of a tubular matrix and bonds to the pore walls.
//                   Scale-separated nesting (multi-level).
//   R3 twist      : a BCC lattice is twisted about z by a helical angle, so the lattice itself is deformed.
//                   Orientation coupling with the helical family.
//   R4 blend      : Kelvin -> gyroid -> I-WP in three z-zones joined by a smooth minimum (fillets, no seam plane).
//                   Multi-material transition.
//   R5 hierarchy  : a gyroid sheet fills every pocket of a cellular foam and bonds to the foam walls.
//                   Hierarchical infill.
//   R6 morph      : the structure changes type inside one field: a gyroid sheet in the core, a BCC strut lattice in
//                   the outer shell, blended over a radial transition zone. Topology (sheet to strut) coupling.
//   R7 grading    : a gyroid whose period along z grows with height (3 mm at the base to 7 mm at the top; x and y
//                   period 5 mm) at constant wall thickness. Scale coupling by a one-dimensional coordinate warp
//                   (single structure; not a cross-structure coupling).
//   R8 radius     : a BCC strut lattice whose strut radius is set by a gyroid field (r = r0 + A tanh(g F)), so the struts
//                   swell and thin with the sheet. Two structures coupled inside one field.
//   R9 gated      : interpenetrating phases. A Schwarz D sheet occupies one side of a gyroid gate surface and a BCC
//                   lattice the other side, joined by a smooth minimum. Two families gated by a third field.
//
// All fields are signed distances in millimetres on the box [0, L]^3 (negative inside the solid).

import { type Field, sdBox, sdCylinderZ } from "./fields.ts";
import { strutLattice, tpmsShell, tpmsValueGrad } from "./lattice.ts";
import type { LatticeType, TpmsType } from "../types.ts";
import { buildBio, toMillimetres } from "../bio/families.ts";
import { sampleField } from "../geometry/grid.ts";

export type CoupledRound = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12";

export interface CoupledSpec {
  round: CoupledRound;
  /** Free numeric parameters (defaults per round are in ROUND_DEFAULTS). */
  params?: Record<string, number | string>;
}

// Every round also carries a closed envelope skin (skin_mm), the same design rule as the periodic
// lattices and TPMS in the gallery: a clipped periodic structure is otherwise not one solid.
const ROUND_DEFAULTS: Record<CoupledRound, Record<string, number | string>> = {
  R1: { cell_mm: 5, t_min_mm: 0.5, t_max_mm: 1.2, driver_scale_mm: 0.4, driver_grid: 120, skin_mm: 1 },
  R2: { lattice: "kelvin", lattice_cell_mm: 2, strut_radius_mm: 0.3, hole_radius_mm: 2, hole_pitch_mm: 5, skin_mm: 1 },
  R3: { lattice: "bcc", lattice_cell_mm: 4, strut_radius_mm: 0.4, twist_deg: 90, skin_mm: 1 },
  R4: { lattice: "kelvin", lattice_cell_mm: 4, strut_radius_mm: 0.4, tpms_a: "gyroid", tpms_b: "iwp", tpms_cell_mm: 5, tpms_wall_mm: 0.5, blend_mm: 1.5, skin_mm: 1 },
  R5: { foam_grid: 120, gyroid_cell_mm: 4, gyroid_wall_mm: 0.5, skin_mm: 1 },
  R6: { lattice: "bcc", lattice_cell_mm: 4, strut_radius_mm: 0.4, tpms_cell_mm: 5, tpms_wall_mm: 0.5, core_radius_mm: 5.5, morph_width_mm: 2, skin_mm: 0 },
  R7: { a_bottom_mm: 3, a_top_mm: 7, a_ref_mm: 5, wall_mm: 0.5, skin_mm: 0 },
  R8: { lattice: "bcc", lattice_cell_mm: 4, strut_radius_mm: 0.45, radius_amp_mm: 0.1, gyroid_gain: 1, tpms_cell_mm: 5, skin_mm: 0 },
  R9: { lattice: "bcc", lattice_cell_mm: 4, strut_radius_mm: 0.4, sheet: "schwarz_d", sheet_cell_mm: 5, sheet_wall_mm: 0.5, gate_cell_mm: 8, blend_mm: 0.3, skin_mm: 0 },
  R10: { lattice: "bcc", lattice_cell_mm: 4, strut_radius_mm: 0.4, radius_amp_mm: 0.1, sheet: "schwarz_d", sheet_cell_mm: 5, sheet_wall_mm: 0.7, sheet_amp_mm: 0.2, gate_cell_mm: 8, dominance_mm: 1, blend_mm: 0.2, skin_mm: 0 },
  R11: { gyroid_cell_mm: 5, level_c0: 0, level_amp: 0.35, gate_cell_mm: 8, level_width_mm: 1.5, skin_mm: 0 },
  R12: { gyroid_cell_mm: 5, level_lo: 0, level_hi: 0.35, gate_cell_mm: 8, level_width_mm: 1.5, skin_mm: 0 },
};

export interface CoupledBuild {
  field: Field;
  description: string;
  observations: string[];
  limitations: string[];
  /** Measured evidence that the coupling is active (sampled deterministically on the box). */
  coupling_metrics: Record<string, number | string>;
  resolved_params: Record<string, number | string>;
}

// ---- helpers --------------------------------------------------------------------------------

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Polynomial smooth minimum with blend radius k (k = 0 gives the hard minimum). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

/**
 * Trilinear cache of an expensive field, sampled on an n^3 grid over its bounds.
 * Used for the cellular (Voronoi) field, which costs ~100 distance evaluations per point.
 */
export function cacheField(f: Field, n: number): Field {
  const g = sampleField(f, n, 2);
  const { nx, ny, nz, origin, h, values } = g;
  return {
    bounds: f.bounds,
    expr: `trilinear cache (${n} samples per axis) of [${f.expr}]`,
    eval(x: number, y: number, z: number): number {
      const fx = Math.min(nx - 1.000001, Math.max(0, (x - origin[0]) / h));
      const fy = Math.min(ny - 1.000001, Math.max(0, (y - origin[1]) / h));
      const fz = Math.min(nz - 1.000001, Math.max(0, (z - origin[2]) / h));
      const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
      const tx = fx - i, ty = fy - j, tz = fz - k;
      const at = (a: number, b: number, c: number) => values[a + nx * (b + ny * c)];
      const c00 = at(i, j, k) * (1 - tx) + at(i + 1, j, k) * tx;
      const c10 = at(i, j + 1, k) * (1 - tx) + at(i + 1, j + 1, k) * tx;
      const c01 = at(i, j, k + 1) * (1 - tx) + at(i + 1, j, k + 1) * tx;
      const c11 = at(i, j + 1, k + 1) * (1 - tx) + at(i + 1, j + 1, k + 1) * tx;
      return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
    },
  };
}

function boxField(L: number, expr: string, eval_: (x: number, y: number, z: number) => number): Field {
  return { bounds: { min: [0, 0, 0], max: [L, L, L] }, expr, eval: eval_ };
}

const boxDist = (L: number, x: number, y: number, z: number) =>
  sdBox(x - L / 2, y - L / 2, z - L / 2, L / 2, L / 2, L / 2);

/** Deterministic uniform samples in the box (for coupling metrics). */
function samplePoints(L: number, n: number, seed = 7): [number, number, number][] {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) out.push([rnd() * L, rnd() * L, rnd() * L]);
  return out;
}

const num = (p: Record<string, number | string>, k: string) => Number(p[k]);

// ---- R1: thickness driven by a cellular foam ------------------------------------------------

function buildR1(L: number, p: Record<string, number | string>) {
  const bio = buildBio("cellular_generic", {}, 42);
  const foamRaw = toMillimetres(bio.baseField, L);
  const foam = cacheField(foamRaw, num(p, "driver_grid"));
  const type = "gyroid" as TpmsType;
  const a = num(p, "cell_mm");
  const k = (2 * Math.PI) / a;
  const tMin = num(p, "t_min_mm"), tMax = num(p, "t_max_mm"), dS = num(p, "driver_scale_mm");
  // Wall thickness rises near the foam walls (distance d < 0 in the wall) and falls in the pockets.
  const thickAt = (x: number, y: number, z: number) => tMin + (tMax - tMin) * (1 - smoothstep(-dS, dS, foam.eval(x, y, z)));
  // Note: the foam field is a base-frame field scaled to mm, not an exact distance (values about -0.8 .. 0.8).
  const field = boxField(L, `max(|F|/|grad F| - t(d)/2, sdBox); F = gyroid(2pi x/${a}); t(d)=${tMin}..${tMax} mm driven by cellular foam distance d (scale ${dS})`, (x, y, z) => {
    const [F, gx, gy, gz] = tpmsValueGrad(type, k * x, k * y, k * z);
    const gn = Math.hypot(gx, gy, gz) * k + 1e-12;
    return Math.max(Math.abs(F) / gn - thickAt(x, y, z) / 2, boxDist(L, x, y, z));
  });
  const pts = samplePoints(L, 4000);
  let tWall = 0, nWall = 0, tPocket = 0, nPocket = 0, tMinObs = Infinity, tMaxObs = -Infinity;
  for (const [x, y, z] of pts) {
    const d = foam.eval(x, y, z);
    const t = thickAt(x, y, z);
    tMinObs = Math.min(tMinObs, t); tMaxObs = Math.max(tMaxObs, t);
    if (d < -dS / 2) { tWall += t; nWall++; } else if (d > dS / 2) { tPocket += t; nPocket++; }
  }
  return {
    field,
    description: `R1 thickness-driven gyroid (t ${tMin}-${tMax} mm) over a cellular foam driver`,
    metrics: {
      t_min_observed_mm: +tMinObs.toFixed(3),
      t_max_observed_mm: +tMaxObs.toFixed(3),
      t_mean_near_foam_walls_mm: nWall ? +(tWall / nWall).toFixed(3) : 0,
      t_mean_in_pockets_mm: nPocket ? +(tPocket / nPocket).toFixed(3) : 0,
      foam_base: bio.base.id,
    },
    observations: [`Gyroid thickness is set by the foam distance field: thick near foam walls, thin in pockets.`],
  };
}

// ---- R2: lattice nested in tubular pores ----------------------------------------------------

function buildR2(L: number, p: Record<string, number | string>) {
  const type = String(p.lattice) as LatticeType;
  const pitch = num(p, "hole_pitch_mm"), rh = num(p, "hole_radius_mm");
  const n = Math.round(L / pitch);
  if (Math.abs(n * pitch - L) > 1e-9) throw new Error(`R2: hole pitch ${pitch} must divide the box size ${L}`);
  const centres: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centres.push([pitch / 2 + i * pitch, pitch / 2 + j * pitch]);
  // Pore field: negative inside any pore (infinite cylinders along z).
  const holeAt = (x: number, y: number) => {
    let best = Infinity;
    for (const [cx, cy] of centres) best = Math.min(best, sdCylinderZ(x, y, cx, cy, rh));
    return best;
  };
  const cells = Math.round(L / num(p, "lattice_cell_mm"));
  const lat = strutLattice({ type, cellSize: L / cells, cells: [cells, cells, cells], radius: num(p, "strut_radius_mm") });
  // Matrix = box minus pores; infill = lattice restricted to the pores; union, with the infill bonded to the walls.
  const field = boxField(L, `min( max(sdBox, -holes) , max(${lat.expr}, holes) )  holes = ${n}x${n} pores r=${rh} mm, pitch ${pitch} mm`, (x, y, z) => {
    const h = holeAt(x, y);
    const matrix = Math.max(boxDist(L, x, y, z), -h);
    const infill = Math.max(lat.eval(x, y, z), h);
    return Math.min(matrix, infill);
  });
  const pts = samplePoints(L, 6000, 11);
  let inPore = 0, solidInPore = 0;
  for (const [x, y, z] of pts) {
    if (holeAt(x, y) < 0) { inPore++; if (field.eval(x, y, z) < 0) solidInPore++; }
  }
  return {
    field,
    description: `R2 ${type} lattice nested in ${n * n} tubular pores (r ${rh} mm, pitch ${pitch} mm)`,
    metrics: { pores: n * n, pore_infill_solid_fraction: inPore ? +(solidInPore / inPore).toFixed(4) : 0, lattice_cells: cells },
    observations: [`Pores are filled with a ${type} lattice; infill is clipped to each pore wall so it bonds to the matrix.`],
  };
}

// ---- R3: helically twisted lattice ----------------------------------------------------------

function buildR3(L: number, p: Record<string, number | string>) {
  const type = String(p.lattice) as LatticeType;
  const a = num(p, "lattice_cell_mm");
  const r = num(p, "strut_radius_mm");
  const twist = (num(p, "twist_deg") * Math.PI) / 180;
  // The lattice is evaluated in a padded domain so that rotated points still land inside it.
  const pad = a * Math.ceil((0.71 * L) / a);
  const nxy = Math.round((L + 2 * pad) / a), nz = Math.round(L / a);
  const lat = strutLattice({ type, cellSize: a, cells: [nxy, nxy, nz], radius: r });
  const field = boxField(L, `max( ${lat.expr} evaluated at Rz(-phi(z)) p ,  sdBox ); phi(z) = ${twist} rad * z/L`, (x, y, z) => {
    const phi = twist * (z / L);
    const dx = x - L / 2, dy = y - L / 2;
    const c = Math.cos(phi), s = Math.sin(phi);
    const qx = L / 2 + c * dx + s * dy + pad;
    const qy = L / 2 - s * dx + c * dy + pad;
    return Math.max(lat.eval(qx, qy, z), boxDist(L, x, y, z));
  });
  return {
    field,
    description: `R3 ${type} lattice twisted by ${num(p, "twist_deg")} deg along z (helical orientation field)`,
    metrics: { twist_total_deg: num(p, "twist_deg"), twist_rate_deg_per_mm: +(num(p, "twist_deg") / L).toFixed(3), lattice_cells_xy: nxy, lattice_cells_z: nz },
    observations: [`Each z-slice of the ${type} lattice is rotated by the helical angle phi(z); the deformation is a point map, so the sign of the field is exact.`],
  };
}

// ---- R4: smooth three-zone blend ------------------------------------------------------------

function buildR4(L: number, p: Record<string, number | string>) {
  const k = num(p, "blend_mm");
  const z1 = L / 3, z2 = (2 * L) / 3;
  const latType = String(p.lattice) as LatticeType;
  const lat = strutLattice({ type: latType, cellSize: num(p, "lattice_cell_mm"), cells: [5, 5, 5], radius: num(p, "strut_radius_mm") });
  const tpA = String(p.tpms_a) as TpmsType, tpB = String(p.tpms_b) as TpmsType;
  const cellT = num(p, "tpms_cell_mm");
  const wallT = num(p, "tpms_wall_mm");
  const nT = Math.round(L / cellT);
  const B = tpmsShell({ type: tpA, cellSize: L / nT, cells: [nT, nT, nT], thickness: wallT });
  const C = tpmsShell({ type: tpB, cellSize: L / nT, cells: [nT, nT, nT], thickness: wallT });
  const field = boxField(L, `smin( smin(zoneA, zoneB, ${k}), zoneC, ${k} )  zones at ${z1.toFixed(2)} / ${z2.toFixed(2)} mm; A=${latType} lattice, B=${tpA}, C=${tpB}`, (x, y, z) => {
    const zoneA = Math.max(lat.eval(x, y, z), z - (z1 + k));
    const zoneB = Math.max(B.eval(x, y, z), Math.max(z1 - k - z, z - (z2 + k)));
    const zoneC = Math.max(C.eval(x, y, z), z2 - k - z);
    return smin(smin(zoneA, zoneB, k), zoneC, k);
  });
  const pts = samplePoints(L, 4000, 13);
  let sa = 0, sb = 0, sc = 0, nA = 0, nB = 0, nC = 0;
  for (const [x, y, z] of pts) {
    const v = field.eval(x, y, z) < 0 ? 1 : 0;
    if (z < z1) { sa += v; nA++; } else if (z < z2) { sb += v; nB++; } else { sc += v; nC++; }
  }
  return {
    field,
    description: `R4 three-zone blend: ${latType} lattice | ${tpA} | ${tpB} joined by smooth minimum (radius ${k} mm)`,
    metrics: {
      zone_low_solid_fraction: +(sa / nA).toFixed(4),
      zone_mid_solid_fraction: +(sb / nB).toFixed(4),
      zone_high_solid_fraction: +(sc / nC).toFixed(4),
      blend_radius_mm: k,
    },
    observations: [`Three zones: ${latType} lattice below z=${z1.toFixed(2)} mm, ${tpA} between, ${tpB} above z=${z2.toFixed(2)} mm, joined by a smooth minimum (no planar seam).`],
  };
}

// ---- R5: gyroid sheet infilling every foam pocket ------------------------------------------

function buildR5(L: number, p: Record<string, number | string>) {
  const bio = buildBio("cellular_generic", {}, 42);
  const foam = cacheField(toMillimetres(bio.baseField, L), num(p, "foam_grid"));
  const a = num(p, "gyroid_cell_mm");
  const nG = Math.round(L / a);
  const G = tpmsShell({ type: "gyroid", cellSize: L / nG, cells: [nG, nG, nG], thickness: num(p, "gyroid_wall_mm") });
  // foam < 0 in the walls, > 0 in the pockets. The gyroid lives only where foam > 0; it is united with the walls.
  const field = boxField(L, `min( foam , max( gyroid , -foam ) )  foam=${bio.base.id} (cached), gyroid cell ${a} mm`, (x, y, z) => {
    const v = foam.eval(x, y, z);
    return Math.min(v, Math.max(G.eval(x, y, z), -v));
  });
  const pts = samplePoints(L, 6000, 17);
  let pocket = 0, pocketFilled = 0, solid = 0;
  for (const [x, y, z] of pts) {
    const v = foam.eval(x, y, z);
    const s = field.eval(x, y, z) < 0;
    if (s) solid++;
    if (v > 0) { pocket++; if (s) pocketFilled++; }
  }
  return {
    field,
    description: `R5 gyroid infill (cell ${a} mm) in every pocket of a cellular foam (${bio.base.id})`,
    metrics: { pocket_fill_fraction: pocket ? +(pocketFilled / pocket).toFixed(4) : 0, solid_fraction: +(solid / pts.length).toFixed(4) },
    observations: [`Foam walls are kept; each pocket is filled with a gyroid sheet, which bonds to the walls.`],
  };
}

// ---- R6: sheet-to-strut morph ---------------------------------------------------------------

function buildR6(L: number, p: Record<string, number | string>) {
  const type = String(p.lattice) as LatticeType;
  const nL = Math.round(L / num(p, "lattice_cell_mm"));
  const lat = strutLattice({ type, cellSize: L / nL, cells: [nL, nL, nL], radius: num(p, "strut_radius_mm") });
  const tpmsCell = num(p, "tpms_cell_mm");
  const k = (2 * Math.PI) / tpmsCell;
  const t = num(p, "tpms_wall_mm");
  const r0 = num(p, "core_radius_mm"), w = num(p, "morph_width_mm");
  const c = L / 2;
  // Radial weight: 0 in the core (gyroid sheet), 1 in the outer shell (lattice), smooth over the morph width.
  const weightAt = (x: number, y: number, z: number) =>
    smoothstep(r0 - w / 2, r0 + w / 2, Math.hypot(x - c, y - c, z - c));
  const field = boxField(
    L,
    `(1 - w) * gyroid sheet + w * ${type} lattice; w = smoothstep(${r0 - w / 2}, ${r0 + w / 2} mm) of the distance from the box centre`,
    (x, y, z) => {
      const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as TpmsType, k * x, k * y, k * z);
      const gn = Math.hypot(gx, gy, gz) * k + 1e-12;
      const sheet = Math.max(Math.abs(F) / gn - t / 2, boxDist(L, x, y, z));
      const strut = Math.max(lat.eval(x, y, z), boxDist(L, x, y, z));
      const wt = weightAt(x, y, z);
      return (1 - wt) * sheet + wt * strut;
    },
  );
  const pts = samplePoints(L, 6000, 19);
  let nCore = 0, sCore = 0, nShell = 0, sShell = 0, nMid = 0, sMid = 0;
  for (const [x, y, z] of pts) {
    const solid = field.eval(x, y, z) < 0 ? 1 : 0;
    const r = Math.hypot(x - c, y - c, z - c);
    if (r < r0 - w / 2) { sCore += solid; nCore++; }
    else if (r > r0 + w / 2) { sShell += solid; nShell++; }
    else { sMid += solid; nMid++; }
  }
  return {
    field,
    description: `R6 morph: gyroid sheet (core radius ${r0} mm) blended into a ${type} strut lattice shell over ${w} mm`,
    metrics: {
      core_solid_fraction: nCore ? +(sCore / nCore).toFixed(4) : 0,
      morph_zone_solid_fraction: nMid ? +(sMid / nMid).toFixed(4) : 0,
      shell_solid_fraction: nShell ? +(sShell / nShell).toFixed(4) : 0,
      core_radius_mm: r0,
      morph_width_mm: w,
    },
    observations: [
      `Core (r < ${r0 - w / 2} mm): gyroid sheet. Shell (r > ${r0 + w / 2} mm): ${type} strut lattice. The change is a smooth blend of the two signed fields, so the structure changes type inside one solid.`,
    ],
  };
}

// ---- R7: gyroid with a period graded along z -----------------------------------------------

function buildR7(L: number, p: Record<string, number | string>) {
  const a0 = num(p, "a_bottom_mm"), a1 = num(p, "a_top_mm"), aRef = num(p, "a_ref_mm");
  const t = num(p, "wall_mm");
  const g = (a1 - a0) / L; // period gradient, mm per mm
  const period = (z: number) => a0 + g * z;
  // Warp along z only: Z(z) has dZ/dz = aRef / period(z), so the gyroid (period aRef in Z) has period period(z) in z.
  // x and y keep period aRef. The map is one-dimensional, so the gradient of the warped field is exact:
  // |grad f| = k sqrt(gx^2 + gy^2 + (gz * aRef / period)^2), with (gx, gy, gz) the gyroid gradient in its own variables.
  const Zmap = (z: number) => (aRef / g) * Math.log(period(z) / a0);
  const k = (2 * Math.PI) / aRef;
  const field = boxField(
    L,
    `gyroid, period ${aRef} mm in x and y, period graded along z from ${a0} to ${a1} mm; wall ${t} mm`,
    (x, y, z) => {
      const pz = period(z);
      const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as TpmsType, k * x, k * y, k * Zmap(z));
      const gzReal = gz * (aRef / pz);
      const gn = k * Math.hypot(gx, gy, gzReal) + 1e-12;
      const sheet = Math.abs(F) / gn - t / 2;
      return Math.max(sheet, boxDist(L, x, y, z));
    },
  );
  const pts = samplePoints(L, 6000, 23);
  const third = [0, 0, 0], count = [0, 0, 0];
  for (const [x, y, z] of pts) {
    const i = Math.min(2, Math.floor((3 * z) / L));
    count[i]++;
    if (field.eval(x, y, z) < 0) third[i]++;
  }
  return {
    field,
    description: `R7 graded gyroid: period along z from ${a0} mm (z=0) to ${a1} mm (z=${L}), period ${aRef} mm in x and y, wall ${t} mm`,
    metrics: {
      period_z_bottom_mm: a0,
      period_z_top_mm: a1,
      period_xy_mm: aRef,
      solid_fraction_bottom_third: +(third[0] / count[0]).toFixed(4),
      solid_fraction_middle_third: +(third[1] / count[1]).toFixed(4),
      solid_fraction_top_third: +(third[2] / count[2]).toFixed(4),
    },
    observations: [
      `The gyroid period along z grows from ${a0} to ${a1} mm with height (x and y period ${aRef} mm); the wall stays ${t} mm. The grading is one-dimensional, so the sheet is continuous.`,
    ],
  };
}

// ---- R8: strut radius set by a gyroid field -------------------------------------------------

function buildR8(L: number, p: Record<string, number | string>) {
  const type = String(p.lattice) as LatticeType;
  const nL = Math.round(L / num(p, "lattice_cell_mm"));
  const r0 = num(p, "strut_radius_mm"), amp = num(p, "radius_amp_mm"), gain = num(p, "gyroid_gain");
  const lat = strutLattice({ type, cellSize: L / nL, cells: [nL, nL, nL], radius: r0 });
  const k = (2 * Math.PI) / num(p, "tpms_cell_mm");
  // Local strut radius from the gyroid value F in [-1.5, 1.5]: r = r0 + amp tanh(gain F), in (r0 - amp, r0 + amp).
  // The lattice distance is corrected by (r - r0); this is exact to first order in the radius variation.
  const radiusAt = (x: number, y: number, z: number) => {
    const [F] = tpmsValueGrad("gyroid" as TpmsType, k * x, k * y, k * z);
    return r0 + amp * Math.tanh(gain * F);
  };
  const field = boxField(
    L,
    `${type} strut lattice, radius r0 + ${amp} tanh(${gain} gyroid) mm, r0 = ${r0} mm`,
    (x, y, z) => Math.max(lat.eval(x, y, z) - (radiusAt(x, y, z) - r0), boxDist(L, x, y, z)),
  );
  const pts = samplePoints(L, 6000, 29);
  let rMin = Infinity, rMax = -Infinity, rSum = 0, solid = 0;
  for (const [x, y, z] of pts) {
    const r = radiusAt(x, y, z);
    rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); rSum += r;
    if (field.eval(x, y, z) < 0) solid++;
  }
  return {
    field,
    description: `R8 ${type} lattice with strut radius set by a gyroid field (${(r0 - amp).toFixed(3)}-${(r0 + amp).toFixed(3)} mm)`,
    metrics: {
      radius_min_mm: +rMin.toFixed(3),
      radius_max_mm: +rMax.toFixed(3),
      radius_mean_mm: +(rSum / pts.length).toFixed(3),
      solid_fraction: +(solid / pts.length).toFixed(4),
    },
    observations: [
      `Strut radius follows the gyroid value: thick where the sheet is positive, thin where it is negative. Both structures are in one field.`,
    ],
  };
}

// ---- R9: interpenetrating phases gated by a gyroid -----------------------------------------

function buildR9(L: number, p: Record<string, number | string>) {
  const latType = String(p.lattice) as LatticeType;
  const nL = Math.round(L / num(p, "lattice_cell_mm"));
  const lat = strutLattice({ type: latType, cellSize: L / nL, cells: [nL, nL, nL], radius: num(p, "strut_radius_mm") });
  const sheetType = String(p.sheet) as TpmsType;
  const kS = (2 * Math.PI) / num(p, "sheet_cell_mm");
  const tS = num(p, "sheet_wall_mm");
  const kG = (2 * Math.PI) / num(p, "gate_cell_mm");
  const k = num(p, "blend_mm");
  // Gate: signed distance (mm, approximate) to the gyroid surface; gate < 0 selects the sheet side.
  const gate = (x: number, y: number, z: number) => {
    const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as TpmsType, kG * x, kG * y, kG * z);
    return F / (Math.hypot(gx, gy, gz) * kG + 1e-12);
  };
  const field = boxField(
    L,
    `smin( smax(sheet, gate), smax(${latType} lattice, -gate), ${k} ); sheet = ${sheetType} wall ${tS} mm; gate = gyroid cell ${num(p, "gate_cell_mm")} mm`,
    (x, y, z) => {
      const [F, gx, gy, gz] = tpmsValueGrad(sheetType, kS * x, kS * y, kS * z);
      const sheet = Math.abs(F) / (Math.hypot(gx, gy, gz) * kS + 1e-12) - tS / 2;
      const g = gate(x, y, z);
      // Rounded phase cut: smooth max instead of a hard max, so the sheet and lattice do not meet in sharp creases.
      const a = -smin(-sheet, -g, k);
      const b = -smin(-lat.eval(x, y, z), g, k);
      return Math.max(smin(a, b, k), boxDist(L, x, y, z));
    },
  );
  const pts = samplePoints(L, 6000, 31);
  let nA = 0, sA = 0, nB = 0, sB = 0;
  for (const [x, y, z] of pts) {
    const solid = field.eval(x, y, z) < 0 ? 1 : 0;
    if (gate(x, y, z) < 0) { sA += solid; nA++; } else { sB += solid; nB++; }
  }
  return {
    field,
    description: `R9 gated phases: ${sheetType} sheet on one side of a gyroid gate (cell ${num(p, "gate_cell_mm")} mm), ${latType} lattice on the other, smooth join ${k} mm`,
    metrics: {
      sheet_zone_solid_fraction: nA ? +(sA / nA).toFixed(4) : 0,
      lattice_zone_solid_fraction: nB ? +(sB / nB).toFixed(4) : 0,
      sheet_zone_fraction: +(nA / pts.length).toFixed(4),
      blend_mm: k,
    },
    observations: [
      `Two phases interpenetrate: the ${sheetType} sheet fills the gate-negative labyrinth and the ${latType} lattice fills the gate-positive one; no planar seam.`,
    ],
  };
}

// ---- R10: gated dominance (both phases everywhere, the gate sets which one is thick) --------

function buildR10(L: number, p: Record<string, number | string>) {
  const latType = String(p.lattice) as LatticeType;
  const nL = Math.round(L / num(p, "lattice_cell_mm"));
  const r0 = num(p, "strut_radius_mm"), ampL = num(p, "radius_amp_mm");
  const lat = strutLattice({ type: latType, cellSize: L / nL, cells: [nL, nL, nL], radius: r0 });
  const sheetType = String(p.sheet) as TpmsType;
  const kS = (2 * Math.PI) / num(p, "sheet_cell_mm");
  const t0 = num(p, "sheet_wall_mm"), ampS = num(p, "sheet_amp_mm");
  const kG = (2 * Math.PI) / num(p, "gate_cell_mm");
  const w = num(p, "dominance_mm"), k = num(p, "blend_mm");
  const gate = (x: number, y: number, z: number) => {
    const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as TpmsType, kG * x, kG * y, kG * z);
    return F / (Math.hypot(gx, gy, gz) * kG + 1e-12);
  };
  // Dominance d = tanh(g / w): +1 on the gate-positive side (lattice thick, sheet thin), -1 on the other (sheet thick).
  // Both phases are present everywhere; the join is a smooth union, so no cut and no acute wedge is created.
  const thickAt = (g: number) => t0 - ampS * Math.tanh(g / w);
  const radiusAt = (g: number) => r0 + ampL * Math.tanh(g / w);
  const field = boxField(
    L,
    `smin( ${sheetType} sheet (thickness ${t0} - ${ampS} tanh(g/${w})), ${latType} lattice (radius ${r0} + ${ampL} tanh(g/${w})), ${k} ); g = gyroid cell ${num(p, "gate_cell_mm")} mm`,
    (x, y, z) => {
      const [F, gx, gy, gz] = tpmsValueGrad(sheetType, kS * x, kS * y, kS * z);
      const g = gate(x, y, z);
      const sheet = Math.abs(F) / (Math.hypot(gx, gy, gz) * kS + 1e-12) - thickAt(g) / 2;
      const lt = lat.eval(x, y, z) - (radiusAt(g) - r0);
      return Math.max(smin(sheet, lt, k), boxDist(L, x, y, z));
    },
  );
  const pts = samplePoints(L, 6000, 37);
  let nA = 0, sA = 0, nB = 0, sB = 0, tA = 0, tB = 0, rA = 0, rB = 0;
  let tMin = Infinity, rMin = Infinity;
  for (const [x, y, z] of pts) {
    const g = gate(x, y, z);
    const solid = field.eval(x, y, z) < 0 ? 1 : 0;
    const t = thickAt(g), r = radiusAt(g);
    tMin = Math.min(tMin, t); rMin = Math.min(rMin, r);
    if (g < 0) { sA += solid; nA++; tA += t; rA += r; } else { sB += solid; nB++; tB += t; rB += r; }
  }
  return {
    field,
    description: `R10 gated dominance: ${sheetType} sheet and ${latType} lattice both present; the gyroid gate (cell ${num(p, "gate_cell_mm")} mm) sets which is thick`,
    metrics: {
      sheet_zone_solid_fraction: nA ? +(sA / nA).toFixed(4) : 0,
      lattice_zone_solid_fraction: nB ? +(sB / nB).toFixed(4) : 0,
      sheet_zone_mean_thickness_mm: nA ? +(tA / nA).toFixed(3) : 0,
      lattice_zone_mean_thickness_mm: nB ? +(tB / nB).toFixed(3) : 0,
      sheet_zone_mean_strut_radius_mm: nA ? +(rA / nA).toFixed(3) : 0,
      lattice_zone_mean_strut_radius_mm: nB ? +(rB / nB).toFixed(3) : 0,
      min_sheet_thickness_mm: +tMin.toFixed(3),
      min_strut_radius_mm: +rMin.toFixed(3),
      sheet_zone_fraction: +(nA / pts.length).toFixed(4),
    },
    observations: [
      `Both phases are present everywhere; the gate sets dominance. The sheet is thick where the gate is negative and the struts are thick where it is positive. No cut, so no acute wedges.`,
    ],
  };
}

// ---- R11: gate-set iso-level of one gyroid (volume coupling) --------------------------------

function buildR11(L: number, p: Record<string, number | string>) {
  const kT = (2 * Math.PI) / num(p, "gyroid_cell_mm");
  const kG = (2 * Math.PI) / num(p, "gate_cell_mm");
  const c0 = num(p, "level_c0"), c1 = num(p, "level_amp"), w = num(p, "level_width_mm");
  const gate = (x: number, y: number, z: number) => {
    const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as TpmsType, kG * x, kG * y, kG * z);
    return F / (Math.hypot(gx, gy, gz) * kG + 1e-12);
  };
  // Solid where F < c(g): the iso-level sets the volume fraction locally. The level never reaches the
  // gyroid extremes, so the labyrinth stays connected and no acute wedge is cut. dist ~ (F - c) / |grad F|, in mm.
  const levelAt = (g: number) => c0 + c1 * Math.tanh(g / w);
  const field = boxField(
    L,
    `gyroid iso-level c(g) = ${c0} + ${c1} tanh(g/${w}) (solid where F < c); g = gyroid cell ${num(p, "gate_cell_mm")} mm`,
    (x, y, z) => {
      const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as TpmsType, kT * x, kT * y, kT * z);
      const g = gate(x, y, z);
      const d = (F - levelAt(g)) / (kT * Math.hypot(gx, gy, gz) + 1e-12);
      return Math.max(d, boxDist(L, x, y, z));
    },
  );
  const pts = samplePoints(L, 6000, 41);
  let nA = 0, sA = 0, nB = 0, sB = 0;
  for (const [x, y, z] of pts) {
    const g = gate(x, y, z);
    const solid = field.eval(x, y, z) < 0 ? 1 : 0;
    if (g < 0) { sA += solid; nA++; } else { sB += solid; nB++; }
  }
  return {
    field,
    description: `R11 gate-set iso-level: gyroid solid where F < ${c0} + ${c1} tanh(g/${w}); level ${c0 - c1} to ${c0 + c1}`,
    metrics: {
      level_min: +(c0 - c1).toFixed(3),
      level_max: +(c0 + c1).toFixed(3),
      sheet_zone_solid_fraction: nA ? +(sA / nA).toFixed(4) : 0,
      lattice_zone_solid_fraction: nB ? +(sB / nB).toFixed(4) : 0,
      solid_fraction: +((sA + sB) / pts.length).toFixed(4),
    },
    observations: [
      `The gate sets the local iso-level of one gyroid: the solid fraction changes with the gate, and the labyrinth stays connected because the level stays inside the gyroid's range.`,
    ],
  };
}

// ---- R12: one-sided gate-set iso-level (asymmetric, net volume coupling) --------------------

function buildR12(L: number, p: Record<string, number | string>) {
  const kT = (2 * Math.PI) / num(p, "gyroid_cell_mm");
  const kG = (2 * Math.PI) / num(p, "gate_cell_mm");
  const lo = num(p, "level_lo"), hi = num(p, "level_hi"), w = num(p, "level_width_mm");
  const gate = (x: number, y: number, z: number) => {
    const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as TpmsType, kG * x, kG * y, kG * z);
    return F / (Math.hypot(gx, gy, gz) * kG + 1e-12);
  };
  // One-sided response: the level runs from lo (gate far negative) to hi (gate far positive) and never crosses the
  // symmetric point. Since the level is always >= lo, the solid is never below the lo-level solid, so the total
  // volume shifts; it is not a redistribution about 50 %.
  const levelAt = (g: number) => lo + (hi - lo) * 0.5 * (1 + Math.tanh(g / w));
  const field = boxField(
    L,
    `gyroid one-sided iso-level c(g) = ${lo} + ${hi - lo} (1 + tanh(g/${w}))/2 (solid where F < c); g = gyroid cell ${num(p, "gate_cell_mm")} mm`,
    (x, y, z) => {
      const [F, gx, gy, gz] = tpmsValueGrad("gyroid" as TpmsType, kT * x, kT * y, kT * z);
      const g = gate(x, y, z);
      const d = (F - levelAt(g)) / (kT * Math.hypot(gx, gy, gz) + 1e-12);
      return Math.max(d, boxDist(L, x, y, z));
    },
  );
  const pts = samplePoints(L, 6000, 43);
  let nA = 0, sA = 0, nB = 0, sB = 0;
  for (const [x, y, z] of pts) {
    const g = gate(x, y, z);
    const solid = field.eval(x, y, z) < 0 ? 1 : 0;
    if (g < 0) { sA += solid; nA++; } else { sB += solid; nB++; }
  }
  return {
    field,
    description: `R12 one-sided gate-set iso-level: gyroid solid where F < c(g), c from ${lo} to ${hi} (gate-negative side at ${lo}, gate-positive side at ${hi})`,
    metrics: {
      level_min: lo,
      level_max: hi,
      sheet_zone_solid_fraction: nA ? +(sA / nA).toFixed(4) : 0,
      lattice_zone_solid_fraction: nB ? +(sB / nB).toFixed(4) : 0,
      solid_fraction: +((sA + sB) / pts.length).toFixed(4),
    },
    observations: [
      `The gate sets the local iso-level between ${lo} and ${hi}: a one-sided response, so the total solid shifts with the gate rather than redistributing about 50 %.`,
    ],
  };
}

// ---- entry point ----------------------------------------------------------------------------

export function buildCoupled(spec: CoupledSpec, L: number): CoupledBuild {
  const defaults = ROUND_DEFAULTS[spec.round];
  if (!defaults) throw new Error(`unknown coupled round ${spec.round}`);
  const p = { ...defaults, ...(spec.params ?? {}) } as Record<string, number | string>;
  let r: { field: Field; description: string; metrics: Record<string, number | string>; observations: string[] };
  switch (spec.round) {
    case "R1": r = buildR1(L, p); break;
    case "R2": r = buildR2(L, p); break;
    case "R3": r = buildR3(L, p); break;
    case "R4": r = buildR4(L, p); break;
    case "R5": r = buildR5(L, p); break;
    case "R6": r = buildR6(L, p); break;
    case "R7": r = buildR7(L, p); break;
    case "R8": r = buildR8(L, p); break;
    case "R9": r = buildR9(L, p); break;
    case "R10": r = buildR10(L, p); break;
    case "R11": r = buildR11(L, p); break;
    case "R12": r = buildR12(L, p); break;
    default: throw new Error(`unknown coupled round ${spec.round}`);
  }
  // Clip to the build box (no feature extends beyond it), then unite the closed envelope skin.
  const t = num(p, "skin_mm");
  const core: Field = {
    bounds: { min: [0, 0, 0], max: [L, L, L] },
    expr: `max( ${r.field.expr} , sdBox )`,
    eval: (x, y, z) => Math.max(r.field.eval(x, y, z), boxDist(L, x, y, z)),
  };
  const skin: Field = {
    bounds: { min: [0, 0, 0], max: [L, L, L] },
    expr: `|sdBox + t/2| - t/2, t=${t} mm`,
    eval: (x, y, z) => Math.abs(boxDist(L, x, y, z) + t / 2) - t / 2,
  };
  const boxed: Field = t > 0
    ? { bounds: core.bounds, expr: `min( ${core.expr} , ${skin.expr} )`, eval: (x, y, z) => Math.min(core.eval(x, y, z), skin.eval(x, y, z)) }
    : core;
  return {
    field: boxed,
    description: r.description,
    observations: r.observations,
    limitations: ["Coupled geometry is SDF-only (mesh export); the coupling is evaluated pointwise, not as a B-Rep."],
    coupling_metrics: r.metrics,
    resolved_params: p,
  };
}
