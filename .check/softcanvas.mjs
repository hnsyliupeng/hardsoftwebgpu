/**
 * softcanvas.mjs — a real (if small) software Canvas2D + PNG writer, used only
 * by the verification probes.
 *
 * The app's `FallbackRenderer` draws the whole scene with seventeen canvas
 * calls: a vertical gradient sky, flat-shaded triangles, polyline strokes for
 * tendons/grid/trail, filled circles for the workspace cloud, one caption. That
 * is a small enough surface to implement honestly, which lets the *real*
 * renderer produce real pixels inside Node — no browser required.
 *
 * Supersampling comes free: the app sets `canvas.width = clientWidth * dpr`
 * with dpr = 2, so we rasterise at 2× and box-filter down when writing the PNG.
 */
import { deflateSync } from 'node:zlib';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

function parseColor(css) {
  if (typeof css !== 'string') return [0, 0, 0, 1];
  let m = /^#([0-9a-f]{6})$/i.exec(css);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(css);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p.length > 3 ? p[3] : 1];
  }
  return [0, 0, 0, 1];
}

class Gradient {
  constructor(x0, y0, x1, y1) {
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    this.stops = [];
    this.isGradient = true;
  }
  addColorStop(off, color) { this.stops.push([off, parseColor(color)]); this.stops.sort((a, b) => a[0] - b[0]); }
  at(x, y) {
    const dx = this.x1 - this.x0;
    const dy = this.y1 - this.y0;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - this.x0) * dx + (y - this.y0) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const s = this.stops;
    if (!s.length) return [0, 0, 0, 1];
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i += 1) {
      if (t <= s[i][0]) {
        const [t0, c0] = s[i - 1];
        const [t1, c1] = s[i];
        const k = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        return [
          c0[0] + (c1[0] - c0[0]) * k,
          c0[1] + (c1[1] - c0[1]) * k,
          c0[2] + (c1[2] - c0[2]) * k,
          c0[3] + (c1[3] - c0[3]) * k,
        ];
      }
    }
    return s[s.length - 1][1];
  }
}

class SoftContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000';
    this.strokeStyle = '#fff';
    this.lineWidth = 1;
    this.lineJoin = 'round';
    this.lineCap = 'butt';
    this.font = '12px monospace';
    this.globalAlpha = 1;
    this._path = [];
    this._pts = [];
    this.buf = new Uint8ClampedArray(canvas.width * canvas.height * 4);
    this.counts = { tris: 0, rects: 0, strokes: 0, arcs: 0, text: 0 };
  }

  _size() { return [this.canvas.width, this.canvas.height]; }

  /** The app resizes the canvas during boot (clientWidth × dpr), so the pixel
   *  buffer has to follow. Called from every drawing entry point. */
  _sync() {
    const need = this.canvas.width * this.canvas.height * 4;
    if (this.buf.length !== need) this.buf = new Uint8ClampedArray(need);
  }

  _blend(x, y, rgba) {
    const [W, H] = this._size();
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const a = rgba[3] * this.globalAlpha;
    if (a <= 0) return;
    const i = (y * W + x) * 4;
    const b = this.buf;
    if (a >= 0.999) {
      b[i] = clamp255(rgba[0]); b[i + 1] = clamp255(rgba[1]); b[i + 2] = clamp255(rgba[2]); b[i + 3] = 255;
      return;
    }
    b[i] = clamp255(rgba[0] * a + b[i] * (1 - a));
    b[i + 1] = clamp255(rgba[1] * a + b[i + 1] * (1 - a));
    b[i + 2] = clamp255(rgba[2] * a + b[i + 2] * (1 - a));
    b[i + 3] = clamp255(255 * a + b[i + 3] * (1 - a));
  }

  /** Horizontal scanline polygon fill (even-odd), the workhorse of the rasteriser. */
  _fillPolygon(points, colorAt) {
    if (points.length < 3) return;
    this._sync();
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const [W, H] = this._size();
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(H - 1, Math.ceil(maxY));
    const xs = [];
    for (let y = y0; y <= y1; y += 1) {
      const cy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
          xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x += 1) this._blend(x, y, colorAt ? colorAt(x, y) : this._resolved);
      }
    }
  }

  _resolve(style, x, y) {
    if (style && style.isGradient) return style.at(x, y);
    return parseColor(style);
  }

  // ---- path API
  beginPath() { this._pts = []; }
  moveTo(x, y) { this._pts.push({ x, y, move: true }); }
  lineTo(x, y) { this._pts.push({ x, y }); }
  closePath() { this._closed = true; }
  arc(cx, cy, r, a0 = 0, a1 = Math.PI * 2) {
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * r * 0.5));
    for (let i = 0; i <= n; i += 1) {
      const t = a0 + ((a1 - a0) * i) / n;
      this._pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r, move: i === 0 });
    }
    this.counts.arcs += 1;
  }
  fill() {
    // a closed path keeps its leading `moveTo` point: dropping it turned every
    // triangle into a two-point path that never drew (the `move` flag is only
    // meaningful for `stroke`, which uses it to break polylines)
    const poly = this._pts;
    if (poly.length < 3) return;
    const style = this.fillStyle;
    if (style && style.isGradient) {
      this._fillPolygon(poly, (x, y) => style.at(x, y));
    } else {
      this._resolved = parseColor(style);
      this._fillPolygon(poly, null);
    }
    if (poly.length === 3) this.counts.tris += 1;
  }
  stroke() {
    const w = Math.max(1, this.lineWidth) / 2;
    const col = Array.isArray(this.strokeStyle) ? this.strokeStyle : this._resolve(this.strokeStyle, 0, 0);
    for (let i = 0; i + 1 < this._pts.length; i += 1) {
      const a = this._pts[i];
      const b = this._pts[i + 1];
      if (b.move) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * w;
      const ny = (dx / len) * w;
      const quad = [
        { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
      ];
      this._resolved = col;
      this._fillPolygon(quad, null);
      if (i === 0 || b.move) this.counts.strokes += 1;
    }
    this.counts.strokes += 1;
  }
  fillRect(x, y, w, h) {
    this.counts.rects += 1;
    this._sync();
    const style = this.fillStyle;
    if (style && style.isGradient) {
      const [W, H] = this._size();
      const xa = Math.max(0, Math.floor(x));
      const ya = Math.max(0, Math.floor(y));
      const xb = Math.min(W - 1, Math.ceil(x + w) - 1);
      const yb = Math.min(H - 1, Math.ceil(y + h) - 1);
      for (let py = ya; py <= yb; py += 1) {
        for (let px = xa; px <= xb; px += 1) this._blend(px, py, style.at(px, py));
      }
      return;
    }
    this._fillPolygon([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
      null) || (this._resolved = parseColor(style));
  }
  clearRect(x, y, w, h) {
    this._sync();
    const [W, H] = this._size();
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(H, y + h); py += 1) {
      for (let px = Math.max(0, Math.floor(x)); px < Math.min(W, x + w); px += 1) {
        const i = (py * W + px) * 4;
        this.buf[i] = 0; this.buf[i + 1] = 0; this.buf[i + 2] = 0; this.buf[i + 3] = 255;
      }
    }
  }
  createLinearGradient(x0, y0, x1, y1) { return new Gradient(x0, y0, x1, y1); }
  measureText(t) { return { width: String(t).length * 7 }; }
  fillText() { this.counts.text += 1; }   // text lives in the DOM HUD, not here
  save() {} restore() {} translate() {} scale() {} setTransform() {}
  putImageData() {} drawImage() {}
  getImageData(x, y, w, h) { void x; void y; return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
}

/** Attach a real software context to a shim canvas element. */
export function attachSoftCanvas(el, width, height) {
  el.width = width;
  el.height = height;
  el.clientWidth = width;
  el.clientHeight = height;
  const ctx = new SoftContext2D(el);
  el.getContext = (kind) => (kind === '2d' ? ctx : null);
  return ctx;
}

// ---------------------------------------------------------------- PNG writer
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA buffer as a PNG, optionally box-filtering down by `scale`. */
export function encodePng(rgba, W, H, scale = 1) {
  const w = Math.floor(W / scale);
  const h = Math.floor(H / scale);
  const out = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y += 1) {
    out[y * (w * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x += 1) {
      let r = 0; let g = 0; let b = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const i = ((y * scale + sy) * W + (x * scale + sx)) * 4;
          r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2];
        }
      }
      const n = scale * scale;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(out, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
