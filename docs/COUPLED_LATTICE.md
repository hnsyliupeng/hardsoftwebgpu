# Coupled bio-lattice: multi-level structure, exact B-Rep, editable STEP

This is the high-resolution path of the app. Geometry is built as an exact OpenCASCADE B-Rep
(CadQuery 2.8), not as a voxel or SDF field, and it is exported as an editable STEP file.

- Code: `python/bioxlattice/` (builder, timeline, metrics, exporter, verifier, CLI)
- Tests: `python/tests/test_bioxlattice.py` (19 tests, including the smlibpy cross-check) and `tests/coupled.test.ts` (4 tests)
- Result: `examples/coupled_bio_lattice/` (STEP, mesh.bin, design.json, verify.json, structural_tests.json, timeline.json, design_code.py, spec.json, screenshots)
- Web: choose "Coupled bio-lattice" in the input panel and press Generate. The page loads the verified build outputs.

## Architecture

The builder works like a parametric timeline, in the spirit of SolidCraft's feature tree. Each feature runs in order and is logged with its parameters, time, volume, and solid/face counts (`examples/coupled_bio_lattice/timeline.json`).

| Level | Feature | Operation (OCC) | Coupling |
|---|---|---|---|
| L0 | envelope box, vertical edges filleted 3 mm | primitive + fillet | defines the depth field |
| L1 | skin, 2 mm, with 4 Ø2 mm bottom vents | boolean cut of the cavity from the envelope | `shell()` is avoided: it exports as a shell-based surface model, while a boolean cut gives a manifold solid |
| L2 | BCC strut core, 5 mm cell | cylinders fused per z-layer, clipped to the cavity plus 0.2 mm | nodes are twisted by θ(z) = 2°/mm · z (Bouligand-like helical coupling); neighbouring cells share the rotated nodes, so the lattice stays connected |
| L3 | three depth-graded strut radii (0.8 / 0.6 / 0.45 mm) | strut radius chosen by depth below the envelope surface (tiers at 4 mm and 7 mm) | struts that reach the skin fuse into it through the 0.2 mm overlap |

The final union is `skin ∪ core`. Two independent consistency checks hold: the volumes satisfy `L1 + L2 − overlap = total`, and the STEP re-imported with OCC matches the in-memory volume to 9·10⁻⁹.

## Results (default spec)

| Metric | Value |
|---|---|
| volume | 17 762.0 mm³ (envelope 31 845.5, skin with 4 vents 11 098.1, core 7 081.4, overlap 417.4) |
| surface area | 24 959.9 mm² |
| solids | 1 |
| outer boundary | watertight, genus 1024 (lattice tunnels open to the exterior through the vents) |
| internal voids | 0 (the vents open every enclosed lattice gap) |
| porosity | 0.4422 |
| struts | 3 680 kept of 16 384 unique candidates; per tier 3104 / 376 / 200 |
| analytic faces | 100 % (2 228 cylinders, 20 planes) |
| STEP | 48.5 MB (the first committed STEP was 48 MB), 1 solid, `MANIFOLD_SOLID_BREP`, no shell-based model, volume error 9·10⁻⁹ on re-import |
| printability vents | 4 × Ø2.0 mm through the bottom wall at (±10, ±10) mm; diameter floor 0.4 mm |
| mesh (high-res) | 647 946 triangles, 321 927 vertices, deflection 0.02 mm, watertight |
| build time | 236.7 s CLI build (STEP, mesh, STL, verify included) on 2 CPU cores |

The min wall thickness is reported as 0.9 mm. This is a B-Rep proxy, `min(skin, 2·r_min)`, not a ray-based measurement.

## Reference repositories: what was used and how

| Repository | Licence | Used for | Status |
|---|---|---|---|
| bherbruck/solidcraft | Rust app (MIT/Apache) | Parametric feature-timeline architecture (ordered features, logged parameters, rebuild from spec) | Architecture only. The Rust toolchain cannot be installed in this sandbox, so no code was built or linked. |
| NVIDIA-Omniverse/usd-brep | Apache-2.0 | Reference for NURBS B-Rep modelling and USD representation | Not integrated. The project needs its Packman/NVIDIA build chain, and it is not reachable from here. No USD export was produced. |
| awv-informatik/smlibpy | MIT | Second SMLib kernel (the same kernel as our smlibwasm) for cross-checks | Used for the second-kernel check of the envelope, cavity and skin (`python/bioxlattice/crosscheck.py`, result in `crosscheck_smlibpy.json`). Relative error ≈ 10⁻¹⁶. The lattice itself is not repeated in SMLib. |
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
- The vents are four Ø2 mm cylinders through the bottom wall only. They are a printability relief, not a load path. Their effect on the mechanical response is not measured here. Printability is not verified on a printer.
- Twist keeps straight struts between rotated nodes. It is not an exact helicoid lattice.
- The browser cannot run OpenCASCADE. Generate loads prebuilt outputs. Changing parameters in the page requires running the Python CLI.
- The cutaway screenshot removes the half nearest the camera by triangle centroid. Thin vertical slivers at the part corners are a CPU-rasteriser artefact at grazing angles, not geometry.
- The STL (32 MB) is not committed. The CLI writes it. The STEP and mesh.bin are committed.
- Not verified here: WebGPU presentation (see the earlier notes), mechanical response, printability.

