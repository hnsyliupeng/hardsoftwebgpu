//! Minimal maths: `f32` vectors, quaternions, transforms and a PCG32 PRNG.
//! Mirrored by `src/core/mathx.js` — keep the two in sync.

pub use std::f32::consts::PI;

pub const fn deg(d: f32) -> f32 { d * PI / 180.0 }
pub const fn rad(r: f32) -> f32 { r * 180.0 / PI }
pub fn clamp(v: f32, lo: f32, hi: f32) -> f32 { if v < lo { lo } else if v > hi { hi } else { v } }
pub fn clamp01(v: f32) -> f32 { clamp(v, 0.0, 1.0) }
pub fn lerp(a: f32, b: f32, t: f32) -> f32 { a + (b - a) * t }
pub fn smoothstep(t: f32) -> f32 { let t = clamp01(t); t * t * (3.0 - 2.0 * t) }
pub fn wrap_pi(mut a: f32) -> f32 { while a > PI { a -= 2.0 * PI; } while a < -PI { a += 2.0 * PI; } a }
pub fn sign(v: f32) -> f32 { if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { 0.0 } }

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 { pub x: f32, pub y: f32, pub z: f32 }

impl Vec3 {
    pub const fn new(x: f32, y: f32, z: f32) -> Self { Vec3 { x, y, z } }
    pub const fn splat(v: f32) -> Self { Vec3 { x: v, y: v, z: v } }
    pub const fn zero() -> Self { Vec3 { x: 0.0, y: 0.0, z: 0.0 } }
    pub const fn up() -> Self { Vec3 { x: 0.0, y: 1.0, z: 0.0 } }
    pub fn add(self, o: Vec3) -> Vec3 { Vec3::new(self.x + o.x, self.y + o.y, self.z + o.z) }
    pub fn sub(self, o: Vec3) -> Vec3 { Vec3::new(self.x - o.x, self.y - o.y, self.z - o.z) }
    pub fn mul(self, o: Vec3) -> Vec3 { Vec3::new(self.x * o.x, self.y * o.y, self.z * o.z) }
    pub fn scale(self, s: f32) -> Vec3 { Vec3::new(self.x * s, self.y * s, self.z * s) }
    pub fn neg(self) -> Vec3 { Vec3::new(-self.x, -self.y, -self.z) }
    pub fn dot(self, o: Vec3) -> f32 { self.x * o.x + self.y * o.y + self.z * o.z }
    pub fn cross(self, o: Vec3) -> Vec3 {
        Vec3::new(self.y * o.z - self.z * o.y, self.z * o.x - self.x * o.z, self.x * o.y - self.y * o.x)
    }
    pub fn len(self) -> f32 { self.dot(self).sqrt() }
    pub fn len_xz(self) -> f32 { (self.x * self.x + self.z * self.z).sqrt() }
    pub fn norm(self) -> Vec3 { let l = self.len(); if l > 1e-9 { self.scale(1.0 / l) } else { Vec3::zero() } }
    pub fn lerp(a: Vec3, b: Vec3, t: f32) -> Vec3 { a.add(b.sub(a).scale(t)) }
    pub fn dist(a: Vec3, b: Vec3) -> f32 { a.sub(b).len() }
    pub fn to_array(self) -> [f32; 3] { [self.x, self.y, self.z] }
    pub fn from_array(a: [f32; 3]) -> Vec3 { Vec3::new(a[0], a[1], a[2]) }
    /// Any unit vector orthogonal to `self`.
    pub fn any_ortho(self) -> Vec3 {
        let a = if self.x.abs() < 0.9 { Vec3::new(1.0, 0.0, 0.0) } else { Vec3::new(0.0, 1.0, 0.0) };
        self.cross(a).norm()
    }
    /// Rotate `self` about `axis` (unit) by `angle`.
    pub fn rotate_axis(self, axis: Vec3, angle: f32) -> Vec3 { Quat::from_axis_angle(axis, angle).rotate(self) }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat { pub x: f32, pub y: f32, pub z: f32, pub w: f32 }

impl Default for Quat { fn default() -> Self { Quat::identity() } }

impl Quat {
    pub const fn new(x: f32, y: f32, z: f32, w: f32) -> Self { Quat { x, y, z, w } }
    pub const fn identity() -> Self { Quat { x: 0.0, y: 0.0, z: 0.0, w: 1.0 } }
    pub fn from_axis_angle(axis: Vec3, angle: f32) -> Self {
        let a = axis.norm();
        let h = angle * 0.5;
        let s = h.sin();
        Quat::new(a.x * s, a.y * s, a.z * s, h.cos())
    }
    /// Yaw (about +Y) then pitch (about +X) then roll (about +Z), applied in that order.
    pub fn from_euler(yaw: f32, pitch: f32, roll: f32) -> Self {
        let qy = Quat::from_axis_angle(Vec3::up(), yaw);
        let qx = Quat::from_axis_angle(Vec3::new(1.0, 0.0, 0.0), pitch);
        let qz = Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), roll);
        qy.mul(qx).mul(qz)
    }
    pub fn mul(self, o: Quat) -> Quat {
        Quat::new(
            self.w * o.x + self.x * o.w + self.y * o.z - self.z * o.y,
            self.w * o.y - self.x * o.z + self.y * o.w + self.z * o.x,
            self.w * o.z + self.x * o.y - self.y * o.x + self.z * o.w,
            self.w * o.w - self.x * o.x - self.y * o.y - self.z * o.z,
        )
    }
    pub fn conj(self) -> Quat { Quat::new(-self.x, -self.y, -self.z, self.w) }
    pub fn dot(self, o: Quat) -> f32 { self.x * o.x + self.y * o.y + self.z * o.z + self.w * o.w }
    pub fn norm(self) -> Quat {
        let l = self.dot(self).sqrt();
        if l > 1e-9 { Quat::new(self.x / l, self.y / l, self.z / l, self.w / l) } else { Quat::identity() }
    }
    pub fn rotate(self, v: Vec3) -> Vec3 {
        // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
        let u = Vec3::new(self.x, self.y, self.z);
        let t = u.cross(v).add(v.scale(self.w)).scale(2.0);
        v.add(u.cross(t))
    }
    pub fn inverse_rotate(self, v: Vec3) -> Vec3 { self.conj().rotate(v) }
    pub fn to_mat3(self) -> Mat3 {
        let (x, y, z, w) = (self.x, self.y, self.z, self.w);
        Mat3::from_rows(
            [1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y - w * z), 2.0 * (x * z + w * y)],
            [2.0 * (x * y + w * z), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z - w * x)],
            [2.0 * (x * z - w * y), 2.0 * (y * z + w * x), 1.0 - 2.0 * (x * x + y * y)],
        )
    }
    /// Build a rotation whose local +Y maps to `dir` (used to aim arm segments).
    pub fn from_y_to(dir: Vec3) -> Self {
        let d = dir.norm();
        let up = Vec3::up();
        let c = clamp(up.dot(d), -1.0, 1.0);
        if c > 0.999_999 { return Quat::identity(); }
        if c < -0.999_999 { return Quat::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), PI); }
        let axis = up.cross(d).norm();
        Quat::from_axis_angle(axis, c.acos())
    }
    /// Twist angle (radians) of a rotation about `axis`.
    pub fn twist_about(self, axis: Vec3) -> f32 {
        let q = self.norm();
        let a = axis.norm();
        let s = q.x * a.x + q.y * a.y + q.z * a.z;
        let w = clamp(q.w, -1.0, 1.0);
        2.0 * s.atan2(w)
    }
    pub fn slerp(a: Quat, b: Quat, t: f32) -> Quat {
        let mut d = a.dot(b);
        let mut bb = b;
        if d < 0.0 { d = -d; bb = Quat::new(-b.x, -b.y, -b.z, -b.w); }
        if d > 0.9995 { return Quat::new(lerp(a.x, bb.x, t), lerp(a.y, bb.y, t), lerp(a.z, bb.z, t), lerp(a.w, bb.w, t)).norm(); }
        let theta0 = d.acos();
        let theta = theta0 * t;
        let s0 = (theta0 - theta).sin() / theta0.sin();
        let s1 = theta.sin() / theta0.sin();
        Quat::new(a.x * s0 + bb.x * s1, a.y * s0 + bb.y * s1, a.z * s0 + bb.z * s1, a.w * s0 + bb.w * s1)
    }
    pub fn to_array(self) -> [f32; 4] { [self.x, self.y, self.z, self.w] }
    pub fn from_array(a: [f32; 4]) -> Quat { Quat::new(a[0], a[1], a[2], a[3]).norm() }
}

