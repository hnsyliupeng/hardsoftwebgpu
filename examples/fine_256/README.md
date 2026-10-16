# Fine set, 256 cells-grid resolution (task A4)

High-resolution multi-view renders: 1600 px, 2x supersampling (box-filtered), CPU rasteriser, cut-away (far half kept, straddling triangles clipped). No closed exterior skin.

Each folder: `screenshot.png` (isometric cut-away), `view_top.png`, `view_front.png`, `view_side.png`, `meta.json`.

| Folder | Grid res | Full triangles | Display triangles | Display volume error |
|---|---|---|---|---|
| sc | 256 | 1,569,312 | 995,946 | −0.73 % |
| gyroid | 256 | 5,905,764 | 988,890 | +0.32 % |
| schwarz_p | 256 | 4,596,600 | 993,504 | +0.13 % |

Notes
- Display meshes are decimated to a 1 M-triangle budget (`scripts/render_fine.ts`, `decimateToBudget`); the volume error column is the decimation error, not the field error.
- SC is an open strut lattice (cell 4 mm, r 0.4 mm). Short spikes at the cut edges are struts clipped by the cut plane.
- Gyroid and Schwarz P: the cut-away rim shows sawtooth edges where the sheet meets the cut plane and box faces. Not yet investigated (could be cut clipping or decimation); treat the rim as a known artefact.
- Reproduce: `node --experimental-strip-types scripts/render_fine.ts 256 1000000 examples/fine_256 sc gyroid schwarz_p`.
