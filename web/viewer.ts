// Mesh viewer with automatic backend selection: WebGPU -> WebGL2 -> CPU (preview image).
// The shader and the matrix conventions are identical across the GPU backends, so the same
// interleaved buffers (position xyz, normal xyz; stride 24 bytes) are used everywhere.

import { lookAt, multiply, perspective, perspectiveZeroOne, rotationX, rotationY, translation } from "./mat4.ts";

export type Backend = "webgpu" | "webgl2" | "cpu";

export interface MeshInput {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface Viewer {
  backend: Backend;
  destroy(): void;
}

const WGSL = /* wgsl */ `
struct U { mvp: mat4x4<f32>, };
@group(0) @binding(0) var<uniform> u: U;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) n: vec3<f32>, };
@vertex fn vs(@location(0) p: vec3<f32>, @location(1) n: vec3<f32>) -> VSOut {
  var o: VSOut;
  o.pos = u.mvp * vec4<f32>(p, 1.0);
  o.n = n;
  return o;
}
@fragment fn fs(@location(0) n: vec3<f32>) -> @location(0) vec4<f32> {
  let l = normalize(vec3<f32>(0.4, 0.6, 0.7));
  let d = abs(dot(normalize(n), l));
  return vec4<f32>(vec3<f32>(0.35, 0.52, 0.75) * (0.35 + 0.65 * d), 1.0);
}`;

const GLSL_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; uniform mat4 uMvp; out vec3 vN;
void main(){ vN = aNrm; gl_Position = uMvp * vec4(aPos, 1.0); }`;
const GLSL_FS = `#version 300 es
precision highp float; in vec3 vN; out vec4 o;
void main(){ vec3 l = normalize(vec3(0.4,0.6,0.7)); float d = abs(dot(normalize(vN), l));
  o = vec4(vec3(0.35,0.52,0.75) * (0.35 + 0.65 * d), 1.0); }`;

function interleave(m: MeshInput): Float32Array {
  const n = m.positions.length / 3;
  const v = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    v[i * 6] = m.positions[i * 3];
    v[i * 6 + 1] = m.positions[i * 3 + 1];
    v[i * 6 + 2] = m.positions[i * 3 + 2];
    v[i * 6 + 3] = m.normals[i * 3] ?? 0;
    v[i * 6 + 4] = m.normals[i * 3 + 1] ?? 0;
    v[i * 6 + 5] = m.normals[i * 3 + 2] ?? 1;
  }
  return v;
}

function bounds(p: Float32Array): { c: number[]; r: number } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const r = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
  return { c, r };
}

/** Camera matrix for orbit angles; the model is centred and normalised to a unit sphere. */
function mvp(mesh: MeshInput, ax: number, ay: number, aspect: number, zeroOne: boolean): Float32Array {
  const { c, r } = bounds(mesh.positions);
  const model = multiply(rotationX(ax), multiply(rotationY(ay), translation(-c[0], -c[1], -c[2])));
  const scale = new Float32Array([1 / r, 0, 0, 0, 0, 1 / r, 0, 0, 0, 0, 1 / r, 0, 0, 0, 0, 1]);
  const view = lookAt([0, 0, 3.2], [0, 0, 0], [0, 1, 0]);
  const proj = zeroOne ? perspectiveZeroOne(0.6, aspect, 0.1, 20) : perspective(0.6, aspect, 0.1, 20);
  return multiply(proj, multiply(view, multiply(scale, model)));
}

function attachDrag(canvas: HTMLCanvasElement, state: { ax: number; ay: number }, redraw: () => void): void {
  let down = false, lx = 0, ly = 0;
  canvas.addEventListener("pointerdown", (e) => { down = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => (down = false));
  canvas.addEventListener("pointermove", (e) => {
    if (!down) return;
    state.ay += (e.clientX - lx) * 0.01;
    state.ax += (e.clientY - ly) * 0.01;
    lx = e.clientX; ly = e.clientY;
    redraw();
  });
}

export interface BackendEnv {
  /** navigator.gpu is present and an adapter can be requested. */
  webgpu: boolean;
  /** A WebGL2 context can be created on the canvas. */
  webgl2: boolean;
}

/**
 * Ordered backend list for the environment. Automatic choice is WebGL2 first: it is the path that
 * was executed and seen rendering in headless Chromium; WebGPU is used when WebGL2 is missing, or
 * when explicitly requested. The list always ends in "cpu", which is always available.
 * `force` (from the page URL, e.g. ?backend=cpu) restricts the list; CPU-only verification uses it.
 */
export function backendOrder(env: BackendEnv, force?: Backend): Backend[] {
  if (force === "cpu") return ["cpu"];
  if (force === "webgl2") return env.webgl2 ? ["webgl2", "cpu"] : ["cpu"];
  if (force === "webgpu") return [...(env.webgpu ? ["webgpu" as const] : []), ...(env.webgl2 ? ["webgl2" as const] : []), "cpu"];
  return [...(env.webgl2 ? ["webgl2" as const] : []), ...(env.webgpu ? ["webgpu" as const] : []), "cpu"];
}

/** First entry of backendOrder: the backend that is tried first. */
export function chooseBackend(env: BackendEnv, force?: Backend): Backend {
  return backendOrder(env, force)[0];
}

/** Tries the backends in order and returns the first that starts; "cpu" always succeeds. */
export async function createViewer(canvas: HTMLCanvasElement, mesh: MeshInput, force?: Backend): Promise<Viewer> {
  const gpu = (navigator as any).gpu;
  for (const b of backendOrder({ webgpu: !!gpu, webgl2: true }, force)) {
    try {
      if (b === "cpu") break;
      if (b === "webgl2") {
        const gl = canvas.getContext("webgl2", { antialias: true }) as WebGL2RenderingContext | null;
        if (gl) return webgl2Viewer(canvas, mesh, gl);
      } else {
        const adapter = await gpu.requestAdapter();
        if (adapter) {
          const device = await adapter.requestDevice();
          return await webgpuViewer(canvas, mesh, device, gpu.getPreferredCanvasFormat());
        }
      }
    } catch (e) {
      console.warn(`${b} unavailable, trying the next backend:`, e);
    }
  }
  return { backend: "cpu", destroy() {} };
}

async function webgpuViewer(canvas: HTMLCanvasElement, mesh: MeshInput, device: any, format: string): Promise<Viewer> {
  const ctx = canvas.getContext("webgpu") as any;
  if (!ctx) throw new Error("no webgpu canvas context");
  ctx.configure({ device, format, alphaMode: "opaque" });
  const verts = interleave(mesh);
  const vb = device.createBuffer({ size: verts.byteLength, usage: 0x20 | 0x08, mappedAtCreation: false }); // VERTEX | COPY_DST
  device.queue.writeBuffer(vb, 0, verts);
  const ib = device.createBuffer({ size: Math.ceil(mesh.indices.byteLength / 4) * 4, usage: 0x10 | 0x08 }); // INDEX | COPY_DST
  device.queue.writeBuffer(ib, 0, mesh.indices);
  const ub = device.createBuffer({ size: 64, usage: 0x40 | 0x08 }); // UNIFORM | COPY_DST
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }, { shaderLocation: 1, offset: 12, format: "float32x3" }] }],
    },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });
  const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub } }] });
  const state = { ax: -0.5, ay: 0.6 };
  let depth: any = null;
  let raf = 0;
  const draw = () => {
    raf = 0;
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    if (!depth || depth.width !== w || depth.height !== h) {
      depth?.destroy();
      depth = device.createTexture({ size: [w, h], format: "depth24plus", usage: 0x10 }); // RENDER_ATTACHMENT
    }
    device.queue.writeBuffer(ub, 0, mvp(mesh, state.ax, state.ay, w / h, true));
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 1, g: 1, b: 1, a: 1 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.setVertexBuffer(0, vb);
    pass.setIndexBuffer(ib, "uint32");
    pass.drawIndexed(mesh.indices.length);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  attachDrag(canvas, state, redraw);
  redraw();
  return { backend: "webgpu", destroy() { cancelAnimationFrame(raf); vb.destroy(); ib.destroy(); ub.destroy(); depth?.destroy(); } };
}

function webgl2Viewer(canvas: HTMLCanvasElement, mesh: MeshInput, gl: WebGL2RenderingContext): Viewer {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, GLSL_VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, GLSL_FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, interleave(mesh), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos"), aNrm = gl.getAttribLocation(prog, "aNrm");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(aNrm);
  gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 24, 12);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  const uMvp = gl.getUniformLocation(prog, "uMvp");
  const state = { ax: -0.5, ay: 0.6 };
  let raf = 0;
  const draw = () => {
    raf = 0;
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uMvp, false, mvp(mesh, state.ax, state.ay, w / h, false));
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  attachDrag(canvas, state, redraw);
  redraw();
  return { backend: "webgl2", destroy() { cancelAnimationFrame(raf); gl.deleteBuffer(vb); gl.deleteBuffer(ib); } };
}
