# Exact lattice B-Rep status (SMLib kernel, cell 4 mm, r 0.4 mm, tessellation tol 0.02 mm)

Runner: `node --experimental-strip-types scripts/exact_lattice.ts <type> <L> <cell> <r> <tol>`.
Experiment switches (not for production): `EXACT_MODE=lines|bonds` overrides the default mode per type;
`EXACT_EPS=<mm>` overrides the per-line normal-plane offset in `lines` mode (default 0.01).

Defaults: `lines` for sc, bcc, fcc, fbcc, bccz; `bonds` for diamond and kelvin.

| Type | Mode | L | Result |
|---|---|---|---|
| sc | lines | 8 | PASS, B-Rep 42.515 mm³ |
| sc | lines | 20 | PASS, B-Rep 663.433 mm³, 108 pieces, mesh 661.157 mm³ (field 256 = 671.758, MC 664) |
| bcc | lines | 8 | PASS, B-Rep 91.375 mm³, 76 pieces, mesh 91.04 mm³ |
| bcc | lines | 20 | FAIL, fuse not closed/manifold (about 4.5 min) |
| bcc | bonds | 8 | PASS, mesh 91.018 mm³, 99 pieces |
| bcc | bonds | 20 | FAIL, SM_ERR in fuse (15 s) |
| fcc | lines | 8 | FAIL, fuse not closed/manifold |
| fcc | bonds | 8 | FAIL |
| diamond | bonds | 8 | PASS, 89.985 mm³ (earlier run) |
| diamond | bonds | 20 | FAIL, SM_ERR in fuse (69 s) |
| kelvin | bonds | 4 (one cell) | PASS, 10.755 mm³ (earlier run) |
| kelvin | bonds | ≥ 8 | FAIL (see earlier attempts) |

## Tried, did not help (do not repeat as-is)
- Trimming each line to the box plus a margin (instead of the full 2√3·L+4 cylinder): BCC L=8 fails for pad margins of 0.5 mm and for golden-ratio-spread margins; EPS 0.03/0.05/0.1 also fail. The untrimmed construction is kept.
- Larger line offsets (EXACT_EPS 0.03–0.1) at BCC L=8 in trimmed form: still fail.

## Offset sweep (untrimmed lines, the kept construction)
- bcc L=8: EXACT_EPS 0.005 FAIL; 0.01 PASS (91.375); 0.02 PASS (B-Rep 91.38, mesh 91.045); 0.03 PASS (B-Rep 91.388, mesh 91.053).
- bcc L=20: EXACT_EPS 0.03 FAIL (4.4 min). So the L=20 failure is not fixed by a larger offset.

## Diagnosis so far
- Every BCC and FCC node is shared by several lines (4 or more in one point), so `lines` mode needs the golden-angle offsets; the failure appears only at larger L (BCC) or already at L=8 (FCC).
- `bonds` mode fails at larger L with SM_ERR, which points to touching/tangent node-sphere joins that the current jitter does not remove.
- None of these failures are resolution-related: they are kernel boolean failures on exact coincidences.

## Next options (not yet tried)
- Fuse in spatial order per cell with explicit overlap (instead of balanced tree).
- Per-cell builds merged by a single final fuse, with per-cell jitter seeds.
- Accept the field-based render for BCC/FCC and label them as field-based in the gallery.

## Round 2 (kernel diagnosis)
Experiment switches added (all off by default):
- `EXACT_DEBUG=1`: on a fuse failure, print the failing tree depth and the two operands' labels (centre and direction of each line/bond/node).
- `EXACT_CLIP_LEVELS=1`: intersect each intermediate solid with a box slightly larger than the lattice (margin 0.5 mm). Intersecting with the exact box instead fails at BCC L=8 in 3 s.
- `EXACT_FUSE_ALL=1`: one multi-tool `fuse(...tools)` call instead of the balanced tree.

Results (BCC, cell 4, r 0.4, EPS 0.01 unless noted):
- Default tree, L=20: fails at the top-level fuse (depth 7) joining two large halves. Each side is a valid solid; the pair of halves is what the kernel rejects, not any single line pair.
- `EXACT_CLIP_LEVELS=1`: L=8 PASS (91.375 mm³, same as default). L=20 FAIL at depth 6 after 92 s. The same switch makes SC L=20 fail in 6 s, so it stays opt-in.
- `EXACT_FUSE_ALL=1`: L=8 PASS (91.375 mm³, 36 s). L=20 did not finish in 25 min, so it is not usable.
- Default restored; SC L=20 re-verified: 663.433 mm³, 108 pieces.

