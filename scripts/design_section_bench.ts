// D3 design-mesh benchmark: sections and measurement on closed meshes of field-based designs.
// Designs (all clipped by a sphere, so the material is closed and the section areas are meaningful):
//   - SC strut lattice (cell 4 mm, 6 cells) clipped by a sphere of radius 10 mm
//   - gyroid sheet (cell 4 mm, 6 cells, thickness 0.5 mm) clipped by the same sphere
//   - graded_infill_sphere (presets/graded_infill_sphere.json, hierarchical SC clipped by a sphere)
// Validation: the mesh must be closed (every edge shared by exactly two triangles). Section areas are
// compared with an independent estimate: the area of {field < 0} on the same plane, counted on a fine
// 2D grid of the field itself (not the mesh).
//   node --experimental-strip-types --no-warnings --max-old-space-size=8000 scripts/design_section_bench.ts [res,res,...]
// Output: eval/design_section_bench.csv
import { writeFileSync } from "node:fs";
import { compileGraph, type StructureGraph } from "../src/graph/graph.ts";
import { loadPreset } from "../src/graph/presets.ts";
import { sampleField, surfaceNets, vertexNormals, removeFloatingComponents } from "../src/geometry/grid.ts";
import { sectionSegments, sectionArea } from "../src/geometry/section.ts";
import { measure } from "../src/geometry/measure.ts";
import type { Field } from "../src/topology/fields.ts";

const CLIP = { op: "clip", shape: { type: "sphere", centre: [12, 12, 12], radius: 10 } };

function clippedGraph(id: string, source: object): StructureGraph {
  return {
    version: 1,
    nodes: [
      { id: "src", kind: "field", source: source as never },
      { id: "clip", kind: "transform", transform: CLIP as never },
      { id: "out", kind: "structure", name: id },
    ],
    edges: [{ from: "src", to: "clip" }, { from: "clip", to: "out" }],
  } as StructureGraph;
}

const designs: { id: string; graph: StructureGraph }[] = [
  { id: "sc_sphere", graph: clippedGraph("sc_sphere", { type: "sc", cellSize: 4, cells: 6, radius: 0.4 }) },
  { id: "gyroid_sphere", graph: clippedGraph("gyroid_sphere", { type: "gyroid", cellSize: 4, cells: 6, thickness: 0.5 }) },
  { id: "graded_infill_sphere", graph: loadPreset("presets/graded_infill_sphere.json") },
];

const resList = process.argv[2] ? process.argv[2].split(",").map(Number) : [128, 192];

// Edges used by other than exactly two triangles: open (used once) and non-manifold (used three or more times).
// Both are zero for a closed 2-manifold.
function boundaryEdges(indices: Uint32Array): { open: number; nonManifold: number } {
  const count = new Map<number, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)];
      const key = Math.min(a, b) * 4_000_000_000 + Math.max(a, b);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  let open = 0, nonManifold = 0;
  for (const c of count.values()) {
    if (c === 1) open++;
    else if (c >= 3) nonManifold++;
  }
  return { open, nonManifold };
}

// Area of {field < 0} on the plane coordinate[axis] = offset, counted on a fine 2D grid of the field.
function fieldSectionArea(field: Field, axis: number, offset: number, h: number): number {
  const b = field.bounds;
  const a = (axis + 1) % 3, c = (axis + 2) % 3;
  let n = 0;
  const p = [0, 0, 0];
  p[axis] = offset;
  for (let u = b.min[a] + h / 2; u < b.max[a]; u += h) {
    for (let w = b.min[c] + h / 2; w < b.max[c]; w += h) {
      p[a] = u;
      p[c] = w;
      if (field.eval(p[0], p[1], p[2]) < 0) n++;
    }
  }
  return n * h * h;
}

const rows = ["design,res,triangles,open_edges,nonmanifold_edges,volume_mm3,section_z_mesh_mm2,section_z_field_mm2,err_z_pct,section_x_mesh_mm2,section_x_field_mm2,err_x_pct,measure_ms,section_ms_mean"];
for (const d of designs) {
  const field = compileGraph(d.graph, d.graph.nodes.find((n) => n.kind === "structure")!.id);
  for (const res of resList) {
    const grid = removeFloatingComponents(sampleField(field, res)).grid;
    const raw = surfaceNets(grid);
    const mesh = { positions: raw.positions, indices: raw.indices, normals: vertexNormals(raw.positions, raw.indices) };
    const bnd = boundaryEdges(mesh.indices);

    const t0 = performance.now();
    const m = measure(mesh);
    const measureMs = performance.now() - t0;

    const zc = (field.bounds.min[2] + field.bounds.max[2]) / 2;
    const xc = (field.bounds.min[0] + field.bounds.max[0]) / 2;
    const ts = performance.now();
    const secZ = sectionArea(sectionSegments(mesh, 2, zc));
    const tZ = performance.now() - ts;
    const ts2 = performance.now();
    const secX = sectionArea(sectionSegments(mesh, 0, xc));
    const tX = performance.now() - ts2;
    const refZ = fieldSectionArea(field, 2, zc, 0.05);
    const refX = fieldSectionArea(field, 0, xc, 0.05);
    const errZ = refZ > 0 ? (secZ / refZ - 1) * 100 : NaN;
    const errX = refX > 0 ? (secX / refX - 1) * 100 : NaN;

    const row = [d.id, res, m.triangles, bnd.open, bnd.nonManifold, m.volumeMm3.toFixed(1), secZ.toFixed(2), refZ.toFixed(2), errZ.toFixed(3), secX.toFixed(2), refX.toFixed(2), errX.toFixed(3), measureMs.toFixed(1), ((tZ + tX) / 2).toFixed(2)].join(",");
    rows.push(row);
    console.log(row);
  }
}
writeFileSync("eval/design_section_bench.csv", rows.join("\n") + "\n");
console.log("wrote eval/design_section_bench.csv");
