/* ------------------------------------------------------------------------ *
 * Single-file build loader (inlined verbatim into hardsoftwebgpu.html).
 *
 * Modules are embedded as source text and handed to the browser's own ES-module
 * loader as blob URLs, so export/import semantics are untouched by any bundler
 * transform. Only three mechanical rewrites happen, listed in bundle.mjs.
 *
 * `__SOURCES__` and `__ASSETS__` are placeholder identifiers replaced with JSON
 * literals at build time.
 * ------------------------------------------------------------------------ */
(function () {
  window.__SRC = __SOURCES__;
  window.__ASSETS = __ASSETS__;

  const urls = new Map();

  const resolveId = (fromId, spec) => {
    if (spec.startsWith('/')) return spec.slice(1);
    const parts = fromId.split('/');
    parts.pop();
    for (const seg of spec.split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  };

  const rewrite = (id) => {
    let src = window.__SRC[id];
    if (src === undefined) throw new Error('bundle: missing module ' + id);
    // shader assets that the WebGPU path would otherwise fetch
    src = src.replace(
      /fetch\(new URL\('\.\/wgsl\/([A-Za-z0-9_.-]+)\.wgsl', import\.meta\.url\)\)\.then\(\(r\) => r\.text\(\)\)/g,
      (m, name) => "Promise.resolve(window.__ASSETS['wgsl/" + name + ".wgsl'])",
    );
    // the training worker: a module built from its own blob URL
    src = src.replace(
      /new Worker\(new URL\('([^']+)', import\.meta\.url\)/g,
      (m, spec) => "new Worker(window.__moduleUrl('" + resolveId(id, spec) + "')",
    );
    // anything else asking for its own URL (defensive — blob modules have none)
    src = src.replace(/import\.meta\.url/g, JSON.stringify('bundle://' + id));
    // module specifiers → blob URLs
    src = src.replace(
      /(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,
      (m, pre, quote, spec) => pre + quote + window.__moduleUrl(resolveId(id, spec)) + quote,
    );
    // dynamic imports too — `await import('./engineCheck.js')` in a blob module
    // would otherwise resolve against the blob URL and 404
    src = src.replace(
      /(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,
      (m, pre, quote, spec) => pre + quote + window.__moduleUrl(resolveId(id, spec)) + quote,
    );
    return src;
  };

  window.__moduleUrl = (id) => {
    const hit = urls.get(id);
    if (hit) {
      if (hit === 'pending') throw new Error('bundle: import cycle through ' + id);
      return hit;
    }
    urls.set(id, 'pending');
    const url = URL.createObjectURL(new Blob([rewrite(id)], { type: 'text/javascript' }));
    urls.set(id, url);
    return url;
  };

  window.__entryUrl = window.__moduleUrl('src/app/main.js');
})();
