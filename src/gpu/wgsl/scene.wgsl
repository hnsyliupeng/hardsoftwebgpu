// scene.wgsl — WebGPU shaders for the TRUNC arm lab.
//
// One source file, several entry points (background, shadow depth, main scene,
// lines, sprites). Bind groups:
//   group(0) — frame uniforms (camera, light, shadow matrix, tuning)
//   group(1) — scene resources (shadow map + comparison sampler)
//   group(2) — per-draw instance buffers are *vertex* buffers, not bindings
//
// Lighting is a compact PBR-ish model: wrapped Lambert diffuse (soft bodies read
// better with a little wrap), a Blinn-Phong highlight driven by roughness, a
// fresnel rim light and a single shadow-mapped sun with 3x3 PCF.

struct Frame {
  viewProj: mat4x4<f32>,
  lightViewProj: mat4x4<f32>,
  camPos: vec4<f32>,
  lightDir: vec4<f32>,     // xyz: direction towards the sun, w: intensity
  lightColor: vec4<f32>,
  params: vec4<f32>,       // x time, y exposure, z shadow texel size, w cloud alpha
  ambient: vec4<f32>,      // rgb sky, w ground mix
  fogColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var shadowMap: texture_depth_2d;
@group(1) @binding(1) var shadowSampler: sampler_comparison;

// ---------------------------------------------------------------- background

struct BgOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_bg(@builtin(vertex_index) vi: u32) -> BgOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var out: BgOut;
  out.pos = vec4<f32>(p[vi], 1.0, 1.0);
  out.uv = p[vi];
  return out;
}

@fragment
fn fs_bg(in: BgOut) -> @location(0) vec4<f32> {
  let t = clamp(in.uv.y * 0.5 + 0.5, 0.0, 1.0);
  let horizon = smoothstep(0.0, 1.0, t);
  let sky = mix(vec3<f32>(0.020, 0.026, 0.038), vec3<f32>(0.055, 0.070, 0.105), horizon);
  let glow = exp(-pow(abs(in.uv.y + 0.15) * 3.2, 1.6)) * 0.09;
  let floor = smoothstep(0.0, 1.0, clamp(-in.uv.y * 2.4, 0.0, 1.0)) * 0.022;
  let col = sky + vec3<f32>(glow * 0.55, glow * 0.72, glow * 1.0) - floor;
  // subtle vertical dithering kills banding in the dark gradient
  let dither = fract(sin(dot(in.uv * 1024.0, vec2<f32>(12.9898, 78.233))) * 43758.5453) / 255.0;
  return vec4<f32>(col + dither * 0.5, 1.0);
}

// -------------------------------------------------------------------- depth

struct DepthIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) m0: vec4<f32>,
  @location(3) m1: vec4<f32>,
  @location(4) m2: vec4<f32>,
  @location(5) m3: vec4<f32>,
  @location(6) color: vec4<f32>,
  @location(7) material: vec4<f32>,
};

fn model_matrix(m0: vec4<f32>, m1: vec4<f32>, m2: vec4<f32>, m3: vec4<f32>) -> mat4x4<f32> {
  return mat4x4<f32>(m0, m1, m2, m3);
}

@vertex
fn vs_depth(in: DepthIn) -> @builtin(position) vec4<f32> {
  let model = model_matrix(in.m0, in.m1, in.m2, in.m3);
  return frame.lightViewProj * model * vec4<f32>(in.position, 1.0);
}

@fragment
fn fs_depth() {}

// -------------------------------------------------------------------- scene

struct SceneOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec4<f32>,
  @location(3) material: vec4<f32>,
  @location(4) shadowPos: vec3<f32>,
};

@vertex
fn vs_scene(in: DepthIn) -> SceneOut {
  let model = model_matrix(in.m0, in.m1, in.m2, in.m3);
  let world = model * vec4<f32>(in.position, 1.0);
  let nrm = normalize((model * vec4<f32>(in.normal, 0.0)).xyz);
  var out: SceneOut;
  out.pos = frame.viewProj * world;
  out.world = world.xyz;
  out.normal = nrm;
  out.color = in.color;
  out.material = in.material;
  out.shadowPos = (frame.lightViewProj * world).xyz;
  return out;
}

fn shadow_factor(shadowPos: vec3<f32>, ndl: f32) -> f32 {
  var uv = shadowPos.xy * 0.5 + vec2<f32>(0.5, 0.5);
  uv.y = 1.0 - uv.y;
  let depth = shadowPos.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  let texel = frame.params.z;
  var sum = 0.0;
  var bias = 0.0016 * clamp(1.0 - ndl, 0.25, 1.0);
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let o = vec2<f32>(f32(x), f32(y)) * texel;
      sum = sum + textureSampleCompare(shadowMap, shadowSampler, uv + o, depth - bias);
    }
  }
  return sum / 9.0;
}

