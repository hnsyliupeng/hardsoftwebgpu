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
//
// All fields are signed distances in millimetres on the box [0, L]^3 (negative inside the solid).

import { type Field, sdBox, sdCylinderZ } from "./fields.ts";
import { strutLattice, tpmsShell, tpmsValueGrad } from "./lattice.ts";
import type { LatticeType, TpmsType } from "../types.ts";
import { buildBio, toMillimetres } from "../bio/families.ts";
import { sampleField } from "../geometry/grid.ts";

export type CoupledRound = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

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
