// Local wall thickness by inward ray casting on the SDF.
// For a sampled surface vertex p with outward unit normal n (from the SDF gradient), we start
// half a voxel inside the solid and march along -n with sphere tracing until the field becomes
// non-negative. The chord length is the local thickness through that point. The minimum chord
// over all sampled vertices is the minimum wall thickness; the 5th percentile and median are
// reported as context. Chords below one voxel are discarded as meshing artefacts.

import type { Field } from "../topology/fields.ts";
import type { MeshData } from "../types.ts";

export interface WallThickness {
  min: number;
  p5: number;
  median: number;
  chords: number;
  sampledVertices: number;
  unresolvedBelowVoxel: number;
}

/**
 * Surface samples within `faceMarginMm` of the build-envelope faces are skipped. Where a design is cut by
 * the envelope (open structures), the rim of the cut gives short inward chords that measure the cut, not a
 * wall. Such samples are counted in `excludedNearFaces`.
 */
export function rayWallThickness(
  field: Field,
  mesh: MeshData,
  h: number,
  maxSamples = 6000,
  faceMarginMm = 0,
): WallThickness & { excludedNearFaces: number } {
  const P = mesh.positions;
  const nv = P.length / 3;
  const stride = Math.max(1, Math.ceil(nv / maxSamples));
  const eps = h * 0.25;
  const chords: number[] = [];
  let sampled = 0;
  let belowVoxel = 0;
  let excludedNearFaces = 0;
  const bmin = field.bounds.min;
  const bmax = field.bounds.max;
  const maxT = 2 * Math.hypot(field.bounds.max[0] - field.bounds.min[0], field.bounds.max[1] - field.bounds.min[1], field.bounds.max[2] - field.bounds.min[2]);
  for (let vi = 0; vi < nv; vi += stride) {
    const px = P[vi * 3], py = P[vi * 3 + 1], pz = P[vi * 3 + 2];
    if (faceMarginMm > 0) {
      const dFace = Math.min(px - bmin[0], bmax[0] - px, py - bmin[1], bmax[1] - py, pz - bmin[2], bmax[2] - pz);
      if (dFace < faceMarginMm) {
        excludedNearFaces++;
        continue;
      }
    }
    // SDF gradient (outward).
    const gx = field.eval(px + eps, py, pz) - field.eval(px - eps, py, pz);
    const gy = field.eval(px, py + eps, pz) - field.eval(px, py - eps, pz);
    const gz = field.eval(px, py, pz + eps) - field.eval(px, py, pz - eps);
    const gl = Math.hypot(gx, gy, gz);
    if (gl < 1e-12) continue;
    const nx = gx / gl, ny = gy / gl, nz = gz / gl;
    sampled++;
    // Project the vertex onto the zero level along the gradient, then start a tenth of a voxel
    // inside. Starting from the raw vertex (up to h/2 off the surface) would skip thin features.
    const f0 = field.eval(px, py, pz);
    const qx = px - nx * f0, qy = py - ny * f0, qz = pz - nz * f0;
    const sx = qx - nx * 0.1 * h, sy = qy - ny * 0.1 * h, sz = qz - nz * 0.1 * h;
    if (field.eval(sx, sy, sz) >= 0) continue;
    let t = 0;
    let fPrev = field.eval(sx, sy, sz);
    let tPrev = 0;
    let exitT = -1;
    for (let it = 0; it < 2000 && t < maxT; it++) {
      const step = Math.max(0.5 * h, 0.8 * -fPrev);
      tPrev = t;
      t += step;
      const f = field.eval(sx - nx * t, sy - ny * t, sz - nz * t);
      if (f >= 0) {
        // Linear interpolation of the crossing between tPrev and t.
        const fp = fPrev;
        const frac = fp === f ? 0 : -fp / (f - fp);
        exitT = tPrev + Math.min(1, Math.max(0, frac)) * (t - tPrev);
        break;
      }
      fPrev = f;
    }
    if (exitT < 0) continue;
    const chord = exitT + 0.1 * h;
    if (chord < h) {
      belowVoxel++;
      continue;
    }
    chords.push(chord);
  }
  chords.sort((a, b) => a - b);
  const at = (q: number) => (chords.length ? chords[Math.min(chords.length - 1, Math.floor(q * (chords.length - 1)))] : 0);
  return {
    min: chords.length ? chords[0] : 0,
    p5: at(0.05),
    median: at(0.5),
    chords: chords.length,
    sampledVertices: sampled,
    unresolvedBelowVoxel: belowVoxel,
    excludedNearFaces,
  };
}
