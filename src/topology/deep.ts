// Deep fusion: structures coupled at the field level, so one structure's parameters are driven by another's.
// Every builder has a `naive` variant with the coupling removed. The coupling effect is the symmetric-difference
// fraction between the coupled and naive solids (reported by the gallery), so a coupling that changes nothing is visible.
//
// All coordinates are millimetres in the box [0, S]^3. Convention: f < 0 inside the solid.

import type { Bounds, Field } from "./fields.ts";
import { sdBox } from "./fields.ts";
import { strutLattice, tpmsValueGrad } from "./lattice.ts";
import { makeRng } from "../util/rng.ts";
import type { DeepSpec } from "../types.ts";

export interface DeepBuild {
  field: Field;
  description: string;
  observations: string[];
  limitations: string[];
}

const GYROID_PERIOD = 5; // mm
const OVERLAP = 0.2; // mm, overlap between neighbouring parts so that they fuse into one solid

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** Jittered n x n x n seed grid in the box [0, S]^3 (seeded, reproducible). */
function seedGrid(n: number, S: number, seed: number, jitter: number): number[][] {
  const rng = makeRng(seed);
  const h = S / n;
  const out: number[][] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        out.push([
          (i + 0.5 + jitter * rng.uniform(-0.5, 0.5)) * h,
          (j + 0.5 + jitter * rng.uniform(-0.5, 0.5)) * h,
          (k + 0.5 + jitter * rng.uniform(-0.5, 0.5)) * h,
        ]);
  return out;
}

/** Distance to the nearest and second-nearest Voronoi seed; (F2 - F1) / 2 is the distance to the nearest cell face. */
function voronoiGap(seeds: number[][], x: number, y: number, z: number): number {
  let f1 = Infinity;
  let f2 = Infinity;
  for (const s of seeds) {
    const d = Math.hypot(x - s[0], y - s[1], z - s[2]);
    if (d < f1) {
      f2 = f1;
      f1 = d;
    } else if (d < f2) f2 = d;
  }
  return (f2 - f1) / 2;
}

/** Approximate signed distance to a gyroid sheet of wall thickness t, in the frame rotated by angle (rad) about z. */
function gyroidSheet(x: number, y: number, z: number, t: number, angle: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const xr = c * x + s * y;
  const yr = -s * x + c * y;
  const k = (2 * Math.PI) / GYROID_PERIOD;
  const [F, gx, gy, gz] = tpmsValueGrad("gyroid", k * xr, k * yr, k * z);
  const gn = Math.hypot(gx, gy, gz) * k + 1e-12;
  return Math.abs(F) / gn - t / 2;
}

/**
 * Clip a field to the box. With skin > 0 the result is also unioned with a closed solid shell of that thickness at the
 * box faces (|d + skin/2| - skin/2, d = box SDF), so that clipped sheets are attached to one body.
 */
function boxField(S: number, inner: (x: number, y: number, z: number) => number, expr: string, skin = 0): Field {
  const bounds: Bounds = { min: [0, 0, 0], max: [S, S, S] };
  return {
    bounds,
    expr: skin > 0 ? `min( max(${expr}, box), |box + ${skin / 2}| - ${skin / 2} )` : `max(${expr}, box)`,
    eval(x, y, z) {
      const d = sdBox(x - S / 2, y - S / 2, z - S / 2, S / 2, S / 2, S / 2);
      const core = Math.max(inner(x, y, z), d);
      if (skin <= 0) return core;
      return Math.min(core, Math.abs(d + skin / 2) - skin / 2);
    },
  };
}

// ---- R1: tubular channels filled with a lattice (lattice nested inside macro channels) ----------------------

function channelLattice(S: number, p: Required<DeepSpec>): DeepBuild {
  const r = p.channel_radius_mm;
  const centres: [number, number][] = [
    [S / 4, S / 4],
    [(3 * S) / 4, S / 4],
    [S / 4, (3 * S) / 4],
    [(3 * S) / 4, (3 * S) / 4],
  ];
  const lat = strutLattice({ type: "bcc", cellSize: p.lattice_cell_mm, cells: [8, 8, 8], radius: p.lattice_radius_mm, heterogeneity: null });
  const dChan = (x: number, y: number): number => {
    let d = Infinity;
    for (const [cx, cy] of centres) d = Math.min(d, Math.hypot(x - cx, y - cy) - r);
    return d;
  };
  const inner = (x: number, y: number, z: number): number => {
    const dc = dChan(x, y);
    const matrix = -dc; // solid outside every channel
    // lattice inside the channels, extended into the matrix by OVERLAP so that the parts fuse
    const content = p.naive ? Infinity : Math.max(lat.eval(x, y, z), dc - OVERLAP);
    return Math.min(matrix, content);
  };
  return {
    field: boxField(S, inner, `min(-dChan, max(BCC_lattice, dChan-${OVERLAP})) ; channels r=${r} at 4 positions`),
    description: `channel lattice: ${p.naive ? "empty channels (naive)" : "BCC lattice inside 4 macro channels"}`,
    observations: [
      `Four macro channels of radius ${r} mm; BCC lattice (cell ${p.lattice_cell_mm} mm, strut radius ${p.lattice_radius_mm} mm) is nested inside them.`,
    ],
    limitations: ["Lattice struts are fused to the channel wall by a 0.2 mm overlap; no separate interface model."],
  };
}

