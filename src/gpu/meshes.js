/**
 * meshes.js — procedural geometry for everything the GPU draws.
 *
 * All builders return `{ positions: Float32Array, normals: Float32Array,
 * indices: Uint32Array }` in the layout the renderer uploads directly:
 * interleaved as `pos.xyz | normal.xyz` (24-byte stride), counter-clockwise
 * winding, +Y up.
 *
 * The arm itself is assembled from TRUNC cells: a truss lattice for the torque
 * channel and a slotted equatorial tube for the tendon guides. One unit cell is
 * meshed once and instanced along the backbone (`renderer.js`), which keeps the
 * metamaterial look while staying cheap to draw.
 */

import { V3, Quat, Transform, deg, TAU } from '../core/mathx.js';
import { CELL_TRUSS, CELL_EQUATORIAL } from '../core/metamaterial.js';

const EMPTY = () => ({ positions: [], normals: [], indices: [] });

/** Accumulate triangles with a shared transform helper. */
class MeshBuilder {
  constructor() { this.pos = []; this.nrm = []; this.idx = []; }

  /** Push a vertex, transformed by (optional) quaternion + position. */
  vertex(p, n, q = null, t = null) {
    const pp = q ? Quat.rotate(q, p) : p;
    const nn = q ? Quat.rotate(q, n) : n;
    this.pos.push(pp.x + (t ? t.x : 0), pp.y + (t ? t.y : 0), pp.z + (t ? t.z : 0));
    this.nrm.push(nn.x, nn.y, nn.z);
    return this.pos.length / 3 - 1;
  }

