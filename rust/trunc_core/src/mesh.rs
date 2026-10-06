//! Procedural geometry for the whole lab: the TRUNC lattice cells, tendons, tools and
//! the props used by the four tasks. Everything is generated on the fly (a few hundred
//! kB of vertices) so no asset pipeline is needed — the WebGPU front-end uploads the
//! buffers returned by [`MeshData`], and the Rust CLI can dump OBJ for inspection.
//!
//! The cell meshes are the visual argument of the paper: the *truss* cell is a helical
//! lattice that is torsionally rigid but bends, the *equatorial* cell is a slotted shell
//! that guides the tendons and twists easily.

use crate::mathx::{Transform, Vec3};

#[derive(Clone, Debug, Default)]
pub struct MeshData { pub positions: Vec<f32>, pub normals: Vec<f32>, pub indices: Vec<u32> }

impl MeshData {
    pub fn new() -> Self { MeshData::default() }
    pub fn push_vertex(&mut self, p: Vec3, n: Vec3) -> u32 {
        self.positions.push(p.x); self.positions.push(p.y); self.positions.push(p.z);
        self.normals.push(n.x); self.normals.push(n.y); self.normals.push(n.z);
        self.positions[0]; // keep the borrow checker happy about ordering
        ((self.positions.len() / 3) - 1) as u32
    }
    pub fn push_tri(&mut self, a: u32, b: u32, c: u32) {
        self.indices.push(a); self.indices.push(b); self.indices.push(c);
    }
    pub fn push_quad(&mut self, a: u32, b: u32, c: u32, d: u32) {
        self.push_tri(a, b, c);
        self.push_tri(a, c, d);
    }
    pub fn vertex_count(&self) -> usize { self.positions.len() / 3 }
    pub fn tri_count(&self) -> usize { self.indices.len() / 3 }
    pub fn is_empty(&self) -> bool { self.indices.is_empty() }

    pub fn transform(&self, t: &Transform) -> MeshData {
        let mut out = MeshData::new();
        for i in 0..self.vertex_count() {
            let p = Vec3::new(self.positions[i * 3], self.positions[i * 3 + 1], self.positions[i * 3 + 2]);
            let n = Vec3::new(self.normals[i * 3], self.normals[i * 3 + 1], self.normals[i * 3 + 2]);
            out.push_vertex(t.apply(p), t.apply_dir(n));
        }
        out.indices.extend_from_slice(&self.indices);
        out
    }

    pub fn append(&mut self, other: &MeshData) {
        let base = self.vertex_count() as u32;
        self.positions.extend_from_slice(&other.positions);
        self.normals.extend_from_slice(&other.normals);
        for i in other.indices.iter() { self.indices.push(base + i); }
    }

    /// Simple OBJ export (used by `trunc_cli mesh`).
    pub fn to_obj(&self) -> String {
        let mut s = String::with_capacity(self.vertex_count() * 32);
        s.push_str("# trunc_core procedural mesh\n");
        for i in 0..self.vertex_count() {
            s.push_str(&format!("v {} {} {}\n", self.positions[i * 3], self.positions[i * 3 + 1], self.positions[i * 3 + 2]));
        }
        for i in 0..self.vertex_count() {
            s.push_str(&format!("vn {} {} {}\n", self.normals[i * 3], self.normals[i * 3 + 1], self.normals[i * 3 + 2]));
        }
        for t in self.indices.chunks(3) {
            if t.len() == 3 {
                s.push_str(&format!("f {}//{} {}//{} {}//{}\n", t[0] + 1, t[0] + 1, t[1] + 1, t[1] + 1, t[2] + 1, t[2] + 1));
            }
        }
        s
    }
}

/// Compute a smooth normal for a vertex on a surface of revolution around +Y.
fn radial_normal(p: Vec3, axis_y: f32) -> Vec3 {
    let r = Vec3::new(p.x, 0.0, p.z);
    r.norm().scale(1.0 - axis_y.abs()).add(Vec3::new(0.0, axis_y, 0.0)).norm()
}

