// post.wgsl — resolve pass: ACES-ish tonemap, vignette, film grain, and the
// overlay grid that ties the HUD to the 3D view.

struct PostFrame {
  params: vec4<f32>,   // x exposure, y vignette, z grain, w aspect
  tint: vec4<f32>,
};

@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var hdrSampler: sampler;
@group(0) @binding(2) var<uniform> post: PostFrame;

struct Out {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vi: u32) -> Out {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var out: Out;
  out.pos = vec4<f32>(p[vi], 0.0, 1.0);
  out.uv = vec2<f32>(p[vi].x * 0.5 + 0.5, 1.0 - (p[vi].y * 0.5 + 0.5));
  return out;
}

fn aces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_post(in: Out) -> @location(0) vec4<f32> {
  let uv = in.uv;
  // 3-tap barrel bloom: the bright pass is folded into the tonemap so no extra
  // render target is needed — cheap glow around the emissive status LEDs.
  let base = textureSample(hdr, hdrSampler, uv).rgb;
  let off = vec2<f32>(2.6 / max(post.params.w, 0.001), 2.6 / max(post.params.w, 0.001)) * 0.0016;
  let b0 = textureSample(hdr, hdrSampler, uv + vec2<f32>(off.x, 0.0)).rgb;
  let b1 = textureSample(hdr, hdrSampler, uv - vec2<f32>(off.x, 0.0)).rgb;
  let b2 = textureSample(hdr, hdrSampler, uv + vec2<f32>(0.0, off.y)).rgb;
  let b3 = textureSample(hdr, hdrSampler, uv - vec2<f32>(0.0, off.y)).rgb;
  let bright = max(max(b0, b1), max(b2, b3));
  var color = base + max(bright - vec3<f32>(0.85), vec3<f32>(0.0)) * 0.35;

  color = aces(color * post.params.x);
  // vignette
  let d = distance(uv, vec2<f32>(0.5, 0.5));
  color = color * (1.0 - post.params.y * smoothstep(0.35, 0.95, d));
  // grain / dither
  let n = fract(sin(dot(uv * vec2<f32>(1920.0, 1080.0), vec2<f32>(12.9898, 78.233))) * 43758.5453);
  color = color + (n - 0.5) * post.params.z;
  color = mix(color, color * post.tint.rgb, post.tint.a);
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
