# Multi-form fusion: five deepening rounds

Five rounds, each adding one fusion dimension to the coupled bio-lattice part. Every round is a
full build (B-Rep, STEP re-import, tessellation, structural gates) and a render. Specs are in
`examples/fusion/<round>/spec.json`; outputs (`design.json`, `structural_tests.json`,
`verify.json`, `design_code.py`, `timeline.json`, screenshots) are tracked. STEP and `mesh.bin`
are rebuilt locally (ignored by Git, see the repository-size decision). Rebuild all rounds:
`bash scripts/run_fusion_rounds.sh` (one build at a time; about 2 GB peak per build on the 4 GB host).

## New capabilities (code)

| Feature | Where | Notes |
|---|---|---|
| Z-zones: each band has its own topology, cell size, twist rate and radius scale | `spec.Lattice.zones`, `spec.resolved_zones` | Contiguous, cover the envelope height. Empty list = the single-band model of earlier rounds (regression-tested). |
| Twist gradient, continuous across zones | `build.twist_angle` | Angle = integral of the zone twist rate from z = 0. Continuous at every interface (tested). |
| New topologies | `topology.py`: `bccz`, `octet` | `bccz` = BCC + four vertical cell edges (12 struts per cell). `octet` = FCC star + 12 octahedron edges (36 per cell, all of length sqrt(2)/2). These are generic lattices, not measured biological geometry. |
| Radius gradient per zone | `radius_scale` | Multiplies the depth-tier radii (cortical-like gradient, unchanged). |
| Zone interface check | `structural.coupling.zoneN_interface_crossed` | A thin slab across each interface must intersect the lattice; otherwise zones connect only through the skin. |
| Zone count re-derivation | `structural.L3.zoneN_struts_rederived` | Independent re-derivation of per-zone counts from the spec. |
| Chunked boolean union | `build.fuse_all` | Unions of 48 struts, then tree-merged. A single union over thousands of struts exhausted memory (octet zones). Same geometry. |
| Void gate refined | `structural.VOID_MIN_VOLUME_MM3 = 1e-3` | Closed fragments with zero enclosed volume are warnings, not voids (see round 5). |
| Relative overlap identity tolerance | `coupling.overlap_identity` | 1e-4 relative (was 1e-3 mm^3 absolute); OCC boolean error on a multi-solid core is about 1e-5 relative. |

## Rounds

Common envelope 40 x 40 x 20 mm, edge fillet 3 mm, skin 2 mm, four bottom vents (d = 2 mm),
tessellation deflection 0.02 mm. Solid fraction = volume / envelope volume (31 845.5 mm^3).

| Round | Fusion dimension | Zones (z mm: topology, cell, twist deg/mm, radius scale) | Result |
|---|---|---|---|
| 1 | Multi-topology, three bands | [-10,-5] FCC 5 mm, 2.0, 1.0; [-5,5] BCC 5 mm, 2.0, 1.0; [5,10] BCC 5 mm, 2.0, 0.9 | PASS, 0 voids, watertight. Volume 17 319 mm^3, solid 0.544, struts 4148, genus 1012, 1.30 M triangles, build 235 s. |
| 2 | Cell-size gradient | [-10,0] BCC 5 mm, 2.0, 1.0; [0,10] BCC 4.4 mm, 2.0, 0.9 | PASS, 0 voids, watertight (after repair, below). Volume 17 804 mm^3, solid 0.559, struts 4640, genus 1348, 1.55 M triangles, build 293 s. |
| 3 | Bouligand twist gradient | [-10,-5] BCC 5 mm, 0; [-5,5] BCC 5 mm, 4; [5,10] BCC 5 mm, 8 | PASS, 0 voids, watertight. Volume 18 670 mm^3, solid 0.586, struts 3680, genus 1033, 1.44 M triangles, build 284 s. Twist reaches 60 deg at the top. |
| 4 | Different bioinspired lattice (octet) | single band, octet 5 mm, twist 2.0, default depth tiers | PASS, 0 voids, watertight. Volume 23 517 mm^3, solid 0.738, struts 11 564, genus 2912, 2.03 M triangles, build 1150 s. |
| 5 | Full multi-level integration | [-10,-5] FCC 5 mm, 1.0, 1.0; [-5,0] octet 5 mm, 2.0, 0.9; [0,5] BCC 5 mm, 3.0, 0.8; [5,10] BCC 5 mm, 4.0, 1.0 | PASS, 0 voids, 1 warning (4 zero-volume fragments). Volume 18 380 mm^3, solid 0.577, struts 6004, genus 1700, 1.63 M triangles, build 456 s. |

