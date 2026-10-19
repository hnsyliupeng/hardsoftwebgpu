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

## Deep coupled fields (topology `coupled` and `deep`), 96 cells

Measured with `scripts/compare_extractors.ts` (CPU, 2026-10-19). Dual contouring is now used for these topologies too (`src/geometry/index.ts`).

| Design | Non-manifold, surface nets | Non-manifold, dual contouring | Volume SN → DC (mm³) |
|---|---|---|---|
| `deep_R1_thickness` (coupled) | 39 | 0 | 4023.9 → 4001.1 |
| `deep_R2_nested` (coupled) | 3,444 | 928 | 5684.0 → 5635.7 |
| `deep_R3_twist` (coupled) | 940 | 0 | 1329.4 → 1441.3 |
| `deep_R4_blend` (coupled) | 566 | 9 | 3496.7 → 3483.0 |
| `deep_R5_hierarchy` (coupled) | 1,369 | 63 | 6590.2 → 6554.4 |
| `fieldfuse_r1_channel_lattice` (deep) | 704 | 0 | 6909.7 → 6950.2 |
| `fieldfuse_r2_ply_tpms` (deep) | 1,186 | 34 | 4870.4 → 4834.0 |
| `fieldfuse_r3_graded_tpms` (deep) | 273 | 0 | 3119.7 → 3111.3 |
| `fieldfuse_r4_foam_lattice` (deep) | 501 | 38 | 3074.0 → 3212.4 |
| `fieldfuse_r5_ply_graded_tpms` (deep) | 1,144 | 33 | 5050.6 → 5009.9 |

At 96 cells, surface nets underestimates `deep_R3_twist` by 7.8 % (1329.4 against Monte Carlo 1442); dual contouring gives 1441.3. At 256 cells the final records differ from their earlier values by at most 1.24 % (R3). Every deep record was regenerated with dual contouring (256 open sets, the 192 closed-skin set, and `examples/deep_fusion_256/`), and each run passes.

## Vertex splitting at pinches (current, 2026-10-19)

`src/geometry/pinch.ts` (`splitPinchVertices`) runs after dual contouring for fused, coupled and deep designs
(`src/geometry/index.ts`). Each vertex's triangles are grouped into fans, connected only through manifold edges; every
fan after the first gets its own copy of the vertex at the same position. Positions, triangle count and enclosed volume
do not change; only the topology is cut at the pinch. Repeated until no non-manifold edge remains (at most 8 passes).
Unit tests: `tests/pinch.test.ts` (two closed tetrahedra sharing an edge; a manifold mesh is returned unchanged).

Measured with `scripts/compare_extractors.ts` (third row per design: `manifold_dc_split`), CPU, 2026-10-19. Each design is
measured at one resolution: 96 for the `structure_gallery/` (192-set) and `structure_gallery_96/` rows, 256 for the others.
The gallery records have **not** been regenerated with the split; their geometry and volumes are identical (the volume
column matches to the printed precision), only the non-manifold count differs.

