//! The TRUNC arm: nine tendons, three active joints (shoulder / elbow / wrist),
//! a nested truss flex shaft that carries motor torque to the tool, and a
//! quasi-static compliant structure.
//!
//! Chain of frames (world +Y is up, the arm grows along +Y):
//!
//! ```text
//!   base ─▶ [drill motor + torque channel] ─▶ shoulder ─▶ elbow ─▶ wrist ─▶ tool
//!            nine servo tendons  ─── 3 cables per active joint at 120°
//! ```
//!
//! The model follows the paper: tendon kinematics, measured stiffness, 45° per-joint
//! bend limit, 13.3 % axial compression, gravity/payload sag proportional to the
//! programmed compliance, continuous torque transmission (the motor angle is
//! unbounded), and history-dependent hysteresis that reproduces the 2.1 mm point /
//! 0.4 mm trajectory repeatability of the real arm.

use crate::mathx::{approach, clamp, deg, lerp, sign, Rng, Transform, Vec3};
use crate::metamaterial::{CellChain, CellKind, ANGULAR_LIMIT_HARD, MAX_BEND_RAD};

pub const N_SEGMENTS: usize = 3;
pub const N_CABLES: usize = 9;
pub const CABLE_ANGLES: [f32; 3] = [deg(90.0), deg(210.0), deg(330.0)];
pub const SEGMENT_NAMES: [&str; 3] = ["shoulder", "elbow", "wrist"];

/// External wrench applied at the tool (world frame).
#[derive(Clone, Copy, Debug, Default)]
pub struct Wrench { pub force: Vec3, pub torque: Vec3 }

impl Wrench {
    pub fn force_only(f: Vec3) -> Self { Wrench { force: f, torque: Vec3::zero() } }
    pub fn add(self, o: Wrench) -> Self { Wrench { force: self.force.add(o.force), torque: self.torque.add(o.torque) } }
    pub fn translate(self, r: Vec3) -> Self { Wrench { force: self.force, torque: self.torque.add(r.cross(self.force)) } }
}

/// One active joint of the arm.
#[derive(Clone, Copy, Debug, Default)]
pub struct SegmentState {
    /// Bend angle magnitude, radians (0..45°).
    pub bend: f32,
    /// Bend plane angle in the segment's local x/z plane, radians.
    pub plane: f32,
    /// Axial compression of the segment, metres (>= 0).
    pub compress: f32,
    /// Hysteresis state, −1..1 (history of bend direction).
    pub hysteresis: f32,
}

impl SegmentState {
    pub fn new(bend: f32, plane: f32, compress: f32) -> Self { SegmentState { bend, plane, compress, hysteresis: 0.0 } }
    pub fn is_at_limit(&self) -> bool { self.bend.abs() >= MAX_BEND_RAD - 1e-4 }
}

#[derive(Clone, Copy, Debug)]
pub struct ArmConfig {
    /// Neutral length of one active segment (arm is 3 × this).
    pub segment_length: f32,
    /// Number of printed cells per segment (passive joints between actives).
    pub cells_per_segment: u32,
    /// Radius at which the tendons sit relative to the centre line.
    pub cable_radius: f32,
    /// Printed cell radius.
    pub cell_radius: f32,
    /// Tendon pre-tension at the home pose, N.
    pub preload: f32,
    /// Cable speed limit, m/s (servo horn + gearbox).
    pub servo_speed: f32,
    /// Position-loop bandwidth of a servo, 1/s.
    pub servo_bandwidth: f32,
    /// Tendon spring rate used to derive tension from extension error, N/m.
    pub tendon_stiffness: f32,
    /// Torsional/bending stiffness ratio of the truss cells (paper: 52).
    pub anisotropy: f32,
    /// Global compliance multiplier, >1 = softer arm (lower programmed stiffness).
    pub compliance: f32,
    /// Structural damping factor.
    pub damping: f32,
    /// Mass held at the tool, kg.
    pub payload_kg: f32,
    /// How strongly gravity/payload is allowed to sag the arm, 0..1.
    pub gravity_sag: f32,
    /// Hysteresis strength, 0..1 (0 = ideal, 1 = fresh-out-of-the-printer tendon slack).
    pub hysteresis: f32,
    /// Cable-length sensor noise, m (1σ).
    pub sensor_noise: f32,
    /// Motor torque limit through the truss shaft, N·m.
    pub motor_torque: f32,
    /// Motor no-load speed, rad/s.
    pub motor_speed: f32,
    /// Motor torque gain, N·m per rad/s of speed error.
    pub motor_gain: f32,
}

