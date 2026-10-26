// Discrete harmonic map of a parameter domain onto a disk (C1, general parameter plane, piecewise linear).
//
// Two parameter domains are implemented, both meshed into triangles in the source plane:
//   - a rectangle: structured grid of 2 n^2 triangles;
//   - an ellipse (a disk is the case of equal semi-axes): polar mesh with n rings and 2 n points per ring.
// Boundary vertices are placed on the circle of radius R by source perimeter arc length. Interior vertices satisfy the
// uniform (Tutte) harmonic condition: each equals the mean of its neighbours. With a convex boundary and uniform weights
// this is an embedding (Tutte / Floater), checked by requiring positive area for every world triangle.
//
// The map is piecewise affine, so its Lipschitz constant is exact: the largest singular value of the inverse affine map
// over all triangles. The map is harmonic in the discrete sense, not conformal in general. A rectangle has four corners,
// where any map onto a disk is singular (large lambda); a smooth domain such as an ellipse has none.

export type Pt2 = [number, number];
export type HarmonicDiskSpec = {
  radius: number;
  /** Rectangular source domain. Exactly one of box / ellipse. */
  box?: { min: Pt2; max: Pt2 };
  /** Elliptical source domain (centre, semi-axes). A disk is the case of equal semi-axes. */
  ellipse?: { centre: Pt2; semi: Pt2 };
  /** Superellipse |x/a|^p + |y/b|^p <= 1 with p > 2 (convex, C^1 boundary, no corners). Exactly one of the three. */
  superellipse?: { centre: Pt2; semi: Pt2; power: number };
  /** Simple polygon, star-shaped about `centre` (default: the vertex average). Exactly one of the four domains. */
  polygon?: { vertices: Pt2[]; centre?: Pt2 };
  /** Resolution: grid cells per side (rectangle) or rings (ellipse; 2n points per ring). Default 24. */
  n: number;
};

export interface HarmonicDisk {
  readonly n: number;
  readonly radius: number;
  /** Source point -> world (disk) point. */
  forward: (s: Pt2) => Pt2;
  /** World point inside the disk -> source point. Piecewise affine. */
  inverse: (w: Pt2) => Pt2;
  /** Lipschitz constant of the inverse on the disk: max(1, largest singular value over all triangles). */
  lambda: number;
  /** Largest deviation of the boundary vertices from the circle of radius R (should be ~0). */
  boundaryError: number;
  /** Largest residual |x_v - mean(neighbours)| over interior vertices (should be ~0). */
  harmonicResidual: number;
  /** Smallest world triangle area divided by R^2 (must be > 0 for an embedding). */
  minOrientation: number;
}

const MAX_ITER = 400000;

/** Build the discrete harmonic map. Throws if the domain is invalid or the mesh is not an embedding. */
export function buildHarmonicDisk(spec: HarmonicDiskSpec): HarmonicDisk {
  const given = [spec.box, spec.ellipse, spec.superellipse, spec.polygon].filter((x) => x !== undefined).length;
  if (given > 1) throw new Error("harmonic_disk: give exactly one of box, ellipse, superellipse or polygon");
  if (spec.superellipse) {
    const s = spec.superellipse;
    return buildSuperellipse(spec.radius, s.centre, s.semi, s.power, spec.n);
  }
  if (spec.ellipse) return buildEllipse(spec.radius, spec.ellipse.centre, spec.ellipse.semi, spec.n);
  if (spec.polygon) return buildPolygon(spec.radius, spec.polygon.vertices, spec.polygon.centre, spec.n);
  if (!spec.box) throw new Error("harmonic_disk: no parameter domain (box, ellipse, superellipse or polygon)");
  return buildRect(spec.radius, spec.box.min, spec.box.max, spec.n);
}