  quad(a, b, c, d) {
    const [ia, ib, ic, id] = [a, b, c, d];
    this.idx.push(ia, ib, ic, ia, ic, id);
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  build() {
    return {
      positions: Float32Array.from(this.pos),
      normals: Float32Array.from(this.nrm),
      indices: Uint32Array.from(this.idx),
    };
  }

  /** Merge another builder's geometry with a transform applied. */
  merge(other, q = null, t = null, scale = 1) {
    const base = this.pos.length / 3;
    for (let i = 0; i < other.positions.length; i += 3) {
      const p = V3.new(other.positions[i] * scale, other.positions[i + 1] * scale, other.positions[i + 2] * scale);
      const n = V3.new(other.normals[i], other.normals[i + 1], other.normals[i + 2]);
      this.vertex(p, n, q, t);
    }
    for (let i = 0; i < other.indices.length; i += 1) this.idx.push(other.indices[i] + base);
    return this;
  }
}

/** Simple axis-aligned box (clean implementation used everywhere). */
export function cube(sx, sy, sz) {
  const b = new MeshBuilder();
  const hx = sx / 2; const hy = sy / 2; const hz = sz / 2;
  const corners = [
    V3.new(-hx, -hy, -hz), V3.new(hx, -hy, -hz), V3.new(hx, hy, -hz), V3.new(-hx, hy, -hz),
    V3.new(-hx, -hy, hz), V3.new(hx, -hy, hz), V3.new(hx, hy, hz), V3.new(-hx, hy, hz),
  ];
  const faces = [
    [0, 3, 2, 1, V3.new(0, 0, -1)],
    [4, 5, 6, 7, V3.new(0, 0, 1)],
    [0, 1, 5, 4, V3.new(0, -1, 0)],
    [3, 7, 6, 2, V3.new(0, 1, 0)],
    [0, 4, 7, 3, V3.new(-1, 0, 0)],
    [1, 2, 6, 5, V3.new(1, 0, 0)],
  ];
  for (const [a, c, d, e, n] of faces) {
    const i0 = b.vertex(corners[a], n);
    const i1 = b.vertex(corners[c], n);
    const i2 = b.vertex(corners[d], n);
    const i3 = b.vertex(corners[e], n);
    b.quad(i0, i1, i2, i3);
  }
  return b.build();
}

/** Cylinder along +Y, centred on the origin. */
export function cylinder(radius, height, radialSegments = 20, capped = true) {
  const b = new MeshBuilder();
  const half = height / 2;
  for (let i = 0; i < radialSegments; i += 1) {
    const a0 = (i / radialSegments) * TAU;
    const a1 = ((i + 1) / radialSegments) * TAU;
    const p0 = V3.new(Math.cos(a0) * radius, -half, Math.sin(a0) * radius);
    const p1 = V3.new(Math.cos(a1) * radius, -half, Math.sin(a1) * radius);
    const p2 = V3.new(Math.cos(a1) * radius, half, Math.sin(a1) * radius);
    const p3 = V3.new(Math.cos(a0) * radius, half, Math.sin(a0) * radius);
    const n0 = V3.new(Math.cos(a0), 0, Math.sin(a0));
    const n1 = V3.new(Math.cos(a1), 0, Math.sin(a1));
    const i0 = b.vertex(p0, n0);
    const i1 = b.vertex(p1, n1);
    const i2 = b.vertex(p2, n1);
    const i3 = b.vertex(p3, n0);
    if (capped) b.quad(i0, i1, i2, i3);
    else b.quad(i0, i1, i2, i3);
  }
  if (capped) {
    for (const [y, ny] of [[half, 1], [-half, -1]]) {
      const center = b.vertex(V3.new(0, y, 0), V3.new(0, ny, 0));
      const ring = [];
      for (let i = 0; i <= radialSegments; i += 1) {
        const a = (i / radialSegments) * TAU;
        ring.push(b.vertex(V3.new(Math.cos(a) * radius, y, Math.sin(a) * radius), V3.new(0, ny, 0)));
      }
      for (let i = 0; i < radialSegments; i += 1) {
        if (ny > 0) b.tri(center, ring[i], ring[i + 1]);
        else b.tri(center, ring[i + 1], ring[i]);
      }
    }
  }
  return b.build();
}

/** Capsule / rounded strut along +Y, from y=0 to y=height. */
export function capsule(radius, height, radialSegments = 10, capSegments = 4) {
  const b = new MeshBuilder();
  const rings = [];
  const y0 = 0;
  const y1 = height;
  for (let i = 0; i <= capSegments; i += 1) {
    const a = (i / capSegments) * (Math.PI / 2);
    rings.push({ y: y0 - Math.sin(a) * radius, r: Math.cos(a) * radius, n: -Math.sin(a) });
  }
  rings.reverse();
  for (let i = 0; i <= capSegments; i += 1) {
    const a = (i / capSegments) * (Math.PI / 2);
    rings.push({ y: y1 + Math.sin(a) * radius, r: Math.cos(a) * radius, n: Math.sin(a) });
  }
  const ringIndex = [];
  for (let ri = 0; ri < rings.length; ri += 1) {
    const { y, r, n } = rings[ri];
    const idx = [];
    for (let i = 0; i <= radialSegments; i += 1) {
      const a = (i / radialSegments) * TAU;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const radial = Math.max(1 - n * n, 0) ** 0.5;
      idx.push(b.vertex(V3.new(ca * r, y, sa * r), V3.new(ca * radial, n, sa * radial)));
    }
    ringIndex.push(idx);
  }
  for (let ri = 0; ri + 1 < ringIndex.length; ri += 1) {
    const a = ringIndex[ri]; const c = ringIndex[ri + 1];
    for (let i = 0; i < radialSegments; i += 1) b.quad(a[i], a[i + 1], c[i + 1], c[i]);
  }
  return b.build();
}

/** Stub used by cable tubes: a strut between two points. */
export function strut(p0, p1, radius, radialSegments = 6) {
  const dir = V3.sub(p1, p0);
  const len = V3.len(dir);
  if (len < 1e-9) return { positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array() };
  const q = Quat.fromYTo(dir);
  const base = capsule(radius, len, radialSegments, 2);
  const b = new MeshBuilder();
  b.merge(base, q, p0);
  return b.build();
}

/** UV sphere. */
export function sphere(radius, segments = 18, rings = 12) {
  const b = new MeshBuilder();
  const grid = [];
  for (let r = 0; r <= rings; r += 1) {
    const phi = (r / rings) * Math.PI;
    const row = [];
    for (let s = 0; s <= segments; s += 1) {
      const theta = (s / segments) * TAU;
      const n = V3.new(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      row.push(b.vertex(V3.scale(n, radius), n));
    }
    grid.push(row);
  }
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      b.quad(grid[r][s], grid[r + 1][s], grid[r + 1][s + 1], grid[r][s + 1]);
    }
  }
  return b.build();
}

