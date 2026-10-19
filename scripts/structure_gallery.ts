// Structure gallery: every structure family through the full multi-harness pipeline, with explicit
// pass/fail checks, a high-resolution CPU render and a copy-executable design.ts per design.
//   node --experimental-strip-types --no-warnings scripts/structure_gallery.ts [resolution=96] [id ...]
// Output: examples/structure_gallery/<id>/{design.json, design.ts, screenshot.png} and an index README.md.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runPipeline } from "../src/pipeline.ts";
import { parseIntent } from "../src/intent/intent.ts";
import { buildTopology } from "../src/topology/index.ts";
import { rasterisePreview } from "../src/render/preview.ts";
import { encodePngCompressed } from "../src/render/png.ts";
import { cutAway, VIEWS } from "../src/render/cutaway.ts";
import { emitParametricCode } from "../src/codegen/emit.ts";
import type { DesignSpec, DeepKind, DeepSpec, FusionSpec } from "../src/types.ts";
import type { Field } from "../src/topology/fields.ts";

const L = 20; // envelope edge (mm), every design
const RES = Number(process.argv[2] ?? 192);       // grid cells along the 20 mm box (0.104 mm voxels)
const RES_CONV = Math.round(RES * 1.25);           // convergence grid
const SHOT = 1600; // screenshot edge (px), as in render_coupled.ts
const SS = 2;      // supersampling factor, box-filtered down to SHOT
const MC_SAMPLES = 200000;
const OUT = process.env.GALLERY_OUT ?? "examples/structure_gallery";
const ONLY = process.argv.slice(3);

type Group = "lattice" | "tpms" | "bio" | "fusion" | "coupled" | "deep";
interface Entry {
  id: string;
  group: Group;
  title: string;
  prompt: string;
  make: () => DesignSpec;
  /** Designed wall (strut diameter or TPMS sheet thickness), mm, for the wall check. */
  nominalWall?: number;
  /** TPMS period (mm), for the periodicity check. */
  period?: number;
}

/** A spec from the IntentHarness for a prompt, with the envelope and resolution fixed. */
function mk(prompt: string, resolution = RES): DesignSpec {
  const s = structuredClone(parseIntent(prompt).data);
  s.constraints.size_mm = L;
  s.constraints.resolution = resolution;
  return s;
}

/** Deep fusion: one field with the structures coupled inside it (see src/topology/deep.ts). */
function deepSpec(kind: DeepKind, extra: Partial<DeepSpec> = {}): DesignSpec {
  const s = mk(`deep fusion ${kind}`);
  s.topology = "deep";
  s.family = "deep";
  s.variant = kind;
  s.bio_motif = `deep:${kind}`;
  s.parameters = {};
  s.fusion = undefined;
  s.deep = { kind, skin_mm: 0, ...extra };
  return s;
}

// No closed envelope skin: periodic structures stay open at the box faces (user request). The clipped
// core is checked as one connected solid (single_solid) at the resolutions in the gallery.
const SKIN = Number(process.env.GALLERY_SKIN_MM ?? 0); // mm; default 0 (open). GALLERY_SKIN_MM=1 reproduces the earlier closed-skin records (96 and 192 sets) with the current mesher

/** Raw periodic core, cut by the envelope; the skin is added by the fusion step in latticeSpec / tpmsSpec. */
function rawLattice(type: string, cell: number, r: number): DesignSpec {
  const s = mk(`${type} lattice`);
  s.parameters = { ...s.parameters, cell_size_mm: cell, strut_radius_mm: r };
  return s;
}

function latticeSpec(type: string, cell: number, r: number): DesignSpec {
  if (!SKIN) return rawLattice(type, cell, r);
  return fusionSpec("union", rawLattice(type, cell, r), undefined, SKIN);
}

function rawTpms(type: string, cell: number, t: number): DesignSpec {
  const s = mk(`${type} TPMS`);
  s.parameters = { ...s.parameters, cell_size_mm: cell, wall_thickness_mm: t };
  return s;
}

function tpmsSpec(type: string, cell: number, t: number): DesignSpec {
  if (!SKIN) return rawTpms(type, cell, t);
  return fusionSpec("union", rawTpms(type, cell, t), undefined, SKIN);
}