function buildRect(R: number, min: Pt2, max: Pt2, n: number): HarmonicDisk {
  const [x0, y0] = min, [x1, y1] = max;
  if (!(R > 0) || !(x1 > x0) || !(y1 > y0) || !Number.isInteger(n) || n < 3) throw new Error("harmonic_disk: bad rectangle spec");
  const N = n + 1;
  const vid = (i: number, j: number) => j * N + i;
  const V = N * N;
  const src = new Float64Array(2 * V);
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const k = vid(i, j);
      src[2 * k] = x0 + ((x1 - x0) * i) / n;
      src[2 * k + 1] = y0 + ((y1 - y0) * j) / n;
    }
  const tris: number[][] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      tris.push([vid(i, j), vid(i + 1, j), vid(i + 1, j + 1)]);
      tris.push([vid(i, j), vid(i + 1, j + 1), vid(i, j + 1)]);
    }
  // Boundary, counter-clockwise.
  const boundary: number[] = [];
  for (let i = 0; i < n; i++) boundary.push(vid(i, 0));
  for (let j = 0; j < n; j++) boundary.push(vid(n, j));
  for (let i = n; i > 0; i--) boundary.push(vid(i, n));
  for (let j = n; j > 0; j--) boundary.push(vid(0, j));
  return buildMesh(R, src, tris, boundary, n);
}

function buildEllipse(R: number, centre: Pt2, semi: Pt2, n: number): HarmonicDisk {
  const [cx, cy] = centre, [a, b] = semi;
  if (!(R > 0) || !(a > 0) || !(b > 0) || !Number.isInteger(n) || n < 3) throw new Error("harmonic_disk: bad ellipse spec");
  // Polar mesh of the unit disk: centre, then n rings of 2n points. Ring k (1..n) has radius k/n.
  const M = 2 * n;
  const V = 1 + n * M;
  const ringId = (k: number, j: number) => 1 + (k - 1) * M + (((j % M) + M) % M);
  const unit = new Float64Array(2 * V);
  for (let k = 1; k <= n; k++)
    for (let j = 0; j < M; j++) {
      const r = k / n, th = (2 * Math.PI * j) / M;
      const id = ringId(k, j);
      unit[2 * id] = r * Math.cos(th);
      unit[2 * id + 1] = r * Math.sin(th);
    }
  // Affine map of the unit disk onto the ellipse (orientation preserving for a, b > 0).
  const src = new Float64Array(2 * V);
  for (let v = 0; v < V; v++) {
    src[2 * v] = cx + a * unit[2 * v];
    src[2 * v + 1] = cy + b * unit[2 * v + 1];
  }
  const tris: number[][] = [];
  for (let j = 0; j < M; j++) tris.push([0, ringId(1, j), ringId(1, j + 1)]);
  for (let k = 1; k < n; k++)
    for (let j = 0; j < M; j++) {
      // Quad A (inner, j), B (inner, j+1), D (outer, j+1), C (outer, j) is counter-clockwise: A, C, D, B.
      const A = ringId(k, j), B = ringId(k, j + 1), D = ringId(k + 1, j + 1), C = ringId(k + 1, j);
      tris.push([A, C, D]);
      tris.push([A, D, B]);
    }
  const boundary: number[] = [];
  for (let j = 0; j < M; j++) boundary.push(ringId(n, j));
  return buildMesh(R, src, tris, boundary, n);
}

/**
 * Superellipse |x/a|^p + |y/b|^p = 1 (p > 2). Polar mesh as for the ellipse, but ring k lies at the fraction k/n of the
 * boundary distance along each ray: rho(theta) = (|cos/a|^p + |sin/b|^p)^(-1/p). The boundary is C^1 and convex, so the
 * map has no corner singularities (the same reason the ellipse is corner-free).
 */
function buildSuperellipse(R: number, centre: Pt2, semi: Pt2, p: number, n: number): HarmonicDisk {
  const [cx, cy] = centre, [a, b] = semi;
  if (!(R > 0) || !(a > 0) || !(b > 0) || !(p > 2) || !Number.isFinite(p) || !Number.isInteger(n) || n < 3)
    throw new Error("harmonic_disk: bad superellipse spec (semi-axes > 0, power > 2, n integer >= 3)");
  const M = 2 * n;
  const V = 1 + n * M;
  const ringId = (k: number, j: number) => 1 + (k - 1) * M + (((j % M) + M) % M);
  const src = new Float64Array(2 * V);
  src[0] = cx;
  src[1] = cy;
  for (let k = 1; k <= n; k++)
    for (let j = 0; j < M; j++) {
      const th = (2 * Math.PI * j) / M;
      const c = Math.cos(th), s = Math.sin(th);
      const rho = Math.pow(Math.pow(Math.abs(c) / a, p) + Math.pow(Math.abs(s) / b, p), -1 / p);
      const id = ringId(k, j);
      src[2 * id] = cx + (k / n) * rho * c;
      src[2 * id + 1] = cy + (k / n) * rho * s;
    }
  const tris: number[][] = [];
  for (let j = 0; j < M; j++) tris.push([0, ringId(1, j), ringId(1, j + 1)]);
  for (let k = 1; k < n; k++)
    for (let j = 0; j < M; j++) {
      const A = ringId(k, j), B = ringId(k, j + 1), D = ringId(k + 1, j + 1), C = ringId(k + 1, j);
      tris.push([A, C, D]);
      tris.push([A, D, B]);
    }
  const boundary: number[] = [];
  for (let j = 0; j < M; j++) boundary.push(ringId(n, j));
  return buildMesh(R, src, tris, boundary, n);
}