pub fn cylinder(radius: f32, top: f32, bottom: f32, segments: u32, caps: bool) -> MeshData {
    let mut m = MeshData::new();
    let seg = segments.max(3);
    let mut ring_top = Vec::with_capacity(seg as usize);
    let mut ring_bot = Vec::with_capacity(seg as usize);
    for i in 0..seg {
        let a = i as f32 / seg as f32 * std::f32::consts::TAU;
        let (s, c) = (a.sin(), a.cos());
        let p_t = Vec3::new(c * radius, top, s * radius);
        let p_b = Vec3::new(c * radius, bottom, s * radius);
        let n = Vec3::new(c, 0.0, s);
        ring_top.push(m.push_vertex(p_t, n));
        ring_bot.push(m.push_vertex(p_b, n));
    }
    for i in 0..seg {
        let j = (i + 1) % seg;
        m.push_quad(ring_bot[i as usize], ring_bot[j as usize], ring_top[j as usize], ring_top[i as usize]);
    }
    if caps {
        let ct = m.push_vertex(Vec3::new(0.0, top, 0.0), Vec3::up());
        let cb = m.push_vertex(Vec3::new(0.0, bottom, 0.0), Vec3::new(0.0, -1.0, 0.0));
        for i in 0..seg {
            let j = (i + 1) % seg;
            m.push_tri(ct, ring_top[i as usize], ring_top[j as usize]);
            m.push_tri(cb, ring_bot[j as usize], ring_bot[i as usize]);
        }
    }
    m
}

pub fn sphere(radius: f32, rings: u32, sectors: u32) -> MeshData {
    let mut m = MeshData::new();
    let r = rings.max(2);
    let s = sectors.max(3);
    for i in 0..=r {
        let phi = i as f32 / r as f32 * std::f32::consts::PI;
        for j in 0..=s {
            let theta = j as f32 / s as f32 * std::f32::consts::TAU;
            let n = Vec3::new(phi.sin() * theta.cos(), phi.cos(), phi.sin() * theta.sin());
            m.push_vertex(n.scale(radius), n);
        }
    }
    let stride = s + 1;
    for i in 0..r {
        for j in 0..s {
            let a = i * stride + j;
            let b = a + stride;
            m.push_quad(a, a + 1, b + 1, b);
        }
    }
    m
}

pub fn torus(major: f32, minor: f32, major_seg: u32, minor_seg: u32) -> MeshData {
    let mut m = MeshData::new();
    let ms = major_seg.max(3);
    let ns = minor_seg.max(3);
    for i in 0..ms {
        let u = i as f32 / ms as f32 * std::f32::consts::TAU;
        for j in 0..ns {
            let v = j as f32 / ns as f32 * std::f32::consts::TAU;
            let c = Vec3::new(u.cos(), 0.0, u.sin());
            let p = c.scale(major + minor * v.cos()).add(Vec3::new(0.0, minor * v.sin(), 0.0));
            let n = c.scale(v.cos()).add(Vec3::new(0.0, v.sin(), 0.0));
            m.push_vertex(p, n);
        }
    }
    for i in 0..ms {
        for j in 0..ns {
            let a = i * ns + j;
            let b = ((i + 1) % ms) * ns + j;
            let c = ((i + 1) % ms) * ns + (j + 1) % ns;
            let d = i * ns + (j + 1) % ns;
            m.push_quad(a, b, c, d);
        }
    }
    m
}

/// Sweep a circular profile along a polyline (tendons, struts, threads).
pub fn tube(path: &[Vec3], radius: f32, segments: u32) -> MeshData {
    let mut m = MeshData::new();
    if path.len() < 2 { return m; }
    let seg = segments.max(3);
    let mut rings: Vec<Vec<u32>> = Vec::with_capacity(path.len());
    for i in 0..path.len() {
        let dir = if i == 0 {
            path[1].sub(path[0]).norm()
        } else if i + 1 == path.len() {
            path[i].sub(path[i - 1]).norm()
        } else {
            path[i + 1].sub(path[i - 1]).norm()
        };
        let side = dir.any_ortho();
        let up2 = dir.cross(side).norm();
        let mut ring = Vec::with_capacity(seg as usize);
        for j in 0..seg {
            let a = j as f32 / seg as f32 * std::f32::consts::TAU;
            let n = side.scale(a.cos()).add(up2.scale(a.sin()));
            ring.push(m.push_vertex(path[i].add(n.scale(radius)), n));
        }
        rings.push(ring);
    }
    for i in 0..rings.len() - 1 {
        for j in 0..seg {
            let k = (j + 1) % seg;
            m.push_quad(rings[i][j as usize], rings[i][k as usize], rings[i + 1][k as usize], rings[i + 1][j as usize]);
        }
    }
    m
}

