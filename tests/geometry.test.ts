import { test } from "node:test";
import assert from "node:assert/strict";
import { rayWallThickness } from "../src/validation/thickness.ts";
import { sampleField, surfaceNets } from "../src/geometry/grid.ts";
import { sdBox } from "../src/topology/fields.ts";
import type { Field } from "../src/topology/fields.ts";
import { evaluateSpec } from "../src/evaluate.ts";
import { parseIntent } from "../src/intent/intent.ts";
import { binaryStl, asciiStl, gltfJson, webgpuBuffers } from "../src/export/export.ts";
import { encodePng } from "../src/render/preview.ts";

const box = (min: number, max: number, eval_: (x: number, y: number, z: number) => number): Field => ({
  bounds: { min: [min, min, min], max: [max, max, max] },
  eval: eval_,
  expr: "custom",
});

test("ray wall thickness recovers known thicknesses (slab, sphere, tube wall, cube)", () => {
  const cases: [string, Field, number][] = [
    ["slab 2 mm", box(0, 20, (x, y, z) => sdBox(x - 10, y - 10, z - 10, 10, 10, 1)), 2],
    ["sphere r=3", box(0, 20, (x, y, z) => Math.hypot(x - 10, y - 10, z - 10) - 3), 6],
    ["tube wall 0.4", box(0, 20, (x, y) => Math.max(Math.hypot(x - 10, y - 10) - 5, 4.6 - Math.hypot(x - 10, y - 10))), 0.4],
    ["cube 10", box(0, 20, (x, y, z) => sdBox(x - 10, y - 10, z - 10, 5, 5, 5)), 10],
  ];
  for (const [name, f, expected] of cases) {
    const g = sampleField(f, 64);
    const m = surfaceNets(g);
    const r = rayWallThickness(f, m, g.h);
    assert.ok(r.chords > 0, `${name}: no chords`);
    assert.ok(Math.abs(r.min - expected) / expected < 0.05, `${name}: min ${r.min} vs ${expected}`);
  }
});

test("exact B-Rep vs SDF volume agree for helical and tubular families", async () => {
  for (const prompt of [
    "Make a helical Bouligand structure with 5 plies, 10 degrees rotation.",
    "Make a tubular structure with 16 tubules and cortical layer thickness 0.04.",
  ]) {
    const spec = parseIntent(prompt).data;
    spec.constraints.resolution = 64;
    const ev = await evaluateSpec(spec);
    const err = ev.validation.data.metrics.brep_vs_sdf_volume_rel_err;
    assert.ok(err !== null, "expected B-Rep");
    assert.ok(err < 0.03, `${prompt}: relative error ${err}`);
  }
});

test("export: binary STL size, ASCII STL structure, glTF accessors, WebGPU stride", async () => {
  const spec = parseIntent("gyroid TPMS wall thickness 0.6 mm, 5 mm cell").data;
  spec.constraints.resolution = 40;
  const ev = await evaluateSpec(spec);
  const mesh = ev.geometry.data.mesh;
  const tris = mesh.indices.length / 3;
  const stl = binaryStl(mesh, "t");
  assert.equal(stl.length, 84 + 50 * tris);
  assert.equal(new DataView(stl.buffer).getUint32(80, true), tris);
  const ascii = asciiStl(mesh, "t");
  assert.ok(ascii.startsWith("solid t") && ascii.trimEnd().endsWith("endsolid t"));
  const g = gltfJson(mesh, "t") as any;
  assert.equal(g.accessors[0].count, mesh.indices.length);
  assert.equal(g.accessors[1].count, mesh.positions.length / 3);
  const wg = webgpuBuffers(mesh);
  assert.equal(wg.stride, 24);
  assert.equal(wg.vertices.length, wg.vertexCount * 6);
});

test("PNG encoder writes a valid signature and IHDR size", () => {
  const w = 4, h = 3;
  const rgba = new Uint8Array(w * h * 4).fill(200);
  const png = encodePng(w, h, rgba);
  assert.deepEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset);
  assert.equal(dv.getUint32(16), w);
  assert.equal(dv.getUint32(20), h);
});