/** Why the polygon (counter-clockwise vertices V0) is not star-shaped about c, or null if it is. */
function starReason(V0: Pt2[], c: Pt2): string | null {
  const m = V0.length;
  const at = `(${c[0]}, ${c[1]})`;
  let total = 0;
  for (let i = 0; i < m; i++) {
    const p = V0[i], q = V0[(i + 1) % m];
    if (!(Math.hypot(p[0] - c[0], p[1] - c[1]) > 0)) return `polygon is not star-shaped about ${at}: the centre coincides with a polygon vertex`;
    let d = Math.atan2(q[1] - c[1], q[0] - c[0]) - Math.atan2(p[1] - c[1], p[0] - c[0]);
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    if (!(d > 0 && d < Math.PI)) return `polygon is not star-shaped about ${at} (edge ${i} angle step ${d})`;
    total += d;
  }
  if (Math.abs(total - 2 * Math.PI) > 1e-9) return `polygon is not star-shaped about ${at}`;
  return null;
}

/**
 * Simple polygon (any outline, concave allowed). If `centre` is given the polygon must be star-shaped about it and the
 * radial mesh is used. Otherwise the vertex average is tried, and a polygon that is not star-shaped about it is
 * triangulated by ear clipping (general path, see buildPolygonGeneral). Vertices are counter-clockwise after
 * normalisation, and repeated or collinear-degenerate input is rejected.
 */