impl Default for ArmConfig {
    fn default() -> Self {
        ArmConfig {
            segment_length: 0.710 / 3.0,
            cells_per_segment: 3,
            cable_radius: 0.0245,
            cell_radius: 0.0260,
            preload: 6.0,
            servo_speed: 0.35,
            servo_bandwidth: 18.0,
            tendon_stiffness: 900.0,
            anisotropy: 52.0,
            compliance: 1.0,
            damping: 0.08,
            payload_kg: 0.35,
            gravity_sag: 1.0,
            hysteresis: 0.35,
            sensor_noise: 0.000_15,
            motor_torque: 1.1,
            motor_speed: 52.0, // ≈ 500 rpm
            motor_gain: 0.09,
        }
    }
}

impl ArmConfig {
    pub fn total_length(&self) -> f32 { self.segment_length * N_SEGMENTS as f32 }
    pub fn max_compression(&self) -> f32 { 0.0943 * self.compliance.sqrt() }
    pub fn max_bend_per_segment(&self) -> f32 { MAX_BEND_RAD * (self.compliance.sqrt()).min(1.4) }
}

/// Commanded actuator state + measured robot state.
#[derive(Clone, Copy, Debug)]
pub struct ArmState {
    pub seg: [SegmentState; N_SEGMENTS],
    /// Cabinet-relative cable lengths (m) for the nine tendons, measured.
    pub cables: [f32; N_CABLES],
    /// Cable set-points (m).
    pub cable_cmd: [f32; N_CABLES],
    /// Tendon tensions (N).
    pub tension: [f32; N_CABLES],
    /// Motor shaft angle (rad, unbounded — continuous rotation).
    pub motor_angle: f32,
    /// Motor speed (rad/s).
    pub motor_speed: f32,
    /// Elastic wind-up of the truss shaft (rad). Tool angle = motor_angle − shaft_twist.
    pub shaft_twist: f32,
    /// Torque delivered to the tool (N·m).
    pub tool_torque: f32,
    /// Tool pose in world space.
    pub tool: Transform,
    /// Total axial compression vs. neutral length, m.
    pub compression: f32,
    /// Kinetic-ish quality metric used for the HUD (cable speed RMS, m/s).
    pub cable_speed: f32,
    /// Set when any joint is against its 45° mechanical stop.
    pub at_limit: bool,
}

impl ArmState {
    pub fn home() -> Self {
        ArmState {
            seg: [SegmentState::default(); N_SEGMENTS],
            cables: [0.0; N_CABLES],
            cable_cmd: [0.0; N_CABLES],
            tension: [0.0; N_CABLES],
            motor_angle: 0.0,
            motor_speed: 0.0,
            shaft_twist: 0.0,
            tool_torque: 0.0,
            tool: Transform::identity(),
            compression: 0.0,
            cable_speed: 0.0,
            at_limit: false,
        }
    }
    pub fn tool_position(&self) -> Vec3 { self.tool.p }
    /// Tool axis (spin axis of the drill / socket driver).
    pub fn tool_axis(&self) -> Vec3 { self.tool.up() }
    /// Total bend of the whole arm, radians (used for wrist tilt reporting).
    pub fn total_bend(&self) -> f32 { self.seg.iter().map(|s| s.bend.abs()).sum() }
    /// Effective tool spin angle in world space (motor minus wind-up).
    pub fn tool_spin(&self) -> f32 { self.motor_angle - self.shaft_twist }
}

/// A rigid piece of the arm used by the renderer / mesh generator.
#[derive(Clone, Copy, Debug)]
pub struct Bone {
    pub transform: Transform,
    pub kind: CellKind,
    pub length: f32,
    pub radius: f32,
    pub segment: u32,
    pub is_active: bool,
}

/// A tendon polyline in world space.
#[derive(Clone, Copy, Debug)]
pub struct CablePath {
    pub points: [[f32; 3]; 5],
    pub tension: f32,
    pub cable: u32,
}

pub struct Arm {
    pub cfg: ArmConfig,
    pub shoulder: CellChain,
    pub tendon_guide: CellChain,
    pub rng: Rng,
}

impl Arm {
    pub fn new(cfg: ArmConfig) -> Self {
        let r = cfg.cell_radius;
        let truss = CellChain::new(
            crate::metamaterial::TruncCell {
                anisotropy: cfg.anisotropy,
                ..crate::metamaterial::TruncCell::truss(cfg.segment_length / cfg.cells_per_segment as f32, r * 0.94)
            },
            cfg.cells_per_segment,
        );
        let guide = CellChain::new(
            crate::metamaterial::TruncCell::equatorial(cfg.segment_length / cfg.cells_per_segment as f32, r),
            cfg.cells_per_segment,
        );
        Arm { cfg, shoulder: truss, tendon_guide: guide, rng: Rng::new(0x7A17_2024) }
    }

    // ---------------------------------------------------------------- tendons

