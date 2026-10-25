// Discrete harmonic map of a rectangle onto a disk (C1, general parameter plane, piecewise linear).
//
// The rectangle (the source parameter plane) is split into a structured grid of 2 n^2 triangles. Boundary vertices are
// placed on the circle of radius R by perimeter arc length. Interior vertices satisfy the uniform (Tutte) harmonic
// condition: each equals the mean of its neighbours. With convex boundary and uniform weights this is an embedding
// (Tutte / Floater), which is checked by requiring positive area for every world triangle.
//
// The map is piecewise affine, so its Lipschitz constant is exact: the largest singular value of the inverse affine
// map over all triangles. The map is harmonic in the discrete sense, not conformal in general.

export type Pt2 = [number, number];
export type HarmonicDiskSpec = { radius: number; box: { min: Pt2; max: Pt2 }; n: number };

export interface HarmonicDisk {
  readonly n: number;
  readonly radius: number;
  /** Source (rectangle) point -> world (disk) point. */
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

/** Build the discrete harmonic map. Throws if the mesh is not an embedding. */
export function buildHarmonicDisk(spec: HarmonicDiskSpec): HarmonicDisk {
  const R = spec.radius, n = spec.n;
  const [x0, y0] = spec.box.min, [x1, y1] = spec.box.max;
  if (!(R > 0) || !(x1 > x0) || !(y1 > y0) || !Number.isInteger(n) || n < 3) throw new Error("harmonic_disk: bad spec");
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

  // Boundary vertices in counter-clockwise order, placed on the circle by source perimeter arc length.
  const bnd: number[] = [];
  for (let i = 0; i < n; i++) bnd.push(vid(i, 0));
  for (let j = 0; j < n; j++) bnd.push(vid(n, j));
  for (let i = n; i > 0; i--) bnd.push(vid(i, n));
  for (let j = n; j > 0; j--) bnd.push(vid(0, j));
  const cum = [0];
  for (let k = 0; k < bnd.length; k++) {
    const a = bnd[k], b = bnd[(k + 1) % bnd.length];
    cum.push(cum[k] + Math.hypot(src[2 * b] - src[2 * a], src[2 * b + 1] - src[2 * a + 1]));
  }
  const L = cum[bnd.length];
  const world = new Float64Array(2 * V);
  const isBoundary = new Uint8Array(V);
  for (let k = 0; k < bnd.length; k++) {
    const th = (2 * Math.PI * cum[k]) / L;
    world[2 * bnd[k]] = R * Math.cos(th);
    world[2 * bnd[k] + 1] = R * Math.sin(th);
    isBoundary[bnd[k]] = 1;
  }

  // Interior vertices and their neighbours (the diagonal of each cell is v(i,j)-v(i+1,j+1)).
  const offs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
  const interior: number[] = [];
  for (let j = 1; j < n; j++) for (let i = 1; i < n; i++) interior.push(vid(i, j));
  const nbrs: number[][] = interior.map((k) => {
    const i = k % N, j = Math.floor(k / N);
    return offs.map(([di, dj]) => vid(i + di, j + dj));
  });

  // Gauss-Seidel on the uniform Laplacian (weakly diagonally dominant; converges for this mesh).
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
  for (const k of bnd) boundaryError = Math.max(boundaryError, Math.abs(Math.hypot(world[2 * k], world[2 * k + 1]) - R));

  // Triangles (counter-clockwise in the source).
  const tris: number[][] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      tris.push([vid(i, j), vid(i + 1, j), vid(i + 1, j + 1)]);
      tris.push([vid(i, j), vid(i + 1, j + 1), vid(i, j + 1)]);
    }
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  let minOrientation = Infinity;
  for (const t of tris) {
    const [a, b, c] = t;
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
    // Mw = [e1w e2w] (columns), inverse of a 2x2 matrix.
    const dw = e1w[0] * e2w[1] - e2w[0] * e1w[1];
    const iw = [[e2w[1] / dw, -e2w[0] / dw], [-e1w[1] / dw, e1w[0] / dw]];
    // Ms = [e1s e2s] (columns).
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

  // Bucket grid over the disk for point location in the world.
  const K = Math.max(8, 2 * n);
  const bucket = (v: number) => Math.min(K - 1, Math.max(0, Math.floor(((v + R) / (2 * R)) * K)));
  const buckets: number[][] = Array.from({ length: K * K }, () => []);
  tris.forEach((t, ti) => {
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const k of t) {
      mnx = Math.min(mnx, world[2 * k]); mxx = Math.max(mxx, world[2 * k]);
      mny = Math.min(mny, world[2 * k + 1]); mxy = Math.max(mxy, world[2 * k + 1]);
    }
    for (let bi = bucket(mnx); bi <= bucket(mxx); bi++)
      for (let bj = bucket(mny); bj <= bucket(mxy); bj++) buckets[bi * K + bj].push(ti);
  });