export function buildPolygon(R: number, vertices: Pt2[], centreIn: Pt2 | undefined, n: number): HarmonicDisk {
  if (!(R > 0) || !Number.isInteger(n) || n < 3) throw new Error("harmonic_disk: bad polygon spec (radius > 0, n integer >= 3)");
  if (vertices.length < 3) throw new Error("harmonic_disk: a polygon needs at least 3 vertices");
  if (!vertices.every((v) => Number.isFinite(v[0]) && Number.isFinite(v[1]))) throw new Error("harmonic_disk: polygon vertices must be finite [x, y]");
  let a2 = 0;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i], q = vertices[(i + 1) % vertices.length];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  if (!(Math.abs(a2) > 1e-12)) throw new Error("harmonic_disk: polygon has zero area");
  const V0 = a2 > 0 ? vertices : [...vertices].reverse();
  const m = V0.length;
  const lens: number[] = [];
  for (let i = 0; i < m; i++) {
    const p = V0[i], q = V0[(i + 1) % m];
    lens.push(Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  if (lens.some((l) => !(l > 0))) throw new Error("harmonic_disk: polygon has a repeated vertex");
  const L = lens.reduce((x, y) => x + y, 0);

  if (centreIn !== undefined) {
    const reason = starReason(V0, centreIn);
    if (reason) throw new Error(`harmonic_disk: ${reason}`);
    return buildPolygonRadial(R, V0, centreIn, L, n);
  }
  const c0: Pt2 = [V0.reduce((x, p) => x + p[0], 0) / m, V0.reduce((x, p) => x + p[1], 0) / m];
  if (starReason(V0, c0) === null) return buildPolygonRadial(R, V0, c0, L, n);
  return buildPolygonGeneral(R, V0, L, n);
}

/**
 * Star-shaped polygon about c. Outer ring: the boundary sampled at uniform arc length (spacing L / 2n) with every polygon
 * vertex included, so corners are mesh vertices and straight edges are exact. Ring k (1..n) is c + (k/n)(B_j - c), the
 * same radial construction as the superellipse.
 */
function buildPolygonRadial(R: number, V0: Pt2[], c: Pt2, L: number, n: number): HarmonicDisk {
  const m = V0.length;
  const h = L / (2 * n);
  const B: Pt2[] = [];
  for (let i = 0; i < m; i++) {
    const p = V0[i], q = V0[(i + 1) % m];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const mi = Math.max(1, Math.round(len / h));
    for (let k = 0; k < mi; k++) B.push([p[0] + (k / mi) * (q[0] - p[0]), p[1] + (k / mi) * (q[1] - p[1])]);
  }
  const M = B.length;
  if (M < 3) throw new Error("harmonic_disk: polygon boundary has too few samples");

  const V = 1 + n * M;
  const ringId = (k: number, j: number) => 1 + (k - 1) * M + (((j % M) + M) % M);
  const src = new Float64Array(2 * V);
  src[0] = c[0];
  src[1] = c[1];
  for (let k = 1; k <= n; k++)
    for (let j = 0; j < M; j++) {
      const id = ringId(k, j);
      src[2 * id] = c[0] + (k / n) * (B[j][0] - c[0]);
      src[2 * id + 1] = c[1] + (k / n) * (B[j][1] - c[1]);
    }
  const tris: number[][] = [];
  for (let j = 0; j < M; j++) tris.push([0, ringId(1, j), ringId(1, j + 1)]);
  for (let k = 1; k < n; k++)
    for (let j = 0; j < M; j++) {
      const A = ringId(k, j), Bq = ringId(k, j + 1), D = ringId(k + 1, j + 1), C = ringId(k + 1, j);
      tris.push([A, C, D]);
      tris.push([A, D, Bq]);
    }
  const boundary: number[] = [];
  for (let j = 0; j < M; j++) boundary.push(ringId(n, j));
  return buildMesh(R, src, tris, boundary, n);
}

/**
 * Ear clipping of a simple counter-clockwise polygon into triangles (no interior points). A vertex that lies on or inside
 * a candidate ear blocks it. Throws if no ear exists (self-intersection or collinear degeneracy).
 */
function earClip(P: Pt2[]): number[][] {
  const cross = (a: Pt2, b: Pt2, c: Pt2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let scale = 0;
  for (const p of P) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]));
  const eps = 1e-12 * scale * scale;
  const idx = P.map((_, i) => i);
  const out: number[][] = [];
  while (idx.length > 3) {
    const len = idx.length;
    let found = false;
    for (let k = 0; k < len && !found; k++) {
      const i0 = idx[(k + len - 1) % len], i1 = idx[k], i2 = idx[(k + 1) % len];
      const a = P[i0], b = P[i1], c = P[i2];
      if (!(cross(a, b, c) > eps)) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = P[j];
        if (cross(a, b, p) >= -eps && cross(b, c, p) >= -eps && cross(c, a, p) >= -eps) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      found = true;
    }
    if (!found) throw new Error("harmonic_disk: polygon could not be triangulated (self-intersecting or degenerate)");
  }
  out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/**
 * General simple polygon: ear-clipped into triangles. Each triangle is a convex piece, meshed radially from its centroid.
 * Edges shared by two triangles (the diagonals of the clipping) carry one set of sample points, so the union is a conforming
 * triangulation of the polygon. The outer boundary is sampled at spacing L / 2n, as in the radial mesh. Corners are mesh
 * vertices; a reflex corner is the apex of the two triangles that meet there.
 */
