// Exact B-Rep strut lattices through the SMLib kernel (smlibwasm).
//
// The field definition in src/topology/lattice.ts is a union of capsules (distance to strut
// segments minus radius) inside the build box. This module builds the same union as kernel
// solids and clips it to the box, so the volume is exact up to the kernel tolerance.
//
// Two construction modes, chosen per lattice type:
//  - "lines": every strut lies on an infinite line through corner nodes (SC, BCC, FCC, FBCC,
//    BCCZ). Each such line is ONE long cylinder, extended beyond the box. This avoids
//    coaxial end-to-end contacts between consecutive struts, which the kernel rejects.
//    Lines are shifted by a tiny per-line offset (EPS) in their normal plane so that no three
//    struts meet at one point (triple points also fail in the kernel). The shift changes the
//    volume by ~1e-5 relative.
//  - "bonds": struts are not collinear chains (Diamond, Kelvin). Each strut is a cylinder pulled
//    back by DELTA at both ends, plus a sphere at each node slightly larger than the strut
//    radius (JOINT). The cylinder ends sit inside the sphere, so no two solids touch on a face
//    or tangentially.
//
// Frame: the box is [0, L]^3 with L = cells * cellSize, the same frame as strutLattice().

import { latticePattern } from "../topology/lattice.ts";
import type { LatticeType } from "../types.ts";

export const EPS_LINE = 0.01; // mm, per-line normal-plane offset in "lines" mode
export const DELTA_BOND = 0.004; // mm, cylinder end pull-back inside the node sphere
export const NODE_JITTER = 0.002; // mm
export const JOINT_SCALE = 1.002; // node sphere radius = r * JOINT_SCALE

type Seg = readonly [number, number, number, number, number, number];

const SPHERE_ROT: [number, number, number] = [30, 40, 20];

export type ExactMode = "lines" | "bonds";

export function modeOf(type: LatticeType): ExactMode {
  return type === "diamond" || type === "kelvin" ? "bonds" : "lines";
}

export interface ExactLatticeOptions {
  type: LatticeType;
  /** Unit cell edge (mm). */
  cellSize: number;
  /** Number of cells along each axis (the box is cells * cellSize on a side). */
  cells: number;
  /** Strut radius (mm). */
  radius: number;
}

export interface ExactLatticeResult {
  shape: any;
  volume: number;
  area: number;
  pieces: number;
  mode: ExactMode;
  timeMs: { build: number; boolean: number };
}

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function unit(a: Vec3): Vec3 {
  const l = norm(a);
  return [a[0] / l, a[1] / l, a[2] / l];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A unit perpendicular to d (d unit). */
function perpendicular(d: Vec3): Vec3 {
  const ref: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(d, ref));
}

/** Primitive integer direction, sign-normalised so the first non-zero component is positive. */
function primitiveDirection(v: Vec3): Vec3 {
  // Pattern directions have halves (e.g. centre at 0.5); scale by 2 then divide by the gcd.
  const w = v.map((c) => Math.round(c * 2)) as Vec3;
  const g = (a: number, b: number): number => (b === 0 ? Math.abs(a) : g(b, a % b));
  const d = g(g(w[0], w[1]), w[2]) || 1;
  let out = w.map((c) => c / d) as Vec3;
  const first = out.find((c) => c !== 0) ?? 1;
  if (first < 0) out = out.map((c) => -c) as Vec3;
  return out;
}

/** Distinct strut directions of a line-mode lattice (from its unit-cell pattern). */
function lineDirections(type: LatticeType): Vec3[] {
  const seen = new Map<string, Vec3>();
  for (const s of latticePattern(type) as Seg[]) {
    const d = primitiveDirection([s[3] - s[0], s[4] - s[1], s[5] - s[2]]);
    seen.set(d.join(","), d);
  }
  return [...seen.values()];
}

/**
 * Corner-node lines in direction d through the integer corner lattice [lo, hi]^3 (unit-cell
 * coordinates). Each line is returned once; the canonical key sets its first non-zero
 * direction component to zero.
 */
function cornerLines(d: Vec3, lo: number, hi: number): Vec3[] {
  const a = d.findIndex((c) => c !== 0);
  const keys = new Map<string, Vec3>();
  for (let x = lo; x <= hi; x++)
    for (let y = lo; y <= hi; y++)
      for (let z = lo; z <= hi; z++) {
        const p: Vec3 = [x, y, z];
        const t = p[a] / d[a];
        const q: Vec3 = [p[0] - t * d[0], p[1] - t * d[1], p[2] - t * d[2]];
        const key = [0, 1, 2].filter((k) => k !== a).map((k) => q[k]).join(",");
        if (!keys.has(key)) keys.set(key, p);
      }
  return [...keys.values()];
}

