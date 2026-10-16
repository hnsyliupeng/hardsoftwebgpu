# Narrow-band sparse sampling (task A1)

Implementation: `src/geometry/sparse.ts` (`sampleFieldNarrowBand`). Layout shared with the dense sampler via `gridLayout` in `src/geometry/grid.ts`.
Check: `scripts/sparse_check.ts` (writes JSON rows to stdout).

## Method
1. Coarse pass: evaluate the field at each block centre (block = 4 cells per side by default).
2. A block is active if |f(centre)| <= lipschitz * halfDiagonal + band.
3. Active blocks: evaluate every node (block-shared nodes once).
4. Inactive blocks: nodes take the sign of the centre value. Their magnitude is approximate.

## Results at 256 cells (20 mm envelope)

| Case | Lipschitz | Dense volume mm3 | Sparse volume mm3 | Triangles (equal) | Sampling dense ms | Sampling sparse ms | Evaluations / dense |
|---|---|---|---|---|---|---|---|
| SC lattice (exact distance) | 1 | 671.758 | 671.758 | 1,569,312 | 23,595 | 14,126 | 0.61 |
| Gyroid TPMS (approximate) | 2 (default) | 4190.356 | 4190.356 | 5,905,764 | 2,781 | 2,827 | 0.95 |

Other measurements:
- Gyroid at 128 with lipschitz 1.5 and block 8: 6588 sign errors. With block 4 and lipschitz 1.5: 0 errors. The approximate TPMS field needs the conservative default.
- Gyroid: the narrow band covers most of the box at this scale (the surface is dense), so sparse sampling gives almost no saving.

## Limitations (for later steps)
- The pipeline still uses the dense sampler. Sparse sampling is not wired into `buildGeometry` yet.
- Gaussian smoothing on a sparse grid needs `bandMm` >= 3 sigma, because inactive-node magnitudes are approximate.
- Sampling is not the bottleneck at 256 for TPMS: the mesh has 5.9 million triangles. Triangle count grows as resolution squared, so resolution above 256 needs a mesh budget (decimation or LOD). This is step A2.