function buildPolygonGeneral(R: number, V0: Pt2[], L: number, n: number): HarmonicDisk {
  const m = V0.length;
  const h = L / (2 * n);
  const pos: number[] = [];
  const addPt = (x: number, y: number) => {
    pos.push(x, y);
    return pos.length / 2 - 1;
  };
  for (const p of V0) addPt(p[0], p[1]); // ids 0..m-1 are the polygon vertices
  // Edge samples keyed by the sorted vertex pair: ids [lo, s_1, ..., s_{k-1}, hi].
  const edges = new Map<string, number[]>();
  /** Sample ids from p to q, excluding q (so consecutive edges of a loop share no id). */
  const edgeIds = (p: number, q: number): number[] => {
    const lo = Math.min(p, q), hi = Math.max(p, q);
    const key = `${lo},${hi}`;
    let ids = edges.get(key);
    if (!ids) {
      const a = V0[lo], b = V0[hi];
      const mE = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / h));
      ids = [lo];
      for (let k = 1; k < mE; k++) ids.push(addPt(a[0] + (k / mE) * (b[0] - a[0]), a[1] + (k / mE) * (b[1] - a[1])));
      ids.push(hi);
      edges.set(key, ids);
    }
    return p === lo ? ids.slice(0, -1) : ids.slice(1).reverse();
  };

  const tris: number[][] = [];
  for (const [a, b, c] of earClip(V0)) {
    const outer = [...edgeIds(a, b), ...edgeIds(b, c), ...edgeIds(c, a)];
    const M = outer.length;
    const cx = (V0[a][0] + V0[b][0] + V0[c][0]) / 3, cy = (V0[a][1] + V0[b][1] + V0[c][1]) / 3;
    const core = addPt(cx, cy);
    const ring: number[][] = [];
    for (let k = 1; k < n; k++) {
      const r: number[] = [];
      for (let j = 0; j < M; j++) {
        const bx = pos[2 * outer[j]], by = pos[2 * outer[j] + 1];
        r.push(addPt(cx + (k / n) * (bx - cx), cy + (k / n) * (by - cy)));
      }
      ring.push(r);
    }
    ring.push(outer); // ring n: the boundary samples of this triangle (shared ids)
    for (let j = 0; j < M; j++) tris.push([core, ring[0][j], ring[0][(j + 1) % M]]);
    for (let k = 1; k < n; k++) {
      const inner = ring[k - 1], outerR = ring[k];
      for (let j = 0; j < M; j++) {
        const A = inner[j], Bq = inner[(j + 1) % M], D = outerR[(j + 1) % M], C = outerR[j];
        tris.push([A, C, D]);
        tris.push([A, D, Bq]);
      }
    }
  }
  const boundary: number[] = [];
  for (let i = 0; i < m; i++) boundary.push(...edgeIds(i, (i + 1) % m));
  return buildMesh(R, Float64Array.from(pos), tris, boundary, n, true);
}

