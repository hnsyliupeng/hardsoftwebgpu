// Geometry of the 12 bioinspired base structures, as signed-distance fields in the upstream base
// frame (x,y in [-1,1], z in [0,2]) plus an exact B-Rep plan for the smlibwasm kernel.
//
// Deviations from the Blender originals (all recorded in the pipeline limitations):
//  * Helical plies are centred at (i+1/2)*t so neighbouring plies do not overlap by half a ply.
//  * Everything is clipped to the build cube; rotated plates therefore keep square corners.
//  * Cellular (Voronoi / fracture) geometry is an analytic F3-F1 strut field, not a Blender
//    fracture + wireframe modifier. Smoothing is applied as voxel-field blur passes.

import { makeRng, type Rng } from "../util/rng.ts";
import { sdBox, sdCylinderX, sdEllipseZ, type Field } from "../topology/fields.ts";
import { getBase, resolveParams, type BaseEntry } from "./catalog.ts";

export type FiberKind = "plate" | "rect" | "cyl";

export interface HelicalPly {
  index: number;
  zCenter: number; // base units
  thickness: number; // base units (ply thickness t = 2/N)
  angleDeg: number; // total rotation of the ply about z
  fiberCentersY: number[]; // fiber centres in the ply frame (base units)
  pitch: number;
}

export type BrepPlan =
  | { kind: "helical"; fiber: FiberKind; plies: HelicalPly[] }
  | {
      kind: "tubular";
      holes: { x: number; y: number }[];
      rx: number;
      ry: number;
      layer: { rxInner: number; ryInner: number } | null;
    };

export interface BioBuild {
  base: BaseEntry;
  /** Resolved (clamped / defaulted) parameter values, base units. */
  params: Record<string, number>;
  seed: number;
  /** Field in base units (negative inside). */
  baseField: Field;
  /** Optional separately-named bodies (e.g. tubular matrix and cortex). */
  parts: Record<string, Field>;
  /** Number of Voronoi-smoothing passes (cellular families). */
  smoothPasses: number;
  brep: BrepPlan | null;
  notes: string[];
  clamped: string[];
  defaulted: string[];
}

const BASE_DOMAIN = { min: [-1, -1, 0] as [number, number, number], max: [1, 1, 2] as [number, number, number] };

/** Adapt a base-frame field into a millimetre field inside [0,size]^3. */
export function toMillimetres(base: Field, sizeMm: number, extra?: { smoothPasses?: number }): Field {
  const S = sizeMm / 2; // mm per base unit
  return {
    bounds: { min: [0, 0, 0], max: [sizeMm, sizeMm, sizeMm] },
    expr: `${base.expr}  [base units, x_b = x/${S} - 1, z_b = z/${S}; sdf_mm = ${S} * sdf_b]`,
    eval(x, y, z) {
      return S * base.eval(x / S - 1, y / S - 1, z / S);
    },
  };
}

function clipBase(f: (x: number, y: number, z: number) => number, expr: string): Field {
  return {
    bounds: { min: BASE_DOMAIN.min, max: BASE_DOMAIN.max },
    expr,
    eval(x, y, z) {
      return Math.max(f(x, y, z), sdBox(x, y, z - 1, 1, 1, 1));
    },
  };
}

// ----------------------------------------------------------------------------------------------
// Helical families
// ----------------------------------------------------------------------------------------------