function bioSpec(prompt: string): DesignSpec {
  return mk(prompt);
}

function fusionSpec(mode: FusionSpec["mode"], a: DesignSpec, b: DesignSpec | undefined, skin?: number, overlap?: number): DesignSpec {
  const s = mk(`fusion ${mode}`);
  s.topology = "fusion";
  s.family = "fusion";
  s.variant = mode;
  s.bio_motif = `fusion:${mode}`;
  s.parameters = {};
  s.fusion = { mode, a, ...(b ? { b } : {}), ...(skin ? { skin_mm: skin } : {}), ...(overlap ? { overlap_mm: overlap } : {}) };
  return s;
}

const LAT_CELL = 4;
const LAT_R = 0.4;
const TPMS_CELL = 5;
const TPMS_T = 0.5;

const BASE_ENTRIES: Entry[] = [
  // ---- periodic strut lattices ------------------------------------------------------------
  { id: "lattice_sc", group: "lattice", title: "Simple cubic lattice", prompt: "simple cubic lattice, 4 mm cell, strut radius 0.4 mm", make: () => latticeSpec("simple cubic", LAT_CELL, LAT_R), nominalWall: 2 * LAT_R },
  { id: "lattice_bcc", group: "lattice", title: "BCC lattice", prompt: "BCC lattice, 4 mm cell, strut radius 0.4 mm", make: () => latticeSpec("bcc", LAT_CELL, LAT_R), nominalWall: 2 * LAT_R },
  { id: "lattice_fcc", group: "lattice", title: "FCC (octet-truss) lattice", prompt: "FCC lattice, 4 mm cell, strut radius 0.4 mm", make: () => latticeSpec("fcc", LAT_CELL, LAT_R), nominalWall: 2 * LAT_R },
  { id: "lattice_fbcc", group: "lattice", title: "FBCC lattice (BCC + FCC + vertical)", prompt: "FBCC lattice, 4 mm cell, strut radius 0.4 mm", make: () => latticeSpec("fbcc", LAT_CELL, LAT_R), nominalWall: 2 * LAT_R },
  { id: "lattice_diamond", group: "lattice", title: "Diamond lattice", prompt: "diamond lattice, 4 mm cell, strut radius 0.4 mm", make: () => latticeSpec("diamond", LAT_CELL, LAT_R), nominalWall: 2 * LAT_R },
  { id: "lattice_bccz", group: "lattice", title: "BCCZ lattice (BCC + vertical edges)", prompt: "bccz lattice, 4 mm cell, strut radius 0.4 mm", make: () => latticeSpec("bccz", LAT_CELL, LAT_R), nominalWall: 2 * LAT_R },
  { id: "lattice_kelvin", group: "lattice", title: "Kelvin foam lattice (truncated octahedra)", prompt: "kelvin lattice, 4 mm cell, strut radius 0.4 mm", make: () => latticeSpec("kelvin", LAT_CELL, LAT_R), nominalWall: 2 * LAT_R },

  // ---- triply periodic minimal surfaces (sheets) ------------------------------------------
  { id: "tpms_gyroid", group: "tpms", title: "Gyroid", prompt: "gyroid TPMS, 5 mm cell, wall 0.5 mm", make: () => tpmsSpec("gyroid", TPMS_CELL, TPMS_T), nominalWall: TPMS_T, period: TPMS_CELL },
  { id: "tpms_schwarz_p", group: "tpms", title: "Schwarz P (primitive)", prompt: "schwarz P TPMS, 5 mm cell, wall 0.5 mm", make: () => tpmsSpec("schwarz P", TPMS_CELL, TPMS_T), nominalWall: TPMS_T, period: TPMS_CELL },
  { id: "tpms_schwarz_d", group: "tpms", title: "Schwarz D (diamond surface)", prompt: "schwarz D TPMS, 5 mm cell, wall 0.5 mm", make: () => tpmsSpec("schwarz D", TPMS_CELL, TPMS_T), nominalWall: TPMS_T, period: TPMS_CELL },
  { id: "tpms_neovius", group: "tpms", title: "Neovius", prompt: "neovius TPMS, 5 mm cell, wall 0.5 mm", make: () => tpmsSpec("neovius", TPMS_CELL, TPMS_T), nominalWall: TPMS_T, period: TPMS_CELL },
  { id: "tpms_iwp", group: "tpms", title: "I-WP (wrapped package)", prompt: "iwp TPMS, 5 mm cell, wall 0.5 mm", make: () => tpmsSpec("iwp", TPMS_CELL, TPMS_T), nominalWall: TPMS_T, period: TPMS_CELL },
  { id: "tpms_lidinoid", group: "tpms", title: "Lidinoid", prompt: "lidinoid TPMS, 5 mm cell, wall 0.5 mm", make: () => tpmsSpec("lidinoid", TPMS_CELL, TPMS_T), nominalWall: TPMS_T, period: TPMS_CELL },
  { id: "tpms_fischer_koch_s", group: "tpms", title: "Fischer-Koch S", prompt: "fischer_koch_s TPMS, 5 mm cell, wall 0.5 mm", make: () => tpmsSpec("fischer_koch_s", TPMS_CELL, TPMS_T), nominalWall: TPMS_T, period: TPMS_CELL },
  { id: "tpms_split_p", group: "tpms", title: "Split P (Schoen)", prompt: "split_p TPMS, 5 mm cell, wall 0.5 mm", make: () => tpmsSpec("split_p", TPMS_CELL, TPMS_T), nominalWall: TPMS_T, period: TPMS_CELL },

  // ---- bioinspired base structures (Bioinspired123D families, all 12) ---------------------
  { id: "bio_helical_generic", group: "bio", title: "Helical plies (Bouligand)", prompt: "stacked helical plate structure with 10 plies, 10 degrees", make: () => bioSpec("stacked helical plate structure with 10 plies, 10 degrees") },
  { id: "bio_helical_rectfibers", group: "bio", title: "Helical rectangular fibres", prompt: "helical rectangular fibers plies", make: () => bioSpec("helical rectangular fibers plies") },
  { id: "bio_helical_cylinfibers", group: "bio", title: "Helical cylindrical fibres", prompt: "helical cylindrical fibers", make: () => bioSpec("helical cylindrical fibers") },
  { id: "bio_helical_noise", group: "bio", title: "Helical plies with rotation noise", prompt: "helical noise irregular rotation", make: () => bioSpec("helical noise irregular rotation") },
  { id: "bio_cellular_generic", group: "bio", title: "Cellular foam (Voronoi)", prompt: "cellular foam voronoi", make: () => bioSpec("cellular foam voronoi") },
  { id: "bio_cellular_voronoi", group: "bio", title: "Cellular Voronoi, smoothed", prompt: "cellular voronoi smooth rounded", make: () => bioSpec("cellular voronoi smooth rounded") },
  { id: "bio_cellular_sandwich", group: "bio", title: "Cellular sandwich", prompt: "cellular sandwich skin slab", make: () => bioSpec("cellular sandwich skin slab") },
  { id: "bio_cellular_vorosand", group: "bio", title: "Cellular Voronoi sandwich, smoothed", prompt: "cellular voronoi sandwich smooth", make: () => bioSpec("cellular voronoi sandwich smooth") },
  { id: "bio_tubular_generic", group: "bio", title: "Tubular (16 tubules)", prompt: "tubular structure with tubules", make: () => bioSpec("tubular structure with tubules") },
  { id: "bio_tubular_shapesize", group: "bio", title: "Tubular, elliptical section", prompt: "tubular ellipse shape size varying", make: () => bioSpec("tubular ellipse shape size varying") },
  { id: "bio_tubular_layers", group: "bio", title: "Tubular with cortical layers", prompt: "tubular cortical layers", make: () => bioSpec("tubular cortical layers") },
  { id: "bio_tubular_noise", group: "bio", title: "Tubular with random scatter", prompt: "tubular noise random", make: () => bioSpec("tubular noise random") },

  // ---- fusions of different structure types -----------------------------------------------
  {
    // Open partner (chosen by the user, 2026-10-18): the helical part was dense on its faces (fibre version 0.96-0.97),
    // so the gyroid is now united with a BCC lattice. The gyroid alone is open (0.259 on every face).
    // The previous helical version is kept in git history (commit 43cc9b2 and earlier).
    id: "fusion_gyroid_plus_bcc", group: "fusion", title: "Gyroid union BCC lattice",
    prompt: "fusion union: gyroid TPMS with BCC lattice",
    make: () => fusionSpec("union", rawTpms("gyroid", TPMS_CELL, TPMS_T), latticeSpec("bcc", LAT_CELL, LAT_R)),
  },
  {
    id: "fusion_schwarzp_to_gyroid", group: "fusion", title: "Schwarz P below, gyroid above (zoned at mid-height)",
    prompt: "fusion zoned: Schwarz P at the bottom, gyroid at the top",
    make: () => fusionSpec("zoned", rawTpms("schwarz P", TPMS_CELL, TPMS_T), rawTpms("gyroid", TPMS_CELL, TPMS_T), SKIN, 1.0),
  },
  {
    id: "fusion_kelvin_to_iwp", group: "fusion", title: "Kelvin lattice below, I-WP above (zoned), open (no skin)",
    prompt: "fusion zoned: Kelvin lattice below, I-WP above, open",
    make: () => fusionSpec("zoned", rawLattice("kelvin", LAT_CELL, LAT_R), rawTpms("iwp", TPMS_CELL, TPMS_T), SKIN, 1.0),
  },
  {
    id: "fusion_bcc_plus_voronoi", group: "fusion", title: "BCC lattice union Voronoi foam",
    prompt: "fusion union: BCC lattice with cellular Voronoi foam",
    make: () => fusionSpec("union", rawLattice("bcc", LAT_CELL, LAT_R), bioSpec("cellular voronoi smooth rounded"), SKIN),
  },
  {
    id: "fusion_helical_cap_iwp", group: "fusion", title: "Helical plies intersected with I-WP",
    prompt: "fusion intersect: helical plies with I-WP",
    make: () => fusionSpec("intersect", bioSpec("stacked helical plate structure with 10 plies, 10 degrees"), rawTpms("iwp", TPMS_CELL, TPMS_T)),
  },
  {
    id: "fusion_diamond_plus_lidinoid", group: "fusion", title: "Diamond lattice union Lidinoid, open (no skin)",
    prompt: "fusion union: diamond lattice with lidinoid TPMS, open",
    make: () => fusionSpec("union", rawLattice("diamond", LAT_CELL, LAT_R), rawTpms("lidinoid", TPMS_CELL, TPMS_T), SKIN),
  },
];