/** Generic core: solve the Tutte-harmonic map of a triangle mesh with the given ccw boundary loop. */
function buildMesh(R: number, src: Float64Array, tris: number[][], boundary: number[], n: number, mvc = false): HarmonicDisk {
  const V = src.length / 2;
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

  // Boundary on the circle by cumulative source arc length (the boundary loop is closed).
  const cum = [0];
  for (let k = 0; k < boundary.length; k++) {
    const a = boundary[k], b = boundary[(k + 1) % boundary.length];
    cum.push(cum[k] + Math.hypot(src[2 * b] - src[2 * a], src[2 * b + 1] - src[2 * a + 1]));
  }
  const L = cum[boundary.length];
  const world = new Float64Array(2 * V);
  const isBoundary = new Uint8Array(V);
  for (let k = 0; k < boundary.length; k++) {
    const th = (2 * Math.PI * cum[k]) / L;
    world[2 * boundary[k]] = R * Math.cos(th);
    world[2 * boundary[k] + 1] = R * Math.sin(th);
    isBoundary[boundary[k]] = 1;
  }

  // Neighbours from triangle edges (uniform weights).
  const nbSet: Array<Set<number>> = Array.from({ length: V }, () => new Set<number>());
  for (const [a, b, c] of tris) {
    nbSet[a].add(b); nbSet[a].add(c);
    nbSet[b].add(a); nbSet[b].add(c);
    nbSet[c].add(a); nbSet[c].add(b);
  }
  const interior: number[] = [];
  for (let v = 0; v < V; v++) if (!isBoundary[v]) interior.push(v);
  const nbrs: number[][] = interior.map((k) => [...nbSet[k]]);

  // Neighbour weights. Uniform (Tutte) by default. With mvc, Floater's mean-value weights from the source triangulation:
  // w_ij = (sum over the two triangles on edge ij of tan(theta_i / 2)) / |s_j - s_i|, theta_i the angle at i in that
  // triangle. They are positive and reflect the source geometry, so irregular triangulations (ear clipping) distort less.
  const wts: number[][] = interior.map((_, q) => nbrs[q].map(() => 1));
  if (mvc) {
    const W: Array<Map<number, number>> = Array.from({ length: V }, () => new Map<number, number>());
    for (const [a, b, c] of tris)
      for (const [i, j, k] of [[a, b, c], [b, c, a], [c, a, b]]) {
        if (isBoundary[i]) continue;
        const ux = src[2 * j] - src[2 * i], uy = src[2 * j + 1] - src[2 * i + 1];
        const vx = src[2 * k] - src[2 * i], vy = src[2 * k + 1] - src[2 * i + 1];
        const t = Math.tan(Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) / 2);
        W[i].set(j, (W[i].get(j) ?? 0) + t);
        W[i].set(k, (W[i].get(k) ?? 0) + t);
      }
    for (let q = 0; q < interior.length; q++) {
      const i = interior[q];
      nbrs[q].forEach((j, s) => {
        const d = Math.hypot(src[2 * j] - src[2 * i], src[2 * j + 1] - src[2 * i + 1]);
        wts[q][s] = (W[i].get(j) ?? 0) / d;
      });
    }
  }

  // Gauss-Seidel on the weighted Laplacian (weights 1 give the uniform Laplacian).
  let change = Infinity, it = 0;
  for (; it < MAX_ITER && change > 1e-13 * R; it++) {
    change = 0;
    for (let q = 0; q < interior.length; q++) {
      const k = interior[q], nb = nbrs[q], w = wts[q];
      let sx = 0, sy = 0, sw = 0;
      for (let s = 0; s < nb.length; s++) {
        const u = nb[s];
        sx += w[s] * world[2 * u]; sy += w[s] * world[2 * u + 1]; sw += w[s];
      }
      const nx = sx / sw, ny = sy / sw;
      change = Math.max(change, Math.abs(nx - world[2 * k]), Math.abs(ny - world[2 * k + 1]));
      world[2 * k] = nx;
      world[2 * k + 1] = ny;
    }
  }
  if (change > 1e-9 * R) throw new Error(`harmonic_disk: solver did not converge (change ${change}, ${it} iterations)`);

  let harmonicResidual = 0;
  for (let q = 0; q < interior.length; q++) {
    const k = interior[q], nb = nbrs[q], w = wts[q];
    let sx = 0, sy = 0, sw = 0;
    for (let s = 0; s < nb.length; s++) {
      const u = nb[s];
      sx += w[s] * world[2 * u]; sy += w[s] * world[2 * u + 1]; sw += w[s];
    }
    harmonicResidual = Math.max(harmonicResidual, Math.abs(sx / sw - world[2 * k]), Math.abs(sy / sw - world[2 * k + 1]));
  }
  let boundaryError = 0;
  for (const k of boundary) boundaryError = Math.max(boundaryError, Math.abs(Math.hypot(world[2 * k], world[2 * k + 1]) - R));

  // Orientation of every world triangle (must be positive for an embedding).
  let minOrientation = Infinity;
  for (const [a, b, c] of tris) {
    const area = 0.5 * cross(world[2 * b] - world[2 * a], world[2 * b + 1] - world[2 * a + 1], world[2 * c] - world[2 * a], world[2 * c + 1] - world[2 * a + 1]);
    minOrientation = Math.min(minOrientation, area / (R * R));
  }
  if (!(minOrientation > 0)) throw new Error(`harmonic_disk: the map is not an embedding (min orientation ${minOrientation})`);

  // Lipschitz constant of the inverse: per triangle A = Ms * inv(Mw), columns are edge vectors.
  let sigmaMax = 0;
  for (const [a, b, c] of tris) {
    const e1s = [src[2 * b] - src[2 * a], src[2 * b + 1] - src[2 * a + 1]];
    const e2s = [src[2 * c] - src[2 * a], src[2 * c + 1] - src[2 * a + 1]];
    const e1w = [world[2 * b] - world[2 * a], world[2 * b + 1] - world[2 * a + 1]];
    const e2w = [world[2 * c] - world[2 * a], world[2 * c + 1] - world[2 * a + 1]];
    const dw = e1w[0] * e2w[1] - e2w[0] * e1w[1];
    const iw = [[e2w[1] / dw, -e2w[0] / dw], [-e1w[1] / dw, e1w[0] / dw]];
    const Ms = [[e1s[0], e2s[0]], [e1s[1], e2s[1]]];
    const A = [
      [Ms[0][0] * iw[0][0] + Ms[0][1] * iw[1][0], Ms[0][0] * iw[0][1] + Ms[0][1] * iw[1][1]],
      [Ms[1][0] * iw[0][0] + Ms[1][1] * iw[1][0], Ms[1][0] * iw[0][1] + Ms[1][1] * iw[1][1]],
    ];
    // Largest singular value^2 = largest eigenvalue of A^T A.
    const B00 = A[0][0] ** 2 + A[1][0] ** 2, B11 = A[0][1] ** 2 + A[1][1] ** 2, B01 = A[0][0] * A[0][1] + A[1][0] * A[1][1];
    const tr = B00 + B11, det = B00 * B11 - B01 * B01;
    const lam = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
    sigmaMax = Math.max(sigmaMax, Math.sqrt(lam));
  }
  const lambda = Math.max(1, sigmaMax);

  // Point location: bucket grids over the world disk and over the source bounding box.
  const K = Math.max(8, 2 * n);
  const grid = (lo: number[], hi: number[], coords: Float64Array) => {
    const bucket = (v: number, axis: number) => Math.min(K - 1, Math.max(0, Math.floor(((v - lo[axis]) / (hi[axis] - lo[axis])) * K)));
    const cells: number[][] = Array.from({ length: K * K }, () => []);
    tris.forEach((t, ti) => {
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const k of t) {
        mnx = Math.min(mnx, coords[2 * k]); mxx = Math.max(mxx, coords[2 * k]);
        mny = Math.min(mny, coords[2 * k + 1]); mxy = Math.max(mxy, coords[2 * k + 1]);
      }
      for (let bi = bucket(mnx, 0); bi <= bucket(mxx, 0); bi++)
        for (let bj = bucket(mny, 1); bj <= bucket(mxy, 1); bj++) cells[bi * K + bj].push(ti);
    });
    return { cells, bucket };
  };
  const wGrid = grid([-R, -R], [R, R], world);
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (let v = 0; v < V; v++) {
    sx0 = Math.min(sx0, src[2 * v]); sx1 = Math.max(sx1, src[2 * v]);
    sy0 = Math.min(sy0, src[2 * v + 1]); sy1 = Math.max(sy1, src[2 * v + 1]);
  }
  const sGrid = grid([sx0, sy0], [sx1, sy1], src);

  /** Barycentric coordinates of p in triangle t of the given coordinate array, with the minimum coordinate. */
  const bary = (coords: Float64Array, t: number[], px: number, py: number): [number, number, number, number] => {
    const [a, b, c] = t;
    const ax = coords[2 * a], ay = coords[2 * a + 1];
    const bx = coords[2 * b] - ax, by = coords[2 * b + 1] - ay;
    const cx = coords[2 * c] - ax, cy = coords[2 * c + 1] - ay;
    const dx = px - ax, dy = py - ay;
    const det = cross(bx, by, cx, cy);
    const l1 = cross(dx, dy, cx, cy) / det;
    const l2 = cross(bx, by, dx, dy) / det;
    const l0 = 1 - l1 - l2;
    return [l0, l1, l2, Math.min(l0, l1, l2)];
  };

  /** Locate p in the mesh (candidates from its bucket, then a full search). Returns triangle and barycentric weights. */
  const locate = (coords: Float64Array, g: { cells: number[][]; bucket: (v: number, axis: number) => number }, p: Pt2): { t: number[]; l: [number, number, number] } => {
    let best = -Infinity, bestT: number[] = tris[0], bestL: [number, number, number] = [1, 0, 0];
    const test = (ti: number) => {
      const t = tris[ti];
      const [l0, l1, l2, m] = bary(coords, t, p[0], p[1]);
      if (m > best) { best = m; bestT = t; bestL = [l0, l1, l2]; }
      return m >= -1e-12;
    };
    let found = false;
    for (const ti of g.cells[g.bucket(p[0], 0) * K + g.bucket(p[1], 1)]) if (test(ti)) { found = true; break; }
    if (!found) for (let ti = 0; ti < tris.length; ti++) if (test(ti)) break;
    return { t: bestT, l: bestL };
  };

  const inverse = (w: Pt2): Pt2 => {
    const { t, l } = locate(world, wGrid, w);
    const [a, b, c] = t;
    return [l[0] * src[2 * a] + l[1] * src[2 * b] + l[2] * src[2 * c], l[0] * src[2 * a + 1] + l[1] * src[2 * b + 1] + l[2] * src[2 * c + 1]];
  };
  const forward = (s: Pt2): Pt2 => {
    const { t, l } = locate(src, sGrid, s);
    const [a, b, c] = t;
    return [l[0] * world[2 * a] + l[1] * world[2 * b] + l[2] * world[2 * c], l[0] * world[2 * a + 1] + l[1] * world[2 * b + 1] + l[2] * world[2 * c + 1]];
  };

  return { n, radius: R, forward, inverse, lambda, boundaryError, harmonicResidual, minOrientation };
}
