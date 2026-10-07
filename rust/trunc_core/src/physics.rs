//! Task physics: threads, valves, fragile bulbs and human contact.
//!
//! This is where the paper's *utility* lives. The arm is programmed with inverse
//! kinematics and then asked to do things that are hard for soft robots:
//!
//! | task | why it needs a TRUNC | modelled physics |
//! |------|----------------------|------------------|
//! | bolt fastening | continuous torque, misalignment tolerance | thread engagement, cross-threading, joint stiffness |
//! | light-bulb install | delicate torque + rotation until the lamp lights | fragile torque window, contact angle/turn criterion |
//! | valve turning | multi-turn continuous rotation while bent | stiction + viscous friction, multi-turn counter |
//! | human collaboration | safe contact, still finishes the job | contact compliance, force limiting, safety index |
//!
//! Everything is quasi-static and deterministic: a fixed step is integrated with
//! semi-implicit Euler, so the WebGPU front-end and the Rust CLI see identical numbers.

use crate::arm::{Wrench};
use crate::mathx::{clamp, lerp, Vec3};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskKind { Bolt, Bulb, Valve, PegInHole }

impl TaskKind {
    pub fn from_u32(v: u32) -> TaskKind {
        match v { 1 => TaskKind::Bulb, 2 => TaskKind::Valve, 3 => TaskKind::PegInHole, _ => TaskKind::Bolt }
    }
    pub fn name(self) -> &'static str {
        match self {
            TaskKind::Bolt => "bolt fastening",
            TaskKind::Bulb => "light-bulb install",
            TaskKind::Valve => "valve turning",
            TaskKind::PegInHole => "peg-in-hole (human in the loop)",
        }
    }
    pub fn cable_slip(self) -> f32 { 0.0 }
}

/// Physical description of a job, in world space.
#[derive(Clone, Copy, Debug)]
pub struct TaskSpec {
    pub kind: TaskKind,
    /// Where the part sits (the socket / hole / valve).
    pub anchor: Vec3,
    /// Part axis: the tool must align with this to engage.
    pub axis: Vec3,
    /// Thread pitch, m / turn (bolt, bulb).
    pub pitch: f32,
    /// Turns needed to seat the part.
    pub turns_required: f32,
    /// Radial clearance between part and hole, m (how much misalignment is tolerated).
    pub clearance: f32,
    /// Thread/valve friction coefficient.
    pub friction: f32,
    /// Torque the part can take before it breaks / strips, N·m.
    pub torque_limit: f32,
    /// Axial force the part can take, N.
    pub force_limit: f32,
    /// How well the arm's own compliance absorbs lateral error, 0..1.
    pub compliance: f32,
    /// Valve stiction torque, N·m.
    pub stiction: f32,
    /// Human/contact disturbance amplitude, N.
    pub disturbance: f32,
}

impl Default for TaskSpec {
    fn default() -> Self {
        TaskSpec {
            kind: TaskKind::Bolt,
            anchor: Vec3::new(0.0, 0.0, 0.0),
            axis: Vec3::up(),
            pitch: 0.001_25,     // M8 coarse
            turns_required: 6.0,
            clearance: 0.000_6,  // 0.6 mm of radial play
            friction: 0.14,
            torque_limit: 1.4,
            force_limit: 40.0,
            compliance: 0.85,
            stiction: 0.25,
            disturbance: 0.0,
        }
    }
}

