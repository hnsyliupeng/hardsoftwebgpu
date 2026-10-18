// Face origin test: are the solid areas on the box faces foam walls cut by the box?
// For a design whose field is foam walls plus something else (R5: gyroid in pockets; bcc_voronoi: lattice + foam),
// compares on a box face plane the total solid fraction with the foam-wall solid fraction (foam < 0).
// If the walls account for most of the face's solid, the flat faces are the walls, cut by the box.
//
// Usage: node --experimental-strip-types --no-warnings scripts/face_origin.ts <design.json> <foam_motif> [params-json] [--h 0.1] [--inset 0.2]
// foam_motif: e.g. cellular_generic (R5 foam) or cellular_voronoi (bcc_voronoi foam). params-json: e.g. '{"thickness":0.2,"smoothlevel":3}'.
import { readFileSync } from "node:fs";
import { buildTopology } from "../src/topology/index.ts";
import { buildBio, toMillimetres } from "../src/bio/families.ts";
import type { DesignSpec } from "../src/types.ts";

const argv = process.argv.slice(2);
const pos: string[] = [];
let h = 0.1, inset = 0.2;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--h") h = Number(argv[++i]);
  else if (argv[i] === "--inset") inset = Number(argv[++i]);
  else pos.push(argv[i]);
}
const [file, motif, paramsArg = "{}"] = pos;
const params = JSON.parse(paramsArg) as Record<string, number | undefined>;

type F = { eval(x: number, y: number, z: number): number };
const raw = JSON.parse(readFileSync(file, "utf8"));
const spec: DesignSpec = raw.design_spec ?? raw;
const L = spec.constraints.size_mm;
const total = buildTopology(spec).data.field as F;
const foam = toMillimetres(buildBio(motif, params, 42).baseField, L) as F;

// Plane z = inset: solid points of the total field, and foam-wall points among them.
let nTotal = 0, nWall = 0, nBoth = 0, n = 0;
for (let x = h / 2; x < L; x += h) {
  for (let y = h / 2; y < L; y += h) {
    n++;
    const t = total.eval(x, y, inset) < 0;
    const w = foam.eval(x, y, inset) < 0;
    if (t) nTotal++;
    if (w) nWall++;
    if (t && w) nBoth++;
  }
}
console.log("design\tfoam\tface_total_solid\tface_wall_solid\twalls_in_solid\tsolid_outside_walls");
console.log(`${file.split("/").slice(-2).join("/")}\t${motif}\t${(nTotal / n).toFixed(3)}\t${(nWall / n).toFixed(3)}\t${(nBoth / Math.max(1, nTotal)).toFixed(3)}\t${((nTotal - nBoth) / n).toFixed(3)}`);