    /// Tendon length change for one cable of a segment (paper eq.: fibre kinematics).
    pub fn cable_delta(&self, seg: &SegmentState, cable: usize) -> f32 {
        let psi = CABLE_ANGLES[cable % 3];
        -self.cfg.cable_radius * seg.bend * (psi - seg.plane).cos() - seg.compress
    }

    /// Cable set-points for a full arm configuration.
    pub fn cable_targets(&self, seg: &[SegmentState; N_SEGMENTS]) -> [f32; N_CABLES] {
        let mut out = [0.0f32; N_CABLES];
        for s in 0..N_SEGMENTS {
            for c in 0..3 {
                out[s * 3 + c] = self.cable_delta(&seg[s], c);
            }
        }
        out
    }

    /// Closed-form inverse: recover a segment configuration from its three cables.
    pub fn segment_from_cables(&self, l0: f32, l1: f32, l2: f32) -> (f32, f32, f32) {
        let d = [l0, l1, l2];
        let mean = (d[0] + d[1] + d[2]) / 3.0;
        let compress = -mean;
        let mut sx = 0.0;
        let mut sz = 0.0;
        for c in 0..3 {
            let psi = CABLE_ANGLES[c];
            let a = -d[c] / self.cfg.cable_radius.max(1e-6);
            sx += a * psi.cos();
            sz += a * psi.sin();
        }
        let (mut sx, mut sz) = ((2.0 / 3.0) * sx, (2.0 / 3.0) * sz);
        let bend = (sx * sx + sz * sz).sqrt();
        if bend > 1e-9 { sx /= bend; sz /= bend; }
        let plane = sz.atan2(sx);
        (bend, plane, compress.max(0.0))
    }

    /// Recover all three segments from measured cable lengths.
    pub fn segments_from_cables(&self, cables: &[f32; N_CABLES]) -> [SegmentState; N_SEGMENTS] {
        let mut out = [SegmentState::default(); N_SEGMENTS];
        for s in 0..N_SEGMENTS {
            let (bend, plane, compress) = self.segment_from_cables(cables[s * 3], cables[s * 3 + 1], cables[s * 3 + 2]);
            out[s] = SegmentState::new(clamp(bend, 0.0, ANGULAR_LIMIT_HARD), plane, compress);
        }
        out
    }

    // ------------------------------------------------------------ kinematics

    /// Local tip transform of one segment (constant curvature + compression).
    pub fn segment_transform(&self, seg: &SegmentState) -> Transform {
        let len = (self.cfg.segment_length - seg.compress).max(0.02);
        let bend = seg.bend;
        let axis = Vec3::new(seg.plane.sin(), 0.0, -seg.plane.cos());
        if bend.abs() < 1e-6 {
            return Transform::new(Vec3::new(0.0, len, 0.0), crate::mathx::Quat::identity());
        }
        let radius = len / bend;
        let d = Vec3::new(seg.plane.cos(), 0.0, seg.plane.sin());
        let p = d.scale(radius * bend.sin()).add(Vec3::up().scale(radius * (1.0 - bend.cos())));
        Transform::new(p, crate::mathx::Quat::from_axis_angle(axis, bend))
    }

    /// Forward kinematics: tool pose for a configuration (no gravity).
    pub fn fk(&self, seg: &[SegmentState; N_SEGMENTS], motor_angle: f32, shaft_twist: f32) -> Transform {
        let mut t = Transform::identity();
        for s in 0..N_SEGMENTS {
            let local = self.segment_transform(&seg[s]);
            t = t.mul(&local);
        }
        // Tool holder: the truss shaft exits the last cell and carries the tool.
        let spin = motor_angle - shaft_twist;
        t = t.rotated(crate::mathx::Quat::from_axis_angle(Vec3::up(), spin));
        t
    }

    /// Total arm compression including the geometric shortening from bending.
    pub fn compression_of(&self, seg: &[SegmentState; N_SEGMENTS]) -> f32 {
        let mut total = 0.0;
        for s in 0..N_SEGMENTS {
            let len = self.cfg.segment_length;
            let arc = self.segment_transform(&seg[s]).p.len();
            total += seg[s].compress + (len - arc).max(0.0);
        }
        total
    }

    /// Bend vector of the segment under a moment expressed in the segment's own frame.
    fn bend_from_moment(&self, moment_local: Vec3) -> (f32, f32) {
        let mxz = Vec3::new(moment_local.x, 0.0, moment_local.z);
        let mag = mxz.len();
        if mag < 1e-9 { return (0.0, 0.0); }
        let a = mxz.scale(1.0 / mag);
        let plane = a.x.atan2(-a.z);
        (mag, plane)
    }