impl TaskSpec {
    pub fn bolt(anchor: Vec3, axis: Vec3) -> Self { TaskSpec { kind: TaskKind::Bolt, anchor, axis, ..Default::default() } }
    pub fn bulb(anchor: Vec3, axis: Vec3) -> Self {
        TaskSpec { kind: TaskKind::Bulb, anchor, axis, pitch: 0.0025, turns_required: 2.4, clearance: 0.000_8, friction: 0.22, torque_limit: 0.35, force_limit: 12.0, compliance: 0.9, stiction: 0.02, ..Default::default() }
    }
    pub fn valve(anchor: Vec3, axis: Vec3) -> Self {
        TaskSpec { kind: TaskKind::Valve, anchor, axis, pitch: 0.002, turns_required: 5.0, clearance: 0.0012, friction: 0.35, torque_limit: 1.6, force_limit: 60.0, compliance: 0.8, stiction: 0.45, ..Default::default() }
    }
    pub fn peg(anchor: Vec3, axis: Vec3) -> Self {
        TaskSpec { kind: TaskKind::PegInHole, anchor, axis, pitch: 0.001_25, turns_required: 3.0, clearance: 0.000_8, friction: 0.18, torque_limit: 1.2, force_limit: 30.0, compliance: 0.92, stiction: 0.2, disturbance: 1.6, ..Default::default() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase { Approach, Align, Engage, Fasten, Verify, Done, Failed }

impl Phase {
    pub fn name(self) -> &'static str {
        match self {
            Phase::Approach => "approach",
            Phase::Align => "align",
            Phase::Engage => "engage",
            Phase::Fasten => "fasten",
            Phase::Verify => "verify",
            Phase::Done => "complete",
            Phase::Failed => "failed",
        }
    }
    pub fn as_u32(self) -> u32 {
        match self {
            Phase::Approach => 0, Phase::Align => 1, Phase::Engage => 2,
            Phase::Fasten => 3, Phase::Verify => 4, Phase::Done => 5, Phase::Failed => 6,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct TaskState {
    pub phase: Phase,
    /// Signed axial progress of the part, m (0 = first thread contact).
    pub depth: f32,
    /// Total rotation delivered to the part, turns.
    pub turns: f32,
    /// Torque currently needed to keep turning, N·m.
    pub load_torque: f32,
    /// Reaction wrench the part applies to the tool.
    pub reaction: Wrench,
    /// Lateral misalignment at the tool, m.
    pub misalign: f32,
    /// Portion of the misalignment the compliant arm absorbed, m.
    pub absorbed: f32,
    /// Cross-threading / stripping / cracking flag.
    pub damaged: bool,
    /// Threads engaged?
    pub engaged: bool,
    /// Valve opening fraction 0..1.
    pub opening: f32,
    /// Lamp lit (bulb task) / connection made (bolt task).
    pub connected: bool,
    pub success: bool,
    /// Time spent in the current phase, s.
    pub phase_time: f32,
    /// Peak contact force seen, N (safety metric for the human demo).
    pub peak_force: f32,
    /// Accumulated "mechanical intelligence": energy absorbed by compliance, mJ.
    pub compliance_work: f32,
    /// Simulated human/contact force currently applied to the tool, N.
    pub human_force: f32,
}

impl Default for TaskState {
    fn default() -> Self {
        TaskState {
            phase: Phase::Approach, depth: 0.0, turns: 0.0, load_torque: 0.0,
            reaction: Wrench::default(), misalign: 0.0, absorbed: 0.0, damaged: false,
            engaged: false, opening: 1.0, connected: false, success: false, phase_time: 0.0,
            peak_force: 0.0, compliance_work: 0.0, human_force: 0.0,
        }
    }
}

/// Inputs from the arm at each control step.
#[derive(Clone, Copy, Debug, Default)]
pub struct TaskInput {
    /// Tool pose position.
    pub tool_pos: Vec3,
    /// Tool axis (unit).
    pub tool_axis: Vec3,
    /// Tool spin angle, rad (accumulates; used to count turns).
    pub spin: f32,
    /// Torque delivered through the truss shaft, N·m.
    pub torque: f32,
    /// Motor speed, rad/s.
    pub speed: f32,
    /// 0..1 how much lateral compliance the arm currently offers.
    pub compliance_gain: f32,
    /// Distance from the tool to the part axis, m.
    pub lateral_error: f32,
    /// Tilt error between the tool and the part, rad.
    pub tilt_error: f32,
    /// Simulation time, s.
    pub time: f32,
}

const TURNS_PER_RAD: f32 = 1.0 / (2.0 * core::f32::consts::PI as f32);

/// Advance a task by `dt` and return the wrench the part applies back on the tool.
pub fn step(spec: &TaskSpec, st: &mut TaskState, input: &TaskInput, prev_spin: f32, dt: f32) -> Wrench {
    st.phase_time += dt;
    let spin_delta = input.spin - prev_spin;
    let turns_delta = spin_delta * TURNS_PER_RAD;

    // ---------------------------------------------------------- alignment
    let lat = input.lateral_error;
    let tilt = input.tilt_error.abs();
    st.misalign = lat;
    // The compliant arm acts like a remote-centre compliance: part of the lateral
    // error is absorbed by the bent structure instead of loading the threads.
    let absorb_len = spec.clearance * (1.0 + 6.0 * spec.compliance * input.compliance_gain);
    let residual = (lat - absorb_len).max(0.0);
    st.absorbed = lat - residual;
    st.compliance_work += st.absorbed * 0.5 * spec.friction * 1e3 * dt;

    // engaging is only possible when the residual error is inside the clearance
    let can_engage = residual <= spec.clearance * 1.5 && tilt < 0.12;

    // ------------------------------------------------------------ phases
    let axis_err = 1.0 - input.tool_axis.dot(spec.axis).abs();
    match st.phase {
        Phase::Approach => {
            if input.tool_pos.sub(spec.anchor).len() < 0.05 { st.phase = Phase::Align; st.phase_time = 0.0; }
        }
        Phase::Align => {
            if axis_err < 0.02 && input.tool_pos.sub(spec.anchor).len() < 0.02 { st.phase = Phase::Engage; st.phase_time = 0.0; }
            else if st.phase_time > 8.0 { st.phase = Phase::Failed; }
        }
        Phase::Engage => {
            if !can_engage {
                // Forcing a misaligned part: cross-threading damage accumulates.
                if input.torque.abs() > 0.05 && residual > spec.clearance * 2.0 {
                    st.load_torque = input.torque.abs();
                    st.damaged = true;
                    st.phase = Phase::Failed;
                }
            } else if turns_delta.abs() > 1e-5 {
                st.engaged = true;
                st.phase = Phase::Fasten;
                st.phase_time = 0.0;
            }
        }
        Phase::Fasten => {
            if !can_engage && residual > spec.clearance * 2.5 {
                st.damaged = true;
                st.phase = Phase::Failed;
            }
            if st.engaged {
                st.depth += turns_delta.abs() * spec.pitch;
                st.turns += turns_delta.abs();
            }
            // torque needed: threads + preload ramp + friction
            let thread = spec.friction * 0.35 * clamp(st.depth / 0.01, 0.0, 1.0);
            let ramp = 0.25 * clamp(st.turns / spec.turns_required.max(0.1), 0.0, 1.6).powi(2);
            let base = match spec.kind {
                TaskKind::Valve => spec.stiction + spec.friction * 0.6 * st.turns.max(0.0),
                TaskKind::Bulb => 0.02 + spec.friction * 0.05,
                _ => 0.03,
            };
            st.load_torque = base + thread + ramp;
            if st.load_torque > spec.torque_limit {
                st.damaged = true;
                st.phase = Phase::Failed;
            } else if st.turns >= spec.turns_required && input.torque.abs() > st.load_torque * 0.8 {
                st.phase = Phase::Verify;
                st.phase_time = 0.0;
            }
            match spec.kind {
                TaskKind::Valve => { st.opening = clamp(1.0 - st.turns / spec.turns_required.max(0.1), 0.0, 1.0); }
                TaskKind::Bulb => { st.connected = st.turns >= spec.turns_required * 0.98; }
                TaskKind::Bolt => { st.connected = st.depth >= spec.pitch * spec.turns_required * 0.95; }
                TaskKind::PegInHole => { st.connected = st.turns >= spec.turns_required; }
            }
        }
        Phase::Verify => {
            st.load_torque *= 0.9;
            if st.phase_time > 0.15 {
                st.success = !st.damaged;
                st.phase = if st.success { Phase::Done } else { Phase::Failed };
            }
        }
        Phase::Done | Phase::Failed => {
            st.load_torque = lerp(st.load_torque, 0.0, clamp(dt * 4.0, 0.0, 1.0));
        }
    }

    // ------------------------------------------------- contact reaction wrench
    let mut force = Vec3::zero();
    let mut torque = Vec3::zero();
    // lateral spring pushing the tool back to the part axis (this is what the
    // compliant arm has to fight — and what makes misaligned insertion survivable)
    let lateral_stiffness = 220.0 * (1.0 - 0.7 * spec.compliance * input.compliance_gain);
    force = force.add(Vec3::new(residual * lateral_stiffness, 0.0, residual * lateral_stiffness * 0.35));
    // axial reaction from threads
    if st.engaged || matches!(st.phase, Phase::Fasten | Phase::Verify | Phase::Done) {
        torque = torque.add(spec.axis.scale(-st.load_torque * input.speed.signum().max(0.0)));
    }
    // human/contact disturbance (draggable in the UI)
    if spec.disturbance > 0.0 {
        let t = input.time;
        let hf = spec.disturbance * (t * 1.7).sin() * 0.5f32.max(st.human_force);
        st.human_force = hf;
        force = force.add(Vec3::new(hf * 0.6, -hf * 0.25, hf));
    } else {
        st.human_force = 0.0;
    }
    let f_mag = force.len();
    if f_mag > st.peak_force { st.peak_force = f_mag; }
    st.reaction = Wrench { force, torque };
    if f_mag > spec.force_limit { st.damaged = true; st.phase = Phase::Failed; }
    st.reaction
}

/// Safety index for the human-collaboration demo: 1.0 = contact force exactly at the
/// pain threshold, values < 1 are safe. The compliant arm keeps this low because the
/// force it can apply is bounded by the tendon-driven stiffness.
pub fn safety_index(peak_force: f32, torque: f32, programmed_stiffness: f32) -> f32 {
    let f = (peak_force / 45.0).powi(2);
    let t = (torque.abs() / 1.5).powi(2);
    let softness = 1.0 / programmed_stiffness.max(0.2);
    clamp((f + t).sqrt() * softness.min(1.4), 0.0, 3.0)
}

/// Scoring used by the HUD & the headless CLI benchmark.
#[derive(Clone, Copy, Debug, Default)]
pub struct TaskMetrics {
    pub success: bool,
    pub damaged: bool,
    pub turns: f32,
    pub depth_mm: f32,
    pub load_torque: f32,
    pub misalign_mm: f32,
    pub absorbed_mm: f32,
    pub peak_force_n: f32,
    pub safety: f32,
    pub time_s: f32,
    pub phase: u32,
}

pub fn metrics(_spec: &TaskSpec, st: &TaskState, time: f32, stiffness: f32) -> TaskMetrics {
    TaskMetrics {
        success: st.success,
        damaged: st.damaged,
        turns: st.turns,
        depth_mm: st.depth * 1000.0,
        load_torque: st.load_torque,
        misalign_mm: st.misalign * 1000.0,
        absorbed_mm: st.absorbed * 1000.0,
        peak_force_n: st.peak_force,
        safety: safety_index(st.peak_force, st.load_torque, stiffness),
        time_s: time,
        phase: st.phase.as_u32(),
    }
}
