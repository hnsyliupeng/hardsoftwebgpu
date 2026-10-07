#!/usr/bin/env node
/**
 * tools/trunc-data.mjs — read the authors' own CSVs (TransformativeRoboticsLab/TRUNC)
 * and extract the *structural features* of the two TRUNC cells.
 *
 * The data files live in `data/trunc/` and are byte-for-byte copies of the
 * repository's characterisation data:
 *
 *   equatorial-bending.csv / truss-bending.csv   Instron bending-rotation   (Fig. 2 C/D)
 *   equatorial-torsion.csv / truss-torsion.csv   Instron torsion-rotation   (Fig. 2 C/D)
 *   equatorial-force.csv   / truss-force.csv     Instron force-displacement (Fig. 2 C/D)
 *   flex-shaft.csv                               printed flex-shaft stiffness vs strain (Fig. 3 B)
 *   equatorial-D28..112.csv / truss-D28..112.csv ANSYS design-space sweep  (Fig. S3)
 *
 * Units. The Instron files record torque in N·m and rotation in degrees
 * (`README.md` of the data repository: "Rotation: Angular displacement in
 * degrees", "Torque: Torque measured in N∙mm" — the column *values* are N·m:
 * the truss torsion curve ends at 0.474 N·m = 474 N·mm, which is the 450 N·mm
 * of Fig. 2 D, and the axial slopes reproduce Fig. 2 C/D exactly in N/mm).
 * The FEA files are already in N·mm.
 *
 * What comes out is the cell's *transmission*, i.e. the compliance pair that
 * makes a TRUNC a TRUNC: stiff in torsion (it passes rotation through), soft in
 * bending and extension (it gives way around it). The tool writes
 * `data/trunc-features.json` and the browser/node module `src/core/truncData.js`.
 *
 * Run:  node tools/trunc-data.mjs [--check]
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'data', 'trunc');
const CHECK = process.argv.includes('--check');

// ---------------------------------------------------------------- csv reading

function readCsv(name) {
  const text = readFileSync(join(DATA, name), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const header = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  // the ANSYS files quote material names that themselves contain commas
  // ("Carbon steel, 1095, hardened & tempered"), so this is a real CSV reader
  const rows = lines.slice(1).map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false; }
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
  return { header, rows };
}

const num = (s) => Number(s);

/** Least-squares slope + intercept of (x, y), restricted to |x| ≤ limit. */
function fit(rows, xCol, yCol, limit = Infinity, from = -Infinity) {
  const pts = rows
    .map((r) => [num(r[xCol]), num(r[yCol])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= limit && Math.abs(x) >= from);
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p[0], 0);
  const sy = pts.reduce((a, p) => a + p[1], 0);
  const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
  const den = n * sxx - sx * sx;
  const k = den ? (n * sxy - sx * sy) / den : 0;
  const b = n ? (sy - k * sx) / n : 0;
  const ybar = n ? sy / n : 0;
  const sst = pts.reduce((a, p) => a + (p[1] - ybar) ** 2, 0);
  const sse = pts.reduce((a, p) => a + (p[1] - (k * p[0] + b)) ** 2, 0);
  const r2 = sst ? 1 - sse / sst : 1;
  const xMax = pts.reduce((a, p) => Math.max(a, Math.abs(p[0])), 0);
  const yAt = (x) => k * x + b;
  return { k, b, r2, n, xMax, yMax: Math.abs(yAt(xMax)) };
}

// ---------------------------------------------------------------- per-cell fit

const CELLS = ['equatorial', 'truss'];

/** The rated ranges the paper quotes for each cell. */
const RATED = {
  equatorial: { bendDeg: 45, twistDeg: 65, stroke: 20 },
  truss: { bendDeg: 45, twistDeg: 65, stroke: 20 },
};