// ---- R2: helical plies whose TPMS orientation follows the ply angle --------------------------------------------

function plyTpms(S: number, p: Required<DeepSpec>): DeepBuild {
  const N = p.plies;
  const t = S / N;
  const twist = p.naive ? 0 : (p.twist_deg * Math.PI) / 180;
  const wall = p.wall_mm;
  const inner = (x: number, y: number, z: number): number => {
    const j0 = Math.max(0, Math.floor(z / t) - 1);
    const j1 = Math.min(N - 1, Math.floor(z / t) + 1);
    let best = Infinity;
    for (let j = j0; j <= j1; j++) {
      const sheet = gyroidSheet(x, y, z, wall, j * twist);
      const slab = Math.abs(z - (j + 0.5) * t) - (t / 2 + OVERLAP);
      best = Math.min(best, Math.max(sheet, slab));
    }
    return best;
  };
  return {
    field: boxField(S, inner, `min_j max(gyroid(R(j*${p.twist_deg}deg)x,y,z) sheet, slab_j) ; N=${N}`, p.skin_mm),
    description: `helical plies (${N} plies, ${p.naive ? "0" : p.twist_deg} deg per ply) with gyroid sheets in each ply`,
    observations: [
      `Each ply is a gyroid sheet of thickness ${wall} mm, rotated by ${p.naive ? 0 : p.twist_deg} deg per ply (helical stack); plies overlap by ${OVERLAP} mm.`,
    ],
    limitations: ["Sheet SDF is approximate (|F|/|grad F|); ply boundaries are planar."],
  };
}

// ---- R3: TPMS wall thickness graded by the Voronoi cell geometry ------------------------------------------------

function gradedTpms(S: number, p: Required<DeepSpec>): DeepBuild {
  const seeds = seedGrid(p.seeds, S, p.seed, 0.4);
  const dmax = S / p.seeds / 2; // half a cell
  const tAt = (x: number, y: number, z: number): number => {
    if (p.naive) return (p.t_min_mm + p.t_max_mm) / 2;
    const d = voronoiGap(seeds, x, y, z);
    return p.t_min_mm + (p.t_max_mm - p.t_min_mm) * smooth(d / dmax);
  };
  const inner = (x: number, y: number, z: number): number => {
    return gyroidSheet(x, y, z, tAt(x, y, z), 0);
  };
  return {
    field: boxField(S, inner, `gyroid sheet with t(x) = ${p.t_min_mm} + ${p.t_max_mm - p.t_min_mm} * smoothstep(d_voronoi(x)/${dmax.toFixed(2)})`, p.skin_mm),
    description: `graded gyroid: thickness ${p.naive ? "uniform (naive)" : `${p.t_min_mm}-${p.t_max_mm} mm driven by ${p.seeds}^3 Voronoi cells`}`,
    observations: [
      `Wall thickness follows the distance to the nearest Voronoi cell face (d = (F2-F1)/2): thin at cell centres, thick at cell walls.`,
    ],
    limitations: ["Local thickness is evaluated per sample, so the thickness field is only Lipschitz-approximate at cell faces."],
  };
}

// ---- R4: Voronoi foam walls with a BCC lattice filling every cell (two scales) ----------------------------------

