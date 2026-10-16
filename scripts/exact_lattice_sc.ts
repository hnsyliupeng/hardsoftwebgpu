// Exact B-Rep simple-cubic (SC) strut lattice through the SMLib kernel.
//
// Construction: the SC strut lines are axis-aligned and pass through every node, so each
// line is ONE long cylinder (extended 1 mm beyond the build box) instead of per-cell segments.
// That avoids end-to-end coaxial contacts, which the kernel rejects. The x-lines are offset by
// EPS in y and z so that no three struts meet at one point (a triple-point degeneracy the
// kernel also rejects). The offset changes the volume by ~1e-5 relative.
// The union is clipped to the build box [0, L]^3 and measured exactly.
//
// Usage: node --experimental-strip-types scripts/exact_lattice_sc.ts [L=20] [cell=4] [r=0.4] [tol=0.02]
// Writes a JSON record to stdout. Does not write mesh files.

import { loadKernel, measure } from "../src/geometry/brep.ts";

const L = Number(process.argv[2] ?? 20);
const cell = Number(process.argv[3] ?? 4);
const r = Number(process.argv[4] ?? 0.4);
const tol = Number(process.argv[5] ?? 0.02);
const EPS = 0.01;
const EXT = 1;

const K: any = await loadKernel();
const { Box, Cylinder, Pos, Rot } = K;
const n = Math.round(L / cell);
const len = L + 2 * EXT;

const t0 = Date.now();
const tools: any[] = [];
for (let a = 0; a <= n; a++) {
  for (let b = 0; b <= n; b++) {
    const u = a * cell;
    const v = b * cell;
    tools.push(Pos(u, v, L / 2).mul(Cylinder(r, len))); // z-line at (x=u, y=v)
    tools.push(Pos(u, L / 2, v).mul(Rot(-90, 0, 0).mul(Cylinder(r, len)))); // y-line at (x=u, z=v)
    tools.push(Pos(L / 2, v + EPS, u + EPS).mul(Rot(0, 90, 0).mul(Cylinder(r, len)))); // x-line, offset
  }
}
// Balanced fuse tree (all tools combined before the clip).
let level: any[] = tools;
while (level.length > 1) {
  const next: any[] = [];
  for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? level[i].fuse(level[i + 1]) : level[i]);
  level = next;
}
const clip = Pos(L / 2, L / 2, L / 2).mul(Box(L, L, L));
const solid = level[0].intersect(clip);
const tBool = Date.now() - t0;

const m = measure(solid);
const t1 = Date.now();
const tess = K.tessellate(solid, tol);
const mesh = { positions: Float32Array.from(tess.vertices), indices: Uint32Array.from(tess.triangles) };
const tMesh = Date.now() - t1;
// Signed-volume check of the tessellation against the B-Rep volume.
let mv = 0;
const P = mesh.positions, I = mesh.indices;
for (let i = 0; i < I.length; i += 3) {
  const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
  mv += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
}

const record = {
  family: "sc_exact_brep",
  L_mm: L,
  cell_mm: cell,
  strut_radius_mm: r,
  eps_mm: EPS,
  components_expected: 1,
  brep_volume_mm3: +m.volume.toFixed(3),
  brep_area_mm2: +m.area.toFixed(2),
  mesh_tolerance_mm: tol,
  mesh_triangles: I.length / 3,
  mesh_volume_mm3: +Math.abs(mv).toFixed(3),
  time_bool_ms: tBool,
  time_mesh_ms: tMesh,
};
console.log(JSON.stringify(record, null, 2));
