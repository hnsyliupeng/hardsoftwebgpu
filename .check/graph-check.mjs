/**
 * Fetch the app the way a browser does: start at /, follow every module import
 * recursively over HTTP, and fail on any non-200 or wrong MIME type. A missing
 * module is the one failure mode that leaves a page blank without a server error.
 */
const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:5173';
const seen = new Map();
const bad = [];
const isModule = (p) => /\.m?js$/.test(p);

async function load(url, from) {
  if (seen.has(url)) return seen.get(url);
  seen.set(url, 'pending');
  const res = await fetch(url);
  const type = res.headers.get('content-type') ?? '';
  const body = res.ok ? await res.text() : '';
  seen.set(url, res.status);
  const want = isModule(new URL(url).pathname) ? /javascript/ : null;
  if (!res.ok) bad.push(`${res.status} ${url}${from ? ` (imported by ${from})` : ''}`);
  else if (want && !want.test(type)) bad.push(`wrong MIME ${type} for ${url}`);
  if (!res.ok) return;
  const specs = new Set();
  if (/\.html?$/.test(new URL(url).pathname)) {
    for (const m of body.matchAll(/<script[^>]+type="module"[^>]*>([\s\S]*?)<\/script>/g)) {
      for (const s of m[1].matchAll(/from\s+['"]([^'"]+)['"]/g)) specs.add(s[1]);
      for (const s of m[1].matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(s[1]);
    }
    for (const m of body.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) specs.add(m[1]);
  } else {
    for (const s of body.matchAll(/(?:^|[\s;{(])(?:import|export)[\s\S]{0,120}?from\s*['"]([^'"]+)['"]/g)) specs.add(s[1]);
    for (const s of body.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(s[1]);
    for (const s of body.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.add(s[1]);
  }
  for (const spec of specs) {
    if (/^https?:/.test(spec)) { bad.push(`external import ${spec} in ${url}`); continue; }
    await load(new URL(spec, url).href, url);
  }
}

const rootRes = await fetch(`${ORIGIN}/`);
const html = await rootRes.text();
console.log(`index.html ${rootRes.status} · ${html.length} B · title ${/<title>([^<]*)/.exec(html)?.[1] ?? '(none)'}`);
await load(`${ORIGIN}/`, 'browser');
const mods = [...seen.entries()].filter(([u]) => isModule(new URL(u).pathname));
console.log(`modules fetched: ${mods.length} · non-JS assets resolved: ${seen.size - mods.length}`);
for (const [u, st] of mods) console.log(`  ${String(st).padStart(3)}  ${u.replace(ORIGIN, '')}`);
console.log(bad.length ? `FAILURES:\n  ${bad.join('\n  ')}` : 'module graph OK — every import resolves with a JS MIME type');
process.exitCode = bad.length ? 1 : 0;