function foamLattice(S: number, p: Required<DeepSpec>): DeepBuild {
  const seeds = seedGrid(p.seeds, S, p.seed, 0.3);
  const wh = p.wall_mm / 2;
  const lat = strutLattice({ type: "bcc", cellSize: p.lattice_cell_mm, cells: [8, 8, 8], radius: p.lattice_radius_mm, heterogeneity: null });
  const inner = (x: number, y: number, z: number): number => {
    const d = voronoiGap(seeds, x, y, z);
    const wall = d - wh;
    if (p.naive) return wall;
    const cellInterior = -(d - (wh - OVERLAP)); // negative inside each cell and reaching OVERLAP into the walls, so the lattice fuses to them
    return Math.min(wall, Math.max(lat.eval(x, y, z), cellInterior));
  };
  return {
    field: boxField(S, inner, `min(foam_wall, max(BCC_lattice, cell_interior)) ; ${p.seeds}^3 Voronoi cells`),
    description: `hierarchical foam: ${p.seeds}^3 Voronoi walls (${p.wall_mm} mm) ${p.naive ? "only (naive)" : `with BCC lattice (cell ${p.lattice_cell_mm} mm) in every cell`}`,
    observations: [
      `Macro scale: Voronoi foam walls of ${p.wall_mm} mm. Meso scale: BCC lattice of cell ${p.lattice_cell_mm} mm inside each cell.`,
    ],
    limitations: ["Interior lattice fragments that do not touch a wall are kept; the single-solid check decides whether they count."],
  };
}

// ---- R5: helical ply twist and Voronoi-graded thickness, both coupled (triple coupling) ---------------------

function plyGradedTpms(S: number, p: Required<DeepSpec>): DeepBuild {
  const N = p.plies;
  const t = S / N;
  const seeds = seedGrid(p.seeds, S, p.seed, 0.4);
  const dmax = S / p.seeds / 2;
  const twist = p.naive ? 0 : (p.twist_deg * Math.PI) / 180;
  const tAt = (x: number, y: number, z: number): number => {
    if (p.naive) return (p.t_min_mm + p.t_max_mm) / 2;
    return p.t_min_mm + (p.t_max_mm - p.t_min_mm) * smooth(voronoiGap(seeds, x, y, z) / dmax);
  };
  const inner = (x: number, y: number, z: number): number => {
    const j0 = Math.max(0, Math.floor(z / t) - 1);
    const j1 = Math.min(N - 1, Math.floor(z / t) + 1);
    const wall = tAt(x, y, z);
    let best = Infinity;
    for (let j = j0; j <= j1; j++) {
      const sheet = gyroidSheet(x, y, z, wall, j * twist);
      const slab = Math.abs(z - (j + 0.5) * t) - (t / 2 + OVERLAP);
      best = Math.min(best, Math.max(sheet, slab));
    }
    return best;
  };
  return {
    field: boxField(S, inner, `min_j max(gyroid_j sheet(t(x), R(j*twist)), slab_j) ; t(x) from ${p.seeds}^3 Voronoi`, p.skin_mm),
    description: `helical plies (${N}, ${p.naive ? 0 : p.twist_deg} deg) of gyroid sheets with Voronoi-graded thickness ${p.naive ? "(uniform, naive)" : `${p.t_min_mm}-${p.t_max_mm} mm`}`,
    observations: [
      `Triple coupling: ply angle sets each sheet's orientation, and the Voronoi cell geometry sets its thickness.`,
    ],
    limitations: ["Sheet SDF is approximate; thickness varies per sample."],
  };
}

const DEFAULTS: Required<DeepSpec> = {
  kind: "channel_lattice",
  naive: false,
  channel_radius_mm: 2.5,
  lattice_cell_mm: 2.5,
  lattice_radius_mm: 0.25,
  plies: 10,
  twist_deg: 18,
  wall_mm: 0.7,
  t_min_mm: 0.7,
  t_max_mm: 1.0,
  seeds: 4,
  seed: 7,
  skin_mm: 1,
};

/** Build a deep-fusion field for the box [0, S]^3. Unset parameters take the defaults above. */
export function buildDeepField(spec: DeepSpec, S: number): DeepBuild {
  const p: Required<DeepSpec> = { ...DEFAULTS, ...spec } as Required<DeepSpec>;
  switch (p.kind) {
    case "channel_lattice":
      return channelLattice(S, p);
    case "ply_tpms":
      return plyTpms(S, p);
    case "graded_tpms":
      return gradedTpms(S, p);
    case "foam_lattice":
      return foamLattice(S, { ...p, seeds: spec.seeds ?? 3, seed: spec.seed ?? 11, wall_mm: spec.wall_mm ?? 0.8, lattice_cell_mm: spec.lattice_cell_mm ?? 2.5 });
    case "ply_graded_tpms":
      return plyGradedTpms(S, p);
    default: {
      const never: never = p.kind;
      throw new Error(`unknown deep kind ${String(never)}`);
    }
  }
}