/** Kernel cylinder of radius r and length len, centred at c, with its axis along the unit vector d. */
function cylinderAlong(K: any, r: number, len: number, c: Vec3, d: Vec3, shift?: Vec3): any {
  const origin = shift ? [c[0] + shift[0], c[1] + shift[1], c[2] + shift[2]] : c;
  const xDir = perpendicular(d);
  const plane = new K.Plane(new K.Vector(origin[0], origin[1], origin[2]), new K.Vector(xDir[0], xDir[1], xDir[2]), new K.Vector(d[0], d[1], d[2]));
  return K.Cylinder(r, len).on(plane);
}

/** Pseudo-random but deterministic unit-normal-plane offset for line i. */
function lineOffset(d: Vec3, i: number, eps: number): Vec3 {
  const u = perpendicular(d);
  const v = unit(cross(d, u));
  const th = i * 2.399963229728653; // golden angle
  return [
    eps * (Math.cos(th) * u[0] + Math.sin(th) * v[0]),
    eps * (Math.cos(th) * u[1] + Math.sin(th) * v[1]),
    eps * (Math.cos(th) * u[2] + Math.sin(th) * v[2]),
  ];
}

/**
 * Parameter interval [t0, t1] over which the line q + t d (d unit) lies inside the box [-pad, L+pad]^3
 * (slab test), or null if it misses the box.
 */
