// Narrow-band sparse sampling of an implicit field (step A1 of docs/TASK_PLAN.md).
//
// The dense sampler evaluates the field at every node: cost ~ resolution^3. A surface occupies
// ~ resolution^2 nodes, so most evaluations are wasted far from the surface. This sampler:
//   1. splits the node grid into blocks of B x B x B cells;
//   2. evaluates the field once at each block centre;
//   3. a block can contain a surface only if |f(centre)| <= lipschitz * halfDiagonal (+ band).
//      Blocks that fail the test are skipped: all their nodes take the sign of the centre value;
//   4. evaluates every node of the remaining (active) blocks, including shared block faces.
// The output is a dense Grid, so surfaceNets() and the existing validators run unchanged.
//
// Correctness condition: the field must be Lipschitz with constant <= `lipschitz` (exact SDFs have
// 1; the TPMS and sheet fields are approximate and are checked with the dense sampler in
// scripts/sparse_check.ts). Nodes of skipped blocks carry an approximate value; their sign is
// correct, but their magnitude is not, so a Gaussian blur on the output needs `bandMm` at least
// 3 sigma.

import type { Field } from "../topology/fields.ts";
import { gridLayout, type Grid } from "./grid.ts";

export interface SparseOptions {
  /** Border nodes beyond the bounds (see gridLayout). Default 2. */
  pad?: number;
  /** Block side in cells. Default 4 (8 skips too little on lattices; see docs/SPARSE_SAMPLING.md). */
  block?: number;
  /** Assumed Lipschitz constant of the field. Default 2 (conservative for approximate fields). */
  lipschitz?: number;
  /** Extra band width in mm added to the activity test. Default 0.5. */
  bandMm?: number;
}

export interface SparseStats {
  resolution: number;
  block: number;
  blocks: number;
  activeBlocks: number;
  /** Field evaluations performed (centres + active nodes). */
  evaluations: number;
  /** Dense evaluations the full grid would need. */
  denseEvaluations: number;
  timeMs: number;
}

export function sampleFieldNarrowBand(field: Field, resolution: number, opts: SparseOptions = {}): { grid: Grid; stats: SparseStats } {
  const t0 = Date.now();
  const pad = opts.pad ?? 2;
  const B = opts.block ?? 4;
  const lip = opts.lipschitz ?? 2;
  const band = opts.bandMm ?? 0.5;
  const { nx, ny, nz, origin, h } = gridLayout(field, resolution, pad);
  const bx = Math.ceil((nx - 1) / B);
  const by = Math.ceil((ny - 1) / B);
  const bz = Math.ceil((nz - 1) / B);
  const halfDiag = (Math.sqrt(3) * B * h) / 2;
  const threshold = lip * halfDiag + band;

  const values = new Float32Array(nx * ny * nz);
  const evaluated = new Uint8Array(nx * ny * nz);
  const active = new Uint8Array(bx * by * bz);
  const centreValue = new Float32Array(bx * by * bz);
  let evaluations = 0;
  let activeBlocks = 0;

  const blockRange = (b: number, n: number): [number, number] => [b * B, Math.min(b * B + B, n - 1)];
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);

  // Pass 1: block centres.
  for (let bk = 0; bk < bz; bk++)
    for (let bj = 0; bj < by; bj++)
      for (let bi = 0; bi < bx; bi++) {
        const [i0, i1] = blockRange(bi, nx);
        const [j0, j1] = blockRange(bj, ny);
        const [k0, k1] = blockRange(bk, nz);
        const cx = origin[0] + ((i0 + i1) / 2) * h;
        const cy = origin[1] + ((j0 + j1) / 2) * h;
        const cz = origin[2] + ((k0 + k1) / 2) * h;
        const f = field.eval(cx, cy, cz);
        evaluations++;
        const bidx = bi + bx * (bj + by * bk);
        centreValue[bidx] = f;
        if (Math.abs(f) <= threshold) {
          active[bidx] = 1;
          activeBlocks++;
        }
      }

  // Pass 2: every node of an active block (block faces shared by two blocks are evaluated once).
  for (let bk = 0; bk < bz; bk++)
    for (let bj = 0; bj < by; bj++)
      for (let bi = 0; bi < bx; bi++) {
        if (!active[bi + bx * (bj + by * bk)]) continue;
        const [i0, i1] = blockRange(bi, nx);
        const [j0, j1] = blockRange(bj, ny);
        const [k0, k1] = blockRange(bk, nz);
        for (let k = k0; k <= k1; k++)
          for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
              const n = idx(i, j, k);
              if (evaluated[n]) continue;
              evaluated[n] = 1;
              values[n] = field.eval(origin[0] + i * h, origin[1] + j * h, origin[2] + k * h);
              evaluations++;
            }
      }

  // Pass 3: nodes of inactive blocks that were not evaluated take the sign of their block centre.
  for (let bk = 0; bk < bz; bk++)
    for (let bj = 0; bj < by; bj++)
      for (let bi = 0; bi < bx; bi++) {
        const bidx = bi + bx * (bj + by * bk);
        if (active[bidx]) continue;
        const [i0, i1] = blockRange(bi, nx);
        const [j0, j1] = blockRange(bj, ny);
        const [k0, k1] = blockRange(bk, nz);
        const fill = centreValue[bidx] < 0 ? -1 : 1;
        // Magnitude: the centre value is a lower bound on the distance to the surface (Lipschitz).
        const mag = Math.max(Math.abs(centreValue[bidx]), threshold);
        for (let k = k0; k <= k1; k++)
          for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
              const n = idx(i, j, k);
              if (!evaluated[n]) values[n] = fill * mag;
            }
      }

  const denseEvaluations = nx * ny * nz;
  return {
    grid: { nx, ny, nz, origin, h, values },
    stats: {
      resolution,
      block: B,
      blocks: bx * by * bz,
      activeBlocks,
      evaluations,
      denseEvaluations,
      timeMs: Date.now() - t0,
    },
  };
}