/** Torus in the XZ plane (valve wheel rim, bolt head knurl). */
export function torus(major, minor, majorSegs = 28, minorSegs = 10) {
  const b = new MeshBuilder();
  const grid = [];
  for (let i = 0; i <= majorSegs; i += 1) {
    const u = (i / majorSegs) * TAU;
    const row = [];
    for (let j = 0; j <= minorSegs; j += 1) {
      const v = (j / minorSegs) * TAU;
      const n = V3.new(Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v));
      const p = V3.new(
        (major + minor * Math.cos(v)) * Math.cos(u),
        minor * Math.sin(v),
        (major + minor * Math.cos(v)) * Math.sin(u),
      );
      row.push(b.vertex(p, n));
    }
    grid.push(row);
  }
  for (let i = 0; i < majorSegs; i += 1) {
    for (let j = 0; j < minorSegs; j += 1) {
      b.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
    }
  }
  return b.build();
}

// ---------------------------------------------------------------------------
// TRUNC cells — the metamaterial look
// ---------------------------------------------------------------------------

/**
 * One TRUNC cell.
 *  • truss      : two end collars + helical lattice struts (the torque channel)
 *  • equatorial : a slotted tube with equatorial rings (the tendon guide)
 */
export function truncCell(kind, length, radius, { struts = 6, rings = 3, thickness = 0.0016 } = {}) {
  const b = new MeshBuilder();
  if (kind === CELL_TRUSS) {
    const collarHeight = length * 0.06;
    for (const y of [0, length - collarHeight]) {
      b.merge(cylinder(radius, collarHeight, 18), null, V3.new(0, y + collarHeight / 2, 0));
    }
    // helical lattice: `struts` helical bands, each a chain of straight struts
    const turns = 0.42;
    const steps = 5;
    const segments = Math.max(4, Math.round(struts * 1.5));
    for (let s = 0; s < segments; s += 1) {
      const phase = (s / segments) * TAU;
      const handed = s % 2 === 0 ? 1 : -1;
      for (let i = 0; i < steps; i += 1) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const a0 = phase + handed * t0 * turns * TAU;
        const a1 = phase + handed * t1 * turns * TAU;
        const p0 = V3.new(Math.cos(a0) * radius * 0.92, length * (0.07 + t0 * 0.86), Math.sin(a0) * radius * 0.92);
        const p1 = V3.new(Math.cos(a1) * radius * 0.92, length * (0.07 + t1 * 0.86), Math.sin(a1) * radius * 0.92);
        b.merge(strut(p0, p1, thickness, 5));
      }
    }
  } else {
    // slotted shell: rings + vertical spines, gaps between them
    const spines = struts * 2;
    const ringCount = Math.max(2, rings);
    for (let r = 0; r < ringCount; r += 1) {
      const y = (r / (ringCount - 1)) * (length - thickness);
      b.merge(torus(radius * 0.98, thickness * 0.9, 26, 8), null, V3.new(0, y + thickness / 2, 0));
    }
    for (let s = 0; s < spines; s += 1) {
      const a = (s / spines) * TAU;
      const p0 = V3.new(Math.cos(a) * radius * 0.98, 0, Math.sin(a) * radius * 0.98);
      const p1 = V3.new(Math.cos(a) * radius * 0.98, length, Math.sin(a) * radius * 0.98);
      b.merge(strut(p0, p1, thickness * 0.8, 5));
    }
  }
  return b.build();
}

// ---------------------------------------------------------------------------
// Task props
// ---------------------------------------------------------------------------

/** Hex-head bolt along +Y, head at the origin. */
export function boltMesh(shank = 0.008, length = 0.05) {
  const b = new MeshBuilder();
  b.merge(cylinder(shank * 1.75, shank * 1.2, 6), null, V3.new(0, shank * 0.6, 0));
  b.merge(cylinder(shank, length, 18), null, V3.new(0, -length / 2, 0));
  // thread ridges: thin rings along the shank
  const ridges = 12;
  for (let i = 0; i < ridges; i += 1) {
    const y = -length * (0.15 + 0.8 * (i / ridges));
    b.merge(torus(shank * 1.05, shank * 0.12, 16, 6), null, V3.new(0, y, 0));
  }
  return b.build();
}

