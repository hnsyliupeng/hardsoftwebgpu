// WebGPU compute path for the SC strut field (D2), with a CPU fallback.
//
// evalScGrid() evaluates the instanced SC field (src/topology/instanced.ts) on a regular grid.
// If navigator.gpu gives an adapter, the WGSL kernel (sc_field_wgsl.ts, generated from the same
// reference) runs one invocation per grid point. Otherwise the CPU reference runs. Both write
// index = i + nx * (j + ny * k), so the results can be compared point by point.
//
// Status: the CPU reference and the WGSL text are tested in Node (tests/instanced.test.ts). The
// GPU path has not been run on a GPU in this sandbox; it is written against the WebGPU API and
// falls back to the CPU reference if no adapter or device is available.

import { scInstancedValue, type ScInstanced } from "../../src/topology/instanced.ts";
import { SC_FIELD_WGSL } from "./sc_field_wgsl.ts";

export interface ScGrid {
  origin: [number, number, number];
  spacing: number;
  dims: [number, number, number];
  lattice: ScInstanced;
}

export interface ScGridResult {
  field: Float32Array;
  backend: "webgpu" | "cpu";
  ms: number;
}

/** CPU reference: the same values the WGSL kernel writes. */
export function cpuScGrid(g: ScGrid): Float32Array {
  const [nx, ny, nz] = g.dims;
  const out = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const p: [number, number, number] = [
          g.origin[0] + g.spacing * i,
          g.origin[1] + g.spacing * j,
          g.origin[2] + g.spacing * k,
        ];
        out[i + nx * (j + ny * k)] = scInstancedValue(p, g.lattice);
      }
  return out;
}

// WebGPU usage flags, as numbers (so this module does not depend on a global GPUBufferUsage).
const USAGE = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 };

async function gpuScGrid(device: any, g: ScGrid): Promise<Float32Array> {
  const [nx, ny, nz] = g.dims;
  const n = nx * ny * nz;

  // Uniform block: vec3 origin, f32 spacing, vec3<u32> dims, f32 cell, vec3<u32> cells, f32 radius (48 bytes).
  const params = new ArrayBuffer(48);
  const f = new Float32Array(params);
  const u = new Uint32Array(params);
  f[0] = g.origin[0];
  f[1] = g.origin[1];
  f[2] = g.origin[2];
  f[3] = g.spacing;
  u[4] = nx;
  u[5] = ny;
  u[6] = nz;
  f[7] = g.lattice.a;
  u[8] = g.lattice.cells[0];
  u[9] = g.lattice.cells[1];
  u[10] = g.lattice.cells[2];
  f[11] = g.lattice.r;

  const uniform = device.createBuffer({ size: 48, usage: USAGE.UNIFORM | USAGE.COPY_DST });
  device.queue.writeBuffer(uniform, 0, params);
  const storage = device.createBuffer({ size: n * 4, usage: USAGE.STORAGE | USAGE.COPY_SRC });
  const readback = device.createBuffer({ size: n * 4, usage: USAGE.COPY_DST | USAGE.MAP_READ });

  const module = device.createShaderModule({ code: SC_FIELD_WGSL });
  const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: storage } },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(Math.ceil(nx / 4), Math.ceil(ny / 4), Math.ceil(nz / 4));
  pass.end();
  encoder.copyBufferToBuffer(storage, 0, readback, 0, n * 4);
  device.queue.submit([encoder.finish()]);

  await readback.mapAsync(1); // GPUMapMode.READ
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  uniform.destroy();
  storage.destroy();
  readback.destroy();
  return out;
}

/** Evaluate the SC field on a grid: WebGPU when available, CPU reference otherwise. */
export async function evalScGrid(g: ScGrid): Promise<ScGridResult> {
  const t0 = performance.now();
  const gpu = (globalThis as { navigator?: { gpu?: any } }).navigator?.gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        const device = await adapter.requestDevice();
        const field = await gpuScGrid(device, g);
        return { field, backend: "webgpu", ms: performance.now() - t0 };
      }
    } catch {
      // No usable adapter or device: fall back to the CPU reference below.
    }
  }
  return { field: cpuScGrid(g), backend: "cpu", ms: performance.now() - t0 };
}
