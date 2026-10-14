// Minimal RFC-4180 CSV reader (quoted fields, embedded commas / newlines, BOM-tolerant header).

export function parseCsv(src: string): { prompt: string; filename: string; category: string; subcategory: string }[] {
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
