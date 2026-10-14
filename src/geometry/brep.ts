// Exact B-Rep geometry through the SMLib NURBS kernel compiled to WebAssembly
// (@classcad/smlibwasm, MIT / Apache-2.0 NVIDIA usd-brep). No Blender, no Python, no network.
//
// Frame convention: the kernel solid is built centred on the origin in x,y and spans
// z in [-S, S] (S = size/2), then translated by (S, S, S) so the build cube is [0, size]^3.
// Base-frame z in [0, 2] maps to centred z = (z_base - 1) * S.

import type { BrepPlan } from "../bio/families.ts";

export interface BrepSolid {
  /** Kernel solid (opaque). */
  shape: unknown;
  volume: number;
  area: number;
  centerOfMass: [number, number, number];
  /** Named bodies (e.g. tubular "matrix" and "cortex") with their exact volumes. */
  parts: Record<string, { volume: number }>;
  /** Triangle mesh from the kernel tessellation (for rendering / STL). */
  mesh: { positions: Float32Array; indices: Uint32Array; normals: Float32Array };
}

type Kernel = typeof import("@classcad/smlibwasm");

let kernelPromise: Promise<Kernel> | null = null;
/**
 * Loads the kernel. In Node the bare specifier resolves through node_modules. In the browser
 * bundle the package is shipped as a runtime asset and the worker sets `globalThis.__SMLIB_URL`
 * to its entry URL, because bundling the kernel's top-level-await glue hangs at initialisation.
 */
export function loadKernel(): Promise<Kernel> {
  if (!kernelPromise) {
    const spec = (globalThis as { __SMLIB_URL?: string }).__SMLIB_URL ?? "@classcad/smlibwasm";
    kernelPromise = import(/* @vite-ignore */ spec) as Promise<Kernel>;
  }
  return kernelPromise;
}

function measure(shape: any): { volume: number; area: number; centerOfMass: [number, number, number] } {
  const mp = shape.massProperties();
  const c = mp.center;
  return {
    volume: shape.volume as number,
    area: shape.area as number,
    centerOfMass: [c.x ?? c[0], c.y ?? c[1], c.z ?? c[2]],
  };
}

function meshOf(K: Kernel, shape: any): BrepSolid["mesh"] {
  const t = K.tessellate(shape);
  const positions = Float32Array.from(t.vertices as ArrayLike<number>);
  const indices = Uint32Array.from(t.triangles as ArrayLike<number>);
  const normals = Float32Array.from((t.normals as ArrayLike<number>) ?? []);
  return { positions, indices, normals };
}

function fuseAll(shapes: any[]): any {
  let acc = shapes[0];
  for (let i = 1; i < shapes.length; i++) acc = acc.fuse(shapes[i]);
  return acc;
}

export async function buildBrep(plan: BrepPlan, sizeMm: number): Promise<BrepSolid> {
  const K = await loadKernel();
  const { Box, Cylinder, Pos, Rot, Ellipse } = K as any;
  const S = sizeMm / 2;
  const parts: Record<string, { volume: number }> = {};
  let solid: any;

  if (plan.kind === "helical") {
    const plies: any[] = [];
    for (const ply of plan.plies) {
      const tp = ply.thickness * S;
      let piece: any;
      if (plan.fiber === "plate") {
        piece = Box(2 * S, 2 * S, tp);
      } else if (plan.fiber === "rect") {
        piece = fuseAll(
          ply.fiberCentersY.map((yk) => Pos(0, yk * S, 0).mul(Box(2 * S, tp, tp))),
        );
      } else {
        piece = fuseAll(
          ply.fiberCentersY.map((yk) => Pos(0, yk * S, 0).mul(Rot(0, 90, 0).mul(Cylinder(tp / 2, 2 * S)))),
        );
      }
      const zc = (ply.zCenter - 1) * S; // centred z
      plies.push(Pos(0, 0, zc).mul(Rot(0, 0, ply.angleDeg).mul(piece)));
    }
    const stack = fuseAll(plies);
    const clip = Box(2 * S, 2 * S, 2 * S);
    solid = stack.intersect(clip);
  } else {
    const L = 2 * S;
    const matrixBox = Box(L, L, L);
    const outerHoles = plan.holes.map((h) =>
      Pos(h.x * S, h.y * S, 0).mul(
        plan.rx === plan.ry ? Cylinder(plan.rx * S, 2 * L) : ellipseCutter(Ellipse, Pos, plan.rx * S, plan.ry * S, L),
      ),
    );
    const outerCut = outerHoles.reduce((acc, h) => acc.fuse(h));
    const matrix = matrixBox.cut(outerCut);
    if (plan.layer) {
      const innerHoles = plan.holes.map((h) =>
        Pos(h.x * S, h.y * S, 0).mul(
          plan.layer!.rxInner === plan.layer!.ryInner
            ? Cylinder(plan.layer!.rxInner * S, 2 * L)
            : ellipseCutter(Ellipse, Pos, plan.layer!.rxInner * S, plan.layer!.ryInner * S, L),
        ),
      );
      const innerCut = innerHoles.reduce((acc, h) => acc.fuse(h));
      const cortex = matrixBox.cut(innerCut).intersect(outerCut);
      parts.matrix = { volume: matrix.volume };
      parts.cortex = { volume: cortex.volume };
      solid = matrix.fuse(cortex);
    } else {
      solid = matrix;
    }
  }
  const translated = Pos(S, S, S).mul(solid);
  const m = measure(translated);
  return {
    shape: translated,
    volume: m.volume,
    area: m.area,
    centerOfMass: m.centerOfMass,
    parts,
    mesh: meshOf(K, translated),
  };
}

/** Elliptical through-cutter. Ellipse(a,b).extrude(h) spans z in [0,h]; re-centre it on z in [-L, L]. */
function ellipseCutter(Ellipse: any, Pos: any, a: number, b: number, L: number): any {
  return Pos(0, 0, -L).mul(Ellipse(a, b).extrude(2 * L));
}