function cellFeatures(name) {
  // bending and torsion: the Instron sweeps down from zero, so use |x| and the
  // tangent at the origin — the loading branch. Torque N·m → N·mm (× 1000).
  const bendRows = readCsv(`${name}-bending.csv`).rows;
  const twistRows = readCsv(`${name}-torsion.csv`).rows;
  const forceRows = readCsv(`${name}-force.csv`).rows;

  const bendFit = fit(bendRows, 0, 1, 45);           // rotation (deg) → torque (N·m)
  const twistFit = fit(twistRows, 0, 1, 65);
  const axialFit = fit(forceRows, 0, 1, 20, 0);      // displacement (mm) → force (N)

  const kBend = Math.abs(bendFit.k) * 1000;          // N·mm per degree
  const kTwist = Math.abs(twistFit.k) * 1000;        // N·mm per degree
  const kAxial = Math.abs(axialFit.k);               // N per mm

  return {
    rated: RATED[name],
    bend: {
      k: kBend, kPerRad: kBend * (180 / Math.PI),
      r2: bendFit.r2, samples: bendFit.n, testedDeg: bendFit.xMax,
      momentAtTested: kBend * bendFit.xMax,           // N·mm
      momentAtRated: kBend * RATED[name].bendDeg,
    },
    twist: {
      k: kTwist, kPerRad: kTwist * (180 / Math.PI),
      r2: twistFit.r2, samples: twistFit.n, testedDeg: twistFit.xMax,
      momentAtTested: kTwist * twistFit.xMax,
      momentAtRated: kTwist * RATED[name].twistDeg,
    },
    axial: {
      k: kAxial, r2: axialFit.r2, samples: axialFit.n, testedMm: axialFit.xMax,
      forceAtTested: kAxial * axialFit.xMax,
    },
    twistBendRatio: kTwist / kBend,
  };
}

// -------------------------------------------------------------- FEA sweep (S3)

function feaTable() {
  const sizes = [28, 42, 56, 70, 84, 98, 112];
  const out = {};
  for (const name of ['equitorial', 'truss']) {
    const rows = [];
    for (const d of sizes) {
      let csv;
      try { csv = readCsv(`${name}-D${d}.csv`); } catch { continue; }
      for (const r of csv.rows) {
        const bend = num(r[2]);      // deg
        const twist = num(r[3]);     // deg
        const mB = num(r[4]);        // N·mm
        const mT = num(r[5]);        // N·mm
        if (!bend || !twist) continue;
        rows.push({
          d,
          material: r[1],
          kBend: mB / bend,
          kTwist: mT / twist,
          ratio: (mT / twist) / (mB / bend),
        });
      }
    }
    out[name === 'equitorial' ? 'equatorial' : name] = rows;
  }
  return out;
}

// ------------------------------------------------- flex shaft under extension

function flexShaft() {
  const { rows } = readCsv('flex-shaft.csv');
  const byStrain = new Map();
  for (const r of rows) {
    for (let t = 0; t < 3; t += 1) {
      const s = num(r[t * 2]);
      const k = num(r[t * 2 + 1]);
      if (!Number.isFinite(s) || !Number.isFinite(k)) continue;
      const key = s.toFixed(3);
      const e = byStrain.get(key) ?? { strain: s, k: 0, n: 0 };
      e.k += k; e.n += 1;
      byStrain.set(key, e);
    }
  }
  const curve = [...byStrain.values()].sort((a, b) => a.strain - b.strain).map((e) => ({ strain: e.strain, k: e.k / e.n }));
  const k0 = curve[0].k;
  const last = curve[curve.length - 1];
  return {
    curve,
    stiffnessAtRest: k0,
    stiffnessAtMaxStrain: last.k,
    strainAtMax: last.strain,
    retention: last.k / k0,
  };
}

// ------------------------------------------------------------------ assemble

const cells = Object.fromEntries(CELLS.map((c) => [c, cellFeatures(c)]));
const fea = feaTable();
const shaft = flexShaft();

// The two cells the arm is actually built from: truss D = 56 (bent on the 56 mm
// mould) and equatorial D = 88 (88 mm mould, Materials and Methods).
const inArm = {
  truss: { d: 56, ...fea.truss.find((r) => r.d === 56 && /1095/.test(r.material)) },
  equatorial: { d: 88, ...fea.equatorial.find((r) => r.d === 84 && /1095/.test(r.material)) },
};
if (!inArm.equatorial.ratio) {
  const near = fea.equatorial.filter((r) => /1095/.test(r.material)).sort((a, b) => Math.abs(a.d - 88) - Math.abs(b.d - 88));
  inArm.equatorial = { d: near[0].d, ...near[0], note: 'nearest simulated diameter (no D88 run)' };
}

const features = {
  source: 'TransformativeRoboticsLab/TRUNC — matlab/instron, matlab/ansys (data/trunc/*.csv)',
  cells,
  fea,
  flexShaft: shaft,
  inArm,
};