Per-zone struts: R1 [1388, 1840, 920]; R2 [1840, 2800]; R3 [920, 1840, 920]; R5 [1388, 2776, 920, 920].
Per-tier struts (radius 0.8 / 0.6 / 0.45 mm): R1 [3572, 376, 200]; R2 [3764, 632, 244]; R3 [3104, 376, 200]; R4 [9596, 1228, 740]; R5 [4804, 780, 420].

Every round: 36 to 42 checks across L0 to export, all passing. STEP re-import volume error 2e-9 to 3e-7 relative.

## What failed, and the repair

**Round 2, attempt 1 (top cell 4.0 mm): not watertight.** Node planes at z = 0, 4, 8 put a node
layer exactly on the cavity top (z = 8). The boolean left near-coincident vertices (differences of 1e-4 mm)
and five open edges on that plane. The STEP was valid. Repair: top cell 4.4 mm (node planes 0, 4.4, 8.8,
clear of the cavity walls at x, y, z = 18, 18, 8). Re-run: PASS.

**Round 5, attempt 1 (top band BCCZ, twist 1, 3, 5, 8 deg/mm, BCC top): four sealed micro-pockets.**
Each ~3.4 mm^3, at the four top corners (z about 7.3 mm, next to the cavity corner fillet). This is a
real enclosed air volume, and the bottom vents cannot reach it. A coarse first attempt with BCCZ at the top
gave four pockets of 1.3 mm^3. R3 has the same top band (BCC, 8 deg/mm) with no pockets, so the cause is
the combination of zone twists, not one topology. Repair attempt 2: twist 1, 2, 3, 4 deg/mm (monotone). Attempt 1 is kept
in `examples/fusion/attempts/fusion_r5_v1/`.

**Round 5, attempt 2: four zero-volume fragments.** The void gate then reported four closed components
of 54 triangles each, bounding boxes 0.03 x 0.14 x 0.03 mm on the cavity top edge at x = +-18, z = 8.
They enclose no air (volume rounds to 0.0). They are degenerate tessellation patches, closed and
not connected to the main shell. The gate now counts only fragments of at least 1e-3 mm^3 as voids
(`VOID_MIN_VOLUME_MM3`). Smaller closed fragments are listed in `warnings[]` and `slivers[]`. This is a
definition change, made after seeing the data. Real pockets in the committed FCC model are 0.0175 mm^3 each,
and they still count. The watertight check still applies to these fragments, and they pass it.

**Round 2 warning.** The final R2 report has one zero-volume fragment at z = 0, the zone interface (x about
4.3, y about -4.4). Same classification; it is not an enclosed void.

## Visual checks

Every round's cutaway and exterior PNG was viewed (1600 px). Results:
- R1, R5: clean (checked earlier). R2: clean; the cell refinement toward the top is visible. R3: clean; the twist shows as rotated strut bands.
- R4 (octet): clean lattice, but the bottom row of cavity-edge struts shows truncated, slightly sawtooth ends. Cause: the octet cell (5 mm, dense) meets the cavity floor with many tangent cuts. The structural gates pass and the watertight check holds, but this is a visible edge artefact, not fixed.
- Exteriors (R2, R3, R4): closed 2 mm skin with four 2 mm vents, no defects.

## Limits (not verified here)

- Topologies `bccz` and `octet` and the zone parameters are design choices. Nothing here is fitted to
  Bioinspired123D families or to biological measurements. The Bioinspired123D comparison is still open.
- No mechanical response, printability on a machine, or resin-trap test beyond the air-volume gate.
- Twist and zone gradients are geometric only. They are not optimised for stiffness.
- Zone interfaces are node planes of both zones. Mismatched grids would need the interface check.
- Octet is the heaviest build (about 19 minutes, 11 564 struts). Build time is set by OCC booleans on the host.
- R4 bottom-edge artefact (see visual checks): not repaired.
- The degenerate-fragment warnings (R2, R5) are a known tessellation artefact of cavity-edge tangencies. They
  were not traced to a single boolean and are not removed.
