// Strut lattices (SC, BCC, FCC, FBCC, Diamond) and triply periodic minimal surfaces
// (Gyroid, Schwarz P, Schwarz D). Topology families follow the set requested for LatticeQuery
// porting; implementations are independent re-derivations (see limitations in the pipeline).

import { clipSign, distSegment, sdBox, type Bounds, type Field } from "./fields.ts";
import { heteroValue, maxValue } from "./heterogeneous.ts";
import type { Axis, HeterogeneityField, LatticeType, TpmsType } from "../types.ts";

type Seg = readonly [number, number, number, number, number, number];

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

function corners(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) out.push([x, y, z]);
  return out;
}

/** Cube edges: pairs of corners differing in exactly one coordinate. */
function cubeEdges(): Seg[] {
  const cs = corners();
  const segs: Seg[] = [];
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const d = [0, 1, 2].map((k) => Math.abs(cs[i][k] - cs[j][k]));
      if (d[0] + d[1] + d[2] === 1) segs.push([...cs[i], ...cs[j]] as unknown as Seg);
    }
  return segs;
}

/** Body-centre struts: each corner to the cell centre. */
function bccSegs(): Seg[] {
  return corners().map((c) => [c[0], c[1], c[2], 0.5, 0.5, 0.5] as unknown as Seg);
}

/** Face-centre struts: each face centre to the four corners of that face. */
function fccSegs(): Seg[] {
  const segs: Seg[] = [];
  for (let d = 0; d < 3; d++)
    for (const s of [0, 1]) {
      const c = [0.5, 0.5, 0.5];
      c[d] = s;
      for (const cr of corners()) {
        if (cr[d] !== s) continue;
        segs.push([c[0], c[1], c[2], cr[0], cr[1], cr[2]] as unknown as Seg);
      }
    }
  return segs;
}

/** Diamond bonds: four tetrahedral sites, each bonded to its four nearest FCC sites. */
function diamondSegs(): Seg[] {
  const sites: [number, number, number][] = [
    [0.25, 0.25, 0.25],
    [0.75, 0.75, 0.25],
    [0.75, 0.25, 0.75],
    [0.25, 0.75, 0.75],
  ];
  const fcc: [number, number, number][] = [];
  for (const x of [0, 0.5, 1])
    for (const y of [0, 0.5, 1])
      for (const z of [0, 0.5, 1]) {
        const halves = [x, y, z].filter((v) => v === 0.5).length;
        if (halves % 2 === 0) fcc.push([x, y, z]);
      }
  const target = Math.sqrt(3) / 4;
  const segs: Seg[] = [];
  for (const s of sites)
    for (const q of fcc) {
      const d = Math.hypot(s[0] - q[0], s[1] - q[1], s[2] - q[2]);
      if (Math.abs(d - target) < 1e-9) segs.push([...s, ...q] as unknown as Seg);
    }
  return segs;
}

/**
 * Kelvin foam (truncated octahedra on a BCC arrangement). Unit cell edge = 1: one truncated octahedron
 * at the cell corner and one at the body centre. Vertices are the 24 permutations of (0, +-1, +-2)/4;
 * edges join vertices at squared distance 2/16 (36 edges, each vertex has three).
 */
function kelvinSegs(): Seg[] {
  // All distinct permutations of (0, +-1, +-2), scaled by 1/4: the 24 vertices of one truncated octahedron.
  const verts: [number, number, number][] = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const pm of perms)
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const a = [0, sa, 2 * sb];
      verts.push([a[pm[0]] / 4, a[pm[1]] / 4, a[pm[2]] / 4]);
    }
  const uniq = verts;
  const segs: Seg[] = [];
  const sq = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const edgeLen2 = 2 / 16;
  const sites: [number, number, number][] = [
    [0, 0, 0],
    [0.5, 0.5, 0.5],
  ];
  // Edges shared by two neighbouring truncated octahedra appear once per site: keep unique edges only.
  const seen = new Set<string>();
  for (const site of sites) {
    const vs = uniq.map((v) => [v[0] + site[0], v[1] + site[1], v[2] + site[2]]);
    for (let i = 0; i < vs.length; i++)
      for (let j = i + 1; j < vs.length; j++) {
        if (Math.abs(sq(vs[i], vs[j]) - edgeLen2) > 1e-12) continue;
        const a = vs[i].map((c) => c.toFixed(6)).join(",");
        const b = vs[j].map((c) => c.toFixed(6)).join(",");
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Periodic images of one edge are represented once: keep the edge whose midpoint lies in [0,1)^3.
        const mid = [0, 1, 2].map((k) => (vs[i][k] + vs[j][k]) / 2);
        if (mid.some((m) => m < 0 || m >= 1)) continue;
        segs.push([vs[i][0], vs[i][1], vs[i][2], vs[j][0], vs[j][1], vs[j][2]] as unknown as Seg);
      }
  }
  return segs;
}

