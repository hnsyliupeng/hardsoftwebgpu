// Export one SDF structure to GLB (step A3). Usage:
//   node --experimental-strip-types scripts/export_glb.ts <family> <res> <out.glb> [budget]
// family: sc | gyroid | schwarz_p. With a budget, the display copy is decimated (A2); without, the
// full mesh is written.
import { writeFileSync } from "node:fs";
import { strutLattice, tpmsShell } from "../src/topology/lattice.ts";
import { sampleField, surfaceNets, vertexNormals } from "../src/geometry/grid.ts";
import { decimateToBudget } from "../src/geometry/decimate.ts";
import { writeGlb } from "../src/export/glb.ts";
import type { Field } from "../src/topology/fields.ts";

const [family = "gyroid", resArg = "128", out = "out.glb", budgetArg] = process.argv.slice(2);
const field: Field =
  family === "sc"
    ? strutLattice({ type: "sc", cellSize: 4, cells: [5, 5, 5], radius: 0.4 })
    : tpmsShell({ type: family as "gyroid" | "schwarz_p", cellSize: 4, cells: [5, 5, 5], thickness: 0.8 });
const raw = surfaceNets(sampleField(field, Number(resArg)));
let mesh = { ...raw, normals: vertexNormals(raw.positions, raw.indices) };
if (budgetArg) mesh = decimateToBudget(mesh, Number(budgetArg)).mesh;
const bytes = writeGlb(mesh, `${family}_${resArg}`);
writeFileSync(out, bytes);
console.log(JSON.stringify({ family, res: Number(resArg), out, bytes: bytes.length, triangles: mesh.indices.length / 3 }));
