# Sections and measurement (D3)

## What is implemented (CPU library)
- `src/geometry/section.ts`: `sectionSegments(mesh, axis, offset)` returns the segments where an axis-aligned plane cuts a triangle mesh. `sectionArea` gives the enclosed area as a shoelace sum over the segments.
  - Half-open crossing rule: a vertex counts as "above" if its coordinate is ≥ offset. Adjacent triangles then share the same crossing point, so the segments close into loops without gaps.
  - Each segment is oriented from the triangle normal, so outer boundaries add area and cavities subtract it. No chaining is needed for the area.
- `src/geometry/measure.ts`: `surfaceArea`, `boundingBox`, `distance`, `crossSectionArea`, and `measure` (area, volume, bbox, triangle count). Volume uses `signedVolume` (divergence theorem), valid for closed outward meshes.
- `src/geometry/primitives.ts`: `boxMesh` (optionally a cavity) and `icosphereMesh(subdiv, R)` with 20·4^subdiv outward triangles. Used for tests and the benchmark.

## Tests
`tests/section.test.ts` (5 tests): box sections (10×10 at any interior plane, 0 outside), cavity subtraction (10×10 minus 2×2), icosphere area, volume, equator and off-centre section within 0.5–1 %, closed-loop check (each loop vertex shared by two segments), and bbox and distance.

## Benchmark (`scripts/section_bench.ts` → `eval/section_bench.csv`)
Icosphere, R = 10 mm. Section time is the mean over three planes. Errors are against the analytic sphere values.

| subdiv | triangles | build (ms) | measure (ms) | section (ms) | area err | volume err | equator err | off-centre err |
|---|---|---|---|---|---|---|---|---|
| 6 | 81,920 | 105 | 17 | 11 | 0.0075 % | 0.0135 % | 0.0080 % | 0.0158 % |
| 7 | 327,680 | 241 | 31 | 14 | 0.0019 % | 0.0034 % | 0.0020 % | 0.0038 % |
| 8 | 1,310,720 | 1,124 | 132 | 45 | 0.0005 % | 0.0008 % | 0.0005 % | 0.0010 % |

Errors fall about 4× per subdivision, which is the expected convergence of an inscribed icosphere. Timings were measured in this sandbox (single thread, Node).

## Not done (D3 remainder)
- Viewer panel (`web/section.ts`, "Section and measurement" in `web/index.html`): plane normal x/y/z, offset slider, outline drawn on a canvas, area, surface area, volume, bounding box and triangle count. It is fed by `showViewer` in `web/main.ts`. Pure parts are tested (`tests/section_view.test.ts`); the build compiles. The panel has not been viewed in a browser in this sandbox.
- Benchmarks on design meshes (lattice, TPMS, fusion). The benchmark uses spheres only, so it gives geometric accuracy and speed, not design-specific behaviour.
- Section images of designs (the segments are available, but no renderer draws them yet).