export function latticePattern(type: LatticeType): Seg[] {
  switch (type) {
    case "sc":
      return cubeEdges();
    case "bcc":
      return bccSegs();
    case "fcc":
      return fccSegs();
    case "fbcc":
      // LatticeQuery FBCC = BCC diagonals + FCC diagonals + vertical reinforcement (fbccz variant).
      return [
        ...bccSegs(),
        ...fccSegs(),
        ...cubeEdges().filter((s) => s[2] !== s[5]),
      ];
    case "diamond":
      return diamondSegs();
    case "bccz":
      // BCC body-centre struts plus the four vertical cube edges (cell-edge reinforcement along z).
      return [...bccSegs(), ...cubeEdges().filter((s) => s[2] !== s[5])];
    case "kelvin":
      return kelvinSegs();
    default: {
      const never: never = type;
      throw new Error(`unknown lattice ${String(never)}`);
    }
  }
}

export interface StrutLatticeOptions {
  type: LatticeType;
  /** Unit cell edge length (mm). */
  cellSize: number;
  /** Number of cells along x, y, z. */
  cells: [number, number, number];
  /** Uniform strut radius (mm) when heterogeneity is null. */
  radius: number;
  heterogeneity?: HeterogeneityField | null;
}

/** Signed distance to a union of capsules (struts) within a periodic-cell layout, clipped to the box. */
export function strutLattice(opts: StrutLatticeOptions): Field {
  const { type, cellSize: a, cells, radius } = opts;
  const [nx, ny, nz] = cells;
  const pattern = latticePattern(type);
  const het = opts.heterogeneity ?? null;
  const dirIdx = het ? AXIS_INDEX[het.direction] : 0;
  const nDir = cells[dirIdx];
  // Per-cell radius along the variation direction (cell-centre sampling of the profile).
  const radiusAt: number[] = [];
  for (let i = 0; i < nDir; i++) {
    radiusAt.push(het ? heteroValue(het.rule, (i + 0.5) / nDir, het.min, het.max, het.expression) : radius);
  }
  const rMax = het ? maxValue(het) : radius;
  const bounds: Bounds = {
    min: [0, 0, 0],
    max: [nx * a, ny * a, nz * a],
  };

  const expr =
    `min_over_cells( min_seg( dist(p, seg_i) - r(cell) ) ) clipped to [0,${(nx * a).toFixed(3)}]x[0,${(ny * a).toFixed(3)}]x[0,${(nz * a).toFixed(3)}]` +
    `; type=${type}, cell=${a}mm, r=${het ? `${het.expression ? `expr(${het.expression})` : het.rule}(${het.min}..${het.max}, dir=${het.direction})` : radius}`;

  const field: Field = {
    bounds,
    expr,
    eval(x, y, z) {
      // Cell index of the point and the cells whose boxes lie within rMax of it.
      const ci = Math.floor(x / a);
      const cj = Math.floor(y / a);
      const ck = Math.floor(z / a);
      let best = Infinity;
      for (let dk = -1; dk <= 1; dk++) {
        const k = ck + dk;
        if (k < 0 || k >= nz) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const j = cj + dj;
          if (j < 0 || j >= ny) continue;
          for (let di = -1; di <= 1; di++) {
            const i = ci + di;
            if (i < 0 || i >= nx) continue;
            // Distance from p to the cell box [i a, (i+1) a] x ...
            const bx = Math.max(i * a - x, 0, x - (i + 1) * a);
            const by = Math.max(j * a - y, 0, y - (j + 1) * a);
            const bz = Math.max(k * a - z, 0, z - (k + 1) * a);
            if (Math.hypot(bx, by, bz) > rMax) continue;
            const idx = [i, j, k];
            const r = radiusAt[idx[dirIdx]];
            const ox = i * a;
            const oy = j * a;
            const oz = k * a;
            for (let s = 0; s < pattern.length; s++) {
              const sg = pattern[s];
              const d =
                distSegment(
                  x,
                  y,
                  z,
                  ox + sg[0] * a,
                  oy + sg[1] * a,
                  oz + sg[2] * a,
                  ox + sg[3] * a,
                  oy + sg[4] * a,
                  oz + sg[5] * a,
                ) - r;
              if (d < best) best = d;
            }
          }
        }
      }
      if (best === Infinity) best = rMax; // far outside every strut: positive, sign-correct
      return clipSign(best, sdBox(x - bounds.max[0] / 2, y - bounds.max[1] / 2, z - bounds.max[2] / 2, bounds.max[0] / 2, bounds.max[1] / 2, bounds.max[2] / 2));
    },
  };
  return field;
}

