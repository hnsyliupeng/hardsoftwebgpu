# Non-manifold edges in surface-nets meshes

Measured with `scripts/nonmanifold_count.ts` on the surface-nets mesh of each design (CPU, no repair applied).
An edge shared by exactly 2 triangles is manifold; 1 is open; 3 or more is non-manifold.

| Design | Res | Triangles | Open edges | Manifold edges | Non-manifold edges | Max triangles per edge |
|---|---|---|---|---|---|---|
| `slice_reference/gyroid_only` (TPMS gyroid, cell 5, t 0.5) | 96 | 710,400 | 0 | 1,065,600 | 0 | 2 |
| `slice_reference/gyroid_only` | 128 | 1,278,144 | 0 | 1,917,216 | 0 | 2 |
| `structure_gallery_256/lattice_bcc` (BCC strut lattice) | 96 | 450,300 | 0 | 675,450 | 0 | 2 |
| `structure_gallery_256/lattice_bcc` | 128 | 807,972 | 0 | 1,211,958 | 0 | 2 |
| `structure_gallery_256/tpms_gyroid` (closed skin) | 96 | 710,400 | 0 | 1,065,600 | 0 | 2 |
| `structure_gallery_256_mixed_open/fusion_gyroid_plus_bcc` (union) | 96 | 880,260 | 0 | 1,312,596 | 3,897 | 4 |
| `structure_gallery_256_mixed_open/fusion_gyroid_plus_bcc` (union) | 128 | 1,586,712 | 0 | 2,371,692 | 4,188 | 4 |

## Reading

- Each part alone is manifold at these resolutions. The non-manifold edges appear only in the union.
- The union is the field `min(A, B)`. Where the two surfaces cross, the union has a crease. Surface nets places one
  vertex per grid cell, so along a crease some edges end up shared by four triangles.
- The count grows slightly with resolution (3,897 → 4,188). It does not go to zero, so it is not a grid-only artefact.
- Open edges are 0 everywhere, so the existing "watertight" check (0 open edges) does not see these edges. The
  check name overstates what it tests; it does not establish manifoldness.

## Not done

- The section benchmark (`docs/SECTIONS.md`, `eval/design_section_bench.csv`) reported 861–1,413 non-manifold edges for
  a clipped gyroid. That clipped geometry was not re-measured here, so those numbers are not checked by this script.
- No fix. Options (not chosen): dual contouring with a feature-preserving vertex placement, splitting non-manifold
  edges by vertex duplication (changes topology locally), or a smooth minimum for the union (changes the geometry).
  Each affects every fused design and would need the gallery re-run.
- STL and STEP outputs of fused designs may carry these edges; their consumers may reject them.
