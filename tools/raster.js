/**
 * raster.js — a small software 3D rasteriser, built for the animation GIF.
 *
 * There is no GPU and no browser in this sandbox, so the animation is drawn with
 * a depth-buffered scanline rasteriser and a 3x5 bitmap font. It is deliberately
 * small: flat-shaded triangles, depth-tested thick lines, discs for the arm's
 * tube, and text. Everything is in metres with +Y up, matching the app frame.
 *
 * Optional 2x supersampling; the caller box-filters down to the GIF size.
 */

/** HUD pixels sit in front of everything and never occlude one another. */
const HUD_Z = -Infinity;

export class Raster {
  constructor(width, height, { supersample = 2, fovDeg = 38 } = {}) {
    this.outW = width;
    this.outH = height;
    this.ss = supersample;
    this.w = width * supersample;
    this.h = height * supersample;
    this.rgb = new Uint8ClampedArray(this.w * this.h * 3);
    this.depth = new Float32Array(this.w * this.h);
    this.fov = (this.h / 2) / Math.tan((fovDeg * Math.PI) / 360);
    this.cam = { yaw: 0.7, pitch: 0.3, dist: 1.3, target: [0, 0.45, 0] };
    this.setCamera(this.cam);
    this.light = normalize([-0.42, 0.8, -0.43]);
  }

  setCamera({ yaw, pitch, dist, target, fovDeg }) {
    Object.assign(this.cam, { yaw, pitch, dist, target });
    if (fovDeg) this.fov = (this.h / 2) / Math.tan((fovDeg * Math.PI) / 360);
    const { yaw: y, pitch: p, dist: d, target: t } = this.cam;
    const eye = [
      t[0] + d * Math.cos(p) * Math.sin(y),
      t[1] + d * Math.sin(p),
      t[2] + d * Math.cos(p) * Math.cos(y),
    ];
    const f = normalize(sub(t, eye));
    const r = normalize(cross([0, 1, 0], f));
    const u = cross(f, r);
    this.eye = eye;
    this.basis = { f, r, u };
  }

  /** Camera-space {x, y, z, s} for a world point, s = screen scale. */
  project(p) {
    const v = sub(p, this.eye);
    const { f, r, u } = this.basis;
    const z = dot(v, f);
    const x = dot(v, r);
    const y = dot(v, u);
    return { x, y, z };
  }

  toScreen(c) {
    return [this.w / 2 + (this.fov * c.x) / c.z, this.h / 2 - (this.fov * c.y) / c.z];
  }

  clearGradient(top, bottom) {
    for (let y = 0; y < this.h; y += 1) {
      const t = y / (this.h - 1);
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      for (let x = 0; x < this.w; x += 1) {
        const i = (y * this.w + x) * 3;
        this.rgb[i] = r;
        this.rgb[i + 1] = g;
        this.rgb[i + 2] = b;
        this.depth[y * this.w + x] = Infinity;
      }
    }
  }

