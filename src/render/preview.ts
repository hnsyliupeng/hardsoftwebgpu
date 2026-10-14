// CPU software rasteriser for the low-resolution preview used by the rule-based critic,
// and a dependency-free PNG encoder (stored deflate blocks, valid PNG, no compression).

import type { MeshData } from "../types.ts";

export interface Preview {
  width: number;
  height: number;
  rgba: Uint8Array;
  /** Fraction of pixels covered by the solid. */
  coverage: number;
  dataUrl: string;
}

function crc32Table(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crc32Table();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  // Raw scanlines with filter byte 0.
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  // zlib stream with stored blocks (max 65535 bytes each).
  const blocks: Uint8Array[] = [];
  blocks.push(Uint8Array.of(0x78, 0x01));
  for (let off = 0; off < raw.length; off += 65535) {
    const len = Math.min(65535, raw.length - off);
    const last = off + len >= raw.length ? 1 : 0;
    const hdr = Uint8Array.of(last, len & 0xff, len >> 8, ~len & 0xff, (~len >> 8) & 0xff);
    blocks.push(hdr, raw.subarray(off, off + len));
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  blocks.push(Uint8Array.of(adler >>> 24, (adler >>> 16) & 0xff, (adler >>> 8) & 0xff, adler & 0xff));
  const idat = concat(blocks);

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Orthographic isometric rasterisation with a z-buffer and Lambert shading.
 * Background is white; solid pixels are grey-blue shaded by the face normal.
 */
export function rasterisePreview(mesh: MeshData, size = 128): Preview {
  const { positions: p, indices: idx } = mesh;
  const rgba = new Uint8Array(size * size * 4).fill(255);
  const depth = new Float32Array(size * size).fill(Infinity);
  const covered = new Uint8Array(size * size);
  if (p.length === 0) return { width: size, height: size, rgba, coverage: 0, dataUrl: "" };
  // Bounding box and isometric projection.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[i + a]);
      max[a] = Math.max(max[a], p[i + a]);
    }
  const c = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const s = (size * 0.9) / ext;
  // View: rotate 35 deg about z, then 25 deg about x (isometric-like).
  const cz = Math.cos(0.61), sz = Math.sin(0.61), cx = Math.cos(0.44), sx = Math.sin(0.44);
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    let X = x - c[0], Y = y - c[1], Z = z - c[2];
    const X1 = X * cz - Y * sz, Y1 = X * sz + Y * cz;
    const Y2 = Y1 * cx - Z * sx, Z2 = Y1 * sx + Z * cx;
    return [size / 2 + X1 * s, size / 2 - Y2 * s, Z2];
  };
  const light = [0.4, 0.6, 0.7];
  const ll = Math.hypot(light[0], light[1], light[2]);
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t] * 3, ib = idx[t + 1] * 3, ic = idx[t + 2] * 3;
    const A = proj(p[ia], p[ia + 1], p[ia + 2]);
    const B = proj(p[ib], p[ib + 1], p[ib + 2]);
    const C = proj(p[ic], p[ic + 1], p[ic + 2]);
    // Face normal in world space for shading.
    const e1 = [p[ib] - p[ia], p[ib + 1] - p[ia + 1], p[ib + 2] - p[ia + 2]];
    const e2 = [p[ic] - p[ia], p[ic + 1] - p[ia + 1], p[ic + 2] - p[ia + 2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1];
    let ny = e1[2] * e2[0] - e1[0] * e2[2];
    let nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const lambert = Math.abs(nx * light[0] + ny * light[1] + nz * light[2]) / ll;
    const shade = 0.35 + 0.65 * lambert;
    const col = [Math.round(90 * shade), Math.round(130 * shade), Math.round(190 * shade)];
    const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(den) < 1e-12) continue;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((B[1] - C[1]) * (x + 0.5 - C[0]) + (C[0] - B[0]) * (y + 0.5 - C[1])) / den;
        const w1 = ((C[1] - A[1]) * (x + 0.5 - C[0]) + (A[0] - C[0]) * (y + 0.5 - C[1])) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * A[2] + w1 * B[2] + w2 * C[2];
        const k = y * size + x;
        if (z < depth[k]) {
          depth[k] = z;
          rgba.set([col[0], col[1], col[2], 255], k * 4);
          covered[k] = 1;
        }
      }
  }
  let n = 0;
  for (const v of covered) n += v;
  const bytes = encodePng(size, size, rgba);
  return {
    width: size,
    height: size,
    rgba,
    coverage: n / (size * size),
    dataUrl: `data:image/png;base64,${toBase64(bytes)}`,
  };
}