#[derive(Clone, Copy, Debug)]
pub struct Mat3 { pub m: [f32; 9] }

impl Mat3 {
    pub fn from_rows(r0: [f32; 3], r1: [f32; 3], r2: [f32; 3]) -> Self {
        Mat3 { m: [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]] }
    }
    pub fn identity() -> Self { Mat3::from_rows([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]) }
    pub fn get(&self, r: usize, c: usize) -> f32 { self.m[r * 3 + c] }
    pub fn mul_vec3(&self, v: Vec3) -> Vec3 {
        Vec3::new(
            self.get(0, 0) * v.x + self.get(0, 1) * v.y + self.get(0, 2) * v.z,
            self.get(1, 0) * v.x + self.get(1, 1) * v.y + self.get(1, 2) * v.z,
            self.get(2, 0) * v.x + self.get(2, 1) * v.y + self.get(2, 2) * v.z,
        )
    }
}

/// Rigid transform: rotation then translation.
#[derive(Clone, Copy, Debug)]
pub struct Transform { pub q: Quat, pub p: Vec3 }

impl Default for Transform { fn default() -> Self { Transform::identity() } }

impl Transform {
    pub const fn identity() -> Self { Transform { q: Quat::identity(), p: Vec3::zero() } }
    pub fn new(p: Vec3, q: Quat) -> Self { Transform { q, p } }
    pub fn from_pos(p: Vec3) -> Self { Transform { q: Quat::identity(), p } }
    pub fn apply(&self, v: Vec3) -> Vec3 { self.q.rotate(v).add(self.p) }
    pub fn apply_dir(&self, v: Vec3) -> Vec3 { self.q.rotate(v) }
    pub fn inverse_apply(&self, v: Vec3) -> Vec3 { self.q.inverse_rotate(v.sub(self.p)) }
    /// `self ∘ o` : o expressed in self's frame.
    pub fn mul(&self, o: &Transform) -> Transform {
        Transform { q: self.q.mul(o.q), p: self.apply(o.p) }
    }
    pub fn inverse(&self) -> Transform { Transform { q: self.q.conj(), p: self.q.inverse_rotate(self.p.neg()) } }
    pub fn translated(&self, local: Vec3) -> Self { Transform { q: self.q, p: self.apply(local) } }
    pub fn rotated(&self, local: Quat) -> Self { Transform { q: self.q.mul(local), p: self.p } }
    pub fn forward(&self) -> Vec3 { self.q.rotate(Vec3::new(0.0, 0.0, 1.0)) }
    pub fn up(&self) -> Vec3 { self.q.rotate(Vec3::up()) }
    pub fn right(&self) -> Vec3 { self.q.rotate(Vec3::new(1.0, 0.0, 0.0)) }
}