  /** Depth of a pixel, or Infinity. */
  depthAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return Infinity;
    return this.depth[y * this.w + x];
  }

  set(x, y, rgb, z) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    // HUD pixels (infinite-negative z) always land, even on top of other HUD.
    const hud = !Number.isFinite(z);
    if (!hud && z >= this.depth[i]) return;
    this.depth[i] = z;
    const c = i * 3;
    this.rgb[c] = rgb[0];
    this.rgb[c + 1] = rgb[1];
    this.rgb[c + 2] = rgb[2];
  }

  /** Flat-shaded, depth-buffered triangle. */
  tri3(a, b, c, rgb) {
    const ca = this.project(a);
    const cb = this.project(b);
    const cc = this.project(c);
    const near = 0.02;
    if (ca.z < near || cb.z < near || cc.z < near) return;
    const [ax, ay] = this.toScreen(ca);
    const [bx, by] = this.toScreen(cb);
    const [cx, cy] = this.toScreen(cc);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 0.01) return;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(this.w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(this.h - 1, Math.ceil(Math.max(ay, by, cy)));
    // 1/z interpolates linearly in screen space
    const ia = 1 / ca.z;
    const ib = 1 / cb.z;
    const ic = 1 / cc.z;
    const inv = 1 / area;
    for (let y = y0; y <= y1; y += 1) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * inv;
        const w1 = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const iz = w1 * ib + w2 * ic + w0 * ia;
        const z = iz > 0 ? 1 / iz : Infinity;
        this.set(x, y, rgb, z);
      }
    }
  }

  /** Depth-tested thick line. */
  line3(a, b, rgb, width = 1) {
    const ca = this.project(a);
    const cb = this.project(b);
    const near = 0.02;
    if (ca.z < near && cb.z < near) return;
    let A = ca;
    let B = cb;
    if (ca.z < near || cb.z < near) {
      const t = (near - ca.z) / (cb.z - ca.z);
      const cut = { x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t, z: near };
      if (ca.z < near) A = cut; else B = cut;
    }
    const [ax, ay] = this.toScreen(A);
    const [bx, by] = this.toScreen(B);
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    const half = Math.max(0, Math.round((width * this.ss) / 2));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = A.z + (B.z - A.z) * t;
      for (let dy = -half; dy <= half; dy += 1) {
        for (let dx = -half; dx <= half; dx += 1) {
          this.set(Math.round(x) + dx, Math.round(y) + dy, rgb, z);
        }
      }
    }
  }

  /** Filled disc in 3D — the arm's tube and the joint collars. */
  disc3(centre, normal, radius, rgb, segments = 14) {
    const n = normalize(normal);
    const u = normalize(Math.abs(n[1]) > 0.9 ? cross([1, 0, 0], n) : cross([0, 1, 0], n));
    const v = cross(n, u);
    const rim = [];
    for (let i = 0; i <= segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      rim.push([
        centre[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * radius,
        centre[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * radius,
        centre[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * radius,
      ]);
    }
    for (let i = 0; i < segments; i += 1) this.tri3(centre, rim[i], rim[i + 1], rgb);
  }

  /** A capped cylinder from `a` to `b` — the base, the guide collars, props. */
  cyl3(a, b, radius, rgb, { segments = 16, cap = true, opts = {} } = {}) {
    const dir = normalize(sub(b, a));
    const u = normalize(Math.abs(dir[1]) > 0.85 ? cross([1, 0, 0], dir) : cross([0, 1, 0], dir));
    const v = cross(dir, u);
    const ringAt = (c) => {
      const ring = [];
      for (let k = 0; k <= segments; k += 1) {
        const t = (k / segments) * Math.PI * 2;
        ring.push(add(c, add(mul(u, Math.cos(t) * radius), mul(v, Math.sin(t) * radius))));
      }
      return ring;
    };
    const r0 = ringAt(a);
    const r1 = ringAt(b);
    const mid = mul(add(a, b), 0.5);
    for (let k = 0; k < segments; k += 1) {
      const centre = mul(add(add(r0[k], r0[k + 1]), add(r1[k], r1[k + 1])), 0.25);
      const col = shade(rgb, this.light, normalize(sub(centre, mid)), opts);
      this.tri3(r0[k], r0[k + 1], r1[k + 1], col);
      this.tri3(r0[k], r1[k + 1], r1[k], col);
    }
    if (cap) {
      this.disc3(b, dir, radius, shade(rgb, this.light, dir, opts), segments);
      this.disc3(a, mul(dir, -1), radius, shade(rgb, this.light, mul(dir, -1), opts), segments);
    }
  }

  /** A latitude/longitude sphere — the bulb in the bulb task. */
  sphere3(centre, radius, rgb, { rings = 8, segments = 14, opts = {} } = {}) {
    const at = (i, k) => {
      const phi = (i / rings) * Math.PI;
      const th = (k / segments) * Math.PI * 2;
      return [
        centre[0] + radius * Math.sin(phi) * Math.cos(th),
        centre[1] + radius * Math.cos(phi),
        centre[2] + radius * Math.sin(phi) * Math.sin(th),
      ];
    };
    for (let i = 0; i < rings; i += 1) {
      for (let k = 0; k < segments; k += 1) {
        const a = at(i, k);
        const b = at(i + 1, k);
        const c = at(i + 1, k + 1);
        const d = at(i, k + 1);
        const n = normalize(sub(mul(add(add(a, b), add(c, d)), 0.25), centre));
        const col = shade(rgb, this.light, n, opts);
        this.tri3(a, b, c, col);
        this.tri3(a, c, d, col);
      }
    }
  }

  /**
   * A solid tube along a polyline: rings of vertices joined by quads, shaded by
   * the radial normal. This is what the arm's truss tube is drawn with — a
   * stack of flat discs would read as a coil of rings, which is exactly the
   * look the TRUNC arm does not have.
   */
  tube3(points, radius, rgb, opts = {}) {
    const segments = opts.segments ?? 12;
    const rings = [];
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const dir = normalize(sub(next, prev));
      const u = normalize(Math.abs(dir[1]) > 0.85 ? cross([1, 0, 0], dir) : cross([0, 1, 0], dir));
      const v = cross(dir, u);
      const r = typeof radius === 'function' ? radius(i / (points.length - 1)) : radius;
      const ring = [];
      for (let k = 0; k <= segments; k += 1) {
        const a = (k / segments) * Math.PI * 2;
        ring.push(add(points[i], add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r))));
      }
      rings.push(ring);
    }
    for (let i = 1; i < rings.length; i += 1) {
      const c0 = points[i - 1];
      const c1 = points[i];
      for (let k = 0; k < segments; k += 1) {
        const a = rings[i - 1][k];
        const b = rings[i - 1][k + 1];
        const c = rings[i][k + 1];
        const d = rings[i][k];
        const mid = mul(add(add(a, b), add(c, d)), 0.25);
        const normal = normalize(sub(mid, mul(add(c0, c1), 0.5)));
        const col = shade(rgb, this.light, normal, opts);
        this.tri3(a, b, c, col);
        this.tri3(a, c, d, col);
      }
    }
    return rings;
  }

  /** A tube along a polyline: discs plus two longitudinal edges for structure. */
  tube(points, radius, rgb, opts = {}) {
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const dir = normalize(sub(next, prev));
      const r = typeof radius === 'function' ? radius(i / (points.length - 1)) : radius;
      this.disc3(points[i], dir, r, shade(rgb, this.light, dir, opts), 12);
    }
  }

  /** Axis-aligned HUD panel with a border. */
  panel(x, y, w, h, rgb, border) {
    this.rect(x, y, w, h, rgb);
    if (border) {
      this.rect(x, y, w, 1, border);
      this.rect(x, y + h - 1, w, 1, border);
      this.rect(x, y, 1, h, border);
      this.rect(x + w - 1, y, 1, h, border);
    }
  }

  rect(x, y, w, h, rgb) {
    const X = Math.round(x * this.ss);
    const Y = Math.round(y * this.ss);
    const W = Math.round(w * this.ss);
    const H = Math.round(h * this.ss);
    for (let j = Y; j < Y + H; j += 1) {
      for (let i = X; i < X + W; i += 1) this.set(i, j, rgb, HUD_Z);
    }
  }

  /** Write text with the 3x5 bitmap font; scale is in output pixels. */
  text(x, y, str, rgb, scale = 2, { shadow = [8, 10, 14] } = {}) {
    const s = Math.max(1, Math.round(scale * this.ss));
    let cx = Math.round(x * this.ss);
    const cy = Math.round(y * this.ss);
    for (const ch of String(str)) {
      const glyph = GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
      for (let row = 0; row < 5; row += 1) {
        const bits = glyph[row];
        for (let col = 0; col < 3; col += 1) {
          if (!(bits & (1 << (2 - col)))) continue;
          for (let dy = 0; dy < s; dy += 1) {
            for (let dx = 0; dx < s; dx += 1) {
              if (shadow) {
                const sx = cx + col * s + dx + Math.max(1, Math.round(s / 3));
                const sy = cy + row * s + dy + Math.max(1, Math.round(s / 3));
                this.set(sx, sy, shadow, HUD_Z);
              }
              this.set(cx + col * s + dx, cy + row * s + dy, rgb, HUD_Z);
            }
          }
        }
      }
      cx += 4 * s;
    }
    return cx;
  }

  textWidth(str, scale = 2) {
    return String(str).length * 4 * scale;
  }

  /** Box-filter the supersampled buffer down to the output size (RGBA). */
  resolve() {
    const { outW, outH, ss } = this;
    if (ss === 1) {
      const out = new Uint8ClampedArray(outW * outH * 4);
      for (let i = 0; i < outW * outH; i += 1) {
        out[i * 4] = this.rgb[i * 3];
        out[i * 4 + 1] = this.rgb[i * 3 + 1];
        out[i * 4 + 2] = this.rgb[i * 3 + 2];
        out[i * 4 + 3] = 255;
      }
      return out;
    }
    const out = new Uint8ClampedArray(outW * outH * 4);
    const n = ss * ss;
    for (let y = 0; y < outH; y += 1) {
      for (let x = 0; x < outW; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let j = 0; j < ss; j += 1) {
          for (let i = 0; i < ss; i += 1) {
            const p = ((y * ss + j) * this.w + (x * ss + i)) * 3;
            r += this.rgb[p];
            g += this.rgb[p + 1];
            b += this.rgb[p + 2];
          }
        }
        const o = (y * outW + x) * 4;
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
        out[o + 3] = 255;
      }
    }
    return out;
  }
}