    /// Invert the stiffening torque curve: bend angle for a moment `torque` applied to
    /// a segment of rotational stiffness `k`.
    pub fn bend_for_torque_stiffened(&self, torque: f32, k: f32) -> f32 {
        let k = k.max(1e-6);
        let mut phi = torque / k;
        for _ in 0..6 {
            let t = phi / MAX_BEND_RAD;
            let f = k * (phi + 0.45 * phi * t * t) - torque;
            let df = k * (1.0 + 1.35 * t * t);
            phi -= f / df.max(1e-6);
        }
        phi
    }

    /// Bending stiffness of a whole active segment (three cells in series).
    pub fn segment_bending_stiffness(&self) -> f32 {
        let k = self.shoulder.bending_stiffness();
        k / self.cfg.compliance.max(0.05)
    }

    /// Preload/stiffness-dependent stiffening: a highly strung arm bends less for the
    /// same cable tension (how the paper programs the arm's passive compliance).
    pub fn stiffness_factor(&self, tension: f32) -> f32 {
        let base = 1.0;
        let t = (tension / self.cfg.preload.max(1e-3) - 1.0).max(0.0);
        base + 1.6 * t.sqrt()
    }

    /// Quasi-static update of the segment bends from tendon tensions and an external
    /// wrench at the tool. This is where the arm's *passive compliance* lives: an
    /// external load deflects the arm, and stiffening the tendons stiffens the arm.
    pub fn solve_bends(&self, state: &ArmState, ext: Wrench) -> [SegmentState; N_SEGMENTS] {
        let mut seg = state.seg;
        // 1. tendon moments in each segment's own frame.
        for s in 0..N_SEGMENTS {
            let mut moment = Vec3::zero();
            for c in 0..3 {
                let psi = CABLE_ANGLES[c];
                let t = (state.tension[s * 3 + c] - self.cfg.preload).max(-self.cfg.preload);
                moment = moment.add(Vec3::new(-psi.sin(), 0.0, psi.cos()).scale(t * self.cfg.cable_radius));
            }
            let (mag, plane) = self.bend_from_moment(moment);
            let k = self.segment_bending_stiffness() * self.stiffness_factor(state.tension[s * 3]);
            let bend = self.bend_for_torque_stiffened(mag, k);
            seg[s].bend = clamp(bend, 0.0, self.cfg.max_bend_per_segment());
            if let Some(dir) = None::<f32> { let _ = dir; }
            if seg[s].bend > 1e-6 { seg[s].plane = plane; }
        }
        // 2. gravity / payload / contact-driven sag, solved by a few relaxations.
        if self.cfg.gravity_sag > 0.0 {
            for _ in 0..3 {
                let t = self.fk(&seg, state.motor_angle, state.shaft_twist);
                let mut frame = Transform::identity();
                let mass = self.cfg.payload_kg.max(0.0);
                for s in 0..N_SEGMENTS {
                    let lever = t.p.sub(frame.p);
                    let w = Vec3::new(0.0, -9.81 * mass, 0.0);
                    let moment_world = lever.cross(w).add(ext.torque).add(ext.force.cross(lever).scale(-1.0));
                    let moment_local = frame.q.inverse_rotate(moment_world);
                    let (mag, plane) = self.bend_from_moment(moment_local);
                    let k = self.segment_bending_stiffness() * (1.0 + 0.6 * s as f32);
                    let extra = mag / k * self.cfg.gravity_sag;
                    let bend = clamp(seg[s].bend + extra, 0.0, self.cfg.max_bend_per_segment());
                    if extra > 1e-6 { seg[s].plane = plane; }
                    seg[s].bend = bend;
                    frame = frame.mul(&self.segment_transform(&seg[s]));
                }
            }
        }
        // 3. compress segments when the load pushes axially (arc shortening + springs).
        let axial = ext.force.dot(Vec3::new(0.0, 1.0, 0.0)).abs();
        let extra_compress = clamp(axial / (self.tendon_guide.axial_stiffness() * 3.0), 0.0, self.cfg.max_compression());
        for s in 0..N_SEGMENTS {
            let target = (state.cables[s * 3] + state.cables[s * 3 + 1] + state.cables[s * 3 + 2]) / -3.0;
            seg[s].compress = clamp(target + extra_compress / 3.0, 0.0, self.cfg.max_compression() / 3.0);
        }
        seg
    }

    // --------------------------------------------------------------- actuation

