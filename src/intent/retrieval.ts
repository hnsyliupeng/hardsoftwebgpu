// Local retrieval over the bioinspired base catalog (replaces the upstream bge-small embedding
// RAG with a deterministic keyword / IDF scorer, so the pipeline needs no model download).

import { BIO_CATALOG, type BaseEntry } from "../bio/catalog.ts";
import type { RetrievalHit } from "../types.ts";

const STOP = new Set(["a", "an", "the", "of", "and", "to", "with", "in", "make", "write", "blender", "code", "script", "structure", "model", "by", "for", "is", "it", "its"]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Smoothed IDF over catalog documents (keywords + description). */
const DOCS = BIO_CATALOG.map((e) => new Set([...e.keywords.flatMap((k) => tokens(k)), ...tokens(e.description)]));
const DF = new Map<string, number>();
for (const d of DOCS) for (const t of d) DF.set(t, (DF.get(t) ?? 0) + 1);
const N_DOCS = BIO_CATALOG.length;
const idf = (t: string) => Math.log(1 + N_DOCS / (DF.get(t) ?? 1));

/** Score catalog entries against a prompt. Keyword substrings count fully, shared tokens by IDF. */
export function retrieve(prompt: string, category?: BaseEntry["category"]): RetrievalHit[] {
  const lower = prompt.toLowerCase();
  const qTokens = new Set(tokens(prompt));
  const hits: RetrievalHit[] = [];
  for (const e of BIO_CATALOG) {
    if (category && e.category !== category) continue;
    let score = 0;
    for (const k of e.keywords) {
      if (k.length > 1 && lower.includes(k.toLowerCase())) score += 1 + Math.log(1 + k.length) * 0.1;
    }
    for (const t of qTokens) if (DOCS[BIO_CATALOG.indexOf(e)].has(t)) score += idf(t) * 0.5;
    hits.push({ id: e.id, score: Math.round(score * 1000) / 1000 });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