| Design (folder) | Res | Triangles | Non-manifold, surface nets | Non-manifold, DC | Non-manifold, DC + split | Open, DC + split | Volume DC → split (mm³) |
|---|---|---|---|---|---|---|---|
| deep_fusion_256/fieldfuse_r1_channel_lattice | 256 | 2,251,440 | 1,728 | 56 | 0 | 0 | 6818.270 → 6818.270 |
| deep_fusion_256/fieldfuse_r2_ply_tpms | 256 | 5,104,552 | 2,036 | 28 | 0 | 0 | 4837.278 → 4837.278 |
| deep_fusion_256/fieldfuse_r3_graded_tpms | 256 | 4,989,832 | 13 | 0 | 0 | 0 | 3127.009 → 3127.009 |
| deep_fusion_256/fieldfuse_r4_foam_lattice | 256 | 5,066,632 | 1,432 | 50 | 0 | 0 | 3195.419 → 3195.419 |
| deep_fusion_256/fieldfuse_r5_ply_graded_tpms | 256 | 5,024,828 | 1,863 | 53 | 0 | 0 | 5009.343 → 5009.343 |
| structure_gallery/deep_R1_thickness | 96 | 604,704 | 37 | 0 | 0 | 0 | 5178.237 → 5178.237 |
| structure_gallery/deep_R2_nested | 96 | 623,136 | 2,200 | 624 | 0 | 0 | 6028.059 → 6028.059 |
| structure_gallery/deep_R3_twist | 96 | 508,476 | 684 | 3 | 0 | 0 | 3254.237 → 3254.237 |
| structure_gallery/deep_R4_blend | 96 | 609,664 | 515 | 10 | 0 | 0 | 4825.197 → 4825.197 |
| structure_gallery/deep_R5_hierarchy | 96 | 347,928 | 1,082 | 57 | 0 | 0 | 7144.409 → 7144.409 |
| structure_gallery/fusion_bcc_plus_voronoi | 96 | 323,056 | 779 | 50 | 0 | 0 | 6935.821 → 6935.821 |
| structure_gallery/fusion_diamond_plus_lidinoid | 96 | 904,980 | 4,989 | 372 | 0 | 0 | 5893.782 → 5893.782 |
| structure_gallery/fusion_gyroid_plus_helical | 96 | 183,212 | 158 | 2 | 0 | 0 | 7414.077 → 7414.077 |
| structure_gallery/fusion_helical_cap_iwp | 96 | 668,616 | 113 | 6 | 0 | 0 | 2326.129 → 2326.129 |
| structure_gallery/fusion_kelvin_to_iwp | 96 | 611,072 | 412 | 12 | 0 | 0 | 3775.643 → 3775.643 |
| structure_gallery/fusion_schwarzp_to_gyroid | 96 | 623,256 | 52 | 0 | 0 | 0 | 3777.734 → 3777.734 |
| structure_gallery_256/deep_R1_thickness | 256 | 4,742,948 | 20 | 0 | 0 | 0 | 4029.029 → 4029.029 |
| structure_gallery_256/deep_R2_nested | 256 | 5,531,712 | 14,328 | 0 | 0 | 0 | 5595.032 → 5595.032 |
| structure_gallery_256/deep_R3_twist | 256 | 3,438,612 | 1,492 | 0 | 0 | 0 | 1437.257 → 1437.257 |
| structure_gallery_256/deep_R4_blend | 256 | 4,712,740 | 423 | 3 | 0 | 0 | 3507.880 → 3507.880 |
| structure_gallery_256/deep_R5_hierarchy | 256 | 3,023,120 | 3,777 | 104 | 0 | 0 | 6563.388 → 6563.388 |
| structure_gallery_256/fusion_bcc_plus_voronoi | 256 | 2,494,916 | 2,742 | 77 | 0 | 0 | 6175.190 → 6175.190 |
| structure_gallery_256/fusion_diamond_plus_lidinoid | 256 | 8,518,836 | 14,535 | 588 | 0 | 0 | 5108.217 → 5108.217 |
| structure_gallery_256/fusion_gyroid_plus_helical | 256 | 1,319,408 | 331 | 2 | 0 | 0 | 7419.620 → 7419.620 |
| structure_gallery_256/fusion_helical_cap_iwp | 256 | 4,819,608 | 218 | 4 | 0 | 0 | 2380.508 → 2380.508 |
| structure_gallery_256/fusion_kelvin_to_iwp | 256 | 4,582,008 | 300 | 8 | 0 | 0 | 2214.100 → 2214.100 |
| structure_gallery_256/fusion_schwarzp_to_gyroid | 256 | 4,685,392 | 176 | 0 | 0 | 0 | 2180.747 → 2180.747 |
| structure_gallery_256_mixed_open/deep_R1_thickness | 256 | 4,742,948 | 20 | 0 | 0 | 0 | 4029.029 → 4029.029 |
| structure_gallery_256_mixed_open/deep_R2_nested | 256 | 5,531,712 | 14,328 | 0 | 0 | 0 | 5595.032 → 5595.032 |
| structure_gallery_256_mixed_open/deep_R3_twist | 256 | 3,438,612 | 1,492 | 0 | 0 | 0 | 1437.257 → 1437.257 |
| structure_gallery_256_mixed_open/deep_R4_blend | 256 | 4,712,740 | 423 | 3 | 0 | 0 | 3507.880 → 3507.880 |
| structure_gallery_256_mixed_open/deep_R5_hierarchy | 256 | 3,023,120 | 3,777 | 104 | 0 | 0 | 6563.388 → 6563.388 |
| structure_gallery_256_mixed_open/fusion_bcc_plus_voronoi | 256 | 2,494,916 | 2,742 | 77 | 0 | 0 | 6175.190 → 6175.190 |
| structure_gallery_256_mixed_open/fusion_diamond_plus_lidinoid | 256 | 8,518,836 | 14,535 | 588 | 0 | 0 | 5108.217 → 5108.217 |
| structure_gallery_256_mixed_open/fusion_gyroid_plus_bcc | 256 | 6,437,688 | 9,474 | 258 | 0 | 0 | 3376.501 → 3376.501 |
| structure_gallery_256_mixed_open/fusion_helical_cap_iwp | 256 | 4,819,608 | 218 | 4 | 0 | 0 | 2380.508 → 2380.508 |
| structure_gallery_256_mixed_open/fusion_kelvin_to_iwp | 256 | 4,582,008 | 300 | 8 | 0 | 0 | 2214.100 → 2214.100 |
| structure_gallery_256_mixed_open/fusion_schwarzp_to_gyroid | 256 | 4,685,392 | 176 | 0 | 0 | 0 | 2180.747 → 2180.747 |
| structure_gallery_96/fusion_bcc_plus_voronoi | 96 | 323,056 | 779 | 50 | 0 | 0 | 6935.821 → 6935.821 |
| structure_gallery_96/fusion_diamond_plus_lidinoid | 96 | 904,980 | 4,989 | 372 | 0 | 0 | 5893.782 → 5893.782 |
| structure_gallery_96/fusion_gyroid_plus_helical | 96 | 183,212 | 158 | 2 | 0 | 0 | 7414.077 → 7414.077 |
| structure_gallery_96/fusion_helical_cap_iwp | 96 | 668,616 | 113 | 6 | 0 | 0 | 2326.129 → 2326.129 |
| structure_gallery_96/fusion_kelvin_to_iwp | 96 | 611,072 | 412 | 12 | 0 | 0 | 3775.643 → 3775.643 |
| structure_gallery_96/fusion_schwarzp_to_gyroid | 96 | 623,256 | 52 | 0 | 0 | 0 | 3777.734 → 3777.734 |