/// The star of the show: a printed TRUNC cell.
///
/// * `kind == 0` → helical truss lattice (torque channel, 52× torsion/bending).
/// * `kind == 1` → slotted equatorial shell (tendon guide, torsionaly soft).
pub fn trunc_cell(kind: u32, length: f32, radius: f32, rings: u32, struts: u32, res: u32) -> MeshData {
    let mut m = MeshData::new();
    let rings = rings.max(2);
    let struts = struts.max(4);
    let res = res.max(3);
    let r_in = radius * 0.55;
    if kind == 0 {
        // ---- truss: helical struts between rings of nodes -------------------
        let twist = std::f32::consts::TAU * 0.28; // < 1 turn over the cell
        let strut_r = radius * 0.085;
        for r in 0..rings {
            let y = length * (r as f32 / (rings - 1) as f32);
            let phase = twist * (r as f32);
            for s in 0..struts {
                let a0 = phase + s as f32 / struts as f32 * std::f32::consts::TAU;
                let a1 = phase + twist + (s as f32 + 1.0) / struts as f32 * std::f32::consts::TAU;
                if r + 1 < rings {
                    let p0 = Vec3::new(a0.cos() * radius, y, a0.sin() * radius);
                    let p1 = Vec3::new(a1.cos() * radius, length * ((r + 1) as f32 / (rings - 1) as f32), a1.sin() * radius);
                    let mid = Vec3::lerp(p0, p1, 0.5).scale(0.86);
                    let mesh = tube(&[p0, mid, p1], strut_r, res);
                    m.append(&mesh);
                }
            }
        }
        // end flanges the tendons / driver bolt through
        let flange = torus(radius * 1.02, radius * 0.10, struts * 3, res);
        m.append(&flange.transform(&Transform::from_pos(Vec3::new(0.0, 0.0, 0.0))));
        m.append(&flange.transform(&Transform::from_pos(Vec3::new(0.0, length, 0.0))));
        // internal torque shaft
        m.append(&cylinder(r_in * 0.42, length, 0.0, res * 2, true));
    } else {
        // ---- equatorial: slotted shell -------------------------------------
        let slots = struts.max(6);
        let gap = 0.24f32; // fraction of the pitch that is an open slot
        for s in 0..slots {
            let a0 = (s as f32 / slots as f32 + gap * 0.5) * std::f32::consts::TAU;
            let span = std::f32::consts::TAU / slots as f32 * (1.0 - gap);
            let bands = 4u32;
            for b in 0..bands {
                let y0 = length * (b as f32 / bands as f32 + 0.06);
                let y1 = length * ((b as f32 + 1.0) / bands as f32 - 0.06);
                let strip_steps = res.max(2);
                let mut prev_top = 0u32;
                let mut prev_bot = 0u32;
                for i in 0..=strip_steps {
                    let a = a0 + span * (i as f32 / strip_steps as f32);
                    let n = Vec3::new(a.cos(), 0.0, a.sin());
                    let pt = m.push_vertex(n.scale(radius).add(Vec3::new(0.0, y1, 0.0)), n);
                    let pb = m.push_vertex(n.scale(radius).add(Vec3::new(0.0, y0, 0.0)), n);
                    if i > 0 { m.push_quad(prev_bot, prev_top, pt, pb); }
                    prev_top = pt;
                    prev_bot = pb;
                }
            }
        }
        let flange = torus(radius * 1.03, radius * 0.09, slots * 3, res);
        m.append(&flange.transform(&Transform::from_pos(Vec3::zero())));
        m.append(&flange.transform(&Transform::from_pos(Vec3::new(0.0, length, 0.0))));
    }
    m
}

/// Threaded fastener (bolt) with a helical thread ridge and a hex head.
pub fn bolt(radius: f32, length: f32, pitch: f32, res: u32) -> MeshData {
    let mut m = MeshData::new();
    m.append(&cylinder(radius * 0.86, length, 0.0, res * 3, true));
    // helical ridge
    let turns = (length / pitch).max(1.0);
    let steps = (turns * 12.0).clamp(24.0, 240.0) as u32;
    let mut path = Vec::with_capacity(steps as usize);
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let a = t * turns * std::f32::consts::TAU;
        path.push(Vec3::new(a.cos() * radius, t * length, a.sin() * radius));
    }
    m.append(&tube(&path, pitch * 0.62, res.max(3)));
    // hex head
    let head = cylinder(radius * 1.9, length + radius * 1.6, length, 6, true);
    m.append(&head);
    m
}

/// Nut / socket-like driver used as the end effector for the bolt task.
pub fn hex_socket(radius: f32, length: f32) -> MeshData {
    let mut m = cylinder(radius, length, 0.0, 6, false);
    let inner = cylinder(radius * 0.62, length * 1.02, -0.01, 6, false);
    m.append(&inner);
    m
}