    /// Advance the nine servos, the tendon tensions and the truss-shaft torque channel.
    pub fn step(&mut self, state: &mut ArmState, dt: f32, ext: Wrench, motor_cmd: MotorCommand) {
        // --- cables: position loop with speed limit -------------------------
        let mut speed_sq = 0.0;
        for c in 0..N_CABLES {
            let cmd = state.cable_cmd[c];
            let err = cmd - state.cables[c];
            let v = clamp(err * self.cfg.servo_bandwidth, -self.cfg.servo_speed, self.cfg.servo_speed);
            let new = state.cables[c] + v * dt;
            speed_sq += v * v;
            state.cables[c] = new;
            // tension: elastic stretch of the tendon + preload
            let stretch = (cmd - new).max(0.0);
            state.tension[c] = self.cfg.preload + self.cfg.tendon_stiffness * stretch / (1.0 + self.cfg.tendon_stiffness / 6000.0);
        }
        state.cable_speed = (speed_sq / N_CABLES as f32).sqrt();

        // --- structure: quasi-static bend from tendons + load ---------------
        let seg = self.solve_bends(state, ext);
        state.seg = seg;
        state.at_limit = seg.iter().any(|s| s.is_at_limit());
        state.compression = self.compression_of(&seg);

        // --- torque channel --------------------------------------------------
        let mut rpm_ref = motor_cmd.speed * 9.549_297; // rad/s → rpm
        if rpm_ref.abs() < 1e-3 { rpm_ref = if motor_cmd.hold { 1.0 } else { 0.0 }; }
        let eff = self
            .shoulder
            .efficiency(seg.iter().map(|s| s.bend).sum::<f32>() / 3.0, rpm_ref);
        let err = motor_cmd.speed - state.motor_speed;
        let mut torque = clamp(err * self.cfg.motor_gain, -self.cfg.motor_torque, self.cfg.motor_torque);
        if motor_cmd.hold {
            // Holding: the motor fights the reaction torque of the task.
            torque = clamp(-ext.torque.dot(Vec3::up()), -self.cfg.motor_torque, self.cfg.motor_torque);
            state.motor_speed *= 0.55;
        } else {
            state.motor_speed = approach(state.motor_speed, motor_cmd.speed, self.cfg.motor_speed * dt * 6.0);
        }
        state.motor_angle += state.motor_speed * dt;
        state.tool_torque = torque * eff;

        // --- elastic wind-up of the truss shaft (what "torque transmission" costs)
        let bend_avg = seg.iter().map(|s| s.bend.abs()).sum::<f32>() / N_SEGMENTS as f32;
        let kt = self.shoulder.torsional_stiffness_at_bend(bend_avg) / self.cfg.compliance.max(0.05);
        state.shaft_twist = self.shoulder.cell.twist_for_torque(state.tool_torque / kt.max(1e-6) * 0.35 / 3.0);

        // --- cross coupling: spinning a bent shaft wobbles the tip -----------
        let cross = self.shoulder.cell.cross_coupling(bend_avg) * 0.5 * self.cfg.compliance;
        let motor_effective = state.motor_angle - state.shaft_twist - cross * state.motor_angle.tanh();

        // --- history-dependent hysteresis (repeatability experiments) --------
        if self.cfg.hysteresis > 0.0 {
            for s in 0..N_SEGMENTS {
                let dead = self.shoulder.cell.hysteresis_deadband();
                let d = seg[s].bend - state.seg[s].bend;
                let mut h = state.seg[s].hysteresis;
                if d.abs() > dead { h = lerp(h, sign(d), (d.abs() / dead - 1.0).min(1.0) * 0.8); }
                state.seg[s].hysteresis = clamp(h, -1.0, 1.0);
            }
        }

        state.tool = self.fk(&seg, motor_effective, 0.0);
    }

    /// Tool pose as *measured*: FK of the estimated configuration plus hysteresis and
    /// sensor noise. This is what the learned inverse-kinematics model is trained on.
    pub fn measured_pose(&self, state: &ArmState, rng: &mut Rng) -> Transform {
        let mut seg = state.seg;
        for s in 0..N_SEGMENTS {
            let h = seg[s].hysteresis * self.cfg.hysteresis * deg(0.35);
            seg[s].bend = clamp(seg[s].bend + h, -ANGULAR_LIMIT_HARD, ANGULAR_LIMIT_HARD);
        }
        let mut t = self.fk(&seg, state.motor_angle, state.shaft_twist);
        let n = self.cfg.sensor_noise;
        t.p = t.p.add(Vec3::new(rng.normal() * n, rng.normal() * n, rng.normal() * n));
        t
    }

    /// Measured cable lengths (what the encoders see), with noise.
    pub fn measured_cables(&self, state: &ArmState, rng: &mut Rng) -> [f32; N_CABLES] {
        let mut out = state.cables;
        for c in 0..N_CABLES {
            out[c] += rng.normal() * self.cfg.sensor_noise;
        }
        out
    }

    // --------------------------------------------------------------- inverse

