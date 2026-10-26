# Slice reference designs (legacy inputs)

Three `design_spec` inputs used for the non-manifold and slice measurements in `docs/NONMANIFOLD.md`:

| file | what it is |
|---|---|
| `gyroid_only.design.json` | TPMS gyroid (cell 5 mm, wall 0.5 mm). Used as the single-structure reference. |
| `fusion_gyroid_plus_helical_plate_v1.design.json` | Earlier shallow fusion (`topology: fusion`, `variant: union`). Superseded by the deep fusion designs in `examples/deep_fusion_256/`. |
| `fusion_gyroid_plus_helical_cylfibre_variant.design.json` | Variant of the same shallow fusion with cylindrical fibres. Legacy, not in the gallery. |

## Status of the stored text

These files were written before the intent routing fix in `320529a` and `8ed0cf1`. The stored `prompt`, `unknowns` and `retrieval` fields are from that earlier parser and do not describe the current behaviour:

- `fusion_gyroid_plus_helical_plate_v1` stores the prompt `fusion union: gyroid TPMS with helical plies` and the unknown "No topology keyword recognised". The current parser reads the same prompt as `topology: tpms`, `variant: gyroid` at confidence 0.85.
- The `design_spec` values are what the measurements in `docs/NONMANIFOLD.md` were computed from. They were deliberately not regenerated, so those measurement records stay reproducible.

Do not use the stored `unknowns` text as a description of current intent parsing. To see what the current parser gives for a prompt, run `parseIntent(prompt)` from `src/intent/intent.ts`.