/// Hand wheel of a gate valve: rim, spokes, hub.
pub fn valve_wheel(radius: f32, spokes: u32) -> MeshData {
    let mut m = torus(radius, radius * 0.09, 32, 8);
    m.append(&cylinder(radius * 0.22, 0.03, -0.01, 16, true));
    for i in 0..spokes.max(3) {
        let a = i as f32 / spokes as f32 * std::f32::consts::TAU;
        let dir = Vec3::new(a.cos(), 0.0, a.sin());
        let path = vec![dir.scale(radius * 0.2), dir.scale(radius * 0.98)];
        m.append(&tube(&path, radius * 0.05, 6));
    }
    m
}

/// Light bulb: glass envelope + threaded base (so the demo can show it lighting up).
pub fn light_bulb(radius: f32) -> MeshData {
    let mut m = sphere(radius, 16, 24);
    let neck = cylinder(radius * 0.45, -radius * 0.2, -radius * 1.5, 16, true);
    m.append(&neck);
    let turns = 3.0;
    let mut path = Vec::with_capacity(64);
    for i in 0..=64 {
        let t = i as f32 / 64.0;
        let a = t * turns * std::f32::consts::TAU;
        path.push(Vec3::new(a.cos() * radius * 0.45, -radius * 1.55 - t * radius * 0.7, a.sin() * radius * 0.45));
    }
    m.append(&tube(&path, radius * 0.06, 6));
    m
}

/// A small human hand proxy (palm + five capsules) for the safety demo.
pub fn hand_proxy() -> MeshData {
    let mut m = sphere(0.055, 12, 16);
    for i in 0..5 {
        let a = (i as f32 - 2.0) * 0.22;
        let path = vec![
            Vec3::new(a * 0.06, 0.02, 0.0),
            Vec3::new(a * 0.09, 0.10 - (i as f32 * 0.004), 0.02 + i as f32 * 0.004),
        ];
        m.append(&tube(&path, 0.012, 8));
    }
    m
}

/// Frame plate for the peg-in-hole / RAM install demo: a plate with four holes.
pub fn motherboard(width: f32, height: f32, thickness: f32) -> MeshData {
    let mut m = MeshData::new();
    // build the plate as a grid of quads, skipping a cross pattern of holes
    let nx = 12u32;
    let ny = 8u32;
    let hole = ((nx as f32 * 0.18) as u32).max(1);
    let top = thickness * 0.5;
    let bot = -thickness * 0.5;
    let mut idx = vec![u32::MAX; ((nx + 1) * (ny + 1)) as usize];
    for iy in 0..=ny {
        for ix in 0..=nx {
            let in_hole = |x: u32, y: u32, cx: u32, cy: u32| {
                (x as i32 - cx as i32).abs() <= hole as i32 / 2 && (y as i32 - cy as i32).abs() <= hole as i32 / 2
            };
            let skip = in_hole(ix, iy, nx / 4, ny / 2) || in_hole(ix, iy, nx * 3 / 4, ny / 2);
            if skip { continue; }
            let x = (ix as f32 / nx as f32 - 0.5) * width;
            let y = (iy as f32 / ny as f32 - 0.5) * height;
            let n = Vec3::new(0.0, 1.0, 0.0);
            let a = m.push_vertex(Vec3::new(x, top, y), n);
            let b = m.push_vertex(Vec3::new(x, bot, y), n);
            let _ = b;
            idx[(iy * (nx + 1) + ix) as usize] = a;
        }
    }
    for iy in 0..ny {
        for ix in 0..nx {
            let i00 = (iy * (nx + 1) + ix) as usize;
            let i10 = (iy * (nx + 1) + ix + 1) as usize;
            let i01 = ((iy + 1) * (nx + 1) + ix) as usize;
            let i11 = ((iy + 1) * (nx + 1) + ix + 1) as usize;
            if idx[i00] == u32::MAX || idx[i10] == u32::MAX || idx[i01] == u32::MAX || idx[i11] == u32::MAX { continue; }
            m.push_quad(idx[i00], idx[i10], idx[i11], idx[i01]);
        }
    }
    m
}

/// Tendon route through the arm, as a swept tube (uses [`crate::arm::CablePath`] points).
pub fn cable_tube(points: &[[f32; 3]; 5], radius: f32) -> MeshData {
    let path: Vec<Vec3> = points.iter().map(|p| Vec3::from_array(*p)).collect();
    tube(&path, radius, 6)
}

pub fn radial(p: Vec3, axis_y: f32) -> Vec3 { radial_normal(p, axis_y) }
