// Sample a structure-graph preset and report volume and floating components (task B3 check).
// Usage: node --experimental-strip-types scripts/graph_check.ts <preset.json> <res>
// Also reports the same source without transforms, so the effect of each transform is visible.
import { loadPreset } from "../src/graph/presets.ts";
import { compileGraph, structureIds, type StructureGraph } from "../src/graph/graph.ts";
import { sampleField, surfaceNets, meshIntegrals, removeFloatingComponents } from "../src/geometry/grid.ts";

const [file, resArg = "96"] = process.argv.slice(2);
const res = Number(resArg);
const g = loadPreset(file);
const out = structureIds(g)[0];

// Grid spacing: sampleField spreads `res` cells over the largest bounding dimension, so a transform that
// enlarges the bounds (bend, shear) must raise the resolution to keep the source spacing. Without this
// the 0.8 mm gyroid wall is under-sampled (96 cells gave -13 % volume; 160 cells gives -1.1 %).
function maxExtent(f: { bounds: unknown }): number {
  const b = f.bounds as { min: number[]; max: number[] };
  return Math.max(...[0, 1, 2].map((a) => b.max[a] - b.min[a]));
}

function measure(graph: StructureGraph, id: string, resFor: number) {
  const t0 = Date.now();
  const field = compileGraph(graph, id);
  const grid = sampleField(field, resFor);
  const clean = removeFloatingComponents(grid);
  const mesh = surfaceNets(clean.grid);
  const vol = meshIntegrals(mesh).volume;
  return { volume_mm3: +vol.toFixed(3), removed_components: clean.removedComponents, removed_volume_mm3: +clean.removedVolumeMm3.toFixed(3), ms: Date.now() - t0, expr: field.expr };
}

// Same source, no transforms: a structure node fed directly by the source node.
const srcId = g.nodes.find((n) => n.kind === "field")!.id;
const plain: StructureGraph = { version: 1, nodes: [g.nodes.find((n) => n.id === srcId)!, { id: "out", kind: "structure", name: "plain" }], edges: [{ from: srcId, to: "out" }] };

const srcField = compileGraph(plain, "out");
const tField = compileGraph(g, out);
const resT = Math.round((res * maxExtent(tField)) / maxExtent(srcField));
const result = { preset: file, res, res_transformed: resT, structure: out, transformed: measure(g, out, resT), source_only: measure(plain, "out", res) };
console.log(JSON.stringify(result, null, 2));