// ------------------------------------------------------------------- printing

const f = (x, n = 3) => (typeof x === 'number' ? x.toFixed(n) : String(x));
console.log('TRUNC cell structural features, from the authors\' CSVs');
console.log('=======================================================');
for (const c of CELLS) {
  const e = cells[c];
  console.log(`\n${c.toUpperCase()} cell (mould D = ${c === 'truss' ? 56 : 88} mm)`);
  console.log(`  bending   K = ${f(e.bend.k)} N·mm/°   (${f(e.bend.kPerRad, 1)} N·mm/rad)  r²=${f(e.bend.r2)}  tested to ${f(e.bend.testedDeg, 1)}°`);
  console.log(`  twisting  K = ${f(e.twist.k)} N·mm/°   (${f(e.twist.kPerRad, 1)} N·mm/rad)  r²=${f(e.twist.r2)}  tested to ${f(e.twist.testedDeg, 1)}°`);
  console.log(`  axial     K = ${f(e.axial.k, 4)} N/mm   r²=${f(e.axial.r2)}  tested to ${f(e.axial.testedMm, 1)} mm`);
  console.log(`  twist/bend ratio = ${f(e.twistBendRatio, 1)}   (paper: ${c === 'truss' ? 52 : 11})`);
}
console.log(`\nprinted flex shaft under extension: K ${f(shaft.stiffnessAtRest, 1)} → ${f(shaft.stiffnessAtMaxStrain, 1)} N/mm at strain ${f(shaft.strainAtMax, 2)} = ${f(shaft.retention * 100, 1)} % retained (paper: 83.6 %)`);
console.log('\nIn-arm cells (ANSYS, 1095 spring steel):');
for (const [k, v] of Object.entries(inArm)) {
  console.log(`  ${k.padEnd(11)} D=${v.d}  K_bend ${f(v.kBend)} N·mm/°  K_twist ${f(v.kTwist)} N·mm/°  ratio ${f(v.ratio, 1)}`);
}

// -------------------------------------------------------------------- output

const json = `${JSON.stringify(features, null, 2)}\n`;
if (!CHECK) {
  writeFileSync(join(ROOT, 'data', 'trunc-features.json'), json);
}

const module = `/**
 * truncData.js — GENERATED by \`node tools/trunc-data.mjs\`. Do not edit by hand.
 *
 * The two TRUNC cells' structural features, straight from the authors' data
 * (TransformativeRoboticsLab/TRUNC: \`matlab/instron\` measurements and the
 * \`matlab/ansys\` design-space sweep; the raw files are in \`data/trunc/\`).
 *
 * The pair that matters is \`bend.k\` against \`twist.k\`: a TRUNC passes rotation
 * through almost rigidly (twist) while giving way in bending and extension. The
 * app's joints use these measured numbers for their transmission, instead of an
 * invented stiffness.
 */
export const TRUNC_DATA = ${JSON.stringify(features, null, 2)};

/** The measured features of one cell kind: 'truss' | 'equatorial'. */
export const cellFeatures = (kind) => TRUNC_DATA.cells[kind === 'truss' ? 'truss' : 'equatorial'];

/**
 * Angular wind-up of a chain of \`n\` joints of this kind under \`torque\` (N·mm):
 * what the joint loses between commanded and transmitted rotation.
 */
export const windUpDeg = (kind, torque, n = 1) => torque * n / cellFeatures(kind).twist.k;

/** Kinematic constants of the arm's own model (matlab/training/kinematics.m). */
export const TRUNC_KINEMATICS = {
  length: 710,            // neutral arm length (mm), L_0
  toolLength: 83,         // wrist → tool (mm)
  cableRadius: 65,        // cable triangle radius (mm)
  segmentSplit: [3 / 7, 2 / 7, 2 / 7],
  cables: 9,
  activeJoints: 3,
  dof: 7,                 // six joint angles (Rx, Rz per stage) + one shared axial slide L
};

export default TRUNC_DATA;
`;

if (!CHECK) {
  writeFileSync(join(ROOT, 'src', 'core', 'truncData.js'), module);
  console.log('\nwrote data/trunc-features.json and src/core/truncData.js');
} else {
  console.log('\n--check: nothing written');
}
