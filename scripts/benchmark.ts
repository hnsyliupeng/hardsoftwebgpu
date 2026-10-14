// IntentHarness benchmark over the Bioinspired123D evaluation prompts (eval/benchmark.csv, 320 rows).
// Scoring is structural (does the parsed DesignSpec name the expected bio family / topology), not
// a geometry-quality score. Usage: node --experimental-strip-types scripts/benchmark.ts [limit]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseIntent } from "../src/intent/intent.ts";

const text = readFileSync("eval/benchmark.csv", "utf8").replace(/^\uFEFF/, "");
const rows = parseCsv(text);
const limit = process.argv[2] ? Number(process.argv[2]) : rows.length;

const expectedFamily: Record<string, string[]> = {
  bio_helical: ["helical"],
  bio_tubular: ["tubular"],
  bio_cellular: ["cellular"],
  bio_cellularxtubular: ["cellular", "tubular"],
  bio_helicalxcellular: ["helical", "cellular"],
  bio_helicalxtubular: ["helical", "tubular"],
  bio_all: ["helical", "cellular", "tubular"],
  general: [],
};

const per: Record<string, { n: number; hit: number; unknown: number }> = {};
const records: unknown[] = [];
let totalMs = 0;
let hits = 0;
let scored = 0;
const topoCount: Record<string, number> = {};
for (const row of rows.slice(0, limit)) {
  const sub = row.subcategory;
  const exp = expectedFamily[sub] ?? [];
  const t0 = performance.now();
  const res = parseIntent(row.prompt);
  totalMs += performance.now() - t0;
  const spec = res.data;
  topoCount[spec.topology] = (topoCount[spec.topology] ?? 0) + 1;
  const fam = spec.bio_motif ? spec.bio_motif.split("_")[0] : "";
  const detected = fam === "helical" || fam === "tubular" || fam === "cellular" ? [fam] : [];
  // For the primary-family score: single-family rows need the detected family to match;
  // mixed rows count a hit when any expected family is detected; general rows need no bio family.
  const matchedFamilies = res.evidence && (res.evidence as any).matched_families ? ((res.evidence as any).matched_families as string[]) : detected;
  let ok: boolean;
  // General (non-bio) prompts are out of scope: they count as handled when they are flagged as
  // low-confidence retrieval guesses (confidence < 0.5) instead of being silently treated as bio.
  if (exp.length === 0) ok = matchedFamilies.length === 0 && spec.confidence < 0.5;
  else if (exp.length === 1) ok = matchedFamilies[0] === exp[0];
  else ok = exp.some((f) => matchedFamilies.includes(f));
  const p = (per[sub] ??= { n: 0, hit: 0, unknown: 0 });
  p.n++;
  if (ok) p.hit++;
  if (spec.unknowns.length) p.unknown++;
  if (exp.length || matchedFamilies.length) scored++;
  if (ok) hits++;
  records.push({
    filename: row.filename,
    subcategory: sub,
    expected: exp,
    detected_families: matchedFamilies,
    topology: spec.topology,
    bio_motif: spec.bio_motif,
    correct: ok,
    unknowns: spec.unknowns.length,
  });
}

const multiRows = records.filter((r: any) => r.expected.length > 1) as any[];
const multiFirstOnly = multiRows.filter((r) => r.detected_families.length < r.expected.length).length;
const summary = {
  prompts: Math.min(limit, rows.length),
  keyword_family_coverage: hits / Math.min(limit, rows.length),
  multi_family_rows: multiRows.length,
  multi_family_rows_generating_only_one_family: multiFirstOnly,
  rows_with_any_unknown: records.filter((r: any) => r.unknowns > 0).length,
  general_rows_flagged_low_confidence: records.filter((r: any) => r.subcategory === "general" && r.correct).length,
  per_subcategory: Object.fromEntries(
    Object.entries(per).map(([k, v]) => [k, { n: v.n, accuracy: +(v.hit / v.n).toFixed(3), prompts_with_unknowns: v.unknown }]),
  ),
  topology_distribution: topoCount,
  mean_parse_ms: +(totalMs / Math.min(limit, rows.length)).toFixed(3),
  scored_rows: scored,
  note: "Keyword-family coverage only. Expected labels come from the benchmark subcategory and the prompts name the family explicitly, so this is a consistency check of the rule set, NOT an independent accuracy. Multi-family prompts are scored as hits when any expected family is detected, but only the first family is generated. The paper's 0.60 is a different, LLM-based metric and is not comparable.",
};
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/benchmark_intent.json", JSON.stringify({ summary, records }, null, 2));
console.log(JSON.stringify(summary, null, 2));

function parseCsv(src: string): { prompt: string; filename: string; category: string; subcategory: string }[] {
  const out: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") out.push(row);
      row = [];
    } else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); out.push(row); }
  const [head, ...body] = out;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])) as any);
}
