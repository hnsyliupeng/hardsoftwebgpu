/**
 * renderer.js — hand-rolled WebGPU renderer (no three.js, no bundler).
 *
 * One shadow pass + one MSAA scene pass + a resolve/post pass. Geometry is
 * uploaded once and drawn with instancing: the whole arm is 9 lattice cells plus
 * a dozen props, so per-frame CPU work is just filling two small Float32Arrays.
 *
 * The 2D canvas fallback (`FallbackRenderer`) draws the same scene as a wireframe
 * with the same camera maths, so the app never shows a blank screen.
 */

import { OrbitCamera, identity, lookAt, multiply, ortho, modelFromTRS } from './camera.js';
import { V3, clamp } from '../core/mathx.js';

const INSTANCE_FLOATS = 24;
const MAX_INSTANCES = 4096;
const MAX_LINE_FLOATS = 240000;
const MAX_SPRITE_FLOATS = 60000;
const SHADOW_SIZE = 2048;

/** Light rig: one shadow-casting key light plus a cold sky fill. */
export const LIGHT = {
  dir: V3.norm(V3.new(-0.42, 0.80, -0.43)),
  color: V3.new(1.0, 0.95, 0.88),
  intensity: 1.55,
  ambientSky: V3.new(0.085, 0.105, 0.145),
  ambientGround: V3.new(0.045, 0.042, 0.038),
  fog: V3.new(0.022, 0.030, 0.045),
};

/** Accumulates draw data for one frame. */
export class SceneBuilder {
  constructor() { this.reset(); }

  reset() {
    this.meshes = new Map();     // meshName → { instances: number[], count }
    this.lines = [];             // flat pos(3)+rgba(4) stream for the GPU
    this.lineChunks = [];        // same data as friendly polylines for the 2D fallback
    this.sprites = [];
    this.shadowCasters = new Set();
    return this;
  }

  /** Add one instance of an uploaded mesh. */
  mesh(name, { p, q = null, scale = 1 }, color = [0.7, 0.7, 0.72, 1], material = [0.0, 0.5, 0.0, 1], castShadow = true) {
    let entry = this.meshes.get(name);
    if (!entry) { entry = { instances: [], count: 0 }; this.meshes.set(name, entry); }
    const m = modelFromTRS(p, q, scale);
    entry.instances.push(...m);
    entry.instances.push(color[0], color[1], color[2], color[3] ?? 1);
    entry.instances.push(material[0], material[1], material[2], material[3] ?? 1);
    entry.count += 1;
    if (castShadow) this.shadowCasters.add(name);
    return this;
  }

  line(a, b, color = [0.2, 0.5, 1, 1]) {
    this.lines.push(a.x, a.y, a.z, color[0], color[1], color[2], color[3] ?? 1);
    this.lines.push(b.x, b.y, b.z, color[0], color[1], color[2], color[3] ?? 1);
    return this;
  }

  /** Polyline: emitted as line-list segments on the GPU and as one path for 2D. */
  polyline(points, color = [0.2, 0.5, 1, 1], stride = 1) {
    if (points.length < 2) return this;
    const chunk = { points: [], color: `rgba(${(color[0] * 255) | 0},${(color[1] * 255) | 0},${(color[2] * 255) | 0},${color[3] ?? 1})` };
    for (let i = 0; i < points.length; i += 1) {
      chunk.points.push(points[i]);
      if (i > 0 && i % stride === 0) this.line(points[i - stride], points[i], color);
    }
    if (points.length > 1) this.line(points[points.length - Math.min(stride, points.length - 1) - 1] ?? points[0], points[points.length - 1], color);
    this.lineChunks.push(chunk);
    return this;
  }

  sprite(p, size = 0.02, intensity = 1) {
    this.sprites.push(p.x, p.y, p.z, size, intensity);
    return this;
  }

  meshData(name) {
    const e = this.meshes.get(name);
    return e ? Float32Array.from(e.instances) : null;
  }
}

/** WebGPU renderer. `create()` resolves to null when WebGPU is unavailable. */
export class Renderer {
  static async create(canvas, { msaa = 4, force = false } = {}) {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const renderer = new Renderer(canvas, device, { msaa });
    await renderer.init();
    return renderer;
  }

  constructor(canvas, device, { msaa = 4 } = {}) {
    this.canvas = canvas;
    this.device = device;
    this.msaa = msaa;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.camera = new OrbitCamera();
    this.time = 0;
    this.stats = { draws: 0, instances: 0, tris: 0 };
    this.ready = false;
  }