// ---- deep coupling (five rounds, src/topology/coupled.ts) -------------------------------------------
function coupledSpec(round: "R1" | "R2" | "R3" | "R4" | "R5", params: Record<string, number | string> = {}): DesignSpec {
  const s = mk(`coupled ${round}`);
  s.topology = "coupled";
  s.family = "coupled";
  s.variant = round;
  s.bio_motif = `coupled:${round}`;
  s.parameters = {};
  s.coupled = { round, params: { skin_mm: 0, ...params } };
  s.fusion = undefined;
  s.unknowns = [];
  return s;
}

const COUPLED_ENTRIES: Entry[] = [
  { id: "deep_R1_thickness", group: "coupled", title: "R1 thickness: gyroid wall set by a cellular foam field", prompt: "coupled R1: gyroid thickness driven by cellular foam", make: () => coupledSpec("R1") },
  { id: "deep_R2_nested", group: "coupled", title: "R2 nested: Kelvin lattice grown inside tubular pores", prompt: "coupled R2: kelvin lattice nested in tubular pores", make: () => coupledSpec("R2") },
  { id: "deep_R3_twist", group: "coupled", title: "R3 twist: BCC lattice twisted by a helical angle", prompt: "coupled R3: bcc lattice twisted helically", make: () => coupledSpec("R3") },
  { id: "deep_R4_blend", group: "coupled", title: "R4 blend: Kelvin, gyroid and I-WP joined by smooth minima", prompt: "coupled R4: three-zone smooth blend", make: () => coupledSpec("R4") },
  { id: "deep_R5_hierarchy", group: "coupled", title: "R5 hierarchy: gyroid infill in every foam pocket", prompt: "coupled R5: gyroid infill in cellular foam pockets", make: () => coupledSpec("R5") },
];