/// PCG32 — small, fast, deterministic. Same stream in Rust and JS.
#[derive(Clone, Debug)]
pub struct Rng { state: u64, inc: u64 }

impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut r = Rng { state: 0, inc: (seed << 1) | 1 };
        r.next_u32();
        r.state = r.state.wrapping_add(seed ^ 0x9E37_79B9_7F4A_7C15);
        r.next_u32();
        r
    }
    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(6364136223846793005).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }
    pub fn next_f32(&mut self) -> f32 { (self.next_u32() >> 8) as f32 / 16_777_216.0 }
    pub fn range(&mut self, lo: f32, hi: f32) -> f32 { lo + (hi - lo) * self.next_f32() }
    pub fn signed(&mut self) -> f32 { self.next_f32() * 2.0 - 1.0 }
    pub fn normal(&mut self) -> f32 {
        // Box–Muller, clamped to avoid ±inf on a zero draw.
        let u1 = self.next_f32().max(1e-7);
        let u2 = self.next_f32();
        (-2.0 * u1.ln()).sqrt() * (2.0 * PI * u2).cos()
    }
    pub fn chance(&mut self, p: f32) -> bool { self.next_f32() < p }
    pub fn pick(&mut self, n: usize) -> usize { if n == 0 { 0 } else { (self.next_u32() as usize) % n } }
}

/// Convert an angle in the x/z plane to a unit direction (arm "bend plane" helper).
pub fn dir_from_plane(plane: f32) -> Vec3 { Vec3::new(plane.cos(), 0.0, plane.sin()) }

/// Shortest-arc interpolation of a bend angle with rate limiting.
pub fn approach(current: f32, target: f32, max_delta: f32) -> f32 {
    let d = target - current;
    if d.abs() <= max_delta { target } else { current + sign(d) * max_delta }
}
