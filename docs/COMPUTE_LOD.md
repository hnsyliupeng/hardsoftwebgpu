# WebGPU compute path, instancing and LOD (D2)

## Status
| Part | State | How it was checked |
|---|---|---|
| Instanced SC field (one unit cell, 3×3×3 neighbourhood) | done | `tests/instanced.test.ts` (5 tests): equals brute force over all cells where the nearest strut is within a − r, equals `strutLattice`, shader segment table matches the reference |
| WGSL compute kernel (`web/compute/sc_field_wgsl.ts`, generated) | written, parsed | `wgsl_reflect` 1.6.0 parses it (entry `main`, uniform members as expected). **Not run on a GPU** in this sandbox |
| GPU runner (`web/compute/scField.ts`) | written, CPU fallback tested | `cpuScGrid` (the same values the kernel writes) is tested; the GPU branch is not run here |
| LOD levels (vertex clustering to budgets) | done, measured | `scripts/lod_table.ts` → `eval/lod_table.csv` |
| Viewer uses the compute path | not wired | `web/viewer.ts` still renders meshes; the compute path is not called from the UI |

## Instancing
`src/topology/instanced.ts` evaluates the SC lattice as copies of one unit cell. The unit cell is the 12 cube edges from `latticePattern("sc")`, the same table `strutLattice` uses. A field point is checked against the instances in its 3×3×3 neighbourhood. This is the same set `strutLattice` uses, so the values agree (the test compares them to 1e-9). The table is shared with the WGSL source (`scShaderSource()`), so the kernel cannot drift from the reference.

Exactness: the neighbourhood gives the exact minimum whenever the nearest strut is closer than a − r. Beyond that, a cell two steps away could be nearer, so the value is only guaranteed to have the correct sign. The test checks this boundary.

## WGSL kernel
- One invocation per grid point, workgroup 4×4×4, output index `x + nx·(y + ny·z)`.
- Uniform block: origin, spacing, grid dimensions, cell size, lattice cell counts, radius (48 bytes).
- Regenerate after changing the reference: `node --experimental-strip-types scripts/gen_sc_shader.ts`. The test fails if the file is stale.

## Runner
`evalScGrid(grid)` tries `navigator.gpu` (adapter, device, compute pipeline, readback) and falls back to `cpuScGrid`. The result says which backend ran. The GPU path needs a browser test on a machine with WebGPU before it can be called verified.

## LOD (`eval/lod_table.csv`)
Icosphere, 1,310,720 triangles, R = 10 mm, `decimateToBudget` (vertex clustering):

| budget | triangles out | volume err | area err | time (ms) |
|---|---|---|---|---|
| none | 1,310,720 | 0 | −0.0005 % | 0 |
| 1,000,000 | 995,006 | −0.001 % | −0.000 % | 3,391 |
| 250,000 | 248,710 | −0.008 % | +0.015 % | 1,537 |
| 50,000 | 49,608 | −0.045 % | +0.143 % | 1,056 |

## Not done (D2 remainder)
- Running the WGSL kernel on a real GPU and comparing its output with `cpuScGrid` point by point.
- Instancing for the other lattice types (BCC, FCC, …) and for TPMS (periodic field, same idea).
- LOD selected by view distance in the viewer (only the global budget exists).
- Full WGSL validation (types, bindings) beyond parsing: needs `naga` or a browser.