  // Barycentric coordinates of p in world triangle t, returned with the minimum coordinate.
  const bary = (t: number[], px: number, py: number): [number, number, number, number] => {
    const [a, b, c] = t;
    const ax = world[2 * a], ay = world[2 * a + 1];
    const bx = world[2 * b] - ax, by = world[2 * b + 1] - ay;
    const cx = world[2 * c] - ax, cy = world[2 * c + 1] - ay;
    const dx = px - ax, dy = py - ay;
    const det = cross(bx, by, cx, cy);
    const l1 = cross(dx, dy, cx, cy) / det;
    const l2 = cross(bx, by, dx, dy) / det;
    const l0 = 1 - l1 - l2;
    return [l0, l1, l2, Math.min(l0, l1, l2)];
  };

  const inverse = (w: Pt2): Pt2 => {
    const cand = buckets[bucket(w[0]) * K + bucket(w[1])];
    let best = -Infinity, bestT: number[] | null = null, bestL: [number, number, number] = [0, 0, 0];
    const test = (ti: number) => {
      const t = tris[ti];
      const [l0, l1, l2, m] = bary(t, w[0], w[1]);
      if (m > best) { best = m; bestT = t; bestL = [l0, l1, l2]; }
      return m >= -1e-12;
    };
    let found = false;
    for (const ti of cand) if (test(ti)) { found = true; break; }
    if (!found) for (let ti = 0; ti < tris.length; ti++) if (test(ti)) break;
    const t = bestT as unknown as number[];
    const [a, b, c] = t;
    const [l0, l1, l2] = bestL;
    return [l0 * src[2 * a] + l1 * src[2 * b] + l2 * src[2 * c], l0 * src[2 * a + 1] + l1 * src[2 * b + 1] + l2 * src[2 * c + 1]];
  };

  const forward = (s: Pt2): Pt2 => {
    const fi = Math.min(n - 1, Math.max(0, Math.floor(((s[0] - x0) / (x1 - x0)) * n)));
    const fj = Math.min(n - 1, Math.max(0, Math.floor(((s[1] - y0) / (y1 - y0)) * n)));
    let best = -Infinity, bestT = tris[0], bestL: [number, number, number] = [1, 0, 0];
    for (const t of [tris[2 * (fj * n + fi)], tris[2 * (fj * n + fi) + 1]]) {
      const [a, b, c] = t;
      const ax = src[2 * a], ay = src[2 * a + 1];
      const bx = src[2 * b] - ax, by = src[2 * b + 1] - ay;
      const cx = src[2 * c] - ax, cy = src[2 * c + 1] - ay;
      const dx = s[0] - ax, dy = s[1] - ay;
      const det = cross(bx, by, cx, cy);
      const l1 = cross(dx, dy, cx, cy) / det, l2 = cross(bx, by, dx, dy) / det;
      const l0 = 1 - l1 - l2;
      const m = Math.min(l0, l1, l2);
      if (m > best) { best = m; bestT = t; bestL = [l0, l1, l2]; }
    }
    const [a, b, c] = bestT;
    const [l0, l1, l2] = bestL;
    return [l0 * world[2 * a] + l1 * world[2 * b] + l2 * world[2 * c], l0 * world[2 * a + 1] + l1 * world[2 * b + 1] + l2 * world[2 * c + 1]];
  };

  return { n, radius: R, forward, inverse, lambda, boundaryError, harmonicResidual, minOrientation };
}