function lineInterval(q: Vec3, d: Vec3, L: number, pad: number): [number, number] | null {
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const lo = -pad, hi = L + pad;
    if (Math.abs(d[k]) < 1e-12) {
      if (q[k] < lo || q[k] > hi) return null;
    } else {
      let a = (lo - q[k]) / d[k], b = (hi - q[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** True if the line (point q, unit direction d) passes within pad of the box [0,L]^3. */
function lineHitsBox(q: Vec3, d: Vec3, L: number, pad: number): boolean {
  return lineInterval(q, d, L, pad) !== null;
}

function balancedFuse(parts: any[], tags?: string[], clip?: any): any {
  // EXACT_FUSE_ALL=1: one multi-tool fuse call instead of the tree (experiment).
  if (process.env.EXACT_FUSE_ALL === "1") return parts[0].fuse(...parts.slice(1));
  // EXACT_DEBUG=1: on a kernel failure, report the two operands' tags (centre and direction) and the level.
  let level = parts;
  let labels = tags ?? parts.map((_, i) => String(i));
  let depth = 0;
  while (level.length > 1) {
    const next: any[] = [];
    const nextLabels: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        try {
          const f = level[i].fuse(level[i + 1]);
          // EXACT_CLIP_LEVELS=1 (experiment): keep intermediate solids inside the box. Off by default: it
          // breaks SC at L=20 (fails in 6 s) while BCC L=8 passes either way.
          next.push(clip && process.env.EXACT_CLIP_LEVELS === "1" ? f.intersect(clip) : f);
        } catch (e) {
          if (process.env.EXACT_DEBUG) console.error(`FUSE_FAIL depth=${depth} a=${labels[i]} b=${labels[i + 1]}`);
          throw e;
        }
        nextLabels.push(`(${labels[i]}+${labels[i + 1]})`);
      } else {
        next.push(level[i]);
        nextLabels.push(labels[i]);
      }
    }
    level = next;
    labels = nextLabels;
    depth++;
  }
  return level[0];
}

/**
 * Slab-ordered fusion (experiment, EXACT_SLABS=n). The box is cut into n z-slabs. Each slab fuses the
 * pieces whose conservative z range reaches it (slab +/- margin), is intersected with its own
 * expanded slab box, and the slab solids are then chained in z order. A failing merge is therefore
 * local to one z-plane, and the failing plane is reported with EXACT_DEBUG.
 */
function slabFuse(K: any, pieces: any[], tags: string[], zc: number[], zh: number[], L: number, n: number, margin: number): any {
  let acc: any = null;
  const xy = L + 2 * margin;
  for (let k = 0; k < n; k++) {
    // Exact slab planes: adjacent slabs touch on a plane and do not overlap. (An overlapping margin put
    // the same strut surface into two slabs, and the chained fuse then failed on coincident faces.)
    // Interior planes are shifted off the lattice node heights (multiples of cell/2): a plane through a
    // node meets the struts there in a degenerate way. The outer faces stay at the box faces.
    const bound = (j: number) => (j <= 0 ? 0 : j >= n ? L : (j * L) / n + 0.37);
    const z0 = bound(k), z1 = bound(k + 1);
    const members: number[] = [];
    for (let i = 0; i < pieces.length; i++) if (zc[i] + zh[i] >= z0 - margin && zc[i] - zh[i] <= z1 + margin) members.push(i);
    if (members.length === 0) continue;
    if (process.env.EXACT_DEBUG) console.error(`SLAB ${k}/${n} z=[${z0.toFixed(2)},${z1.toFixed(2)}] pieces=${members.length}`);
    let part: any;
    try {
      // Fuse the members UNcut, then cut the slab once. Cutting each piece first puts overlapping
      // cap faces on the slab plane, which the kernel rejects (tried: fails at depth 4).
      // xy extent is huge: only the two z planes cut, so no extra faces meet the outside struts.
      // Exact xy faces this time (EXACT_SLABS_XY=big keeps the huge box): each slab is then already inside
      // the lattice box, so no final intersect is needed.
      const big = process.env.EXACT_SLABS_XY === "big" ? 4 * L + 40 : L;
      const box = K.Box(big, big, z1 - z0).translate(L / 2, L / 2, (z0 + z1) / 2);
      part = balancedFuse(members.map((i) => pieces[i]), members.map((i) => tags[i]));
      part = part.intersect(box);
      acc = acc ? acc.fuse(part) : part;
    } catch (e) {
      if (process.env.EXACT_DEBUG) console.error(`SLAB_FAIL k=${k} z=[${z0.toFixed(2)},${z1.toFixed(2)}]`);
      throw e;
    }
  }
  return acc;
}

/** Build the exact lattice solid for the given type, cell size, cell count and radius. */
export async function buildExactLattice(K: any, opts: ExactLatticeOptions): Promise<ExactLatticeResult> {
  const { type, cellSize: a, cells: n, radius: r } = opts;
  const L = n * a;
  // EXACT_MODE=lines|bonds overrides the default per type (for experiments only).
  const forced = process.env.EXACT_MODE;
  const mode: ExactMode = forced === "lines" || forced === "bonds" ? forced : modeOf(type);
  const pieces: any[] = [];
  const tags: string[] = [];
  const zCentres: number[] = []; // z centre of each piece (for slab grouping)
  // Conservative z half-extent of each piece (for slab grouping): |axis_z| * half length + radius + margin.
  const zh: number[] = [];
  const t0 = Date.now();

  if (mode === "lines") {
    const dirs = lineDirections(type);
    let idx = 0;
    const lineLen = 2 * Math.sqrt(3) * L + 4; // covers the box diagonal with margin
    for (const d of dirs) {
      const dn = unit(d as Vec3);
      for (const p of cornerLines(d, -1, n + 1)) {
        // Point on the line closest to the box centre, so the cylinder is centred inside the box.
        const centre: Vec3 = [L / 2, L / 2, L / 2];
        const pc: Vec3 = [p[0] * a, p[1] * a, p[2] * a];
        const t = dot(sub(centre, pc), dn);
        const onLine: Vec3 = [pc[0] + t * dn[0], pc[1] + t * dn[1], pc[2] + t * dn[2]];
        // Full-length lines: trimming each line to the box (tried, see docs/EXACT_LATTICES.md) made the
        // BCC fuse fail even at L=8, so the untrimmed construction is kept; the final intersect clips it.
        if (!lineHitsBox(onLine, dn, L, r)) continue;
        const off = lineOffset(dn, idx++, Number(process.env.EXACT_EPS ?? EPS_LINE)); // EXACT_EPS: experiments only
        pieces.push(cylinderAlong(K, r, lineLen, onLine, dn, off));
        zh.push(Math.abs(dn[2]) * lineLen / 2 + r + 0.1);
        zCentres.push(onLine[2]);
        tags.push(`line p=${onLine.map((c) => c.toFixed(2)).join(",")} d=${dn.map((c) => c.toFixed(2)).join(",")}`);
      }
    }
  } else {
    // Unit-cell pattern, translated per cell exactly as strutLattice() does (cells in [0,n)^3).
    const pattern = latticePattern(type) as Seg[];
    // Node jitter: each unique node is moved by a deterministic ~NODE_JITTER offset, the same for
    // every bond at that node. This breaks the coplanar seams that cell faces and symmetric
    // arrangements produce (the kernel rejects them when many bonds are fused). Volume effect ~1e-4.
    const jitter = new Map<string, Vec3>();
    let jn = 0;
    const jitterOf = (P: Vec3): Vec3 => {
      const key = P.map((c) => c.toFixed(6)).join(",");
      let o = jitter.get(key);
      if (!o) {
        const i = jn++;
        const th = i * 2.399963229728653, ph = i * 1.3247179572447460;
        o = [NODE_JITTER * Math.cos(th) * Math.cos(ph), NODE_JITTER * Math.sin(th) * Math.cos(ph), NODE_JITTER * Math.sin(ph)];
        jitter.set(key, o);
      }
      return [P[0] + o[0], P[1] + o[1], P[2] + o[2]];
    };
    const bonds = new Map<string, [Vec3, Vec3]>();
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++)
          for (const s of pattern) {
            const A: Vec3 = jitterOf([(i + s[0]) * a, (j + s[1]) * a, (k + s[2]) * a]);
            const B: Vec3 = jitterOf([(i + s[3]) * a, (j + s[4]) * a, (k + s[5]) * a]);
            const ka = A.map((c) => c.toFixed(6)).join(",");
            const kb = B.map((c) => c.toFixed(6)).join(",");
            const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
            if (!bonds.has(key)) bonds.set(key, [A, B]);
          }
    const RS = r * JOINT_SCALE;
    const nodes = new Map<string, Vec3>();
    let bi = 0;
    for (const [A, B] of bonds.values()) {
      const d = sub(B, A);
      const len = norm(d);
      const c: Vec3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      // Deterministic radius jitter (<= 0.03 %): breaks exact tangency and coplanar seams that
      // the kernel rejects in the symmetric Kelvin/diamond arrangement. Volume effect ~1e-4.
      const rc = r * (1 - 3e-4 * ((bi++ * 0.6180339887) % 1));
      // Per-bond end pull-back in [0.6, 1.8] * DELTA_BOND so that parallel bonds at a node do not
      // get coplanar end caps (a parallel-face overlap the kernel rejects). Must stay < ~0.025 mm
      // so the cap rim lies inside the node sphere.
      const dl = DELTA_BOND * (0.6 + 1.2 * ((bi * 0.7548776662) % 1));
      pieces.push(cylinderAlong(K, rc, len - 2 * dl, c, unit(d)));
      zh.push(Math.abs(unit(d)[2]) * len / 2 + rc + 0.1);
      zCentres.push(c[2]);
      tags.push(`bond c=${c.map((x) => x.toFixed(2)).join(",")}`);
      nodes.set(A.map((x) => x.toFixed(6)).join(","), A);
      nodes.set(B.map((x) => x.toFixed(6)).join(","), B);
    }
    for (const P of nodes.values()) {
      pieces.push(K.Rot(...SPHERE_ROT).mul(K.Sphere(RS)).translate(P[0], P[1], P[2]));
      zh.push(RS + 0.1);
      zCentres.push(P[2]);
      tags.push(`node p=${P.map((x) => x.toFixed(2)).join(",")}`);
    }
  }

  // Build box [0, L]^3, centred the way the kernel's Box is (Box is centred at the origin).
  const clip = K.Box(L, L, L).translate(L / 2, L / 2, L / 2);
  const tBuild = Date.now() - t0;
  const t1 = Date.now();
  // Intermediate clip box is slightly larger than the lattice box, so intermediate solids do not share
  // faces with it; the final intersect uses the exact box.
  const margin = 0.5;
  const clipBox = K.Box(L + 2 * margin, L + 2 * margin, L + 2 * margin).translate(L / 2, L / 2, L / 2);
  const slabs = Number(process.env.EXACT_SLABS ?? 0);
  const union = slabs > 0 ? slabFuse(K, pieces, tags, zCentres, zh, L, slabs, margin) : balancedFuse(pieces, tags, clipBox);
  const solid = slabs > 0 && process.env.EXACT_SLABS_XY !== "big" ? union : union.intersect(clip);
  const tBool = Date.now() - t1;
  return { shape: solid, volume: solid.volume, area: solid.area, pieces: pieces.length, mode, timeMs: { build: tBuild, boolean: tBool } };
}