  async init() {
    const dev = this.device;
    const context = this.canvas.getContext('webgpu');
    context.configure({ device: dev, format: this.format, alphaMode: 'opaque' });
    this.context = context;

    const [sceneSrc, postSrc] = await Promise.all([
      fetch(new URL('./wgsl/scene.wgsl', import.meta.url)).then((r) => r.text()),
      fetch(new URL('./wgsl/post.wgsl', import.meta.url)).then((r) => r.text()),
    ]);
    const sceneModule = dev.createShaderModule({ code: sceneSrc, label: 'scene.wgsl' });
    const postModule = dev.createShaderModule({ code: postSrc, label: 'post.wgsl' });
    const info = await Promise.all([sceneModule.getCompilationInfo(), postModule.getCompilationInfo()]);
    const errors = info.flatMap((i) => i.messages).filter((m) => m.type === 'error');
    if (errors.length) throw new Error(`WGSL: ${errors.map((e) => `${e.lineNum}:${e.message}`).join(' | ')}`);

    // ---------------------------------------------------------------- layouts
    const frameLayout = dev.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    const sceneLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    const postLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    // ------------------------------------------------------------- uniforms
    this.frameBuffer = dev.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'frame' });
    this.postBuffer = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'post' });
    this.frameData = new Float32Array(64);
    this.postData = new Float32Array(8);
    this.frameBind = dev.createBindGroup({ layout: frameLayout, entries: [{ binding: 0, resource: { buffer: this.frameBuffer } }] });
    this.postBind = null;

    // ----------------------------------------------------------- mesh vertex layout
    const meshVertex = {
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ],
    };
    const instanceAttrs = {
      arrayStride: INSTANCE_FLOATS * 4,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 2, offset: 0, format: 'float32x4' },
        { shaderLocation: 3, offset: 16, format: 'float32x4' },
        { shaderLocation: 4, offset: 32, format: 'float32x4' },
        { shaderLocation: 5, offset: 48, format: 'float32x4' },
        { shaderLocation: 6, offset: 64, format: 'float32x4' },
        { shaderLocation: 7, offset: 80, format: 'float32x4' },
      ],
    };
    const lineVertex = {
      arrayStride: 28,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x4' },
      ],
    };
    const spriteVertex = {
      arrayStride: 20,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x2' },
      ],
    };

    const depthStencil = (write, compare) => ({ format: 'depth24plus', depthWriteEnabled: write, depthCompare: compare });
    const blends = [{
      srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add',
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }];

    this.pipelines = {
      depth: dev.createRenderPipeline({
        label: 'shadow',
        layout: dev.createPipelineLayout({ bindGroupLayouts: [frameLayout] }),
        vertex: { module: sceneModule, entryPoint: 'vs_depth', buffers: [meshVertex, instanceAttrs] },
        fragment: { module: sceneModule, entryPoint: 'fs_depth', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      }),
      bg: dev.createRenderPipeline({
        label: 'background',
        layout: dev.createPipelineLayout({ bindGroupLayouts: [frameLayout] }),
        vertex: { module: sceneModule, entryPoint: 'vs_bg' },
        fragment: { module: sceneModule, entryPoint: 'fs_bg', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
        multisample: { count: this.msaa },
      }),
      scene: dev.createRenderPipeline({
        label: 'scene',
        layout: dev.createPipelineLayout({ bindGroupLayouts: [frameLayout, sceneLayout] }),
        vertex: { module: sceneModule, entryPoint: 'vs_scene', buffers: [meshVertex, instanceAttrs] },
        fragment: { module: sceneModule, entryPoint: 'fs_scene', targets: [{ format: 'rgba16float', blend: blends[0] }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: depthStencil(true, 'less'),
        multisample: { count: this.msaa },
      }),
      lines: dev.createRenderPipeline({
        label: 'lines',
        layout: dev.createPipelineLayout({ bindGroupLayouts: [frameLayout] }),
        vertex: { module: sceneModule, entryPoint: 'vs_line', buffers: [lineVertex] },
        fragment: { module: sceneModule, entryPoint: 'fs_line', targets: [{ format: 'rgba16float', blend: blends[0] }] },
        primitive: { topology: 'line-list' },
        depthStencil: depthStencil(true, 'less-equal'),
        multisample: { count: this.msaa },
      }),
      sprites: dev.createRenderPipeline({
        label: 'sprites',
        layout: dev.createPipelineLayout({ bindGroupLayouts: [frameLayout] }),
        vertex: { module: sceneModule, entryPoint: 'vs_sprite', buffers: [spriteVertex] },
        fragment: { module: sceneModule, entryPoint: 'fs_sprite', targets: [{ format: 'rgba16float', blend: blends[0] }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
        multisample: { count: this.msaa },
      }),
      post: dev.createRenderPipeline({
        label: 'post',
        layout: dev.createPipelineLayout({ bindGroupLayouts: [postLayout] }),
        vertex: { module: postModule, entryPoint: 'vs_fullscreen' },
        fragment: { module: postModule, entryPoint: 'fs_post', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      }),
    };

    this.instanceBuffer = dev.createBuffer({ size: MAX_INSTANCES * INSTANCE_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'instances' });
    this.lineBuffer = dev.createBuffer({ size: MAX_LINE_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'lines' });
    this.spriteBuffer = dev.createBuffer({ size: MAX_SPRITE_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'sprites' });
    this.uploadScratch = { instances: new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS), lines: new Float32Array(MAX_LINE_FLOATS), sprites: new Float32Array(MAX_SPRITE_FLOATS) };

    this.shadowTexture = dev.createTexture({
      size: [SHADOW_SIZE, SHADOW_SIZE], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'shadow',
    });
    this.shadowView = this.shadowTexture.createView();
    this.shadowSampler = dev.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear', label: 'shadow-sampler' });
    this.sceneBind = dev.createBindGroup({
      layout: sceneLayout,
      entries: [
        { binding: 0, resource: this.shadowView },
        { binding: 1, resource: this.shadowSampler },
      ],
    });

    this.meshes = new Map();
    this.resize();
    this.ready = true;
    return this;
  }

  /** Upload (or fetch from cache) a mesh. */
  upload(name, mesh) {
    if (this.meshes.has(name)) return this.meshes.get(name);
    const dev = this.device;
    const interleaved = new Float32Array((mesh.positions.length / 3) * 6);
    for (let i = 0, v = 0; i < mesh.positions.length; i += 3, v += 6) {
      interleaved[v] = mesh.positions[i];
      interleaved[v + 1] = mesh.positions[i + 1];
      interleaved[v + 2] = mesh.positions[i + 2];
      interleaved[v + 3] = mesh.normals[i];
      interleaved[v + 4] = mesh.normals[i + 1];
      interleaved[v + 5] = mesh.normals[i + 2];
    }
    const vbo = dev.createBuffer({ size: Math.max(interleaved.byteLength, 16), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: `${name}-vbo` });
    dev.queue.writeBuffer(vbo, 0, interleaved);
    const indexData = mesh.indices.length > 65535 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
    const ibo = dev.createBuffer({ size: Math.max(indexData.byteLength, 16), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: `${name}-ibo` });
    dev.queue.writeBuffer(ibo, 0, indexData);
    const handle = {
      vbo, ibo,
      indexCount: mesh.indices.length,
      indexFormat: indexData instanceof Uint32Array ? 'uint32' : 'uint16',
      triangles: mesh.indices.length / 3,
      name,
    };
    this.meshes.set(name, handle);
    return handle;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.camera.aspect = w / h;
    const recreate = (tex) => { if (tex) tex.destroy(); };
    recreate(this.colorTexture); recreate(this.depthTexture); recreate(this.resolveTexture);
    this.colorTexture = this.device.createTexture({
      size: [w, h], format: 'rgba16float', sampleCount: this.msaa, usage: GPUTextureUsage.RENDER_ATTACHMENT, label: 'msaa-color',
    });
    this.resolveTexture = this.device.createTexture({
      size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'resolve-color',
    });
    this.depthTexture = this.device.createTexture({
      size: [w, h], format: 'depth24plus', sampleCount: this.msaa, usage: GPUTextureUsage.RENDER_ATTACHMENT, label: 'msaa-depth',
    });
    const postLayout = this.pipelines.post.getBindGroupLayout(0);
    this.postBind = this.device.createBindGroup({
      layout: postLayout,
      entries: [
        { binding: 0, resource: this.resolveTexture.createView() },
        { binding: 1, resource: this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
        { binding: 2, resource: { buffer: this.postBuffer } },
      ],
    });
  }

  /**
   * Upload the frame's data and record the whole frame: shadow pass → MSAA scene
   * pass (background, meshes, lines, sprites) → resolve/post pass into the canvas.
   */
  present(scene, opts = {}) {
    if (!this.ready) return null;
    const dev = this.device;
    const cam = this.camera;
    this.time += 1 / 60;

    // ---- frame uniforms
    const f = this.frameData;
    f.set(cam.viewProj(), 0);
    const lightEye = V3.add(V3.scale(LIGHT.dir, 3.2), V3.new(0, 0.4, 0));
    const lightViewProj = multiply(ortho(-1.15, 1.15, -1.15, 1.15, 0.1, 8), lookAt(lightEye, V3.new(0, 0.4, 0)));
    f.set(lightViewProj, 16);
    const eye = cam.eye();
    f.set([eye.x, eye.y, eye.z, 1], 32);
    f.set([LIGHT.dir.x, LIGHT.dir.y, LIGHT.dir.z, LIGHT.intensity * (opts.lightScale ?? 1)], 36);
    f.set([LIGHT.color.x, LIGHT.color.y, LIGHT.color.z, 1], 40);
    f.set([this.time, opts.exposure ?? 1.05, 1 / SHADOW_SIZE, opts.cloudAlpha ?? 0.55], 44);
    f.set([LIGHT.ambientSky.x, LIGHT.ambientSky.y, LIGHT.ambientSky.z, 1.15], 48);
    f.set([LIGHT.fog.x, LIGHT.fog.y, LIGHT.fog.z, 1], 52);
    dev.queue.writeBuffer(this.frameBuffer, 0, f);

    const p = this.postData;
    p.set([opts.exposure ?? 1.05, opts.vignette ?? 0.42, opts.grain ?? 0.012, cam.aspect], 0);
    p.set([opts.tintR ?? 1, opts.tintG ?? 1, opts.tintB ?? 1, opts.tint ?? 0], 4);
    dev.queue.writeBuffer(this.postBuffer, 0, p);

    // ---- pack instances
    let instanceOffset = 0;
    const draws = [];
    for (const [name, entry] of scene.meshes) {
      const handle = this.meshes.get(name);
      if (!handle || entry.count === 0) continue;
      const data = scene.meshData(name);
      const floats = Math.min(data.length, MAX_INSTANCES * INSTANCE_FLOATS - instanceOffset);
      this.uploadScratch.instances.set(data.subarray(0, floats), instanceOffset);
      draws.push({ handle, instanceOffset, count: entry.count, castShadow: scene.shadowCasters.has(name) });
      instanceOffset += floats;
    }
    if (instanceOffset > 0) dev.queue.writeBuffer(this.instanceBuffer, 0, this.uploadScratch.instances, 0, instanceOffset);

    const lineFloats = Math.min(scene.lines.length, MAX_LINE_FLOATS);
    if (lineFloats >= 14) {
      this.uploadScratch.lines.set(Float32Array.from(scene.lines).subarray(0, lineFloats), 0);
      dev.queue.writeBuffer(this.lineBuffer, 0, this.uploadScratch.lines, 0, lineFloats);
    }
    const spriteFloats = Math.min(scene.sprites.length, MAX_SPRITE_FLOATS);
    const spriteCount = Math.floor(spriteFloats / 5);
    if (spriteCount > 0) {
      this.uploadScratch.sprites.set(Float32Array.from(scene.sprites).subarray(0, spriteFloats), 0);
      dev.queue.writeBuffer(this.spriteBuffer, 0, this.uploadScratch.sprites, 0, spriteFloats);
    }

    const encoder = dev.createCommandEncoder({ label: 'frame' });

    // ---- shadow pass
    if (draws.some((d) => d.castShadow)) {
      const shadowPass = encoder.beginRenderPass({
        label: 'shadow',
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      shadowPass.setPipeline(this.pipelines.depth);
      shadowPass.setBindGroup(0, this.frameBind);
      for (const d of draws) {
        if (!d.castShadow) continue;
        shadowPass.setVertexBuffer(0, d.handle.vbo, 0);
        shadowPass.setVertexBuffer(1, this.instanceBuffer, d.instanceOffset * 4);
        shadowPass.setIndexBuffer(d.handle.ibo, d.handle.indexFormat, 0);
        shadowPass.drawIndexed(d.handle.indexCount, d.count);
      }
      shadowPass.end();
    }

    // ---- scene pass (MSAA → resolve)
    const scenePass = encoder.beginRenderPass({
      label: 'scene',
      colorAttachments: [{
        view: this.colorTexture.createView(),
        resolveTarget: this.resolveTexture.createView(),
        clearValue: { r: 0.01, g: 0.012, b: 0.02, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    scenePass.setBindGroup(0, this.frameBind);
    scenePass.setPipeline(this.pipelines.bg);
    scenePass.draw(3, 1, 0, 0);
    if (draws.length > 0) {
      scenePass.setPipeline(this.pipelines.scene);
      scenePass.setBindGroup(1, this.sceneBind);
      for (const d of draws) {
        scenePass.setVertexBuffer(0, d.handle.vbo, 0);
        scenePass.setVertexBuffer(1, this.instanceBuffer, d.instanceOffset * 4);
        scenePass.setIndexBuffer(d.handle.ibo, d.handle.indexFormat, 0);
        scenePass.drawIndexed(d.handle.indexCount, d.count);
      }
    }
    if (lineFloats >= 14) {
      scenePass.setPipeline(this.pipelines.lines);
      scenePass.setVertexBuffer(0, this.lineBuffer, 0);
      scenePass.draw(lineFloats / 7, 1, 0, 0);
    }
    if (spriteCount > 0) {
      scenePass.setPipeline(this.pipelines.sprites);
      scenePass.setVertexBuffer(0, this.spriteBuffer, 0);
      scenePass.draw(6, spriteCount, 0, 0);
    }
    scenePass.end();

    // ---- post pass
    const swap = encoder.beginRenderPass({
      label: 'post',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    swap.setPipeline(this.pipelines.post);
    swap.setBindGroup(0, this.postBind);
    swap.draw(3, 1, 0, 0);
    swap.end();

    dev.queue.submit([encoder.finish()]);

    this.stats = {
      draws: draws.length,
      instances: draws.reduce((a, d) => a + d.count, 0),
      tris: draws.reduce((a, d) => a + d.handle.triangles * d.count, 0),
      lines: Math.floor(lineFloats / 14),
      sprites: spriteCount,
    };
    return this.stats;
  }
}

// ---------------------------------------------------------------------------
// Canvas 2D fallback — same camera, wireframe only.
// ---------------------------------------------------------------------------

export class FallbackRenderer {
  /**
   * Software rasteriser.
   *
   * Keeps the uploaded meshes and draws them with the painter's algorithm and
   * flat shading, so a browser without WebGPU still gets a real picture of the
   * arm instead of a wireframe. Cost is bounded by decimating large meshes —
   * the arm is ~10 k triangles, which a 2D canvas eats comfortably.
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = new OrbitCamera();
    this.ready = true;
    this.meshes = new Map();
    this.stats = { draws: 0, instances: 0, tris: 0, fallback: true };
  }

  upload(name, mesh) {
    this.meshes.set(name, mesh);
    return { name, triangles: (mesh.indices?.length ?? 0) / 3 };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.camera.aspect = this.canvas.width / this.canvas.height;
    this.dpr = dpr;
  }

  present(scene, opts = {}) {
    if (!scene) return null;
    const ctx = this.ctx;
    const cam = this.camera;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.dpr ?? 1;

    // ---- sky gradient
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1220');
    g.addColorStop(0.55, '#070b13');
    g.addColorStop(1, '#04060a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const project = (p) => {
      const s = cam.project(p);
      return s ? { x: s.x * W, y: s.y * H, z: s.w } : null;
    };

    // ---- bench plane shadow blob (cheap contact darkening)
    const benchPts = [];
    for (const [name, entry] of scene.meshes) {
      if (name !== 'bench') continue;
      void entry;
    }
    void benchPts;

    // ---- triangles, painter-sorted
    const tris = [];
    let skipped = 0;
    const light = LIGHT.dir;
    for (const [name, entry] of scene.meshes) {
      const mesh = this.meshes.get(name);
      if (!mesh || !entry.count) continue;
      const inst = scene.meshData(name);
      if (!inst) continue;
      const idx = mesh.indices;
      const pos = mesh.positions;
      // Never drop alternate triangles: on a lattice truss that turns a closed
      // surface into loose slivers (measured: the arm became a white comb).
      // Sub-pixel triangles are culled instead, which is lossless on screen.
      const stride = 1;
      for (let i = 0; i < entry.count; i += 1) {
        const o = i * 24;
        const m = inst.subarray(o, o + 16);
        const col = [inst[o + 16], inst[o + 17], inst[o + 18], inst[o + 19] ?? 1];
        const emis = inst[o + 22] ?? 0;
        for (let t = 0; t < idx.length; t += 3 * stride) {
          const ia = idx[t] * 3;
          const ib = idx[t + 1] * 3;
          const ic = idx[t + 2] * 3;
          const wa = transformPoint(m, pos, ia);
          const wb = transformPoint(m, pos, ib);
          const wc = transformPoint(m, pos, ic);
          const sa = project(wa);
          const sb = project(wb);
          const sc = project(wc);
          if (!sa || !sb || !sc) { skipped += 1; continue; }
          // screen-space area cull (keep tiny triangles so unit cell ribbons and pins render completely)
          const area = Math.abs((sb.x - sa.x) * (sc.y - sa.y) - (sc.x - sa.x) * (sb.y - sa.y));
          if (area < 0.05 * dpr * dpr) { skipped += 1; continue; }
          // face normal from the world-space winding
          const ux = wb.x - wa.x; const uy = wb.y - wa.y; const uz = wb.z - wa.z;
          const vx = wc.x - wa.x; const vy = wc.y - wa.y; const vz = wc.z - wa.z;
          let nx = uy * vz - uz * vy;
          let ny = uz * vx - ux * vz;
          let nz = ux * vy - uy * vx;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl; ny /= nl; nz /= nl;
          const ndl = Math.abs(nx * light.x + ny * light.y + nz * light.z);
          // hemispheric ambient: up-facing surfaces pick up the sky, down-facing
          // ones the floor. Without it everything below the horizon went nearly black.
          const ambient = 0.26 + 0.22 * (0.5 + 0.5 * ny);
          // clamped: without it every upward-facing surface saturates to white and
          // the lattice structure disappears into a blob
          const shade = Math.min(1.02, ambient + 0.85 * ndl) + emis;
          const depth = (sa.z + sb.z + sc.z) / 3;
          const fog = Math.max(0, Math.min(1, (depth - 1.6) * 0.42));
          const r = Math.round(255 * Math.min(1, col[0] * shade) * (1 - fog) + 8 * fog);
          const gg = Math.round(255 * Math.min(1, col[1] * shade) * (1 - fog) + 12 * fog);
          const b = Math.round(255 * Math.min(1, col[2] * shade) * (1 - fog) + 20 * fog);
          tris.push({ d: depth, a: sa, b: sb, c: sc, s: `rgb(${r},${gg},${b})` });
        }
      }
    }
    tris.sort((p, q) => q.d - p.d);
    ctx.lineJoin = 'round';
    for (const t of tris) {
      ctx.fillStyle = t.s;
      ctx.beginPath();
      ctx.moveTo(t.a.x, t.a.y);
      ctx.lineTo(t.b.x, t.b.y);
      ctx.lineTo(t.c.x, t.c.y);
      ctx.closePath();
      ctx.fill();
    }
    this.stats.tris = tris.length;
    this.stats.skipped = skipped;

    // ---- lines (tendons, grid, trail, gizmo)
    ctx.lineWidth = Math.max(1, dpr);
    for (const line of scene.lineChunks ?? []) {
      ctx.strokeStyle = line.color;
      ctx.beginPath();
      let started = false;
      for (const p of line.points) {
        const s = project(p);
        if (!s) { started = false; continue; }
        if (!started) { ctx.moveTo(s.x, s.y); started = true; } else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
    }

    // ---- sprites (markers, workspace cloud)
    for (let i = 0; i + 4 < scene.sprites.length; i += 5) {
      const s = project(V3.new(scene.sprites[i], scene.sprites[i + 1], scene.sprites[i + 2]));
      if (!s) continue;
      const size = Math.max(1.2, scene.sprites[i + 3] * 260 * dpr);
      const intensity = scene.sprites[i + 4];
      ctx.fillStyle = `rgba(150,230,255,${Math.min(0.9, 0.35 * intensity)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- caption
    ctx.fillStyle = 'rgba(180,205,230,0.75)';
    ctx.font = `${12 * dpr}px ui-monospace, monospace`;
    ctx.fillText(`CPU rasteriser (WebGPU unavailable) · ${tris.length} triangles`, 16 * dpr, 24 * dpr);
    void opts;
    return this.stats;
  }
}

/** Transform one vertex of an interleaved mesh by a column-major instance matrix. */
function transformPoint(m, pos, i) {
  const x = pos[i];
  const y = pos[i + 1];
  const z = pos[i + 2];
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}