function buildHelical(
  id: BaseEntry["id"],
  params: Record<string, number>,
  rng: Rng,
  notes: string[],
): Omit<BioBuild, "base" | "params" | "seed" | "clamped" | "defaulted"> {
  const N = Math.round(params.num_plies);
  const t = 2 / N;
  const rot = params.rotation;
  const fiber: FiberKind = id === "helical_rectfibers" ? "rect" : id === "helical_cylinfibers" ? "cyl" : "plate";
  const noiseDeg = id === "helical_noise" ? params.noise : 0;
  // Per-ply rotation, with optional noise drawn in ply order (reproducible from the seed).
  const angles: number[] = [];
  for (let i = 0; i < N; i++) {
    const jitter = noiseDeg > 0 ? rng.uniform(-noiseDeg, noiseDeg) : 0;
    angles.push(i * rot + jitter);
  }
  // Fiber layout inside a ply (replicates the upstream start/pitch arithmetic).
  const gap = 0.01;
  const fiberCenters: number[][] = [];
  const pitches: number[] = [];
  for (let i = 0; i < N; i++) {
    if (fiber === "rect") {
      const pitch = t + gap;
      const M = Math.max(1, Math.floor(2 / pitch));
      const total = M * pitch;
      const start = -1 + pitch / 2 + (2 - total) / 2;
      fiberCenters.push(Array.from({ length: M }, (_, k) => start + k * pitch));
      pitches.push(pitch);
    } else if (fiber === "cyl") {
      const M = Math.max(1, Math.floor(2 / t));
      const total = M * t;
      const start = -1 + t / 2 + (2 - total) / 2;
      fiberCenters.push(Array.from({ length: M }, (_, k) => start + k * t));
      pitches.push(t);
    } else {
      fiberCenters.push([]);
      pitches.push(0);
    }
  }
  const plies: HelicalPly[] = angles.map((a, i) => ({
    index: i,
    zCenter: (i + 0.5) * t,
    thickness: t,
    angleDeg: a,
    fiberCentersY: fiberCenters[i],
    pitch: pitches[i],
  }));
  const cosS = angles.map((a) => Math.cos((a * Math.PI) / 180));
  const sinS = angles.map((a) => Math.sin((a * Math.PI) / 180));
  const radius = t / 2;

  const field = (x: number, y: number, z: number): number => {
    const i = Math.min(N - 1, Math.max(0, Math.floor(z / t)));
    const zc = (i + 0.5) * t;
    // Rotate the point into the ply frame.
    const c = cosS[i];
    const s = sinS[i];
    const xr = x * c + y * s;
    const yr = -x * s + y * c;
    const dz = z - zc;
    if (fiber === "plate") return sdBox(xr, yr, dz, 1, 1, radius);
    if (fiber === "rect") {
      const pitch = pitches[i];
      const centers = fiberCenters[i];
      // Nearest fibre index by pitch; check the neighbours for the minimum.
      const k0 = Math.round((yr - centers[0]) / pitch);
      let best = Infinity;
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        if (k < 0 || k >= centers.length) continue;
        best = Math.min(best, sdBox(xr, yr - centers[k], dz, 1, radius, radius));
      }
      return best;
    }
    if (fiber === "cyl") {
      const centers = fiberCenters[i];
      const pitch = pitches[i];
      const k0 = Math.round((yr - centers[0]) / pitch);
      let best = Infinity;
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        if (k < 0 || k >= centers.length) continue;
        best = Math.min(best, sdCylinderX(xr, yr - centers[k], dz, radius, 1));
      }
      return best;
    }
    return Infinity;
  };

  const expr =
    fiber === "plate"
      ? `plies i=0..${N - 1}: sdBox(R(-theta_i)(x,y), z-(i+1/2)t; 1,1,t/2), t=2/${N}, theta_i=${rot}*i${noiseDeg ? ` + U(-${noiseDeg},${noiseDeg})` : ""}`
      : fiber === "rect"
        ? `plies with rectangular fibres (t x t bars along x, pitch t+${gap}); theta_i=${rot}*i${noiseDeg ? ` + U(-${noiseDeg},${noiseDeg})` : ""}`
        : `plies with cylindrical fibres (r=t/2 along x, pitch t); theta_i=${rot}*i${noiseDeg ? ` + U(-${noiseDeg},${noiseDeg})` : ""}`;

  if (fiber === "plate") notes.push("Plies are plates clipped to the build cube (square corners retained).");
  notes.push("Helical plies are centred at (i+1/2)t (no half-ply overlap), a deviation from the upstream centre at i*t.");

  return {
    baseField: clipBase(field, expr),
    parts: {},
    smoothPasses: 0,
    brep: { kind: "helical", fiber, plies },
    notes,
  };
}

