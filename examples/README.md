# Example designs and screenshots

Each folder holds one generated design, produced by the CPU pipeline (`src/api.ts` → `runDesign`, or `scripts/run.ts`).

| Folder | Topology / motif | Volume (mm³) | Min wall (mm) | Genus | Repairs | Exports here |
|---|---|---|---|---|---|---|
| [helix_demo](helix_demo/) | helical, 5 plies, 10° | 7165.9 | 15.97 (fused plies) | 0 | 0 | STL, glTF, STEP |
| [tubular_demo](tubular_demo/) | tubular | 7638.1 | 1.94 | 16 | 0 | STL, glTF, STEP |
| [rounded_hollow_box](rounded_hollow_box/) | box, rounded, hollow | 2860.1 | 1.50 | 0 | 0 | STL, glTF, STEP |
| [sandwich_demo](sandwich_demo/) | cellular sandwich | 6435.7 | 1.69 | 8 | 0 | design only (STL 12.6 MB, regenerable) |
| [bcc_graded](bcc_graded/) | BCC lattice, graded thickness | 2859.7 | 0.72 | 660 | 0 | design only (STL 26 MB, regenerable) |
| [gyroid_repair](gyroid_repair/) | gyroid TPMS, 2 accepted repairs | 2482.8 | 0.41 | 970 | 2 | design only (STL ≈ 200 MB, regenerable) |

Each folder contains:
- `screenshot.png`: 800 px CPU render of the generated mesh (isometric, no GPU).
- `design.ts`: copy-executable parametric program (run with `node --experimental-strip-types`).
- `<name>.design.json`: full DesignState (prompt, design_spec, code, metrics, render_preview, repair_history, limitations, unknowns).

`web_app_iframe.png` is a screenshot of the live web app after Generate: the WebGL2 viewer shows the helical model, and the CPU render sits underneath.

## Regenerate the large meshes

```
OUT_DIR=/tmp/out_sandwich node --experimental-strip-types scripts/run.ts --program sandwich_demo sandwich_demo 96
OUT_DIR=/tmp/out_bcc node --experimental-strip-types scripts/run.ts --program bcc_graded bcc_graded 96
OUT_DIR=/tmp/out_gyroid node --experimental-strip-types scripts/run.ts --program gyroid_repair gyroid_repair 96
```

Set `OUT_DIR` outside the repository. Large STL and glTF files are not committed because of their size (the gyroid STL is about 200 MB in ASCII).

## Regenerate the screenshots

```
node --experimental-strip-types scripts/screenshots.ts 800
```
