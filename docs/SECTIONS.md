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


## Design meshes (benchmark, `scripts/design_section_bench.ts` → `eval/design_section_bench.csv`)
Three closed designs, each clipped by a sphere of radius 10 mm (centre 12, 12, 12) inside a 24 mm box:
SC strut lattice (cell 4 mm, r 0.4), gyroid sheet (cell 4 mm, t 0.5), and `presets/graded_infill_sphere.json`.
Meshes come from `sampleField` → `removeFloatingComponents` → `surfaceNets`, as in `render_graph.ts`.

The reference section area is the area of {field < 0} on the same plane, counted on a 0.05 mm grid of the field (not of the mesh). The z plane is shown; The x plane gives the same numbers in every row. That is expected: the sphere and all three structures are cubically symmetric about the box centre, so the x and z central planes are equivalent. The table therefore shows only z.

| design | res | triangles | open edges | non-manifold edges | volume (mm³) | section z, mesh / field (mm²) | error z | measure (ms) | section (ms) |
|---|---|---|---|---|---|---|---|---|---|
| sc_sphere | 96 | 105,384 | 0 | 51 | 337.1 | 111.24 / 115.52 | -3.70 % | 35 | 15.1 |
| sc_sphere | 128 | 180,852 | 0 | 30 | 347.2 | 112.95 / 115.52 | -2.23 % | 53 | 14.3 |
| sc_sphere | 160 | 272,976 | 0 | 45 | 352.5 | 113.64 / 115.52 | -1.63 % | 65 | 13.3 |
| sc_sphere | 192 | 419,220 | 0 | 99 | 356.7 | 114.43 / 115.52 | -0.94 % | 42 | 14.7 |
| gyroid_sphere | 96 | 464,472 | 0 | 861 | 1487.9 | 96.18 / 98.32 | -2.18 % | 48 | 16.1 |
| gyroid_sphere | 128 | 829,740 | 0 | 951 | 1493.3 | 96.56 / 98.32 | -1.79 % | 73 | 25.9 |
| gyroid_sphere | 160 | 1,293,804 | 0 | 1314 | 1495.6 | 96.56 / 98.32 | -1.79 % | 121 | 44.8 |
| gyroid_sphere | 192 | 1,874,292 | 0 | 1413 | 1496.9 | 96.72 / 98.32 | -1.63 % | 178 | 59.3 |
| graded_infill_sphere | 96 | 76,356 | 0 | 27 | 188.2 | 56.34 / 67.62 | -16.67 % | 12 | 6.0 |
| graded_infill_sphere | 128 | 134,532 | 0 | 33 | 199.7 | 60.67 / 67.62 | -10.27 % | 14 | 5.1 |
| graded_infill_sphere | 160 | 222,840 | 0 | 30 | 207.7 | 63.00 / 67.62 | -6.83 % | 20 | 7.4 |
| graded_infill_sphere | 192 | 306,180 | 0 | 57 | 210.1 | 63.97 / 67.62 | -5.39 % | 40 | 12.7 |

- Open edges are zero everywhere, so the meshes are closed. Non-manifold edges (shared by four or more triangles) remain at the surface-nets ambiguities. The segment area is additive, so the area is unaffected, but the loops are not guaranteed to be simple.
- SC sphere: error falls from −3.7 % to −0.9 % as the resolution rises. Gyroid: about −1.6 % at 192 (plateau near −1.6 %, not yet explained). Graded infill: −16.7 % at 96, −5.4 % at 192. Its thin hierarchical struts are under-resolved and it converges slowly. Treat the graded numbers as resolution-limited, not validated.
- Triangle counts run from 76 k to 1.9 M, covering the 1e5–1e6 range in the design domain.