@fragment
fn fs_scene(in: SceneOut) -> @location(0) vec4<f32> {
  var N = normalize(in.normal);
  let V = normalize(frame.camPos.xyz - in.world);
  if (dot(N, V) < 0.0) { N = -N; }             // two-sided: soft bodies self-shadow oddly otherwise
  let L = normalize(frame.lightDir.xyz);
  let H = normalize(L + V);
  let metallic = clamp(in.material.x, 0.0, 1.0);
  let roughness = clamp(in.material.y, 0.04, 1.0);
  let emissive = in.material.z;
  var albedo = in.color.rgb;

  let ndl_raw = dot(N, L);
  let ndl = clamp((ndl_raw + 0.28) / 1.28, 0.0, 1.0);   // wrapped diffuse
  let shadow = shadow_factor(in.shadowPos, ndl);
  let sun = frame.lightColor.rgb * frame.lightDir.w * ndl * mix(1.0, shadow, 0.88);

  // hemisphere ambient + a touch of ground bounce
  let hemi = mix(frame.ambient.rgb * frame.ambient.w, frame.ambient.rgb, N.y * 0.5 + 0.5);
  let ambient = hemi * (0.35 + 0.65 * clamp(N.y * 0.5 + 0.5, 0.0, 1.0));

  let shininess = mix(96.0, 6.0, roughness);
  let spec = pow(clamp(dot(N, H), 0.0, 1.0), shininess) * (1.0 - roughness) * mix(0.35, 1.0, metallic);
  let fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2);
  let rim = fres * 0.16 * (0.4 + 0.6 * in.color.rgb);

  var color = albedo * (sun + ambient) + frame.lightColor.rgb * spec + rim + albedo * emissive;
  // watertight-ish fog towards the background so distant cells fade out
  let dist = length(frame.camPos.xyz - in.world);
  let fog = clamp((dist - 0.9) / 2.6, 0.0, 1.0);
  color = mix(color, frame.fogColor.rgb, fog * 0.85);
  color = color / (color + vec3<f32>(1.0));              // cheap tonemap per object
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, in.color.a * (1.0 - fog * 0.6));
}

// -------------------------------------------------------------------- lines

struct LineIn {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
};

struct LineOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) world: vec3<f32>,
};

@vertex
fn vs_line(in: LineIn) -> LineOut {
  var out: LineOut;
  out.pos = frame.viewProj * vec4<f32>(in.position, 1.0);
  out.color = in.color;
  out.world = in.position;
  return out;
}

@fragment
fn fs_line(in: LineOut) -> @location(0) vec4<f32> {
  let dist = length(frame.camPos.xyz - in.world);
  let fade = clamp(1.0 - (dist - 1.0) / 3.4, 0.0, 1.0);
  return vec4<f32>(pow(max(in.color.rgb, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2)), in.color.a * fade);
}

// ------------------------------------------------------------------ sprites

struct SpriteIn {
  @builtin(vertex_index) vi: u32,
  @location(0) position: vec3<f32>,
  @location(1) params: vec2<f32>,      // size (pixels at 1 m), intensity
};

struct SpriteOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) params: vec2<f32>,
  @location(2) view: vec3<f32>,
};

@vertex
fn vs_sprite(in: SpriteIn) -> SpriteOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  let corner = corners[in.vi % 6u];
  let viewPos = frame.viewProj * vec4<f32>(in.position, 1.0);
  // 0.5 px-per-metre scale factor keeps the cloud readable at any zoom
  let scale = in.params.x;
  let clipOffset = vec2<f32>(corner.x, -corner.y) * scale / max(0.35, viewPos.w * 0.45);
  var out: SpriteOut;
  out.pos = vec4<f32>(viewPos.xy + clipOffset * viewPos.w, viewPos.z, viewPos.w);
  out.uv = corner;
  out.params = in.params;
  out.view = in.position;
  return out;
}

@fragment
fn fs_sprite(in: SpriteOut) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  let falloff = exp(-d * d * 2.6);
  let dist = length(frame.camPos.xyz - in.view);
  let fade = clamp(1.0 - (dist - 0.8) / 2.2, 0.0, 1.0);
  let a = falloff * in.params.y * frame.params.w * fade;
  return vec4<f32>(vec3<f32>(0.35, 0.62, 0.95) * a, a);
}
