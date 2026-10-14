// Compare the TypeScript intent router and bio catalogue with the upstream Bioinspired123D benchmark.
//
//   node --experimental-strip-types --no-warnings scripts/compare_bioinspired.ts <Bioinspired123D checkout> [out.json]
//
// Reads eval/benchmark.csv (320 prompts, labelled category/subcategory) and data/raw/biodataset_basecodes.csv
// (base codes). Reports: (1) base-code coverage, (2) family routing accuracy on single-family prompts,
// (3) how cross-domain and general prompts are routed. Output is written as JSON (default: docs/bioinspired_comparison.json).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseIntent } from "../src/intent/intent.ts";
import { BIO_CATALOG } from "../src/bio/catalog.ts";

const root = process.argv[2];
if (!root) throw new Error("usage: compare_bioinspired.ts <Bioinspired123D checkout> [out.json]");
const outPath = process.argv[3] ?? join(dirname(new URL(import.meta.url).pathname), "..", "docs", "bioinspired_comparison.json");

// Minimal CSV parser: handles quoted fields with commas, quotes and newlines.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ""])));
}

const bench = parseCsv(readFileSync(join(root, "eval/benchmark.csv"), "utf8"));
const base = parseCsv(readFileSync(join(root, "data/raw/biodataset_basecodes.csv"), "utf8"));

// (1) base-code coverage
const upstreamIds = [...new Set(base.map((r) => r.ID))].sort();
const ours = new Set(BIO_CATALOG.map((b) => b.id));
const coverage = {
  upstream: upstreamIds.length,
  implemented: upstreamIds.filter((id) => ours.has(id)).length,
  missing: upstreamIds.filter((id) => !ours.has(id)),
  extra: [...ours].filter((id) => !upstreamIds.includes(id)),
};

// (2)-(3) routing
const FAMILY_OF: Record<string, string> = { bio_helical: "helical", bio_cellular: "cellular", bio_tubular: "tubular" };
const single: { expected: string; predicted: string; variant: string; prompt: string }[] = [];
const cross: { subcategory: string; predicted: string; variant: string; topology: string; prompt: string }[] = [];
const general: { subcategory: string; predicted: string; topology: string; confidence: number; flagged: boolean; prompt: string }[] = [];
for (const r of bench) {
  const res = parseIntent(r.prompt);
  const d: any = res.data;
  const family: string = d.family ?? "";
  const variant: string = d.variant ?? "";
  if (r.subcategory in FAMILY_OF) {
    single.push({ expected: FAMILY_OF[r.subcategory], predicted: family, variant, prompt: r.prompt });
  } else if (r.subcategory === "general" || r.subcategory === "general_bio" || r.category.startsWith("general")) {
    // A prompt with no bio/lattice/TPMS cue is not a failure of routing if the router flags it as unrecognised.
    const flagged = (d.unknowns ?? []).some((u: string) => u.startsWith("No topology keyword recognised"));
    general.push({ subcategory: r.subcategory, predicted: family, topology: d.topology, confidence: d.confidence, flagged, prompt: r.prompt });
  } else {
    cross.push({ subcategory: r.subcategory, predicted: family, variant, topology: d.topology, prompt: r.prompt });
  }
}

const correct = single.filter((s) => s.expected === s.predicted).length;
const perFamily: Record<string, { n: number; correct: number }> = {};
for (const s of single) {
  const f = (perFamily[s.expected] ??= { n: 0, correct: 0 });
  f.n++; if (s.expected === s.predicted) f.correct++;
}
const wrong = single.filter((s) => s.expected !== s.predicted).slice(0, 12);
const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

const report = {
  source: "lamm-mit/Bioinspired123D (eval/benchmark.csv, data/raw/biodataset_basecodes.csv)",
  coverage,
  single_family: {
    n: single.length,
    family_accuracy: +(correct / single.length).toFixed(4),
    per_family: Object.fromEntries(Object.entries(perFamily).map(([k, v]) => [k, { ...v, accuracy: +(v.correct / v.n).toFixed(4) }])),
    first_mismatches: wrong,
  },
  cross_domain: { n: cross.length, predicted_family_counts: count(cross.map((c) => c.predicted || "(none)")), topology_counts: count(cross.map((c) => c.topology)), by_subcategory: count(cross.map((c) => c.subcategory)) },
  general: {
    n: general.length,
    flagged_unrecognised: general.filter((g) => g.flagged).length,
    max_confidence: Math.max(...general.map((g) => g.confidence)),
    predicted_family_counts: count(general.map((g) => g.predicted || "(none)")),
  },
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ coverage: { upstream: coverage.upstream, implemented: coverage.implemented, missing: coverage.missing }, single_family: { n: single.length, accuracy: report.single_family.family_accuracy, per_family: report.single_family.per_family }, cross_domain_n: cross.length, general_n: general.length }, null, 2));
