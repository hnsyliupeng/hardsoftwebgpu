// Bundles the web app into dist/web with esbuild (no network, no CDN).
// The smlibwasm .wasm is copied next to the worker bundle, because the kernel resolves it with
// new URL("smlibwasm.wasm", import.meta.url).
import { build } from "esbuild";
import { cpSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";

rmSync("dist/web", { recursive: true, force: true });
mkdirSync("dist/web", { recursive: true });
await build({
  entryPoints: ["web/main.ts", "web/worker.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  outdir: "dist/web",
  sourcemap: true,
  logLevel: "info",
  external: ["node:*"],
});
copyFileSync("web/index.html", "dist/web/index.html");
// The kernel ships as a runtime asset (not bundled): dist + wasm glue + .wasm + fonts, same layout.
const smlib = "node_modules/@classcad/smlibwasm";
const vendor = "dist/web/vendor/smlibwasm";
for (const dir of ["dist", "wasm", "fonts"]) cpSync(`${smlib}/${dir}`, `${vendor}/${dir}`, { recursive: true });
copyFileSync(`${smlib}/package.json`, `${vendor}/package.json`);
cpSync("eval", "dist/web/eval", { recursive: true });
// Offline CadQuery build of the coupled bio-lattice (STEP, STL, mesh.bin, metrics, code).
if (existsSync("examples/coupled_bio_lattice")) cpSync("examples/coupled_bio_lattice", "dist/web/examples/coupled_bio_lattice", { recursive: true });
console.log("built dist/web");