Result: all 44 designs (28 unique design/resolution pairs plus the duplicate folders) reach 0 non-manifold edges and 0
open edges. The largest residual before the split was 588 (`fusion_diamond_plus_lidinoid`, 256 cells); it is now 0.
Triangle counts are unchanged. Time for the split: about 1–2 s at 96 cells, about 10–20 s at 256 cells (on top of about 15 s
for dual contouring at 256). Memory: the split works per vertex on typed arrays; the first version, which used a global
edge `Map`, ran out of heap at 256 cells and was replaced.

The three `structure_gallery_256` and `structure_gallery_256_mixed_open` rows with identical triangle counts are the same
designs in two folders. `fusion_gyroid_plus_helical` is a stale entry (replaced by the BCC partner in the mixed-open set).

## Reading

- Each part alone is manifold at these resolutions. The non-manifold edges appear only where the parts meet.
- The union is the field `min(A, B)`. Surface nets puts one vertex per grid cell, so along a crease some edges are shared
  by four triangles. Dual contouring removes most of these, because it places a vertex per cell and does not pinch
  across a crease.
- The residual edges (for example 483 / 384 / 588 for diamond+Lidinoid) are sub-voxel pinches: two adjacent cells share
  two sign-change crossings on one face, which gives a double dual edge (four triangles on one edge). They are narrower
  than one voxel, and their count does not fall with resolution (483 → 384 → 588 over 96 → 160 → 256). They are removed
  by vertex splitting (section above); this changes topology locally, not geometry.
- Open edges are 0 everywhere, so the existing "watertight" check (0 open edges) does not see these edges. The check
  name overstates what it tests; it does not establish manifoldness.

## Not done

- Gallery records of fused and deep designs are still the pre-split meshes (same geometry; non-manifold counts above
  zero). Regenerating them with the split is possible (about 30 s per design at 96 cells, several minutes at 256 cells);
  it would replace committed records and renders, so it is not done yet.
- Designs of other topologies (lattices, TPMS and graded designs without a fusion or coupled wrapper) keep surface nets; their non-manifold counts are not measured in this document.
- The closed-skin records in the 96 and 192 sets (17 entries each, with a 1 mm skin) were re-meshed with dual contouring on 2026-10-19;
  geometry unchanged (Monte Carlo identical). The other entries in those sets (14 in the 96 set, 19 in the 192 set) are not skin records, or are stale, and keep their earlier meshes.
- The section benchmark (`docs/SECTIONS.md`, `eval/design_section_bench.csv`) reported 861–1,413 non-manifold edges for
  a clipped gyroid. That clipped geometry was measured with surface nets and was not re-measured here.
- STL and STEP outputs of fused designs may still carry the residual pinches; their consumers may reject them.
