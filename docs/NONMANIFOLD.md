# Non-manifold edges in fused meshes

Measured with `scripts/nonmanifold_count.ts` (surface-nets baseline) and `scripts/compare_extractors.ts` (surface nets vs
dual contouring), CPU, no repair applied. An edge shared by exactly 2 triangles is manifold; 1 is open; 3 or more is
non-manifold.

## Baseline (surface nets, before the change)

| Design | Res | Triangles | Open edges | Manifold edges | Non-manifold edges | Max triangles per edge |
|---|---|---|---|---|---|---|
| `slice_reference/gyroid_only` (TPMS gyroid, cell 5, t 0.5) | 96 | 710,400 | 0 | 1,065,600 | 0 | 2 |
| `slice_reference/gyroid_only` | 128 | 1,278,144 | 0 | 1,917,216 | 0 | 2 |
| `structure_gallery_256/lattice_bcc` (BCC strut lattice) | 96 | 450,300 | 0 | 675,450 | 0 | 2 |
| `structure_gallery_256/lattice_bcc` | 128 | 807,972 | 0 | 1,211,958 | 0 | 2 |
| `structure_gallery_256/tpms_gyroid` (closed skin) | 96 | 710,400 | 0 | 1,065,600 | 0 | 2 |
| `structure_gallery_256_mixed_open/fusion_gyroid_plus_bcc` (union) | 96 | 880,260 | 0 | 1,312,596 | 3,897 | 4 |
| `structure_gallery_256_mixed_open/fusion_gyroid_plus_bcc` (union) | 128 | 1,586,712 | 0 | 2,371,692 | 4,188 | 4 |

## Dual contouring for fused designs (current)

`src/geometry/index.ts` now meshes `topology: "fusion"` designs with manifold dual contouring
(`src/geometry/dualcontour.ts`, one vertex per cell, one quad per sign-changing edge). Other designs keep surface nets.
Triangle counts are the same for both extractors at a given resolution; only the vertex placement differs.

| Design | Res | Non-manifold edges, surface nets | Non-manifold edges, dual contouring | Open edges (both) |
|---|---|---|---|---|
| `fusion_gyroid_plus_bcc` | 96 | 3,897 | 135 | 0 |
| `fusion_gyroid_plus_bcc` | 128 | 4,188 | 141 | 0 |
| `fusion_schwarzp_to_gyroid` | 96 | 64 | 0 | 0 |
| `fusion_kelvin_to_iwp` | 96 | 488 | 14 | 0 |
| `fusion_bcc_plus_voronoi` | 96 | 1,019 | 53 | 0 |
| `fusion_helical_cap_iwp` | 96 | 113 | 6 | 0 |
| `fusion_diamond_plus_lidinoid` | 96 | 7,092 | 483 | 0 |
| `fusion_diamond_plus_lidinoid` | 160 | 9,918 | 384 | 0 |
| `fusion_diamond_plus_lidinoid` | 256 | 14,535 | 588 | 0 |

Volume effect (mm³): gyroid+BCC 96: SN 3375.951 / DC 3379.773. Diamond+Lidinoid 256: SN 5138.370 / DC 5108.217 /
Monte Carlo 5094.44. DC volume is nearly constant in resolution (5109–5112), while SN converges slowly from above
(5317 at 96, 5185 at 160, 5138 at 256). Dual-contouring time: about 1–2.5 s at 96 cells, about 15 s at 256 cells
(diamond). The gallery values regenerated with DC are in `examples/structure_gallery_256_mixed_open/` (six fused
designs) and `examples/structure_gallery_256/` (five fused designs).

## Reading

- Each part alone is manifold at these resolutions. The non-manifold edges appear only where the parts meet.
- The union is the field `min(A, B)`. Surface nets puts one vertex per grid cell, so along a crease some edges are shared
  by four triangles. Dual contouring removes most of these, because it places a vertex per cell and does not pinch
  across a crease.
- The residual edges (for example 483 / 384 / 588 for diamond+Lidinoid) are sub-voxel pinches: two adjacent cells share
  two sign-change crossings on one face, which gives a double dual edge (four triangles on one edge). They are narrower
  than one voxel, and their count does not fall with resolution (483 → 384 → 588 over 96 → 160 → 256). They are not
  resolved. The known fix is to split the vertex of such cells (vertex duplication), which changes topology locally.
- Open edges are 0 everywhere, so the existing "watertight" check (0 open edges) does not see these edges. The check
  name overstates what it tests; it does not establish manifoldness.

## Not done

- The residual pinches above (about 135–588 edges per fused mesh at 96–256 cells) are not removed.
- Non-manifold edges in non-fused designs are not measured in this document (surface nets there, 0 in the cases above).
- The closed-skin records in the 96 and 192 sets (17 entries each, with a 1 mm skin) were re-meshed with dual contouring on 2026-10-19;
  geometry unchanged (Monte Carlo identical). The 19 remaining entries in those sets are non-skin or stale records and keep their earlier meshes.
- The section benchmark (`docs/SECTIONS.md`, `eval/design_section_bench.csv`) reported 861–1,413 non-manifold edges for
  a clipped gyroid. That clipped geometry was measured with surface nets and was not re-measured here.
- STL and STEP outputs of fused designs may still carry the residual pinches; their consumers may reject them.
