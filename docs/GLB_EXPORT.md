# GLB export (task A3)

Module: `src/export/glb.ts` (`writeGlb`, `readGlb`). CLI: `scripts/export_glb.ts <family> <res> <out.glb> [budget]`.
Test: `tests/glb.test.ts` (round trip of positions, normals, indices and volume; corrupted header rejected).

## Format
- glTF 2.0 binary: 12-byte header, JSON chunk (space-padded), BIN chunk (zero-padded).
- One mesh, one primitive (mode 4, TRIANGLES). POSITION (VEC3 float, with min/max), NORMAL (VEC3 float), indices (UNSIGNED_INT).
- Normals are normalised on write. Zero-length normals (degenerate triangles, merged vertices) become +Z.

## Validation
Official validator `gltf-validator` (npm, 2.0.0-dev.3.10), run outside the repository; it is not a repo dependency.

| File | Triangles | Vertices | Errors | Warnings |
|---|---|---|---|---|
| Gyroid 192, display budget 1 M (`--budget 1000000`) | 992,928 | 479,187 | 0 | 0 |
| SC 192, full mesh | 888,048 | 443,376 | 0 | 0 |

Before the normal fix, the first file had 15 errors (`ACCESSOR_VECTOR3_NON_UNIT`); the fix removed them.
