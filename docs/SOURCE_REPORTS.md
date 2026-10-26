# Source analysis reports and licence notes (E2)

Each upstream project below was read as a reference. **No code was copied** into this repository unless the
licence section says so. Licences were checked in this session through the GitHub API, PyPI, and npm, and
the licence files were read where the API result was ambiguous. This is an engineering note, not legal advice.

## Summary

| Source | What it is | Licence (checked) | How it is used here |
|---|---|---|---|
| Bioinspired123D (`lamm-mit/Bioinspired123D`) | Bio-inspired base code (12 families), prompt benchmark (320 prompts) | Apache-2.0 | Reference for families and routing; `eval/benchmark.csv` and `eval/LICENSE.Bioinspired123D.txt` are kept with attribution |
| SolidCraft (`bherbruck/solidcraft`) | Parametric CAD app in Rust (desktop, web, MCP) | Apache-2.0 | Architecture reference only (no code copied) |
| usd-brep (`NVIDIA-Omniverse/usd-brep`) | NURBS BRep C++/Python library for USD | Apache-2.0 | Reference for the USD path; the USD export in the spec-gap list is not implemented |
| smlibpy (`awv-informatik/smlibpy`) | Python wrapper of SMLib | MIT (GitHub); PyPI 0.3.3 lists no licence field | Reference for the kernel API; the JavaScript build is used via `@classcad/smlibwasm` |
| `@classcad/smlibwasm` (npm 0.2.3) | JavaScript/WASM build of SMLib | MIT AND Apache-2.0 AND OFL-1.1 (package.json; includes LICENSE.usd-brep and NOTICE) | Runtime kernel for the exact B-Rep path (`src/geometry/brep.ts`); the three licences and the NOTICE must travel with any redistribution |
| LatticeQuery (`jalovisko/LatticeQuery`) | Beam and surface lattice modelling on OpenCASCADE, built on CQ-editor | Apache-2.0 (GitHub API and LICENSE file) | Reference for lattice methodology; no code copied |
| CadQuery (`CadQuery/cadquery`) | Python parametric CAD on OpenCASCADE | GitHub reports NOASSERTION; the LICENSE file contains Apache-2.0 text and an LGPL-style notice | Not a dependency of the web app. Exact-lattice work uses smlibwasm. Licence still to be confirmed before any CadQuery code is used |
| microgen (`3MAH/microgen`) | Python microstructure generation: repeated cells, TPMS, virtual composites, Voronoi, Gmsh/Mmg meshing | **GPL-3.0** | Concept reference only. **No code, formulas copied from its source, or data taken from it.** Using its code would make this repository GPL-bound |

## Notes per source

### Bioinspired123D
- 12 base-code families (helical, cellular, tubular); benchmark `eval/benchmark.csv` = 270 single-family, 36 cross-domain, 14 general non-bio prompts.
- Our comparison (`docs/bioinspired_comparison.json`): 12/12 base codes; 270/270 single-family routing; cross-domain prompts route to a single family (no fusion); general non-bio prompts were forced into bio families at confidence 0.25 before the routing fix; they are now flagged unrecognised (confidence 0.1).
- Licence: Apache-2.0. The licence file is in `eval/`. Attribution is kept.

### SolidCraft
- Pure-Rust parametric CAD with desktop, web, and MCP automation. Our architecture notes (IntentHarness → TopologyHarness → … → ExportHarness) are independent. The repo is used for architecture comparison only.

### usd-brep
- NURBS BRep library with C++ and Python bindings, Apache-2.0. Its `package.json` of smlibwasm ships `LICENSE.usd-brep`, so the kernel build depends on it indirectly.
- USD export is listed as partial in `docs/SPEC_GAP_REPORT.md`.

### smlibpy and smlibwasm
- smlibpy is the Python wrapper. `@classcad/smlibwasm` 0.2.3 is the JavaScript build we use. Its API (Box, Cylinder, Sphere, Helix, Lattice, Mesh, tessellate, toStep, toStl, toGlb, fillet, chamfer, shell, offset, sweep, loft, split, Ellipse) is what `src/geometry/brep.ts` calls. `tessellate(shape, tolerance)` is the tolerance hook.
- The PyPI listing shows version 0.3.3 and no licence field; the GitHub repo is MIT. The licence we rely on is the npm package's combined licence.

### LatticeQuery
- Beam and surface lattice modelling with OpenCASCADE (research paper: doi 10.1093/jcde/qwac076).
- **Correction:** an earlier note in this project said LatticeQuery had a licence conflict with Apache-2.0. The GitHub API now reports Apache-2.0, and its LICENSE is Apache-2.0. That earlier note is withdrawn. OpenCASCADE itself is LGPL-2.1 with an exception (general knowledge, not checked in this session); this matters only if OCC code is linked.

### CadQuery
- GitHub reports NOASSERTION. The LICENSE file contains Apache-2.0 text, plus an LGPL-style notice that needs a manual check before any CadQuery code or wheel is redistributed. Until then, CadQuery is not a dependency of the web app. Scripts that use it (`cadquery` STEP path in earlier builds) are reference tooling.

### microgen (GPL-3.0)
- Features: repeated cells (octet, honeycomb), TPMS, virtual composites (spheres, cylinders, ellipsoids), Voronoi tessellation, Gmsh/Mmg meshing, with an optional CAD path (`microgen[cad]`) on OpenCASCADE.
- Comparison to this project: microgen is mesh- and field-based by default (F-rep); this project's field path is similar in spirit. Our exact B-Rep path is different (smlibwasm).
- **Licence impact:** microgen is GPL-3.0. Copying its code, or formula implementations taken from its source, would bind this repository to GPL-3.0. We did not do this. Any TPMS formula we use is taken from the literature (see `src/topology/lattice.ts`), not from microgen's source.
- A microgen-by-feature comparison (the "microgen comparison" in the spec gap) is still open; it needs the library installed or its docs read, and it does not need any of its code.

## Licence actions

1. Keep `eval/LICENSE.Bioinspired123D.txt` (Apache-2.0) with the benchmark data.
2. Keep smlibwasm's `LICENSE`, `LICENSE.usd-brep`, and `NOTICE` with any copy of `node_modules/@classcad/smlibwasm` that is distributed.
3. Do not add microgen code. If a microgen-based feature is wanted, reimplement from the literature or choose a permissively licensed alternative.
4. Confirm the CadQuery LICENSE before using its code or wheels.
5. The "Apache-2.0 vs LatticeQuery conflict" note is withdrawn.

## Open items

- Microgen feature comparison (concept-level only).
- CadQuery licence confirmation.
- OpenCASCADE licence check if OCC is ever linked directly.