/** Lamp: glass bulb + threaded E27 base, +Y up. */
export function bulbMesh(radius = 0.03, total = 0.075) {
  const b = new MeshBuilder();
  b.merge(sphere(radius, 20, 14), null, V3.new(0, total - radius, 0));
  const neck = [0.0018, 0.0016, 0.0014].map((r, i) => cylinder(r, 0.004, 14));
  let y = total - radius * 1.55;
  for (const nick of neck) { b.merge(nick, null, V3.new(0, y, 0)); y -= 0.004; }
  b.merge(cylinder(0.0034, 0.014, 16), null, V3.new(0, y + 0.004, 0));
  return b.build();
}

/** Valve: body + hand wheel with spokes. */
export function valveMesh(r = 0.032) {
  const b = new MeshBuilder();
  b.merge(cylinder(r, 0.02, 20), null, V3.new(0, 0, 0));
  b.merge(torus(r * 0.95, 0.0035, 30, 10), null, V3.new(0, 0.012, 0));
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * TAU;
    b.merge(strut(V3.new(0, 0.012, 0), V3.new(Math.cos(a) * r * 0.95, 0.012, Math.sin(a) * r * 0.95), 0.0022, 6));
  }
  b.merge(cylinder(0.0045, 0.03, 14), null, V3.new(0, 0.02, 0));
  return b.build();
}

/** Peg for the insertion task. */
export function pegMesh(r = 0.006, length = 0.045) {
  const b = new MeshBuilder();
  b.merge(cylinder(r, length, 16), null, V3.new(0, length / 2, 0));
  b.merge(sphere(r, 14, 10), null, V3.new(0, 0, 0));
  return b.build();
}

/** Tool cartridge mounted on the wrist: collar + chuck + torque sensor ring. */
export function toolMesh() {
  const b = new MeshBuilder();
  b.merge(cylinder(0.016, 0.018, 18), null, V3.new(0, 0.009, 0));
  b.merge(torus(0.017, 0.003, 24, 8), null, V3.new(0, 0.022, 0));
  b.merge(cylinder(0.011, 0.03, 16), null, V3.new(0, 0.04, 0));
  b.merge(cylinder(0.0075, 0.022, 6), null, V3.new(0, 0.066, 0));
  return b.build();
}

/** Fixture furniture per task. */
export function fixtureMesh(kind, size) {
  const b = new MeshBuilder();
  const s = size ?? { x: 0.14, y: 0.02, z: 0.14 };
  switch (kind) {
    case 1: { // bracket
      b.merge(cube(s.x, s.y, s.z));
      b.merge(cube(s.y * 4, s.y * 4, s.z * 0.9), null, V3.new(s.x / 2 - s.y * 2, s.y * 2, 0));
      break;
    }
    case 2: { // lamp socket base
      b.merge(cylinder(s.x * 0.45, s.y, 20));
      b.merge(cube(s.x * 1.6, s.y * 0.5, s.z * 1.6), null, V3.new(0, -s.y, 0));
      break;
    }
    case 3: { // valve body with pipe stubs
      b.merge(cube(s.x, s.y, s.z));
      b.merge(cylinder(s.y * 0.7, s.x * 1.5, 16), Quat.fromAxisAngle(V3.new(1, 0, 0), Math.PI / 2), V3.new(0, 0, 0));
      break;
    }
    default: { // plate
      b.merge(cube(s.x, s.y, s.z));
      break;
    }
  }
  return b.build();
}

/** Cables: a bezier-smoothed tube through the guide points of one cable. */
export function tubeThrough(points, radius = 0.0022, radialSegments = 6) {
  const b = new MeshBuilder();
  let prev = null;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (prev && V3.dist(prev, p0) > 1e-9) {
      // overlap segments slightly so the joints do not show pin-holes
      const mid = V3.scale(V3.add(p0, prev), 0.5);
      b.merge(strut(mid, p0, radius, radialSegments));
    }
    b.merge(strut(p0, p1, radius, radialSegments));
    prev = p1;
  }
  return b.build();
}
