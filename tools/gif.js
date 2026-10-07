/**
 * gif.js — a dependency-free GIF89a encoder.
 *
 * There is no browser and no image library in this sandbox, and the deliverable
 * is an animation, so the encoder is written out longhand: median-cut palette
 * generation over sampled frames, a cached nearest-colour lookup, and the
 * classic variable-width LZW with sub-block framing. Loops forever (Netscape
 * application extension) so the result is a self-playing animation.
 */

// ------------------------------------------------------------------- palette

/** Median-cut palette over a sample of the frames' pixels. */
export function medianCut(samples, maxColors = 256) {
  // 5 bits per channel histogram keeps the buckets bounded and the split cheap
  const hist = new Map();
  const key = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  for (const { data, stride = 4 } of samples) {
    for (let i = 0; i < data.length; i += stride) {
      const k = key(data[i], data[i + 1], data[i + 2]);
      const e = hist.get(k);
      if (e) { e.n += 1; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; }
      else hist.set(k, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  let boxes = [makeBox([...hist.values()])];
  while (boxes.length < maxColors) {
    let bi = -1;
    let bestScore = 0;
    boxes.forEach((box, i) => {
      if (box.colors.length < 2) return;
      const score = box.count * box.spreadMax;
      if (score > bestScore) { bestScore = score; bi = i; }
    });
    if (bi < 0) break;
    const box = boxes[bi];
    const [a, b] = splitBox(box);
    boxes = boxes.slice(0, bi).concat([a, b], boxes.slice(bi + 1));
  }
  return boxes.map((box) => [
    Math.round(box.sum[0] / box.count),
    Math.round(box.sum[1] / box.count),
    Math.round(box.sum[2] / box.count),
  ]);
}

function makeBox(colors) {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  const sum = [0, 0, 0];
  let count = 0;
  for (const c of colors) {
    const r = c.r / c.n;
    const g = c.g / c.n;
    const b = c.b / c.n;
    const v = [r, g, b];
    for (let k = 0; k < 3; k += 1) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
    sum[0] += c.r; sum[1] += c.g; sum[2] += c.b;
    count += c.n;
  }
  const spread = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return { colors, min, max, sum, count, spread, spreadMax: Math.max(...spread) };
}

function splitBox(box) {
  const axis = box.spread.indexOf(box.spreadMax);
  const channel = (c) => (axis === 0 ? c.r / c.n : axis === 1 ? c.g / c.n : c.b / c.n);
  const sorted = box.colors.slice().sort((p, q) => channel(p) - channel(q));
  const half = box.count / 2;
  let acc = 0;
  let cut = 1;
  for (let i = 0; i < sorted.length; i += 1) {
    acc += sorted[i].n;
    if (acc >= half) { cut = Math.min(sorted.length - 1, i + 1); break; }
  }
  return [makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut))];
}

/** 5-bit-per-channel RGB → palette index, computed once and cached. */
export function paletteLookup(palette) {
  const lut = new Uint8Array(32768);
  for (let r = 0; r < 32; r += 1) {
    for (let g = 0; g < 32; g += 1) {
      for (let b = 0; b < 32; b += 1) {
        const R = r * 8 + 4;
        const G = g * 8 + 4;
        const B = b * 8 + 4;
        let bi = 0;
        let bd = Infinity;
        for (let i = 0; i < palette.length; i += 1) {
          const dr = palette[i][0] - R;
          const dg = palette[i][1] - G;
          const db = palette[i][2] - B;
          const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
          if (d < bd) { bd = d; bi = i; }
        }
        lut[(r << 10) | (g << 5) | b] = bi;
      }
    }
  }
  return (r, g, b) => lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
}

/** 4x4 ordered dither matrix, used to hide banding in the sky gradient. */
const BAYER = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
].map((row) => row.map((v) => (v / 16 - 0.5) * 12));

// ----------------------------------------------------------------------- LZW

class BlockWriter {
  constructor() { this.bytes = []; this.block = []; }
  write(byte) {
    this.block.push(byte & 255);
    if (this.block.length === 255) this.flush();
  }
  writeBytes(arr) { for (const b of arr) this.write(b); }
  flush() {
    if (!this.block.length) return;
    this.bytes.push(this.block.length, ...this.block);
    this.block = [];
  }
  result() { this.flush(); this.bytes.push(0); return this.bytes; }
}

function lzwEncode(indices, minCodeSize) {
  const out = new BlockWriter();
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let next = endCode + 1;
  let dict = new Map();
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.write(bitBuffer & 255);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  let prefix = null;
  for (let i = 0; i < indices.length; i += 1) {
    const k = indices[i];
    if (prefix === null) { prefix = k; continue; }
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
    } else {
      emit(prefix);
      dict.set(key, next);
      next += 1;
      if (next > (1 << codeSize) && codeSize < 12) codeSize += 1;
      if (next > 4095) {
        emit(clearCode);
        dict = new Map();
        next = endCode + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
  }
  if (prefix !== null) emit(prefix);
  emit(endCode);
  if (bitCount > 0) out.write(bitBuffer & 255);
  return out.result();
}

// ------------------------------------------------------------------- writer

export class GifWriter {
  /** @param palette array of [r,g,b]; @param width/height pixels */
  constructor(width, height, palette, { loop = 0 } = {}) {
    this.w = width;
    this.h = height;
    this.palette = palette;
    this.bytes = [];
    const push = (...b) => this.bytes.push(...b);
    const u16 = (v) => [v & 255, (v >> 8) & 255];

    // header + logical screen descriptor
    push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)));
    push(...u16(width), ...u16(height));
    const bits = Math.max(1, Math.ceil(Math.log2(palette.length))) - 1;
    push(0x80 | (7 << 4) | bits, 0, 0);
    for (let i = 0; i < (1 << (bits + 1)); i += 1) {
      const c = palette[i] ?? [0, 0, 0];
      push(c[0], c[1], c[2]);
    }
    // Netscape looping extension
    push(0x21, 0xff, 0x0b);
    push(...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)));
    push(0x03, 0x01, ...u16(loop), 0x00);

    this.minCodeSize = Math.max(2, bits + 1);
    this.u16 = u16;
    this.push = push;
  }

  /** Add one frame. `indices` is width*height palette indices. */
  addFrame(indices, delayMs = 100) {
    const { push, u16 } = this;
    const delay = Math.max(2, Math.round(delayMs / 10));
    push(0x21, 0xf9, 0x04, 0x04, ...u16(delay), 0x00, 0x00);
    push(0x2c, ...u16(0), ...u16(0), ...u16(this.w), ...u16(this.h), 0x00);
    push(this.minCodeSize);
    push(...lzwEncode(indices, this.minCodeSize));
  }

  /** RGBA frame → palette indices, with optional ordered dithering. */
  quantise(rgba, lookup, { dither = false } = {}) {
    const { w, h } = this;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        let r = rgba[i];
        let g = rgba[i + 1];
        let b = rgba[i + 2];
        if (dither) {
          const d = BAYER[y & 3][x & 3];
          r = Math.max(0, Math.min(255, r + d));
          g = Math.max(0, Math.min(255, g + d));
          b = Math.max(0, Math.min(255, b + d));
        }
        out[y * w + x] = lookup(r, g, b);
      }
    }
    return out;
  }

  finish() {
    const bytes = Uint8Array.from([...this.bytes, 0x3b]);
    this.bytes = [];
    return bytes;
  }
}
