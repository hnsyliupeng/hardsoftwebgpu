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
/**
 * One TRUNC stage: a *nested* truss cell with end rings.
 *
 * The paper's joint is not a smooth spring — it is two truss layers (an outer
 * and an inner flexure set) whose struts cross in a diamond lattice, closed by a
 * ring at each end. The tendons run in the annulus between the two layers, and
 * the *equatorial guide* (see `truncGuide`) holds them at that radius.
 *
 * The mesh is built **centred on y = 0** because `Arm.bones()` reports each cell's
 * mid transform: building it from 0…L and placing it at the centre offsets every
 * instance by half a cell, which stacks the rings into what reads as a coil.
 */
export function truncCell(kind, length, radius, { struts = 6, rings = 3, thickness = 0.0016 } = {}) {
  const b = new MeshBuilder();
  const half = length / 2;

  if (kind === CELL_TRUSS) {
    const rOuter = radius;
    const t = Math.max(thickness * 2.1, 0.0032);      // struts must survive the 1-pixel cull
    const rCore = radius * 0.30;
    // A helical run between two phases, as a chain of straight struts.
    const helix = (r, phase0, phase1, steps, rad) => {
      let prev = null;
      for (let i = 0; i <= steps; i += 1) {
        const f = i / steps;
        const a = phase0 + (phase1 - phase0) * f;
        const p = V3.new(Math.cos(a) * r, -half + length * f, Math.sin(a) * r);
        if (prev) b.merge(strut(prev, p, rad, 4));
        prev = p;
      }
    };
    // outer layer: a diamond lattice (three right-hand + three left-hand runs)
    for (let k = 0; k < 3; k += 1) {
      const phase = (k / 3) * TAU;
      helix(rOuter, phase, phase + TAU / 3, 3, t);
      helix(rOuter, phase + TAU / 3, phase, 3, t);
    }
    // the nested flex shaft: the central member that carries the torque
    b.merge(cylinder(rCore, length * 0.92, 10, true), null, V3.new(0, 0, 0));
    // end rings (the cell boundaries the next stage keys into)
    for (const y of [-half, half]) {
      b.merge(torus(rOuter, Math.max(thickness * 1.15, 0.0019), 14, 5), null, V3.new(0, y, 0));
      b.merge(torus(rCore * 1.5, Math.max(thickness * 1.0, 0.0016), 10, 4), null, V3.new(0, y, 0));
    }
    // longitudinal spines tying the rings together
    for (let i = 0; i < struts; i += 1) {
      const a = (i / struts) * TAU + TAU / 12;
      b.merge(strut(
        V3.new(Math.cos(a) * rOuter, -half, Math.sin(a) * rOuter),
        V3.new(Math.cos(a) * rOuter, half, Math.sin(a) * rOuter),
        t * 0.5, 4,
      ));
    }
  } else {
    // ---- equatorial guide: the collar the tendons pass through
    const collar = radius * 1.04;
    b.merge(torus(collar, Math.max(thickness * 2.4, 0.0032), 14, 5), null, V3.new(0, 0, 0));
    b.merge(cylinder(collar * 0.97, 0.008, 14, false), null, V3.new(0, 0, 0));
    // nine cable bores, evenly spaced, in the tendon annulus
    const bores = Math.max(3, struts + 3);
    for (let i = 0; i < bores; i += 1) {
      const a = (i / bores) * TAU;
      b.merge(
        cylinder(Math.max(thickness * 2.6, 0.0036), 0.012, 5, true),
        null,
        V3.new(Math.cos(a) * radius * 0.9, 0, Math.sin(a) * radius * 0.9),
      );
    }
    void rings;
  }
  return b.build();
}

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
/**
 * The tool joint: the rigid torque-transmitting section (52× torsion/bending in
 * the paper) with the hex drive that seats the bolt. Drawn as a stepped housing
 * so the tip is unmistakable at a glance.
 */
export function toolMesh() {
  const b = new MeshBuilder();
  b.merge(cylinder(0.019, 0.026, 18), null, V3.new(0, 0.013, 0));
  b.merge(torus(0.0205, 0.0032, 18, 6), null, V3.new(0, 0.028, 0));
  b.merge(cylinder(0.0135, 0.022, 14), null, V3.new(0, 0.041, 0));
  b.merge(torus(0.016, 0.0026, 16, 5), null, V3.new(0, 0.053, 0));
  b.merge(cylinder(0.0105, 0.03, 12), null, V3.new(0, 0.068, 0));
  b.merge(cylinder(0.0072, 0.024, 6), null, V3.new(0, 0.094, 0));   // hex drive
  return b.build();
}

/**
 * The bench: a frame of four plates with a central opening.
 *
 * The arm is mounted on the *floor* and rises to the working volume, so a solid
 * slab would pass straight through its lower cells — that is not a rendering
 * artefact, it is intersecting geometry. Real rigs have a cut-out for exactly
 * this reason, so the table is drawn as a frame around the arm's base.
 */
export function benchFrame({ halfX = 0.575, halfZ = 0.475, thickness = 0.035, hole = 0.20 } = {}) {
  const b = new MeshBuilder();
  const y = -thickness / 2;
  const plate = (x0, x1, z0, z1) => {
    const sx = x1 - x0;
    const sz = z1 - z0;
    b.merge(cube(sx, thickness, sz), null, V3.new((x0 + x1) / 2, y, (z0 + z1) / 2));
  };
  plate(-halfX, halfX, hole, halfZ);          // north
  plate(-halfX, halfX, -halfZ, -hole);        // south
  plate(-halfX, -hole, -hole, hole);          // west
  plate(hole, halfX, -hole, hole);            // east
  return b.build();
}

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
