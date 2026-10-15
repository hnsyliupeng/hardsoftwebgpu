# Open (skin-free) gallery at 256 cells: status

Status: **41/41 designs PASS** (the fibre fix re-ran the two helical fibre entries) (36 in this folder, 5 in `examples/deep_fusion_256/`), all open, all with cut-away and three further
cut-away views, no exterior skin images. The validated numbers are in `README.md` in each folder and in `gallery.json`.

## What was wrong and what was fixed

1. **Strut-lattice wall (root cause of the SC resolution mismatch).** The wall statistic was a 5th percentile of inward ray chords.
   Chords through a cylinder are short at grazing angles, so a 0.8 mm strut measured about 0.35 mm. The RepairHarness then
   scaled the strut radius by a grid-dependent amount, so simple cubic gave 1046 mm³ at 256 and 1121 mm³ at 320. The wall is now 2r for strut lattices
   (`src/validation/validate.ts`); the chord value is kept as `min_wall_thickness_chord`. SC at 256 is 671.758 mm³, converged to 0.15 % at 320,
   and within 2.1 % of the Monte Carlo estimate (659.2 mm³). The RepairHarness now makes no change to any entry.
2. **Floating fragments.** A lattice or TPMS clipped by the envelope can leave cells that touch the body only outside the box.
   `removeFloatingComponents` (`src/geometry/grid.ts`) removes solid fragments that are not connected to the main body before meshing; the removed amount is
   reported. Kelvin had 15 such islands (about 0.6 % of the volume); the gyroid had a 35-node corner speck. Both are now single solids.
3. **Rim of the envelope.** Surface samples within 0.5 mm of a box face are excluded from the wall statistic (`RIM_MARGIN_MM`). They are cut edges, not walls;
   without this the open TPMS sheets read about 0.30 mm at the 5th percentile.
4. **Helical deep designs (fieldfuse R2, R5).** The wall/thickness was raised to 1.1 mm (R2) and 1.1–1.4 mm (R5). The sheet distance is approximated
   by |F|/|∇F|, which under-sizes twisted gyroid sheets (5th-percentile chord about 0.4 × the design wall at 0.7 mm). At the new walls the floor is met (0.44 and 0.42 mm).

## Open items

- **Helical plate plies show triangular teeth on the walls** (`bio_helical_generic`, `bio_helical_noise`, `fusion_helical_cap_iwp`, `fusion_gyroid_plus_helical`).
  The cause is the rotated 2S plate clipped to the envelope. Extending the plate to cover the envelope fills the box (8000 mm³) and removes the helix, so it was rejected.
  Open: accept the notches, or change the plate variant to fibres. Decision for the user.
- Fibre plies (rectfibers, cylinfibers) had the same notches; they are fixed (longer fibres, centre grid extended past the envelope). Their volumes rose by 6–16 %.
- The sheet SDF `|F|/|∇F|` is approximate. An exact or Newton-projected sheet distance would allow the thinner deep walls back.
- `coupled.ts` core clip stays as `max(field, sdBox)`. It defines the same solid as `clipSign`, and the designs pass.
- Helical wall statistic reports p5 = 4 mm and 2 mm for the B-Rep plate designs: the chord statistic is not meaningful for those plates (they are planar slabs).
- Cross-domain prompts still map to one family (no fusion), and non-bio prompts are forced into bio families at confidence 0.25.

## Commands

    GALLERY_OUT=examples/structure_gallery_256 node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 256
    GALLERY_OUT=examples/deep_fusion_256 node --experimental-strip-types --no-warnings scripts/structure_gallery.ts 256 fieldfuse_r1_channel_lattice fieldfuse_r2_ply_tpms fieldfuse_r3_graded_tpms fieldfuse_r4_foam_lattice fieldfuse_r5_ply_graded_tpms
