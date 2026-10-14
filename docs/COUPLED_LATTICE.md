# Coupled bio-lattice: multi-level structure, exact B-Rep, editable STEP

This is the high-resolution path of the app. Geometry is built as an exact OpenCASCADE B-Rep
(CadQuery 2.8), not as a voxel or SDF field, and it is exported as an editable STEP file.

- Code: `python/bioxlattice/` (builder, timeline, metrics, exporter, verifier, CLI)
- Tests: `python/tests/test_bioxlattice.py` (18 tests) and `tests/coupled.test.ts` (4 tests)
- Result: `examples/coupled_bio_lattice/` (STEP, mesh.bin, design.json, verify.json, timeline.json, design_code.py, screenshots)
- Web: choose "Coupled bio-lattice" in the input panel and press Generate. The page loads the verified build outputs.

## Architecture

The builder works like a parametric timeline, in the spirit of SolidCraft's feature tree. Each feature runs in order and is logged with its parameters, time, volume, and solid/face counts (`examples/coupled_bio_lattice/timeline.json`).

| Level | Feature | Operation (OCC) | Coupling |
|---|---|---|---|
| L0 | envelope box, vertical edges filleted 3 mm | primitive + fillet | defines the depth field |
| L1 | closed skin, 2 mm | boolean cut of the cavity from the envelope | `shell()` is avoided: it exports as a shell-based surface model, while a boolean cut gives a manifold solid |
| L2 | BCC strut core, 5 mm cell | cylinders fused per z-layer, clipped to the cavity plus 0.2 mm | nodes are twisted by θ(z) = 2°/mm · z (Bouligand-like helical coupling); neighbouring cells share the rotated nodes, so the lattice stays connected |
| L3 | three depth-graded strut radii (0.8 / 0.6 / 0.45 mm) | strut radius chosen by depth below the envelope surface (tiers at 4 mm and 7 mm) | struts that reach the skin fuse into it through the 0.2 mm overlap |

The final union is `skin ∪ core`. Two independent consistency checks hold: the volumes satisfy `L1 + L2 − overlap = total`, and the STEP re-imported with OCC matches the in-memory volume to 2·10⁻⁸.

## Results (default spec)

| Metric | Value |
|---|---|
| volume | 17 784.9 mm³ (envelope 31 845.5, skin 11 123.2, core 7 081.4, overlap 419.7) |
| surface area | 24 915.1 mm² |
| solids | 1 |
| outer boundary | genus 0, watertight |
| internal voids | 1 (sealed lattice gaps), genus 1021 |
| porosity | 0.4415 |
| struts | 3 680 kept of 16 384 unique candidates; per tier 3104 / 376 / 200 |
| analytic faces | 100 % (2 228 cylinders, 20 planes) |
| STEP | 48 MB, 1 solid, `MANIFOLD_SOLID_BREP` with voids, no shell-based model, volume error 2·10⁻⁸ on re-import |
| mesh (high-res) | 645 780 triangles, 320 852 vertices, deflection 0.02 mm, watertight |
| build time | 262 s build + 3 s STEP + 13 s tessellation on 2 CPU cores |

The min wall thickness is reported as 0.9 mm. This is a B-Rep proxy, `min(skin, 2·r_min)`, not a ray-based measurement.

## Reference repositories: what was used and how

| Repository | Licence | Used for | Status |
|---|---|---|---|
| bherbruck/solidcraft | Rust app (MIT/Apache) | Parametric feature-timeline architecture (ordered features, logged parameters, rebuild from spec) | Architecture only. The Rust toolchain cannot be installed in this sandbox, so no code was built or linked. |
| NVIDIA-Omniverse/usd-brep | Apache-2.0 | Reference for NURBS B-Rep modelling and USD representation | Not integrated. The project needs its Packman/NVIDIA build chain, and it is not reachable from here. No USD export was produced. |
| awv-informatik/smlibpy | MIT | Second SMLib kernel (the same kernel as our smlibwasm) for cross-checks | Installed from PyPI (0.2.3) and imports. Not yet used in the verification. |
| jalovisko/LatticeQuery | Apache-2.0 | Standard strut topologies (SC, BCC, FCC) | Re-implemented from the formulas. No code was copied. The B-Rep path supports SC, BCC and FCC. The SDF path already covers more topologies. |
| cadquery/cadquery | Apache-2.0 | Exact OCC B-Rep and STEP I/O | Used as the geometry engine (CadQuery 2.8.0, from PyPI). |

## Environment

```
bash scripts/python_env.sh          # .venv with cadquery 2.8 + GL load stub (no network beyond PyPI)
LD_LIBRARY_PATH=.venv/stubs .venv/bin/python -m unittest discover -s python/tests -p "test_*.py"
LD_LIBRARY_PATH=.venv/stubs .venv/bin/python -m bioxlattice build --name coupled_bio_lattice /tmp/out
node --experimental-strip-types scripts/render_coupled.ts /tmp/out/coupled_bio_lattice.mesh.bin out.png 800 cut
```

The sandbox has no libGL. `scripts/make_gl_stub.sh` builds a stub `libGL.so.1` that defines the GL symbols bundled OCP libraries reference at load time. B-Rep and STEP work never call GL. On a machine with Mesa, skip the stub.

## Limitations

- Two STEP-format notes. The file is 48 MB because lattice-to-lattice intersections are exact B-spline edges, and each has pcurves. Setting `write.surfacecurve.mode` did not change the size. The STEP is editable B-Rep, but features applied to it may be fragile.
- The internal voids are sealed inside the skin, so this part cannot be printed without vent holes. Vents are not part of this spec.
- Twist keeps straight struts between rotated nodes. It is not an exact helicoid lattice.
- The browser cannot run OpenCASCADE. Generate loads prebuilt outputs. Changing parameters in the page requires running the Python CLI.
- The cutaway screenshot clips triangles by centroid, so the wall edges show small artefacts.
- The STL (32 MB) is not committed. The CLI writes it. The STEP and mesh.bin are committed.
- Not verified here: WebGPU presentation (see the earlier notes), mechanical response, printability.
