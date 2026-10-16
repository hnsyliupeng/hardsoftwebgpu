# Mesh budget and resolution benchmark (task A2)

Scripts: `scripts/benchmark_res.ts` (benchmark), `scripts/decimate_check.ts` (budget check).
Module: `src/geometry/decimate.ts` (`decimateToBudget`, vertex clustering with bisection on cell size).
Test: `tests/decimate.test.ts`. Raw benchmark rows: `docs/benchmark_a2_raw.jsonl`.
Environment: 2 vCPU, 3 GB RAM sandbox. Dense sampling, surface nets, 5 x 5 x 5 cells on a 20 mm envelope.

## Resolution benchmark (dense path)

| Family | Res | Nodes | Triangles | Volume mm3 | Sample ms | Surface ms | RSS MB |
|---|---|---|---|---|---|---|---|
| SC | 128 | 2.9 M | 0.39 M | 643.331 | 3,336 | 766 | 157 |
| SC | 192 | 9.7 M | 0.89 M | 665.948 | 9,995 | 1,787 | 262 |
| SC | 256 | 22.7 M | 1.57 M | 671.758 | 22,940 | 3,629 | 423 |
| Gyroid | 128 | 2.9 M | 1.47 M | 4196.754 | 558 | 1,042 | 224 |
| Gyroid | 192 | 9.7 M | 3.32 M | 4193.775 | 1,167 | 2,830 | 364 |
| Gyroid | 256 | 22.7 M | 5.91 M | 4190.356 | 2,877 | 5,068 | 575 |
| Schwarz P | 128 | 2.9 M | 1.15 M | 3495.470 | 499 | 967 | 204 |
| Schwarz P | 192 | 9.7 M | 2.58 M | 3493.219 | 1,369 | 2,194 | 381 |
| Schwarz P | 256 | 22.7 M | 4.60 M | 3490.899 | 2,975 | 4,733 | 528 |

Findings:
- Triangles grow as resolution squared (Gyroid 128 to 256: x4.0).
- Volume converges with resolution (Gyroid: -0.2 % from 128 to 256).
- Memory: 512 is projected at about 2.5 GB RSS and 23 M triangles. That is at the sandbox limit, so 512 is not a practical display or export target here.

## Decision

- Export keeps the full mesh at 256 (up to about 6 M triangles).
- Display uses a triangle budget of 1,000,000 by vertex clustering.

## Budget check (vertex clustering)

| Case | Input triangles | Output triangles | Cell mm | Volume error | Time ms |
|---|---|---|---|---|---|
| Gyroid 192 -> 1 M | 3.32 M | 0.99 M | 0.173 | +0.28 % | 4,403 |
| Gyroid 192 -> 300 k | 3.32 M | 0.29 M | 0.335 | +0.59 % | 1,144 |
| SC 256 -> 1 M | 1.57 M | 1.00 M | 0.090 | -0.73 % | 3,135 |
| Gyroid 256 -> 1 M | 5.91 M | 0.99 M | 0.180 | +0.32 % | 7,110 |

Vertex clustering biases the volume by up to about 0.7 %. This is acceptable for display only. Reported numbers always come from the full mesh.

## Limitations
- Vertex clustering can create non-manifold edges. It is for display only; STL/GLB exports use the full mesh.
- The volume bias is not corrected.
- Benchmark is the dense path. The sparse sampler (A1) is not used in these runs.
