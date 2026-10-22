# Exact B-Rep lattice: FBCC (face-centred body-centred cubic)

**Exact model (OpenCASCADE B-Rep, not an SDF).** Built with CadQuery 2.8 / OCP (OpenCASCADE). Renders are tessellated from that B-Rep (tolerance 0.02 mm, angle 0.2 rad). This is the seventh exact lattice type, after the six in the parent folder.

Parameters: envelope 20 x 20 x 20 mm cube, cell 4 mm, strut radius 0.4 mm. Struts are cylinders with a sphere at every node (sphere radius 1.002 r). The unit-cell pattern is `fbcc` in `python/exact/patterns.json` (exported from `src/topology/lattice.ts`), 36 struts per cell. The lattice is complete and clipped to the envelope, with struts from cells outside the 5 x 5 x 5 block included: 4572 struts in total.

## Build method
A single boolean over all struts ran out of memory (`std::bad_alloc`, the earlier failure). The build now works per cell:
- each strut belongs to the cell containing its midpoint; each strut end gets a sphere in that cell, so the flat end caps lie inside a sphere of the same fuse;
- cells are fused one item at a time with a fuzzy tolerance of 1e-4 mm. Without the tolerance, sequential fuses silently dropped pieces (a BCC cell gave 13 solids instead of 1); a multi-argument fuse over one cell exhausted memory;
- the 125 cells are fused within each z-layer, the layers are unioned, and the result is intersected with the envelope once.

Check on the method: BCC L = 8 gives 91.3736 mm^3 with both this mode and the layer mode used for the other six types.

## Checks
| Item | Value |
|---|---|
| B-Rep volume | 2956.604 mm^3 |
| Solids | 1 (removed floating slivers: 0) |
| Faces | 3881 |
| B-Rep valid (OCCT `isValid`) | True |
| Mesh vertices / triangles | 265853 / 540462 |
| Mesh open edges / non-manifold edges (after welding) | 0 / 0 |
| Mesh volume | 2954.097 mm^3 (-0.08 % vs B-Rep) |
| Capsule Monte Carlo (independent of OCCT, N = 200000) | 2966.9 +- 8.6 mm^3 (1.2 sigma from B-Rep) |
| Build time | 466 s on 2 CPUs, memory capped at 3.4 GB |

The field-based FBCC (`strutLattice`, 5 x 5 x 5 block) is a different estimate and is not used as a reference here. The field-based gallery renders of FBCC are labelled non-exact in `examples/structure_gallery*`.

## Renders (1600 px, 2x supersampling, cut-away views)
- `screenshot.png`: iso
- `view_top.png`, `view_front.png`, `view_side.png`
- `render_meta.json`: renderer settings
- `exact.json`: metrics above

Cut-away: the far half is kept, so the internal structure is visible. No closed exterior skin is rendered.

## Rebuild
```
MODE=cells python python/exact/build_lattice.py fbcc 20 4 0.4 artifacts/exact_lattices_L20/raw_fbcc   # writes raw_fbcc.step
python python/exact/finalize.py fbcc artifacts/exact_lattices_L20/raw_fbcc.step artifacts/exact_lattices_L20/final_fbcc
node --experimental-strip-types scripts/render_exact.ts artifacts/exact_lattices_L20/final_fbcc/fbcc_L20.mesh examples/exact_lattices_L20/fbcc
python python/exact/check_lattice_mc.py fbcc 20 4 0.4 200000
```
Environment: `python/requirements.txt` (cadquery 2.8) in `.venv`, with `scripts/make_gl_stub.sh` for `LD_LIBRARY_PATH`. Use `ulimit -v 3400000` on this 4 GB host.

The STEP (59 MB, `raw_fbcc.step`) and the mesh are in `artifacts/` and not committed (repo policy for large STEP files).

## Limitations
- Exact B-Rep for the lattice struts. The renderer is a software rasterizer; its output is a PNG, not a CAD view.
- The envelope is a plain cube. There is no skin (open lattice).
- Struts are cylinders and spheres. No fillets at the nodes.
- Not checked against Bioinspired123D. No WebGPU or browser check.
