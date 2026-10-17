// Fractal cube skeleton (C2 of docs/TASK_PLAN.md, recursive substitution).
// Level-k cube of size s has its 12 edges drawn as struts of radius r0 * ratio^k, then recurses into
// the d^3 corner subcubes of size s/d (k < depth). Total edges: 12 * (1 + 8 + 8^2 + ... ) for d = 2.
// The field is the distance to the nearest strut minus its radius, computed with a bucket grid
// (exact within one bucket width of the struts; farther values are only upper bounds, and sign is correct).

import type { Bounds, Field } from "../topology/fields.ts";

type Vec3 = [number, number, number];
interface Strut { a: Vec3; b: Vec3; r: number }

/** tiles: number of fractal cubes along each axis (default 1); cubes share faces, so shared edges are drawn twice (harmless for the field). */
export interface FractalSpec { size: number; divisor: number; depth: number; radius: number; radiusRatio: number; tiles?: number }

/** All struts of the fractal skeleton inside [0, size]^3. */
export function fractalStruts(s: FractalSpec): Strut[] {
  const out: Strut[] = [];
  const rec = (o: Vec3, size: number, k: number) => {
    const r = s.radius * Math.pow(s.radiusRatio, k);
    const [x, y, z] = o;
    const c = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]].map(
      ([i, j, l]) => [x + i * size, y + j * size, z + l * size] as Vec3,
    );
    const edges: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [i, j] of edges) out.push({ a: c[i], b: c[j], r });
    if (k + 1 >= s.depth) return;
    const sub = size / s.divisor;
    const far = size - sub;
    for (const [i, j, l] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
      rec([x + i * far, y + j * far, z + l * far], sub, k + 1);
    }
  };
  const n = s.tiles ?? 1;
  for (let tx = 0; tx < n; tx++) for (let ty = 0; ty < n; ty++) for (let tz = 0; tz < n; tz++)
    rec([tx * s.size, ty * s.size, tz * s.size], s.size, 0);
  return out;
}

function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  let t = L2 > 0 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = ap[0] - t * ab[0], dy = ap[1] - t * ab[1], dz = ap[2] - t * ab[2];
  return Math.hypot(dx, dy, dz);
}

/** Field of the fractal skeleton: min over struts of (distance - radius), bucket-accelerated. */
export function fractalField(s: FractalSpec): Field {
  const struts = fractalStruts(s);
  const tiles = s.tiles ?? 1;
  const perTile = Math.pow(s.divisor, s.depth); // finest subcubes per axis within one tile
  const nb = perTile * tiles; // buckets per axis over the whole tiled extent
  const w = s.size / perTile;
  const rMax = s.radius; // the largest strut radius (level 0)
  if (!(rMax < w)) throw new Error("fractal: radius must be < finest subcube size (bucket width)");
  const T = w - rMax; // clamp value; > 0 by the check above
  const idx = (i: number, j: number, k: number) => (i * nb + j) * nb + k;
  const buckets: number[][] = Array.from({ length: nb * nb * nb }, () => []);
  const bucketOf = (v: number) => Math.min(nb - 1, Math.max(0, Math.floor(v / w)));
  struts.forEach((st, id) => {
    const lo = [0, 1, 2].map((a) => bucketOf(Math.min(st.a[a], st.b[a]) - rMax));
    const hi = [0, 1, 2].map((a) => bucketOf(Math.max(st.a[a], st.b[a]) + rMax));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) buckets[idx(i, j, k)].push(id);
  });
  const eval_ = (x: number, y: number, z: number): number => {
    const p: Vec3 = [x, y, z];
    const bi = bucketOf(x), bj = bucketOf(y), bk = bucketOf(z);
    let best = Infinity;
    for (let i = Math.max(0, bi - 1); i <= Math.min(nb - 1, bi + 1); i++)
      for (let j = Math.max(0, bj - 1); j <= Math.min(nb - 1, bj + 1); j++)
        for (let k = Math.max(0, bk - 1); k <= Math.min(nb - 1, bk + 1); k++)
          for (const id of buckets[idx(i, j, k)]) {
            const st = struts[id];
            const v = segDist(p, st.a, st.b) - st.r;
            if (v < best) best = v;
          }
    // Exact whenever the true value is below T: such a strut has distance < w, so it lies in the 3x3x3 block.
    return Math.min(best, T);
  };
  const ext = s.size * tiles;
  const bounds: Bounds = { min: [-rMax, -rMax, -rMax], max: [ext + rMax, ext + rMax, ext + rMax] } as Bounds;
  return {
    bounds,
    eval: eval_,
    expr: `fractal_cube(size=${s.size}, d=${s.divisor}, depth=${s.depth}, r0=${s.radius}, ratio=${s.radiusRatio}, tiles=${tiles}; ${struts.length} struts)`,
  };
}