// ----------------------------------------------------------------------------------------------
// Tubular families
// ----------------------------------------------------------------------------------------------

function buildTubular(
  id: BaseEntry["id"],
  params: Record<string, number>,
  rng: Rng,
  notes: string[],
): Omit<BioBuild, "base" | "params" | "seed" | "clamped" | "defaulted"> {
  const n = Math.round(params.num_tubules);
  const G = Math.ceil(Math.sqrt(n));
  const sp = 2 / G;
  const start = -1 + sp / 2;
  const noisy = id === "tubular_noise";
  const ell = id === "tubular_shapesize" ? params.ellipticity : 1;
  const R = id === "tubular_shapesize" ? params.radius : 0.1;
  const layerT = id === "tubular_layers" ? params.thickness : 0;
  const jitter = noisy ? params.noise : 0;

  const holes: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    let x = start + (k % G) * sp;
    let y = start + Math.floor(k / G) * sp;
    if (noisy) {
      x += rng.uniform(-jitter, jitter);
      y += rng.uniform(-jitter, jitter);
    }
    holes.push({ x, y });
  }
  const rx = R * ell;
  const ry = R;
  const innerRx = rx - layerT;
  const innerRy = ry - layerT;

  const holeOuter = (x: number, y: number): number => {
    let best = Infinity;
    for (const h of holes) best = Math.min(best, sdEllipseZ(x, y, h.x, h.y, rx, ry));
    return best;
  };
  const holeInner = (x: number, y: number): number => {
    let best = Infinity;
    for (const h of holes) best = Math.min(best, sdEllipseZ(x, y, h.x, h.y, innerRx, innerRy));
    return best;
  };

  const matrix: Field = {
    bounds: { min: BASE_DOMAIN.min, max: BASE_DOMAIN.max },
    expr: `max(sdBox(cube 2x2x2), -min_k sdEllipse(x-x_k,y-y_k; ${rx.toFixed(3)}, ${ry.toFixed(3)}))`,
    eval(x, y, z) {
      return Math.max(sdBox(x, y, z - 1, 1, 1, 1), -holeOuter(x, y));
    },
  };
  const parts: Record<string, Field> = { matrix };
  let baseField: Field;
  if (layerT > 0) {
    // Cortical sleeve: the annulus between the outer hole boundary and the inner lumen.
    const cortex: Field = {
      bounds: { min: BASE_DOMAIN.min, max: BASE_DOMAIN.max },
      expr: `max(sdEllipse_outer, -sdEllipse_inner) per tubule; sleeve thickness ${layerT}`,
      eval(x, y, z) {
        const ring = Math.max(holeOuter(x, y), -holeInner(x, y));
        return Math.max(ring, sdBox(x, y, z - 1, 1, 1, 1));
      },
    };
    parts.cortex = cortex;
    baseField = {
      bounds: { min: BASE_DOMAIN.min, max: BASE_DOMAIN.max },
      expr: `min(matrix, cortex)`,
      eval(x, y, z) {
        return Math.min(matrix.eval(x, y, z), cortex.eval(x, y, z));
      },
    };
    notes.push("Cortical sleeves are reported as a separate body and unioned for the total solid.");
  } else {
    baseField = matrix;
  }
  if (ell !== 1) notes.push("Elliptical holes use an approximate ellipse distance (B-Rep path uses exact ellipses).");
  return {
    baseField,
    parts,
    smoothPasses: 0,
    brep: {
      kind: "tubular",
      holes,
      rx,
      ry,
      layer: layerT > 0 ? { rxInner: innerRx, ryInner: innerRy } : null,
    },
    notes,
  };
}

// ----------------------------------------------------------------------------------------------
// Cellular families (Voronoi F3-F1 strut network, optional sandwich skins, smoothing)
// ----------------------------------------------------------------------------------------------

export const VORONOI_SEEDS = 100; // matches the upstream fracture `source_limit=100`