## Test model 2: FCC graded scaffold (`examples/fcc_graded_test/`)

A second, smaller test of the same pipeline with a different topology, no twist, a different envelope and different tiers. Build: `cd python && ../.venv/bin/python -m bioxlattice build ../examples/fcc_graded_test/spec.json ../examples/fcc_graded_test`. The STL (14 MB) is written to `artifacts/` and is not committed.

| Parameter | Value |
|---|---|
| envelope | 30 × 30 × 16 mm, edge fillet 2 mm |
| skin | 1.5 mm boolean cut |
| lattice | FCC, cell 6 mm, twist 0 deg/mm, overlap 0.2 mm |
| tiers | depths 3 and 6 mm, radii 0.9 / 0.6 / 0.4 mm |
| vents | 4 × Ø1.6 mm at (±7, ±7) |

| Metric | Value |
|---|---|
| volume | 7 567.6 mm³ (envelope 14 345.1, skin 4 858.8, core 3 021.3, overlap 312.5) |
| surface area | 10 886.2 mm² |
| min wall (B-Rep proxy) | 0.8 mm (≥ 0.4 mm floor) |
| struts | 1 920 kept of 11 520 unique candidates; per tier 1 536 / 276 / 108 |
| porosity | 0.4725 |
| STEP | 25.6 MB, 1 `MANIFOLD_SOLID_BREP`, re-import volume error 1.0e-8 |
| mesh | 280 108 triangles, watertight, 0 non-manifold edges |
| build | 61.6 s build, 1.7 s STEP, 3.8 s tessellation |

**Finding (corrected): the 60 enclosed voids are wedge pockets against the cavity walls, and the bottom vents reach none of them.** See "Multi-level structural tests" below for the evidence. The earlier wording that the vents "open some of the gaps" was wrong.

Screenshots: `fcc_graded_test_cutaway.png` (near half removed, so the internal lattice is visible) and `fcc_graded_test_exterior.png` (the real outside: the bottom skin and its four vents, with no lattice visible by design).


## Multi-level structural tests (`python/bioxlattice/structural.py`)

Every build writes `structural_tests.json`. Each level has checks with an observed value, an expected value (a closed form, or an independent re-derivation from the spec), a tolerance and a pass flag. A level passes only if all its checks pass.

| Level | Checks | Expected value source |
|---|---|---|
| L0 envelope | bbox x/y/z; outer volume | `LWH − (4 − π) r² H` |
| L1 skin | skin volume; single solid | `envelope − cavity − n·π(d/2)²·t`, cavity `(L−2t)(W−2t)(H−2t) − (4 − π) r_in² (H−2t)` |
| L2 lattice | core inside the clip box; core volume ≤ clip box; struts kept = tier sum | clip box geometry |
| L3 tiers | per-tier counts and total re-derived from the spec | independent re-run of the strut selection |
| coupling | skin ∩ core (direct) = skin + core − part; overlap bounds; single solid | OCC, two routes |
| printability | watertight; enclosed voids = 0 (gate); minimum wall proxy ≥ 0.4 mm; each vent open | mesh analysis |
| export | STEP re-import volume error; editable B-Rep; no shell-based model | `verify_step` |

Every void component is written to `voids[]` with its bounding box, centroid, volume and location (lateral wall, bottom/top wall, edge, or interior).

Tests: `MultiLevel` (small reference part, all levels pass), `FccKnownDefect` (pins the FCC defect: only the void gate fails, 60 pockets, 20 lateral + 40 edge, total < 2 mm³), `VoidLocation` (classifier).

### Investigation of the FCC pockets

The pockets are not bulk voids. Each one is about 0.6 × 0.2 × 0.6 mm, with volume 0.0175 mm³, and the 60 total 1.05 mm³ (0.014 % of the part). A two-strut wedge that meets the inner wall at a node is sealed by that wall. Locations: 20 on the lateral walls at z = 0 (5 per wall) and 40 in the cavity edges at z = ±6, where the lateral walls meet the top and bottom inner walls.

Experiments that did not remove them (all 60, same geometry):

| Change | Voids |
|---|---|
| overlap 0.8 mm | 60 |
| overlap 1.2 mm | 60 |
| z-layer seams shifted by a/4 and a/2 | 60 (volume unchanged, 7567.57 mm³) |
| clip box = cavity, no outward growth | 60 |

So the cause is not the clip, the overlap, or the layer grouping. The remaining options each change the design, and the choice is open: (a) side vents through the lateral walls at the 60 positions, (b) a thin inner liner (about 0.3 mm, roughly +400 mm³), (c) a documented micro-pocket tolerance, which would relax the gate, or (d) changing the lattice phase so no node meets the wall. The gate is kept strict until the choice is made.
