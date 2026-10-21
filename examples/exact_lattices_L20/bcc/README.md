# Exact B-Rep lattice: BCC (body-centred cubic)

**Exact model (OpenCASCADE B-Rep, not an SDF).** Built with CadQuery 2.8 / OCP (OpenCASCADE). Renders are tessellated from that B-Rep (tolerance 0.02 mm, angle 0.2 rad).

Parameters: envelope 20 x 20 x 20 mm cube, cell 4 mm, strut radius 0.4 mm. Struts are cylinders with a sphere at every node (sphere radius 1.002 r). The unit-cell strut pattern is the one in `src/topology/lattice.ts` (`latticePattern`), exported by `scripts/export_lattice_patterns.ts`. The struts are the complete lattice, clipped to the envelope. Struts from cells outside the 5 x 5 x 5 block are included.

## Checks
| Item | Value |
|---|---|
| B-Rep volume | 1427.713 mm^3 |
| Solids | 1 (removed floating slivers: 0) |
| Faces | 1216 |
| B-Rep valid (OCCT `isValid`) | True |
| Mesh vertices / triangles | 103038 / 208712 |
| Mesh open edges / non-manifold edges (after welding) | 0 / 0 |
| Mesh volume | 1426.682 mm^3 |
| Capsule Monte Carlo (independent of OCCT) | 1425.2 +- 3.1 (N=1e6) mm^3 |
| Field value in `docs/exact_lattice_status.json` (5x5x5 block, 256 grid) | 1416.194 mm^3 |

The field value is lower because `strutLattice` (src/topology/lattice.ts) evaluates only cells inside the 5 x 5 x 5 block. Struts that enter the box from neighbouring cells are missing. The exact model keeps them. The gap is +0.8 %.

Removed slivers: 0 (volumes below 1 mm^3 from bonds cut at the envelope corners, not connected to the network).

## Renders (1600 px, 2x supersampling, cut-away views)
- `screenshot.png`: iso
- `view_top.png`, `view_front.png`, `view_side.png`
- `render_meta.json`: renderer settings

Cut-away: the far half is kept, so the internal structure is visible. No closed exterior skin is rendered.

## Rebuild
```
python python/exact/build_lattice.py bcc 20 4 0.4 artifacts/exact_lattices_L20/raw_bcc      # writes raw_bcc.step
python python/exact/finalize.py bcc artifacts/exact_lattices_L20/raw_bcc.step artifacts/exact_lattices_L20/final_bcc
node --experimental-strip-types scripts/render_exact.ts artifacts/exact_lattices_L20/final_bcc/bcc_L20.mesh examples/exact_lattices_L20/bcc
```
Environment: `python/requirements.txt` (cadquery 2.8) in `.venv`, with `scripts/make_gl_stub.sh` for `LD_LIBRARY_PATH`. Run one build per process, with memory capped (the build peaks near 1.3 GB at BCC L=20).

The STEP (about 18 MB) is kept in `artifacts/` and not committed (repo policy for large STEP files).

## Limitations
- Exact B-Rep for the lattice struts. The renderer is a software rasterizer. Its output is a PNG, not a CAD view.
- The envelope is a plain cube. There is no skin (open lattice).
- Struts are cylinders and spheres. No fillets at the nodes.
