// Exports the unit-cell strut patterns of src/topology/lattice.ts (latticePattern) as JSON,
// so the exact OpenCASCADE builder (python/exact/build_lattice.py) uses the same geometry as the field.
// Usage: node --experimental-strip-types scripts/export_lattice_patterns.ts > python/exact/patterns.json
import { latticePattern } from "../src/topology/lattice.ts";
import type { LatticeType } from "../src/types.ts";

const TYPES: LatticeType[] = ["sc", "bcc", "fcc", "fbcc", "diamond", "kelvin", "bccz"];
const out: Record<string, number[][]> = {};
for (const t of TYPES) out[t] = latticePattern(t).map((s) => Array.from(s));
console.log(JSON.stringify(out));