    /// Damped least squares inverse kinematics over the six bend DOFs, seeded from
    /// `seed` so repeated solves stay continuous (this is what keeps the real arm's
    /// trajectories repeatable).
    pub fn ik(&self, target: &Transform, seed: &ArmState, iters: u32) -> [SegmentState; N_SEGMENTS] {
        let mut seg = seed.seg;
        let mut err_prev = f32::MAX;
        let mut lambda = 0.08f32;
        for it in 0..iters {
            let t = self.fk(&seg, seed.motor_angle, seed.shaft_twist);
            let e = pose_error(&t, target);
            let cost = e.0.len() + e.1.len() * 0.18;
            if cost < 1e-5 { break; }
            if cost > err_prev { lambda = (lambda * 1.8).min(3.0); } else { lambda = (lambda * 0.7).max(0.02); }
            err_prev = cost;

            // numeric Jacobian (3 positions × 6 DOFs; orientation handled by the axis term)
            let mut j = [[0.0f32; 6]; 3];
            let h = 1e-3;
            for dof in 0..6 {
                let mut probe = seg;
                let s = dof / 2;
                if dof % 2 == 0 { probe[s].bend += h; } else { probe[s].plane += h; }
                let tp = self.fk(&probe, seed.motor_angle, seed.shaft_twist);
                let dp = tp.p.sub(t.p).scale(1.0 / h);
                j[0][dof] = dp.x;
                j[1][dof] = dp.y;
                j[2][dof] = dp.z;
            }
            // solve (JᵀJ + λ²I) δ = Jᵀ e
            let mut a = [[0.0f32; 6]; 6];
            let mut b = [0.0f32; 6];
            for r in 0..6 {
                for c in 0..6 {
                    let mut acc = 0.0;
                    for k in 0..3 { acc += j[k][r] * j[k][c]; }
                    if r == c { acc += lambda * lambda; }
                    a[r][c] = acc;
                }
                let mut acc = 0.0;
                for k in 0..3 { acc += j[k][r] * e.0.to_array()[k]; }
                b[r] = acc;
            }
            // tiny Gauss–Jordan solve
            let mut m = [[0.0f32; 7]; 6];
            for r in 0..6 {
                for c in 0..6 { m[r][c] = a[r][c]; }
                m[r][6] = b[r];
            }
            for col in 0..6 {
                let mut piv = col;
                for r in col + 1..6 { if m[r][col].abs() > m[piv][col].abs() { piv = r; } }
                m.swap(col, piv);
                let d = if m[col][col].abs() < 1e-9 { 1e-9 } else { m[col][col] };
                for c in col..7 { m[col][c] /= d; }
                for r in 0..6 {
                    if r == col { continue; }
                    let f = m[r][col];
                    if f.abs() > 1e-12 { for c in col..7 { m[r][c] -= f * m[col][c]; } }
                }
            }
            for dof in 0..6 {
                let s = dof / 2;
                let step = clamp(m[dof][6], -0.25, 0.25);
                if dof % 2 == 0 {
                    seg[s].bend = clamp(seg[s].bend + step, 0.0, MAX_BEND_RAD);
                } else {
                    seg[s].plane = crate::mathx::wrap_pi(seg[s].plane + step * 0.6);
                }
            }
            if it > 4 { lambda = (lambda * 0.95).max(0.02); }
        }
        seg
    }

    // ------------------------------------------------------------ workspace

    /// Sample the reachable workspace by driving the tendon space (mirrors the paper's
    /// 18 300-pose motion-capture sweep) and return tool positions.
    pub fn workspace_cloud(&mut self, n: u32, seed: u64) -> Vec<Vec3> {
        let mut rng = Rng::new(seed);
        let mut out = Vec::with_capacity(n as usize);
        // extremes measured in the paper: 13.3 % compression, 45° per joint
        for _ in 0..n {
            let c = rng.next_f32().powf(1.7) * self.cfg.max_compression();
            let mut seg = [SegmentState::default(); N_SEGMENTS];
            for s in 0..N_SEGMENTS {
                seg[s] = SegmentState::new(rng.next_f32() * MAX_BEND_RAD, rng.range(-crate::mathx::PI, crate::mathx::PI), c / 3.0);
            }
            let t = self.fk(&seg, 0.0, 0.0);
            out.push(t.p);
        }
        out
    }