const DEEP_ENTRIES: Entry[] = [
  // ---- deep fusion (src/topology/deep.ts): structures coupled inside one field, one coupling per round ----
  {
    id: "fieldfuse_r1_channel_lattice", group: "deep", title: "R1 BCC lattice nested inside four macro channels",
    prompt: "deep fusion channel lattice: BCC lattice inside four tubular channels",
    make: () => deepSpec("channel_lattice"),
  },
  {
    id: "fieldfuse_r2_ply_tpms", group: "deep", title: "R2 helical plies: gyroid orientation follows the ply angle",
    prompt: "deep fusion ply tpms: gyroid sheets twisted 18 deg per ply",
    make: () => deepSpec("ply_tpms", { plies: 10, twist_deg: 18, wall_mm: 1.1 }),
  },
  {
    id: "fieldfuse_r3_graded_tpms", group: "deep", title: "R3 gyroid whose wall thickness is driven by Voronoi cells",
    prompt: "deep fusion graded tpms: gyroid thickness from Voronoi cell geometry",
    make: () => deepSpec("graded_tpms", { seeds: 4, t_min_mm: 0.6, t_max_mm: 1.0 }),
  },
  {
    id: "fieldfuse_r4_foam_lattice", group: "deep", title: "R4 hierarchical foam: Voronoi walls with a BCC lattice in every cell",
    prompt: "deep fusion hierarchical foam: Voronoi walls with BCC lattice inside each cell",
    make: () => deepSpec("foam_lattice", { seeds: 3, wall_mm: 0.8, lattice_cell_mm: 2.5, lattice_radius_mm: 0.25 }),
  },
  {
    id: "fieldfuse_r5_ply_graded_tpms", group: "deep", title: "R5 triple coupling: ply twist and Voronoi-graded thickness",
    prompt: "deep fusion triple: twisted helical plies of gyroid with Voronoi-graded thickness",
    make: () => deepSpec("ply_graded_tpms", { plies: 10, twist_deg: 18, seeds: 4, t_min_mm: 1.1, t_max_mm: 1.4 }),
  },
];