// ------------------------------------------------------------------ helpers

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function normalize(a) {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}
/** Flat shade: ambient + lambert, plus a rim term so the tube reads as 3D. */
export function shade(rgb, light, normal, { ambient = 0.42, gain = 0.62, rim = 0.12 } = {}) {
  const ndl = Math.abs(dot(normal, light));
  const k = Math.min(1.25, ambient + gain * ndl + rim * (1 - ndl));
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// -------------------------------------------------------------- bitmap font
// 3x5 glyphs, one octal digit per row (bit 2 = leftmost pixel). Uppercase only;
// the renderer upper-cases its input, which suits a HUD.
const RAW = {
  '0': '75557', '1': '26227', '2': '71747', '3': '71717', '4': '55711',
  '5': '74717', '6': '74757', '7': '71222', '8': '75757', '9': '75717',
  A: '25755', B: '75657', C: '74447', D: '65556', E: '74747', F: '74744',
  G: '74557', H: '55755', I: '72227', J: '11157', K: '55655', L: '44447',
  M: '57755', N: '65555', O: '75557', P: '75744', Q: '75571', R: '75755',
  S: '74717', T: '72222', U: '55557', V: '55552', W: '55775', X: '55255',
  Y: '55722', Z: '71247',
  ' ': '00000', '.': '00002', ',': '00024', ':': '02020', '-': '00700',
  '+': '02720', '/': '11244', '%': '51245', '=': '07070', '(': '24442',
  ')': '21112', '#': '57575', '*': '52725', '<': '12421', '>': '42124',
  '_': '00007', '[': '64446', ']': '11112', '?': '71202', '!': '22202',
  "'": '22000', '"': '55000', '|': '22222', '~': '00500', '$': '76757',
};
export const GLYPHS = Object.fromEntries(
  Object.entries(RAW).map(([ch, rows]) => [ch, [...rows].map((d) => parseInt(d, 8))]),
);