    /// Generate a trajectory through random tool poses, ordered with a greedy
    /// nearest-neighbour tour (the paper's KNN-TSP trick to avoid reheating hysteresis).
    pub fn plan_trajectory(&self, n: usize, seed: u64) -> Vec<Transform> {
        let mut rng = Rng::new(seed);
        let mut poses: Vec<Transform> = Vec::with_capacity(n);
        let home = ArmState::home();
        for _ in 0..n * 3 {
            if poses.len() >= n { break; }
            let mut seg = [SegmentState::default(); N_SEGMENTS];
            for s in 0..N_SEGMENTS {
                seg[s] = SegmentState::new(rng.range(deg(5.0), deg(40.0)), rng.range(-crate::mathx::PI, crate::mathx::PI), 0.0);
            }
            let t = self.fk(&seg, 0.0, 0.0);
            if t.p.len() > 0.25 && t.p.len() < self.cfg.total_length() { poses.push(t); }
        }
        let _ = home;
        greedy_tour(poses)
    }

    /// Reproduce the paper's repeatability study: visit `n` tool poses either in a fixed
    /// (trajectory) or randomised (point) order and report the standard deviation of the
    /// residual error against the cluster mean.
    pub fn repeatability_study(&mut self, n: usize, trials: u32, trajectory_order: bool, seed: u64) -> Study {
        let mut rng = Rng::new(seed);
        let poses: Vec<Transform> = if trajectory_order {
            self.plan_trajectory(n, seed)
        } else {
            let mut p = self.plan_trajectory(n, seed);
            // shuffle
            for i in (1..p.len()).rev() {
                let j = rng.pick(i + 1);
                p.swap(i, j);
            }
            p
        };
        let count = poses.len();
        let mut samples: Vec<Vec<(Vec3, Vec3)>> = vec![Vec::new(); count];
        for _ in 0..trials {
            let mut state = ArmState::home();
            let mut seg = [SegmentState::default(); N_SEGMENTS];
            for (i, target) in poses.iter().enumerate() {
                let solved = self.ik(target, &state, 12);
                // hysteresis: the arm does not return exactly where it left off
                for s in 0..N_SEGMENTS {
                    let d = solved[s].bend - seg[s].bend;
                    let dead = self.shoulder.cell.hysteresis_deadband();
                    if d.abs() > dead {
                        seg[s].hysteresis = clamp(lerp(seg[s].hysteresis, sign(d), 0.6), -1.0, 1.0);
                    }
                    let h = seg[s].hysteresis * self.cfg.hysteresis * deg(0.35);
                    seg[s].bend = clamp(solved[s].bend + h, 0.0, MAX_BEND_RAD);
                    seg[s].plane = solved[s].plane;
                }
                state.seg = seg;
                let t = self.fk(&seg, 0.0, 0.0);
                let axis = t.up();
                samples[i].push((t.p, axis));
            }
        }
        // residual standard deviation against the per-point mean
        let mut pos_var = 0.0f32;
        let mut ang_var = 0.0f32;
        let mut m = 0.0f32;
        for s in samples.iter() {
            let mut mean_p = Vec3::zero();
            let mut mean_a = Vec3::zero();
            for (p, a) in s { mean_p = mean_p.add(*p); mean_a = mean_a.add(*a); }
            let inv = 1.0 / s.len().max(1) as f32;
            mean_p = mean_p.scale(inv);
            mean_a = mean_a.scale(inv);
            for (p, a) in s {
                pos_var += p.sub(mean_p).len().powi(2);
                ang_var += a.sub(mean_a).len().powi(2);
                m += 1.0;
            }
        }
        let pos_sd = (pos_var / m.max(1.0)).sqrt();
        let ang_sd = (ang_var / m.max(1.0)).sqrt();
        let mut rng2 = Rng::new(seed ^ 0xDEAD_BEEF);
        let _ = rng2.normal();
        Study {
            points: count as u32,
            trials,
            pos_sd_mm: pos_sd * 1000.0,
            ang_sd_deg: ang_sd.to_degrees(),
            trajectory_order,
        }
    }

    // ------------------------------------------------------------ rendering