const ENTRIES: Entry[] = [...BASE_ENTRIES, ...COUPLED_ENTRIES, ...DEEP_ENTRIES];

// ---- numerics -----------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monte Carlo occupancy of a field (solid where the field is negative) on a fixed sample set. */
function occupancy(field: Field, pts: Float64Array): Uint8Array {
  const n = pts.length / 3;
  const occ = new Uint8Array(n);
  for (let i = 0; i < n; i++) occ[i] = field.eval(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]) < 0 ? 1 : 0;
  return occ;
}

function samplePoints(field: Field, n: number, seed: number): { pts: Float64Array; boxVol: number } {
  const rnd = mulberry32(seed);
  const b = field.bounds;
  const pts = new Float64Array(3 * n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) pts[3 * i + k] = b.min[k] + (b.max[k] - b.min[k]) * rnd();
  const boxVol = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  return { pts, boxVol };
}

function count(occ: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < occ.length; i++) c += occ[i];
  return c;
}

interface Check {
  name: string;
  pass: boolean;
  value: string;
  rule: string;
}

// ---- one entry ----------------------------------------------------------------------------------


/** Number of open (boundary) edges of a triangle mesh; 0 means watertight. Sort-based, memory-light. */
function openEdgeCount(indices: Uint32Array, vertexCount: number): number {
  const keys = new Float64Array(indices.length);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      const lo = Math.min(a, b), hi = Math.max(a, b);
      keys[t + k] = lo * vertexCount + hi;
    }
  }
  keys.sort();
  let open = 0;
  for (let i = 0; i < keys.length; ) {
    let j = i;
    while (j < keys.length && keys[j] === keys[i]) j++;
    if (j - i === 1) open++;
    i = j;
  }
  return open;
}

function parseCoupling(obs: string[]): Record<string, unknown> | null {
  const line = obs.find((o) => o.startsWith("Coupling metrics: "));
  if (!line) return null;
  return JSON.parse(line.slice("Coupling metrics: ".length, -1));
}

