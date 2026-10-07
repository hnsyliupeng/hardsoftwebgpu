/**
 * crop-image.mjs — crop and zoom a PNG, using only node's zlib.
 *
 *   node .check/crop-image.mjs in.png out.png X Y W H ZOOM
 *
 * Useful for reading a figure closely: the paper's figures arrive as one big
 * image and a joint is a few pixels across.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { encodePng } from './softcanvas.mjs';

/** Decode a non-interlaced PNG into { w, h, rgb } (8-bit, RGB or RGBA). */
export function decodePng(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let depth = 8;
  let color = 6;
  const idat = [];
  let palette = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
      if (depth !== 8) throw new Error(`bit depth ${depth} not supported`);
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 1;
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p];
    p += 1;
    const line = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  // to RGB
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    if (color === 6) { rgb[i * 3] = out[i * 4]; rgb[i * 3 + 1] = out[i * 4 + 1]; rgb[i * 3 + 2] = out[i * 4 + 2]; }
    else if (color === 2) { rgb[i * 3] = out[i * 3]; rgb[i * 3 + 1] = out[i * 3 + 1]; rgb[i * 3 + 2] = out[i * 3 + 2]; }
    else if (color === 3 && palette) { const pi = out[i] * 3; rgb[i * 3] = palette[pi]; rgb[i * 3 + 1] = palette[pi + 1]; rgb[i * 3 + 2] = palette[pi + 2]; }
    else { rgb[i * 3] = out[i]; rgb[i * 3 + 1] = out[i]; rgb[i * 3 + 2] = out[i]; }
  }
  return { w, h, rgb };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , inPath, outPath, xs, ys, ws, hs, zs] = process.argv;
  const X = Number(xs); const Y = Number(ys);
  const W = Number(ws); const H = Number(hs); const Z = Math.max(1, Number(zs ?? 1));
  const src = decodePng(readFileSync(inPath));
  const out = new Uint8Array(W * Z * H * Z * 3);
  for (let y = 0; y < H * Z; y += 1) {
    for (let x = 0; x < W * Z; x += 1) {
      const sx = Math.min(src.w - 1, X + Math.floor(x / Z));
      const sy = Math.min(src.h - 1, Y + Math.floor(y / Z));
      const si = (sy * src.w + sx) * 3;
      const di = (y * W * Z + x) * 3;
      out[di] = src.rgb[si]; out[di + 1] = src.rgb[si + 1]; out[di + 2] = src.rgb[si + 2];
    }
  }
  writeFileSync(outPath, encodePng(out, W * Z, H * Z, 1));
  console.log(`wrote ${outPath} — ${W * Z}x${H * Z} at ${Z}x (source ${src.w}x${src.h})`);
}
