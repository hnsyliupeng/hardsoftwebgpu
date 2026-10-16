// Step A1 check: narrow-band sparse sampling vs dense sampling on the SDF path.
// Usage: node --experimental-strip-types scripts/sparse_check.ts [res...]   (default: 128 256)
import { strutLattice, tpmsShell } from "../src/topology/lattice.ts";
import { sampleField, surfaceNets, meshIntegrals, type Grid } from "../src/geometry/grid.ts";
import { sampleFieldNarrowBand } from "../src/geometry/sparse.ts";
import type { Field } from "../src/topology/fields.ts";

const resList = process.argv.slice(2).map(Number);
const resolutions = resList.length ? resList : [128, 256];
// lipschitz 1 is exact for strut lattices (distance to a union of capsules); TPMS fields are approximate, so they keep the default.
const cases: { name: string; field: Field; opts: { lipschitz?: number } }[] = [
  { name: "lattice_sc", field: strutLattice({ type: "sc", cellSize: 4, cells: [5, 5, 5], radius: 0.4 }), opts: { lipschitz: 1 } },
  { name: "tpms_gyroid", field: tpmsShell({ type: "gyroid", cellSize: 4, cells: [5, 5, 5], thickness: 0.8 }), opts: {} },
];

function volumeOf(g: Grid): { vol: number; tris: number; surfMs: number } {
  const t = Date.now();
  const mesh = surfaceNets(g);
  const surfMs = Date.now() - t;
  return { vol: Math.abs(meshIntegrals(mesh).volume), tris: mesh.indices.length / 3, surfMs };
}

const rows: Record<string, unknown>[] = [];
for (const c of cases) {
  for (const res of resolutions) {
    const td = Date.now();
    const dense = sampleField(c.field, res);
    const denseMs = Date.now() - td;
    const d = volumeOf(dense);
    const { grid: sparse, stats } = sampleFieldNarrowBand(c.field, res, c.opts);
    const s = volumeOf(sparse);
    const row = {
      case: c.name, res,
      dense_volume_mm3: +d.vol.toFixed(3), sparse_volume_mm3: +s.vol.toFixed(3),
      volume_diff_pct: +(((s.vol - d.vol) / d.vol) * 100).toFixed(4),
      dense_tris: d.tris, sparse_tris: s.tris,
      dense_sample_ms: denseMs, sparse_sample_ms: stats.timeMs,
      eval_ratio: +(stats.evaluations / stats.denseEvaluations).toFixed(4),
      active_blocks: `${stats.activeBlocks}/${stats.blocks}`,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