async function runEntry(e: Entry) {
  const t0 = Date.now();
  const dir = join(OUT, e.id);
  mkdirSync(dir, { recursive: true });

  const spec = e.make();
  const res = await runPipeline(e.prompt, { spec, resolution: RES, exportFiles: false });
  const conv = await runPipeline(e.prompt, { spec: e.make(), resolution: RES_CONV, exportFiles: false });
  const m = res.state.metrics;
  const vm = res.validation.metrics;
  const mc = conv.state.metrics;

  const checks: Check[] = [];
  const harnessOk = Object.fromEntries(Object.entries(res.reports).map(([k, r]) => [k, r.ok]));
  const allOk = Object.values(harnessOk).every(Boolean);
  checks.push({ name: "harnesses_ok", pass: allOk, value: Object.entries(harnessOk).filter(([, v]) => !v).map(([k]) => k).join(",") || "all", rule: "all harnesses ok" });
  checks.push({ name: "single_solid", pass: vm.components === 1, value: `${vm.components} component(s)`, rule: "one connected solid" });

  // Independent volume: Monte Carlo occupancy of the field vs the mesh volume.
  const field = buildTopology(res.finalSpec).data.field;
  const { pts, boxVol } = samplePoints(field, MC_SAMPLES, 12345);
  const occ = occupancy(field, pts);
  const volMc = (count(occ) / MC_SAMPLES) * boxVol;
  const mcErr = Math.abs(mc.volume - volMc) / Math.max(volMc, 1e-9);
  checks.push({ name: "volume_mc_agreement", pass: mcErr <= 0.05, value: `mesh at ${RES_CONV} ${mc.volume.toFixed(1)} vs MC ${volMc.toFixed(1)} mm3 (${(mcErr * 100).toFixed(2)} %)`, rule: "<= 5 % (finer mesh)" });

  // Deep fusion: coupling effect = fraction of solid sample points that change when the coupling is removed.
  let couplingPct: number | null = null;
  if (res.finalSpec.topology === "deep" && res.finalSpec.deep) {
    const naiveField = buildTopology({ ...res.finalSpec, deep: { ...res.finalSpec.deep, naive: true } }).data.field;
    const occN = occupancy(naiveField, pts);
    let diff = 0;
    let union = 0;
    for (let i = 0; i < occ.length; i++) {
      if (occ[i] | occN[i]) union++;
      if (occ[i] !== occN[i]) diff++;
    }
    couplingPct = (100 * diff) / Math.max(union, 1);
    checks.push({ name: "coupling_effect", pass: couplingPct >= 1, value: `${couplingPct.toFixed(2)} % of solid points change when the coupling is removed`, rule: ">= 1 % (non-trivial coupling)" });
  }

  // Resolution convergence: the same design at 1.5x resolution.
  const convErr = Math.abs(m.volume - mc.volume) / Math.max(mc.volume, 1e-9);
  const openEdges = openEdgeCount(res.meshForViewer.indices, res.meshForViewer.positions.length / 3);
  checks.push({ name: "watertight", pass: openEdges === 0, value: `${openEdges} open edges`, rule: "0 open edges" });
  checks.push({ name: "resolution_convergence", pass: convErr <= 0.05, value: `${RES} px-grid ${m.volume.toFixed(1)} vs ${RES_CONV} ${mc.volume.toFixed(1)} mm3 (${(convErr * 100).toFixed(2)} %)`, rule: "<= 5 %" });

  // Designed wall vs measured median wall (inward-ray chords).
  let wallErr: number | null = null;
  if (e.nominalWall) {
    wallErr = Math.abs(vm.min_wall_thickness_median - e.nominalWall) / e.nominalWall;
    checks.push({ name: "wall_matches_design", pass: wallErr <= 0.25, value: `median ${vm.min_wall_thickness_median.toFixed(3)} mm vs design ${e.nominalWall} mm (${(wallErr * 100).toFixed(1)} %)`, rule: "<= 25 %" });
  }

  // Periodicity of the implicit field: F(p + a e_i) = F(p) at interior points.
  if (e.period) {
    // The periodic core is checked (without the envelope skin, whose value is not periodic).
    const fz = res.finalSpec.fusion;
    const coreField = fz && !fz.b ? buildTopology(fz.a).data.field : field;
    const rnd = mulberry32(777);
    let worst = 0;
    const a = e.period;
    for (let i = 0; i < 2000; i++) {
      // margin 3 mm: the envelope term max(sheet, sdBox) must not be active at p or p + a
      const margin = 3;
      const p = [0, 0, 0].map(() => margin + (L - 2 * margin - a) * rnd());
      const f0 = coreField.eval(p[0], p[1], p[2]);
      for (let k = 0; k < 3; k++) {
        const q = [...p];
        q[k] += a;
        worst = Math.max(worst, Math.abs(coreField.eval(q[0], q[1], q[2]) - f0));
      }
    }
    checks.push({ name: "periodicity", pass: worst < 1e-6, value: `max |F(p+a)-F(p)| = ${worst.toExponential(2)} over 2000 interior points`, rule: "< 1e-6" });
  }

  // Fusion set identities on the same samples (exact for min / max of two fields).
  if (res.finalSpec.topology === "fusion" && res.finalSpec.fusion) {
    const fz = res.finalSpec.fusion;
    if (!fz.skin_mm && fz.b) {
      const fa = buildTopology(fz.a).data.field;
      const fb = buildTopology(fz.b).data.field;
      const oa = count(occupancy(fa, pts));
      const ob = count(occupancy(fb, pts));
      const ou = count(occ);
      if (fz.mode === "union") {
        const ok = ou >= Math.max(oa, ob) && ou <= oa + ob;
        checks.push({ name: "fusion_union_identity", pass: ok, value: `|A|=${oa} |B|=${ob} |A∪B|=${ou} (samples)`, rule: "max(|A|,|B|) <= |A∪B| <= |A|+|B|" });
      } else if (fz.mode === "intersect") {
        const ok = ou <= Math.min(oa, ob) && ou > 0;
        checks.push({ name: "fusion_intersect_identity", pass: ok, value: `|A|=${oa} |B|=${ob} |A∩B|=${ou} (samples)`, rule: "0 < |A∩B| <= min(|A|,|B|)" });
      } else {
        const ok = ou > 0 && ou < pts.length / 3;
        checks.push({ name: "fusion_zoned_nonempty", pass: ok, value: `|zoned|=${ou} of ${pts.length / 3} samples`, rule: "0 < |zoned| < box" });
      }
    }
    if (fz.skin_mm) {
      const fa = buildTopology(fz.a).data.field;
      const oa = count(occupancy(fa, pts));
      const coreAndSkin = fz.b ? null : oa;
      // the skin only adds solid: |core + skin| >= |core|
      const ok = count(occ) >= (coreAndSkin ?? 0);
      checks.push({ name: "skin_attached", pass: ok && vm.components === 1, value: `|result| ${count(occ)} >= |core| ${oa} (samples); components ${vm.components}`, rule: "result ⊇ core and one solid" });
    }
  }

  // The emitted design.ts must run on its own.
  const code = emitParametricCode(res.finalSpec, e.prompt, "../../../src/evaluate.ts");
  const codePath = join(dir, "design.ts");
  writeFileSync(codePath, code);
  const run = spawnSync("node", ["--experimental-strip-types", "--no-warnings", codePath], { encoding: "utf8", timeout: 600000 });
  checks.push({ name: "design_ts_runs", pass: run.status === 0, value: run.status === 0 ? "exit 0" : `exit ${run.status}: ${(run.stderr || "").split("\n").slice(0, 2).join(" ")}`, rule: "node design.ts exits 0" });

  // High-resolution screenshot of the generated mesh (CPU rasteriser, Lambert shading).
  const shoot = (mesh: never, file: string, view: [number, number] = [0.61, 0.44]) => {
    const big = rasterisePreview(mesh, SHOT * SS, view);
    const out = new Uint8Array(SHOT * SHOT * 4);
    for (let y = 0; y < SHOT; y++)
      for (let x = 0; x < SHOT; x++)
        for (let c = 0; c < 4; c++) {
          let acc = 0;
          for (let dy = 0; dy < SS; dy++)
            for (let dx = 0; dx < SS; dx++) acc += big.rgba[(((y * SS + dy) * SHOT * SS) + (x * SS + dx)) * 4 + c];
          out[(y * SHOT + x) * 4 + c] = Math.round(acc / (SS * SS));
        }
    writeFileSync(join(dir, file), encodePngCompressed(SHOT, SHOT, out));
  };
  // Cut-away views (near half removed, so the internal structure is visible): screenshot.png is the
  // isometric view; view_top / view_front / view_side are axis-aligned. No closed exterior image.
  for (const [name, view] of Object.entries(VIEWS)) {
    const file = name === "iso" ? "screenshot.png" : `view_${name}.png`;
    shoot(cutAway(res.meshForViewer as never, view) as never, file, view);
  }
  rmSync(join(dir, "screenshot_exterior.png"), { force: true });

  const passed = checks.every((c) => c.pass);
  const record = {
    id: e.id,
    group: e.group,
    title: e.title,
    prompt: e.prompt,
    pass: passed,
    checks,
    topology: res.finalSpec.topology,
    variant: res.finalSpec.variant,
    grid: { resolution: RES, resolution_convergence: RES_CONV },
    metrics: {
      volume_mm3: +m.volume.toFixed(3),
      volume_mc_mm3: +volMc.toFixed(3),
      surface_area_mm2: +m.surface_area.toFixed(3),
      volume_fraction: +vm.volume_fraction.toFixed(5),
      porosity: +vm.porosity.toFixed(5),
      components: vm.components,
      cavities: vm.cavities,
      genus_handles: vm.genus,
      euler_characteristic: vm.euler_characteristic,
      min_wall_p5_mm: +vm.min_wall_thickness.toFixed(4),
      min_wall_median_mm: +vm.min_wall_thickness_median.toFixed(4),
      min_wall_excluded_near_faces: vm.min_wall_excluded_near_faces ?? null,
      triangles: vm.triangles,
      center_of_mass: vm.center_of_mass.map((v) => +v.toFixed(4)),
    },
    coupling_metrics: parseCoupling(res.reports.TopologyHarness?.observations ?? []),
    harness_ok: harnessOk,
    repair_history: res.state.repair_history,
    limitations: res.state.limitations,
    unknowns: res.state.unknowns,
    design_spec: res.finalSpec,
    timing_s: +((Date.now() - t0) / 1000).toFixed(1),
  };
  writeFileSync(join(dir, "design.json"), JSON.stringify({ prompt: e.prompt, design_spec: res.finalSpec, metrics: m, render_preview: null, repair_history: res.state.repair_history, limitations: res.state.limitations, unknowns: res.state.unknowns, validation: record }, null, 2));
  return record;
}


