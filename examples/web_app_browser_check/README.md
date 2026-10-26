# Headless browser check of the web app

Checked on 2026-10-26 in a headless Chromium (`@sparticuz/chromium` 143 via puppeteer-core) against the production build
(`npm run build:web`, served by `node scripts/serve.mjs` on port 5173). The sandbox has no GPU, so the renderer is WebGL2.
WebGPU was not available, so `auto` fell back as designed (WebGPU → WebGL2 → CPU). The CPU software render always shows.

- `page.png`: default page after the default model finished (prompt "Make a helical Bouligand structure with 5 plies,
  10 degrees rotation."). Status "Done in 1809 ms. Repairs: 0.", backend WebGL2, 10 metrics rows, no console or page errors.
  The same run is in `default_model.log`.
- `graph_panel_and_section.log`: 14/14 steps of `scripts/browser_graph_check.mjs`:
  - structure graph: starter loaded, 8 parameter sliders, apply unchanged text, slider commit (one undo step),
    undo restores the slider, redo re-applies, invalid JSON rejected, starter reset;
  - section panel: x axis resets the offset range to 0–20 mm, the offset label follows the slider, the outline is drawn
    on the canvas (2596 non-white pixels), and the measurement table has 6 rows;
  - no page errors.

Reproduce: see the header of `scripts/browser_check.mjs` (install and library unpacking), then run
`LD_LIBRARY_PATH=<libs>/lib node browser_graph_check.mjs http://127.0.0.1:5173/` from a directory that has the packages.

Not covered: WebGPU itself (no GPU here), and the viewer's pointer interaction (orbit / zoom). The check uses DOM events,
not mouse drags on the canvas.