/** Periodic-surface function F(X,Y,Z) and its analytic gradient, for X = 2*pi*x/a. */
export function tpmsValueGrad(type: TpmsType, X: number, Y: number, Z: number): [number, number, number, number] {
  const sX = Math.sin(X);
  const cX = Math.cos(X);
  const sY = Math.sin(Y);
  const cY = Math.cos(Y);
  const sZ = Math.sin(Z);
  const cZ = Math.cos(Z);
  switch (type) {
    case "gyroid": {
      // F = sinX cosY + sinY cosZ + sinZ cosX
      const F = sX * cY + sY * cZ + sZ * cX;
      return [F, cX * cY - sZ * sX, -sX * sY + cY * cZ, -sY * sZ + cZ * cX];
    }
    case "schwarz_p": {
      // F = cosX + cosY + cosZ
      return [cX + cY + cZ, -sX, -sY, -sZ];
    }
    case "schwarz_d": {
      // F = sXsYsZ + sXcYcZ + cXsYcZ + cXcYsZ   (Schwarz D surface approximation)
      const F = sX * sY * sZ + sX * cY * cZ + cX * sY * cZ + cX * cY * sZ;
      const gx = cX * sY * sZ + cX * cY * cZ - sX * sY * cZ - sX * cY * sZ;
      const gy = sX * cY * sZ - sX * sY * cZ + cX * cY * cZ - cX * sY * sZ;
      const gz = sX * sY * cZ - sX * cY * sZ - cX * sY * sZ + cX * cY * cZ;
      return [F, gx, gy, gz];
    }
    case "neovius": {
      // F = 3(cosX + cosY + cosZ) + 4 cosX cosY cosZ
      const F = 3 * (cX + cY + cZ) + 4 * cX * cY * cZ;
      return [F, -sX * (3 + 4 * cY * cZ), -sY * (3 + 4 * cX * cZ), -sZ * (3 + 4 * cX * cY)];
    }
    case "iwp": {
      // F = 2(cosXcosY + cosYcosZ + cosZcosX) - (cos2X + cos2Y + cos2Z)
      const c2X = Math.cos(2 * X), c2Y = Math.cos(2 * Y), c2Z = Math.cos(2 * Z);
      const F = 2 * (cX * cY + cY * cZ + cZ * cX) - (c2X + c2Y + c2Z);
      return [
        F,
        -2 * sX * (cY + cZ) + 2 * Math.sin(2 * X),
        -2 * sY * (cZ + cX) + 2 * Math.sin(2 * Y),
        -2 * sZ * (cX + cY) + 2 * Math.sin(2 * Z),
      ];
    }
    case "lidinoid": {
      // F = sin2X cosY sinZ + sin2Y cosZ sinX + sin2Z cosX sinY - cos2X cos2Y - cos2Y cos2Z - cos2Z cos2X + 0.3
      const s2X = Math.sin(2 * X), s2Y = Math.sin(2 * Y), s2Z = Math.sin(2 * Z);
      const c2X = Math.cos(2 * X), c2Y = Math.cos(2 * Y), c2Z = Math.cos(2 * Z);
      const F = s2X * cY * sZ + s2Y * cZ * sX + s2Z * cX * sY - c2X * c2Y - c2Y * c2Z - c2Z * c2X + 0.15;
      const gx = 2 * c2X * cY * sZ + cX * s2Y * cZ - sX * s2Z * sY + 2 * s2X * (c2Y + c2Z);
      const gy = 2 * c2Y * cZ * sX + cY * s2Z * cX - sY * s2X * sZ + 2 * s2Y * (c2Z + c2X);
      const gz = 2 * c2Z * cX * sY + cZ * s2X * cY - sZ * s2Y * sX + 2 * s2Z * (c2X + c2Y);
      return [F, gx, gy, gz];
    }
    default: {
      const never: never = type;
      throw new Error(`unknown tpms ${String(never)}`);
    }
  }
}