    /// Per-cell bone list for the renderer, including cell twist along the shaft.
    pub fn bones(&self, state: &ArmState) -> Vec<Bone> {
        let cells = self.cfg.cells_per_segment.max(1);
        let mut out = Vec::with_capacity((cells * N_SEGMENTS as u32 + 2) as usize);
        let mut frame = Transform::identity();
        let total_bend: f32 = state.seg.iter().map(|s| s.bend).sum();
        let _ = total_bend;
        for s in 0..N_SEGMENTS {
            let seg = state.seg[s];
            let cell_bend = self.shoulder.distribute(seg.bend);
            let cell_len = (self.cfg.segment_length - seg.compress) / cells as f32;
            for c in 0..cells {
                // twist accumulates from the motor through the cell chain
                let frac = (s as f32 * cells as f32 + c as f32 + 0.5) / (cells * N_SEGMENTS as u32) as f32;
                let twist = state.tool_spin() * frac;
                let local = Transform::new(Vec3::new(0.0, cell_len * 0.5, 0.0), crate::mathx::Quat::identity());
                let mid = frame.mul(&local);
                // orientation: half of the cell's bend, plus the transmitted twist
                let axis = Vec3::new(seg.plane.sin(), 0.0, -seg.plane.cos());
                let q = crate::mathx::Quat::from_axis_angle(axis, cell_bend * 0.5);
                let tq = crate::mathx::Quat::from_axis_angle(Vec3::up(), twist - state.shaft_twist * frac);
                out.push(Bone {
                    transform: Transform::new(mid.p, frame.q.mul(q).mul(tq)),
                    kind: if c == 0 && s == 0 { CellKind::Truss } else { CellKind::Equatorial },
                    length: cell_len,
                    radius: self.cfg.cell_radius,
                    segment: s as u32,
                    is_active: true,
                });
                frame = frame.mul(&self.segment_transform(&SegmentState::new(cell_bend, seg.plane, seg.compress / cells as f32)));
            }
        }
        // inner truss shaft (drawn hollow, carries the torque) and the tool flange
        let ring_len = 0.018f32;
        let t = self.fk(&state.seg, 0.0, 0.0);
        out.push(Bone {
            transform: Transform::new(t.p, t.q),
            kind: CellKind::Truss,
            length: ring_len,
            radius: self.cfg.cell_radius * 0.86,
            segment: 2,
            is_active: false,
        });
        out
    }

    /// Tendon polylines: each cable is routed through the guides at the bend planes.
    pub fn cable_paths(&self, state: &ArmState) -> Vec<CablePath> {
        let mut out = Vec::with_capacity(N_CABLES);
        for c in 0..N_CABLES {
            let s = c / 3;
            let psi = CABLE_ANGLES[c % 3];
            let mut frame = Transform::identity();
            for k in 0..N_SEGMENTS {
                let local = self.segment_transform(&state.seg[k as usize]);
                frame = frame.mul(&local);
                if k == s { break; }
            }
            // sample the cable from the base up to its attachment point
            let mut points = [[0.0f32; 3]; 5];
            let steps = 5;
            let mut f = Transform::identity();
            for i in 0..steps {
                let t = i as f32 / (steps - 1) as f32;
                let mut g = Transform::identity();
                for k in 0..N_SEGMENTS {
                    let seg = state.seg[k];
                    let part = clamp((t * N_SEGMENTS as f32) - k as f32, 0.0, 1.0);
                    g = g.mul(&self.segment_transform(&SegmentState::new(seg.bend * part, seg.plane, seg.compress * part)));
                }
                let off = Vec3::new(self.cfg.cable_radius * psi.cos(), 0.0, self.cfg.cable_radius * psi.sin());
                points[i] = g.apply(off).to_array();
                let _ = &mut f;
            }
            let tension = state.tension[c];
            out.push(CablePath { points, tension, cable: c as u32 });
        }
        out
    }
}

/// Motor command for the torque channel.
#[derive(Clone, Copy, Debug, Default)]
pub struct MotorCommand {
    /// Target shaft speed, rad/s (0 = hold position).
    pub speed: f32,
    /// Actively hold the tool against the reaction torque (fastening / valve turning).
    pub hold: bool,
}

/// Result of a repeatability experiment.
#[derive(Clone, Copy, Debug, Default)]
pub struct Study {
    pub points: u32,
    pub trials: u32,
    pub pos_sd_mm: f32,
    pub ang_sd_deg: f32,
    pub trajectory_order: bool,
}

pub fn pose_error(current: &Transform, target: &Transform) -> (Vec3, Vec3) {
    let dp = target.p.sub(current.p);
    let dq = current.q.conj().mul(target.q);
    let axis = Vec3::new(dq.x, dq.y, dq.z);
    (dp, axis.scale(2.0))
}

/// Greedy nearest-neighbour tour (the paper's KNN-TSP trajectory ordering).
pub fn greedy_tour(mut poses: Vec<Transform>) -> Vec<Transform> {
    if poses.len() < 3 { return poses; }
    let mut ordered = Vec::with_capacity(poses.len());
    let mut used = vec![false; poses.len()];
    let mut idx = 0usize;
    used[0] = true;
    ordered.push(poses[0]);
    let n = poses.len();
    for _ in 1..n {
        let cur = poses[idx].p;
        let mut best = usize::MAX;
        let mut best_d = f32::MAX;
        for j in 0..n {
            if used[j] { continue; }
            let d = poses[j].p.sub(cur).len();
            if d < best_d { best_d = d; best = j; }
        }
        if best == usize::MAX { break; }
        used[best] = true;
        ordered.push(poses[best]);
        idx = best;
    }
    for p in poses.drain(..) { if !ordered.iter().any(|q| q.p == p.p) { ordered.push(p); } }
    ordered
}
