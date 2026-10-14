# Comparison with Bioinspired123D

Reference: `lamm-mit/Bioinspired123D` (Apache-2.0), files `data/raw/biodataset_basecodes.csv` and `eval/benchmark.csv`.
Reproduce: `node --experimental-strip-types --no-warnings scripts/compare_bioinspired.ts <checkout>`; results in `docs/bioinspired_comparison.json`.

## Base codes

| | Upstream | Implemented here |
|---|---|---|
| Base codes | 12 (helical 4, cellular 4, tubular 4) | 12, same IDs |

Missing: none. Extra: none.

## Family routing on the 320 benchmark prompts

| Group | n | Result |
|---|---|---|
| Single family (helical / cellular / tubular) | 270 | 270/270 correct (100 %) |
| Cross-domain (`bio_helicalxcellular`, `bio_cellularxtubular`, `bio_helicalxtubular`, `bio_all`) | 36 | routed to one family; no fusion produced |
| General non-bio (torus, cones, prisms) | 14 | flagged "No topology keyword recognised", confidence 0.25 |

Before the fix, 266/270 were correct. The 4 misses were prompts about "struts" (e.g. "flat rectangular struts"), which the lattice keyword `strut` captured. That keyword was removed; the lattice cues `lattice`, BCC/FCC/Kelvin and similar still match.

## Not covered

- Cross-domain prompts are not turned into fusions. The upstream wording is ambiguous ("with cellular sandwich layers on top and bottom" versus "each ply is cellular"), so this needs an explicit spec, which the gallery already provides.
- Geometric agreement with the upstream Blender output has not been measured. The upstream benchmark only gives prompts, not reference meshes.