export const TPMS_EXPR: Record<TpmsType, string> = {
  gyroid: "sin X cos Y + sin Y cos Z + sin Z cos X",
  schwarz_p: "cos X + cos Y + cos Z",
  schwarz_d: "sin X sin Y sin Z + sin X cos Y cos Z + cos X sin Y cos Z + cos X cos Y sin Z",
  neovius: "3 (cos X + cos Y + cos Z) + 4 cos X cos Y cos Z",
  iwp: "2 (cos X cos Y + cos Y cos Z + cos Z cos X) - (cos 2X + cos 2Y + cos 2Z)",
  lidinoid: "sin 2X cos Y sin Z + sin 2Y cos Z sin X + sin 2Z cos X sin Y - cos 2X cos 2Y - cos 2Y cos 2Z - cos 2Z cos 2X + 0.15",
};

export interface TpmsOptions {
  type: TpmsType;
  /** Period (unit cell edge, mm). */
  cellSize: number;
  /** Number of periods along x, y, z. */
  cells: [number, number, number];
  /** Uniform wall thickness (mm) when heterogeneity is null. */
  thickness: number;
  heterogeneity?: HeterogeneityField | null;
}

/**
 * Sheet (shell) TPMS solid: |F| - t/2 normalised by |grad F| gives an approximate signed distance
 * to the two offset surfaces F = +-t/2 (in mm), intersected with the build box.
 */
export function tpmsShell(opts: TpmsOptions): Field {
  const { type, cellSize: a, cells, thickness } = opts;
  const het = opts.heterogeneity ?? null;
  const dirIdx = het ? AXIS_INDEX[het.direction] : 0;
  const L = [cells[0] * a, cells[1] * a, cells[2] * a];
  const k = (2 * Math.PI) / a;
  const bounds: Bounds = { min: [0, 0, 0], max: [L[0], L[1], L[2]] };
  const wallAt = (u: number): number => (het ? heteroValue(het.rule, u, het.min, het.max, het.expression) : thickness);
  const expr =
    `max( (|F| / |grad F|) - t(u)/2 , sdBox ); F = ${TPMS_EXPR[type]} with X=2*pi*x/${a}` +
    `; t=${het ? `${het.expression ? `expr(${het.expression})` : het.rule}(${het.min}..${het.max}, dir=${het.direction})` : thickness}`;
  return {
    bounds,
    expr,
    eval(x, y, z) {
      const [F, gx, gy, gz] = tpmsValueGrad(type, k * x, k * y, k * z);
      const gn = Math.hypot(gx, gy, gz) * k + 1e-12;
      const p = [x, y, z];
      const u = Math.min(1, Math.max(0, p[dirIdx] / L[dirIdx]));
      const t = wallAt(u);
      const g = (Math.abs(F) / gn) - t / 2;
      return clipSign(
        g,
        sdBox(x - L[0] / 2, y - L[1] / 2, z - L[2] / 2, L[0] / 2, L[1] / 2, L[2] / 2),
      );
    },
  };
}
