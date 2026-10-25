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
  if (spec.box && spec.ellipse) throw new Error("harmonic_disk: give either box or ellipse, not both");
  if (spec.ellipse) return buildEllipse(spec.radius, spec.ellipse.centre, spec.ellipse.semi, spec.n);
  if (!spec.box) throw new Error("harmonic_disk: no parameter domain (box or ellipse)");
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

/** Generic core: solve the Tutte-harmonic map of a triangle mesh with the given ccw boundary loop. */
function buildMesh(R: number, src: Float64Array, tris: number[][], boundary: number[], n: number): HarmonicDisk {
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

  // Gauss-Seidel on the uniform Laplacian.
  let change = Infinity, it = 0;
  for (; it < MAX_ITER && change > 1e-13 * R; it++) {
    change = 0;
    for (let q = 0; q < interior.length; q++) {
      const k = interior[q], nb = nbrs[q];
      let sx = 0, sy = 0;
      for (const u of nb) { sx += world[2 * u]; sy += world[2 * u + 1]; }
      const nx = sx / nb.length, ny = sy / nb.length;
      change = Math.max(change, Math.abs(nx - world[2 * k]), Math.abs(ny - world[2 * k + 1]));
      world[2 * k] = nx;
      world[2 * k + 1] = ny;
    }
  }
  if (change > 1e-9 * R) throw new Error(`harmonic_disk: solver did not converge (change ${change}, ${it} iterations)`);

  let harmonicResidual = 0;
  for (let q = 0; q < interior.length; q++) {
    const k = interior[q], nb = nbrs[q];
    let sx = 0, sy = 0;
    for (const u of nb) { sx += world[2 * u]; sy += world[2 * u + 1]; }
    harmonicResidual = Math.max(harmonicResidual, Math.abs(sx / nb.length - world[2 * k]), Math.abs(sy / nb.length - world[2 * k + 1]));
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