// ---- main ---------------------------------------------------------------------------------------

const selected = ONLY.length ? ENTRIES.filter((e) => ONLY.includes(e.id)) : ENTRIES;
mkdirSync(OUT, { recursive: true });
const results: unknown[] = [];
for (const e of selected) {
  try {
    const r = (await runEntry(e)) as { pass: boolean; id: string; checks: Check[]; timing_s: number; metrics: { volume_mm3: number; components: number } };
    results.push(r);
    const failed = r.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.value}`);
    console.log(`${r.pass ? "PASS" : "FAIL"} ${e.id} | V ${r.metrics.volume_mm3} mm3 | comps ${r.metrics.components} | ${r.timing_s} s${failed.length ? " | " + failed.join(" ; ") : ""}`);
  } catch (err) {
    console.log(`ERROR ${e.id}: ${(err as Error).message}`);
    results.push({ id: e.id, pass: false, error: (err as Error).message });
  }
}
// Merge with the existing record so a partial run (ids given on the command line) keeps the other entries.
const jsonPath = join(OUT, "gallery.json");
const previous: { id: string }[] = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")) : [];
const byId = new Map<string, unknown>(previous.map((r) => [r.id, r]));
for (const r of results) byId.set((r as { id: string }).id, r);
const merged = ENTRIES.map((e) => byId.get(e.id)).filter((r) => r !== undefined);
writeFileSync(jsonPath, JSON.stringify(merged, null, 2));
console.log(`GALLERY_DONE ${results.filter((r) => (r as { pass: boolean }).pass).length}/${results.length} pass`);