function buildCellular(
  id: BaseEntry["id"],
  params: Record<string, number>,
  seed: number,
  notes: string[],
): Omit<BioBuild, "base" | "params" | "seed" | "clamped" | "defaulted"> {
  const t = params.thickness;
  const sandwich = id === "cellular_sandwich" || id === "cellular_vorosand";
  const smooth = id === "cellular_voronoi" || id === "cellular_vorosand";
  const skin = sandwich ? params.size : 0;
  const rng = makeRng(seed);
  const seeds = new Float64Array(VORONOI_SEEDS * 3);
  for (let i = 0; i < VORONOI_SEEDS; i++) {
    seeds[3 * i] = rng.uniform(-1, 1);
    seeds[3 * i + 1] = rng.uniform(-1, 1);
    seeds[3 * i + 2] = rng.uniform(0, 2);
  }
  const strut = (x: number, y: number, z: number): number => {
    // Three nearest seeds: F3 - F1 vanishes on Voronoi edges (the cell skeleton).
    let d1 = Infinity;
    let d2 = Infinity;
    let d3 = Infinity;
    for (let i = 0; i < VORONOI_SEEDS; i++) {
      const dx = x - seeds[3 * i];
      const dy = y - seeds[3 * i + 1];
      const dz = z - seeds[3 * i + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d1) {
        d3 = d2;
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d3 = d2;
        d2 = d;
      } else if (d < d3) {
        d3 = d;
      }
    }
    return (Math.sqrt(d3) - Math.sqrt(d1)) / 2 - t / 2;
  };
  const core = (x: number, y: number, z: number): number => {
    const w = strut(x, y, z);
    if (!sandwich) return w;
    // Restrict the strut network to the core between the skins.
    return Math.max(w, sdBox(x, y, z - 1, 1, 1, 1 - skin));
  };
  const cellExpr = `strut = (F3 - F1)/2 - t/2, Voronoi seeds=${VORONOI_SEEDS} (seed ${seed})`;
  let baseField: Field;
  const parts: Record<string, Field> = {};
  if (sandwich) {
    const skins = (x: number, y: number, z: number): number =>
      Math.min(sdBox(x, y, z - skin / 2, 1, 1, skin / 2), sdBox(x, y, z - (2 - skin / 2), 1, 1, skin / 2));
    baseField = {
      bounds: { min: BASE_DOMAIN.min, max: BASE_DOMAIN.max },
      expr: `min(skins, core) ; skins = slabs of thickness ${skin} at z=0 and z=2 ; core = ${cellExpr}`,
      eval(x, y, z) {
        return Math.min(skins(x, y, z), core(x, y, z));
      },
    };
    parts.skins = {
      bounds: { min: BASE_DOMAIN.min, max: BASE_DOMAIN.max },
      expr: `slabs thickness ${skin}`,
      eval: (x, y, z) => skins(x, y, z),
    };
    parts.core = clipBase(core, cellExpr);
  } else {
    baseField = clipBase(core, cellExpr);
  }
  if (smooth) notes.push(`Smoothing: ${params.smoothlevel} blur pass(es) on the sampled field (approximates the upstream subdivision).`);
  return {
    baseField,
    parts,
    smoothPasses: smooth ? Math.round(params.smoothlevel) : 0,
    brep: null,
    notes,
  };
}

// ----------------------------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------------------------

export function buildBio(id: string, requested: Record<string, number | undefined>, seed = 42): BioBuild {
  const base = getBase(id);
  const { values, clamped, defaulted } = resolveParams(id, requested);
  const rng = makeRng(seed);
  const notes: string[] = [];
  let body: Omit<BioBuild, "base" | "params" | "seed" | "clamped" | "defaulted">;
  switch (base.category) {
    case "helical":
      body = buildHelical(base.id, values, rng, notes);
      break;
    case "tubular":
      body = buildTubular(base.id, values, rng, notes);
      break;
    case "cellular":
      body = buildCellular(base.id, values, seed, notes);
      break;
  }
  return { base, params: values, seed, clamped, defaulted, ...body };
}