Conclusion for now: the BCC L=20 failure is in the global merge of large sub-solids. The three switches above move or change it but do not remove it. Next candidate (not tried): spatially ordered slab fusion with per-slab intermediate clip, so the failing merge is local and can be located.

## Round 3 (slab-ordered fusion, `EXACT_SLABS=n`, opt-in)
The z-range is cut into n slabs (interior planes at j·L/n + 0.37 mm, off the node heights). Each slab fuses its members, cuts once with the slab box, and the slab solids are chained in z order.
Findings (BCC, cell 4, r 0.4):
- Slab membership by the piece's conservative z range does not reduce the work: each line is long, so every line lands in every slab (76 pieces per slab at L=8).
- Cutting each piece to its slab before fusing fails: overlapping cap faces on the slab plane (fuse fails at depth 4). Fuse uncut, then cut the slab once.
- Overlapping slab margins fail when chaining: the same strut surface appears in two slabs (coincident faces). Exact touching planes avoid this.
- Slab planes through lattice node heights fail in the trim step (kernel cannot cut through a node plane cleanly). Offset by 0.37 mm.
- Slab box with a large xy extent: both slabs build at L=8, then the final intersect with the exact box fails.
- Slab box with exact xy faces: slab 0 builds, slab 1 fails (SLAB_FAIL k=1), in 1 min 17 s.
Status: BCC L=8 with EXACT_SLABS=2 does not pass in any variant tried. Default path unchanged: SC L=8 = 42.515 mm³ re-verified after these edits.


## Round 4 (OpenCASCADE via CadQuery, `python/exact/`) — current route
The SMLib runs above fail for BCC/FCC/Diamond/Kelvin at L = 20. The repo already lists cadquery 2.8 (`python/requirements.txt`), so the same geometry was built in OpenCASCADE:

- `scripts/export_lattice_patterns.ts` exports the unit-cell patterns of `src/topology/lattice.ts` to `python/exact/patterns.json`.
- `python/exact/build_lattice.py`: struts are cylinders, nodes are spheres (radius 1.002 r). Struts are grouped by z-layer, each layer is fused in **one** boolean call, the layers are unioned, and the result is intersected with the envelope. Chunked fuses of compounds gave wrong solids (BCC L = 8 cell: 18 solids instead of 1). Single-call fuses are correct.
- `python/exact/finalize.py`: drops floating slivers < 1 mm^3, re-exports, tessellates (welded) and checks open/non-manifold edges.
- `scripts/render_exact.ts`: renders the mesh with the existing 1600 px cut-away renderer.

Results at L = 20, cell 4, r 0.4 (all valid, one solid, 0 open / 0 non-manifold mesh edges):
SC 663.473, BCC 1427.713, FCC 1695.565, BCCZ 1599.111, Diamond 1427.399 (4 slivers removed), Kelvin 1649.866 mm^3.

Independent capsule Monte Carlo: BCC 1425.2 ± 3.1, Diamond 1431.4 ± 5.6, Kelvin 1643.0 ± 5.9 mm^3.

Field values in the table above are lower because `strutLattice` only uses the 5 x 5 x 5 cell block (no struts from neighbouring cells).

FBCC at L = 20: **failed** (`std::bad_alloc` in one layer fuse of 324 struts, also with half-cell layers). Not exact. Not retried further.
Kelvin and BCC renders: `examples/exact_lattices_L20/`.

### Deep design R8 (exact, `python/exact/build_r8.py`)
BCC strut lattice whose strut radius is set by a gyroid field. Each strut is a ruled loft through radius samples (nsub = 4).
Result 1775.615 mm³ (valid, one solid, watertight mesh). Monte Carlo: frustum model 1791 ± 11, field definition 1783 ± 11.
Render and metrics: `examples/exact_deep_L20/r8_radius_gyroid/`.
A first version with one cone per sub-segment lost lattice silently (two pieces, 1613.5 mm³): coincident caps. Do not use coincident sub-cones.

### Not attempted: R3 (twisted BCC)
R3 is a point map of the lattice by a z-dependent rotation, so its struts are curved tubes, not straight cylinders. An exact model needs
~1,700 swept tubes along curved paths. That is a different build from the straight-strut route and is not started.
