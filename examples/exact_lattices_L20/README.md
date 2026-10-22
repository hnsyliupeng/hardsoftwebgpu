# Exact B-Rep lattices, L = 20 mm (OpenCASCADE)

Seven lattice types built as exact B-Rep solids (CadQuery 2.8 / OCP, OpenCASCADE). Each folder has a 1600 px iso and three cut-away views, `exact.json` (metrics), and a README (checks and rebuild steps).

Common parameters: 20 mm cube envelope, cell 4 mm, strut radius 0.4 mm, complete lattice clipped to the envelope.

| Type | Folder | B-Rep volume (mm^3) | Solids | Valid | Mesh open / non-manifold edges | Field (5x5x5 block) mm^3 |
|---|---|---|---|---|---|---|
| BCC | `bcc/` | 1427.713 | 1 | yes | 0 / 0 | 1416.194 |
| SC | `sc/` | 663.473 | 1 | yes | 0 / 0 | 671.758 (256 grid) |
| FCC | `fcc/` | 1695.565 | 1 | yes | 0 / 0 | 1704.208 |
| BCCZ | `bccz/` | 1599.111 | 1 | yes | 0 / 0 | 1591.781 |
| Diamond | `diamond/` | 1427.399 | 1 | yes | 0 / 0 | 1411.032 |
| Kelvin | `kelvin/` | 1649.866 | 1 | yes | 0 / 0 | 1569.58 |
| FBCC | `fbcc/` | 2956.604 | 1 | yes | 0 / 0 | 2967.602 (older 256-grid record) |

The field values are lower because the field evaluates only the 5 x 5 x 5 cell block, so struts that enter the box from neighbouring cells are missing. The exact models include them. Independent capsule Monte Carlo agrees with the exact volumes: BCC 1425.2 ± 3.1, Diamond 1431.4 ± 5.6, Kelvin 1643.0 ± 5.9 mm^3.

**FBCC is in `fbcc/`** (seventh exact type, 2956.604 mm³, Monte Carlo 2966.9 ± 8.6). It was built per cell, not as one boolean; see `fbcc/README.md`.

**Not exact:** the TPMS types (gyroid, Schwarz P/D, Fischer–Koch S, Split P) have no exact B-Rep in this route. Their renders stay field-based (see `examples/structure_gallery*`).

Diamond: four corner slivers of 0.078 mm^3 each are removed (bond pieces cut at the envelope corners, not connected to the network). Removal is recorded in `diamond/exact.json`.
