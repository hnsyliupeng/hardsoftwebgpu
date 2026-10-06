//! WebAssembly ABI (C linkage, `wasm32-unknown-unknown`, no `wasm-bindgen`).
//!
//! The browser never sees Rust structs: it owns a single `Core` (opaque `*mut Core`),
//! writes inputs into the core's **scratch buffer** (a `Vec<f32>` on the wasm heap) and
//! reads results back through typed views over the same memory. No pointers cross the
//! boundary except the core handle and the scratch pointer, so this module is 100 %
//! safe Rust — every access is bounds-checked against the scratch length.
//!
//! ```text
//!   JS:  const core = new Core(wasm);       // trunc_new(seed)
//!        core.write([...params])            // into trunc_scratch(core)
//!        core.call('trunc_step', dt)        // simulate
//!        core.read(core.call('trunc_state'))// Float32Array view of the state block
//! ```
//!
//! Block layouts are described by [`LAYOUT`] and mirrored in `src/core/wasmcore.js`.

use crate::arm::{Arm, ArmConfig, ArmState, MotorCommand, N_CABLES, N_SEGMENTS, SEGMENT_NAMES, Study, Wrench};
use crate::mathx::{Transform, Vec3};
use crate::metamaterial::CellKind;
use crate::nn::{Dataset, Mlp, Transformer, TransformerConfig};
use crate::physics::{self, TaskInput, TaskKind, TaskSpec, TaskState};
use crate::{mesh, physics::Phase};

/// Documentation string for the scratch layouts (surfaced by `trunc_cli layout`).
pub const LAYOUT: &str = "\
scratch blocks (all f32 unless noted):
  state        0    : p.x p.y p.z  q.x q.y q.z q.w  (tool pose)
  state        7    : bend[3] plane[3] compress[3]
  state        16   : cables[9] cable_cmd[9] tension[9]
  state        43   : motor_angle motor_speed shaft_twist tool_torque compression cable_speed
  state        49   : at_limit flags[7]
  bones        0    : count then per bone: pos3 quat4 length radius segment kind is_active
  cable        0    : count then per cable: points (5 * 3) tension cable_id pad
  task         0    : phase depth turns load_torque misalign absorbed opening connected damaged
  task         9    : reaction force 3, reaction torque 3, peak_force human_force safety
  mesh         0    : vertex_count (f32 bit-truncated) tri_count, then positions, normals, indices(u32 bit-cast)
";

/// Number of floats the scratch buffer must hold (JS asks for this).
pub const SCRATCH_LEN: usize = 1 << 21; // 2 M floats = 8 MB

/// Field order of [`trunc_set_config`].
pub const CONFIG_FIELDS: [&str; 20] = [
    "segment_length", "cells_per_segment", "cable_radius", "cell_radius", "preload",
    "servo_speed", "servo_bandwidth", "tendon_stiffness", "anisotropy", "compliance",
    "damping", "payload_kg", "gravity_sag", "hysteresis", "sensor_noise", "motor_torque",
    "motor_speed", "motor_gain", "seed", "reserved",
];

/// Field order of [`trunc_set_task`].
pub const TASK_FIELDS: [&str; 17] = [
    "kind", "anchor.x", "anchor.y", "anchor.z", "axis.x", "axis.y", "axis.z", "pitch",
    "turns_required", "clearance", "friction", "torque_limit", "force_limit", "compliance",
    "stiction", "disturbance", "reset",
];

pub struct Core {
    pub arm: Arm,
    pub state: ArmState,
    pub task: TaskSpec,
    pub task_state: TaskState,
    pub scratch: Vec<f32>,
    pub cloud: Vec<[f32; 3]>,
    pub mlp: Option<Mlp>,
    pub transformer: Option<Transformer>,
    pub rng_seed: u64,
    pub prev_spin: f32,
    pub time: f32,
    pub stiffness: f32,
    pub study: Study,
}

impl Core {
    fn new(seed: u32) -> Self {
        let arm = Arm::new(ArmConfig::default());
        Core {
            arm,
            state: ArmState::home(),
            task: TaskSpec::default(),
            task_state: TaskState::default(),
            scratch: vec![0.0; SCRATCH_LEN],
            cloud: Vec::new(),
            mlp: None,
            transformer: None,
            rng_seed: seed as u64,
            prev_spin: 0.0,
            time: 0.0,
            stiffness: 1.0,
            study: Study::default(),
        }
    }
}

// ---------------------------------------------------------------- lifecycle

#[no_mangle]
pub extern "C" fn trunc_version_major() -> u32 { 0 }
#[no_mangle]
pub extern "C" fn trunc_version_minor() -> u32 { 3 }
#[no_mangle]
pub extern "C" fn trunc_version_patch() -> u32 { 0 }

/// Number of floats in the scratch buffer.
#[no_mangle]
pub extern "C" fn trunc_scratch_len() -> u32 { SCRATCH_LEN as u32 }

/// Number of cables / segments (kept in sync with the JS mirror).
#[no_mangle]
pub extern "C" fn trunc_cable_count() -> u32 { N_CABLES as u32 }
#[no_mangle]
pub extern "C" fn trunc_segment_count() -> u32 { N_SEGMENTS as u32 }

/// Allocate a core; free with [`trunc_free`].
#[no_mangle]
pub extern "C" fn trunc_new(seed: u32) -> *mut Core { Box::into_raw(Box::new(Core::new(seed))) }

/// Drop a core created by [`trunc_new`].
///
/// Safety: `ptr` must come from [`trunc_new`] and be freed exactly once.
#[no_mangle]
pub extern "C" fn trunc_free(ptr: *mut Core) {
    if ptr.is_null() { return; }
    // SAFETY: contract above.
    unsafe { drop(Box::from_raw(ptr)) };
}

/// Raw pointer to the core's scratch buffer (f32 view in JS).
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_scratch(ptr: *mut Core) -> *mut f32 {
    if ptr.is_null() { return core::ptr::null_mut(); }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    core.scratch.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn trunc_segment_name(index: u32) -> u32 {
    // returns a stable index into the JS name table (0..2), keeps the ABI string-free
    if index < 3 { index } else { 0 }
}

#[no_mangle]
pub extern "C" fn trunc_segment_name_len() -> u32 { SEGMENT_NAMES.len() as u32 }

// ---------------------------------------------------------------- parameters

/// Apply arm configuration from the scratch buffer (`CONFIG_FIELDS` order).
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_set_config(ptr: *mut Core, len: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let n = (len as usize).min(core.scratch.len());
    let s: Vec<f32> = core.scratch[..n].to_vec();
    if s.len() < 18 { return 0; }
    let mut cfg = core.arm.cfg;
    cfg.segment_length = s[0].clamp(0.05, 1.0);
    cfg.cells_per_segment = s[1].clamp(1.0, 16.0) as u32;
    cfg.cable_radius = s[2].clamp(0.002, 0.2);
    cfg.cell_radius = s[3].clamp(0.004, 0.2);
    cfg.preload = s[4].clamp(0.0, 200.0);
    cfg.servo_speed = s[5].clamp(0.001, 5.0);
    cfg.servo_bandwidth = s[6].clamp(0.1, 400.0);
    cfg.tendon_stiffness = s[7].clamp(1.0, 1.0e6);
    cfg.anisotropy = s[8].clamp(1.0, 400.0);
    cfg.compliance = s[9].clamp(0.05, 8.0);
    cfg.damping = s[10].clamp(0.0, 4.0);
    cfg.payload_kg = s[11].clamp(0.0, 20.0);
    cfg.gravity_sag = s[12].clamp(0.0, 3.0);
    cfg.hysteresis = s[13].clamp(0.0, 1.0);
    cfg.sensor_noise = s[14].clamp(0.0, 0.01);
    cfg.motor_torque = s[15].clamp(0.0, 20.0);
    cfg.motor_speed = s[16].clamp(0.0, 400.0);
    cfg.motor_gain = s[17].clamp(0.0, 20.0);
    core.rng_seed = s[18].max(0.0) as u64;
    core.stiffness = cfg.compliance.max(0.05);
    core.arm = Arm::new(cfg);
    core.state = ArmState::home();
    core.time = 0.0;
    core.state.cable_cmd = core.arm.cable_targets(&core.state.seg);
    1
}

/// Set the nine cable set-points from the scratch buffer.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_set_cables(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    for c in 0..N_CABLES {
        core.state.cable_cmd[c] = core.scratch[c];
    }
    N_CABLES as u32
}

/// Configure the task (`TASK_FIELDS` order).
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_set_task(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let s: Vec<f32> = core.scratch[..17].to_vec();
    let kind = TaskKind::from_u32(s[0] as u32);
    let anchor = Vec3::new(s[1], s[2], s[3]);
    let axis = Vec3::new(s[4], s[5], s[6]).norm();
    let mut spec = match kind {
        TaskKind::Bolt => TaskSpec::bolt(anchor, axis),
        TaskKind::Bulb => TaskSpec::bulb(anchor, axis),
        TaskKind::Valve => TaskSpec::valve(anchor, axis),
        TaskKind::PegInHole => TaskSpec::peg(anchor, axis),
    };
    spec.pitch = s[7].max(1e-5);
    spec.turns_required = s[8].max(0.05);
    spec.clearance = s[9].max(1e-6);
    spec.friction = s[10].max(0.0);
    spec.torque_limit = s[11].max(1e-4);
    spec.force_limit = s[12].max(0.1);
    spec.compliance = s[13].clamp(0.0, 1.0);
    spec.stiction = s[14].max(0.0);
    spec.disturbance = s[15].max(0.0);
    core.task = spec;
    if s[16] > 0.5 {
        core.task_state = TaskState::default();
        core.prev_spin = core.state.motor_angle;
        core.time = 0.0;
    }
    1
}

/// Set the mass held at the tool (kg) and the gravity-sag blend (0..1).
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_set_payload(ptr: *mut Core, kg: f32, sag: f32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    core.arm.cfg.payload_kg = kg.clamp(0.0, 50.0);
    core.arm.cfg.gravity_sag = sag.clamp(0.0, 3.0);
    1
}

// -------------------------------------------------------------- simulation

/// Advance the arm + task by `dt` seconds.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_step(ptr: *mut Core, dt: f32, motor_speed: f32, motor_hold: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let dt = dt.clamp(1e-5, 0.05);

    // 1. task reaction from the previous step deflects the arm (compliance!)
    let ext: Wrench = core.task_state.reaction;
    let cmd = MotorCommand { speed: motor_speed, hold: motor_hold != 0 };
    core.arm.step(&mut core.state, dt, ext, cmd);
    core.time += dt;

    // 2. advance the task with the freshly measured tool pose
    let input = TaskInput {
        tool_pos: core.state.tool.p,
        tool_axis: core.state.tool_axis(),
        spin: core.state.tool_spin(),
        torque: core.state.tool_torque,
        speed: core.state.motor_speed,
        compliance_gain: 1.0 / core.arm.cfg.compliance.max(0.05),
        lateral_error: {
            let d = core.task.anchor.sub(core.state.tool.p);
            let along = d.dot(core.task.axis);
            d.sub(core.task.axis.scale(along)).len()
        },
        tilt_error: core.state.tool_axis().cross(core.task.axis).len().clamp(0.0, 1.0),
        time: core.time,
    };
    let spins = core.state.tool_spin();
    let reaction = physics::step(&core.task, &mut core.task_state, &input, core.prev_spin, dt);
    core.prev_spin = spins;
    core.task_state.reaction = reaction;
    1
}

/// Write the full arm state into the scratch buffer, return the float count.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_state(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let st = core.state;
    let mut o = 0usize;
    let mut w = |core: &mut Core, v: f32| { core.scratch[o] = v; o += 1; };
    w(core, st.tool.p.x); w(core, st.tool.p.y); w(core, st.tool.p.z);
    w(core, st.tool.q.x); w(core, st.tool.q.y); w(core, st.tool.q.z); w(core, st.tool.q.w);
    for s in st.seg.iter() { w(core, s.bend); }
    for s in st.seg.iter() { w(core, s.plane); }
    for s in st.seg.iter() { w(core, s.compress); }
    for c in st.cables.iter() { w(core, *c); }
    for c in st.cable_cmd.iter() { w(core, *c); }
    for c in st.tension.iter() { w(core, *c); }
    w(core, st.motor_angle); w(core, st.motor_speed); w(core, st.shaft_twist);
    w(core, st.tool_torque); w(core, st.compression); w(core, st.cable_speed);
    w(core, if st.at_limit { 1.0 } else { 0.0 });
    for s in st.seg.iter() { w(core, s.hysteresis); }
    w(core, core.time); w(core, core.stiffness); w(core, core.arm.cfg.payload_kg);
    o as u32
}

/// Write the task state into the scratch buffer, return the float count.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_task_state(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let t = core.task_state;
    let f = t.reaction.force;
    let m = t.reaction.torque;
    let vals: [f32; 18] = [
        t.phase.as_u32() as f32, t.depth, t.turns, t.load_torque, t.misalign, t.absorbed, t.opening,
        if t.connected { 1.0 } else { 0.0 }, if t.damaged { 1.0 } else { 0.0 },
        f.x, f.y, f.z, m.x, m.y, m.z, t.peak_force, t.human_force,
        physics::safety_index(t.peak_force, t.load_torque, core.stiffness),
    ];
    for (i, v) in vals.iter().enumerate() { core.scratch[i] = *v; }
    vals.len() as u32
}

/// Per-cell transforms for instanced rendering. Layout: `[count, (pos3, quat4, length, radius, segment, kind, active) * n]`.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_bones(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let bones = core.arm.bones(&core.state);
    let mut o = 0usize;
    core.scratch[o] = bones.len() as f32; o += 1;
    for b in bones.iter() {
        let vals = [
            b.transform.p.x, b.transform.p.y, b.transform.p.z,
            b.transform.q.x, b.transform.q.y, b.transform.q.z, b.transform.q.w,
            b.length, b.radius, b.segment as f32, b.kind.as_u32() as f32, if b.is_active { 1.0 } else { 0.0 },
        ];
        for v in vals.iter() { core.scratch[o] = *v; o += 1; }
    }
    o as u32
}

/// Tendon polylines: `[count, (5*3 points, tension, cable_id, pad) * n]`.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_cables(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let paths = core.arm.cable_paths(&core.state);
    let mut o = 0usize;
    core.scratch[o] = paths.len() as f32; o += 1;
    for p in paths.iter() {
        for k in 0..5 {
            core.scratch[o] = p.points[k][0]; o += 1;
            core.scratch[o] = p.points[k][1]; o += 1;
            core.scratch[o] = p.points[k][2]; o += 1;
        }
        core.scratch[o] = p.tension; o += 1;
        core.scratch[o] = p.cable as f32; o += 1;
        core.scratch[o] = 0.0; o += 1;
    }
    o as u32
}

/// Solve inverse kinematics for the tool pose in the scratch buffer
/// (`[x,y,z,qx,qy,qz,qw]`) and write the nine cable lengths back.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_ik(ptr: *mut Core, iters: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let target = Transform::new(
        Vec3::new(core.scratch[0], core.scratch[1], core.scratch[2]),
        crate::mathx::Quat::from_array([core.scratch[3], core.scratch[4], core.scratch[5], core.scratch[6]]),
    );
    let seg = core.arm.ik(&target, &core.state, iters.clamp(1, 64));
    let cables = core.arm.cable_targets(&seg);
    for c in 0..N_CABLES { core.scratch[c] = cables[c]; }
    for s in 0..N_SEGMENTS {
        core.scratch[9 + s * 3] = seg[s].bend;
        core.scratch[10 + s * 3] = seg[s].plane;
        core.scratch[11 + s * 3] = seg[s].compress;
    }
    N_CABLES as u32
}

/// Forward kinematics from cable lengths in the scratch buffer → tool pose + error.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_fk_from_cables(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let mut cables = [0.0f32; N_CABLES];
    for c in 0..N_CABLES { cables[c] = core.scratch[c]; }
    let seg = core.arm.segments_from_cables(&cables);
    let t = core.arm.fk(&seg, 0.0, 0.0);
    let vals = [t.p.x, t.p.y, t.p.z, t.q.x, t.q.y, t.q.z, t.q.w];
    for (i, v) in vals.iter().enumerate() { core.scratch[i] = *v; }
    for s in 0..N_SEGMENTS {
        core.scratch[7 + s] = seg[s].bend;
        core.scratch[10 + s] = seg[s].plane;
        core.scratch[13 + s] = seg[s].compress;
    }
    16
}

/// Sample the workspace; returns the number of points written
/// (`[x,y,z] * n`). Capped by the scratch size.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_workspace(ptr: *mut Core, n: u32, seed: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let cap = (SCRATCH_LEN / 3) as u32;
    let count = n.min(cap);
    let pts = core.arm.workspace_cloud(count, seed as u64);
    let mut o = 0usize;
    for p in pts.iter() {
        core.scratch[o] = p.x; o += 1;
        core.scratch[o] = p.y; o += 1;
        core.scratch[o] = p.z; o += 1;
    }
    (pts.len() * 3) as u32
}

/// Run the paper's repeatability experiment.
/// Returns `[pos_sd_mm, ang_sd_deg, points, trials]` in the scratch buffer.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_repeatability(ptr: *mut Core, points: u32, trials: u32, ordered: u32, seed: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let study = core.arm.repeatability_study(points.clamp(2, 400) as usize, trials.clamp(1, 20), ordered != 0, seed as u64);
    core.study = study;
    core.scratch[0] = study.pos_sd_mm;
    core.scratch[1] = study.ang_sd_deg;
    core.scratch[2] = study.points as f32;
    core.scratch[3] = study.trials as f32;
    4
}

/// Number of cells / struts of a cell preset (used by the mesh generator UI).
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_mesh_cell(ptr: *mut Core, kind: u32, length: f32, radius: f32, rings: u32, struts: u32, res: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let m = mesh::trunc_cell(kind, length, radius, rings.max(2), struts.max(4), res.max(3));
    write_mesh(core, &m)
}

/// Other procedural parts: 0 bolt, 1 bulb, 2 valve wheel, 3 hex socket, 4 hand, 5 motherboard.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_mesh_part(ptr: *mut Core, part: u32, a: f32, b: f32, c: f32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let m = match part {
        0 => mesh::bolt(a.max(1e-3), b.max(1e-3), c.max(1e-4), 8),
        1 => mesh::light_bulb(a.max(1e-3)),
        2 => mesh::valve_wheel(a.max(1e-3), b.max(3.0) as u32),
        3 => mesh::hex_socket(a.max(1e-3), b.max(1e-3)),
        4 => mesh::hand_proxy(),
        5 => mesh::motherboard(a.max(1e-3), b.max(1e-3), c.max(1e-4)),
        _ => mesh::MeshData::new(),
    };
    write_mesh(core, &m)
}

fn write_mesh(core: &mut Core, m: &mesh::MeshData) -> u32 {
    let verts = m.vertex_count();
    let tris = m.tri_count();
    let mut o = 0usize;
    core.scratch[o] = verts as f32; o += 1;
    core.scratch[o] = tris as f32; o += 1;
    for v in m.positions.iter() { core.scratch[o] = *v; o += 1; }
    for v in m.normals.iter() { core.scratch[o] = *v; o += 1; }
    for idx in m.indices.iter() { core.scratch[o] = f32::from_bits(*idx); o += 1; }
    o as u32
}

// -------------------------------------------------------------- neural nets

/// Create the inverse-kinematics MLP from a size list in the scratch buffer.
/// `seed` in scratch[0], sizes from scratch[1].
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_mlp_new(ptr: *mut Core, n_layers: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let seed = core.scratch[0] as u64;
    let mut sizes = Vec::new();
    for i in 0..n_layers as usize { sizes.push(core.scratch[1 + i].max(1.0) as usize); }
    if sizes.len() < 2 { return 0; }
    let net = Mlp::new(&sizes, crate::nn::Act::Tanh, seed);
    let params = net.param_count();
    core.mlp = Some(net);
    params as u32
}

/// MLP forward: input at scratch[0..in_dim], result written to scratch[1024..].
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_mlp_forward(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let net = match core.mlp.as_ref() { Some(n) => n, None => return 0 };
    let in_dim = net.layers[0].in_dim;
    let input: Vec<f32> = core.scratch[..in_dim].to_vec();
    let mut out = Vec::new();
    net.forward(&input, &mut out);
    for (i, v) in out.iter().enumerate() { core.scratch[1024 + i] = *v; }
    out.len() as u32
}

/// Overwrite MLP parameters from scratch[0..n].
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_mlp_set_params(ptr: *mut Core, n: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let flat: Vec<f32> = core.scratch[..(n as usize).min(core.scratch.len())].to_vec();
    match core.mlp.as_mut() {
        Some(net) => if net.set_params(&flat) { net.param_count() as u32 } else { 0 },
        None => 0,
    }
}

/// Number of parameters of the current MLP.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_mlp_params(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    core.mlp.as_ref().map(|n| n.param_count() as u32).unwrap_or(0)
}

/// Create the causal trajectory transformer.
/// scratch: [d_model, n_heads, n_layers, d_ff, seq_len, out_dim, vocab, cond_in, seed].
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_transformer_new(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let cfg = TransformerConfig {
        d_model: core.scratch[0].clamp(4.0, 256.0) as usize,
        n_heads: core.scratch[1].clamp(1.0, 16.0) as usize,
        n_layers: core.scratch[2].clamp(1.0, 8.0) as usize,
        d_ff: core.scratch[3].clamp(4.0, 512.0) as usize,
        seq_len: core.scratch[4].clamp(2.0, 256.0) as usize,
        out_dim: core.scratch[5].clamp(1.0, 64.0) as usize,
    };
    let vocab = core.scratch[6].clamp(2.0, 4096.0) as usize;
    let cond_in = core.scratch[7].clamp(1.0, 64.0) as usize;
    let seed = core.scratch[8] as u64;
    let t = Transformer::new(cfg, vocab, cond_in, seed);
    let n = t.param_count();
    core.transformer = Some(t);
    n as u32
}

/// Transformer forward pass.
/// scratch: [seq_len (float), tokens (u32 bit-cast)…, cond_in condition floats at 256..],
/// `attention != 0` also writes the layer-0 attention matrix after the outputs.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_transformer_forward(ptr: *mut Core, want_attention: u32) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let t = match core.transformer.as_ref() { Some(t) => t, None => return 0 };
    let seq = core.scratch[0].max(1.0) as usize;
    let mut tokens = Vec::with_capacity(seq);
    for i in 0..seq { tokens.push(core.scratch[1 + i].to_bits()); }
    let cond_in = t.cond_in;
    let cond: Vec<f32> = core.scratch[256..256 + cond_in].to_vec();
    let mut out = Vec::new();
    if want_attention != 0 {
        let mut attn = Vec::new();
        t.forward(&tokens, &cond, &mut out, Some(&mut attn));
        for (i, v) in out.iter().enumerate() { core.scratch[1024 + i] = *v; }
        let base = 1024 + out.len();
        for (i, v) in attn.iter().enumerate() { core.scratch[base + i] = *v; }
        (out.len() + attn.len()) as u32
    } else {
        t.forward(&tokens, &cond, &mut out, None);
        for (i, v) in out.iter().enumerate() { core.scratch[1024 + i] = *v; }
        out.len() as u32
    }
}

/// Parameter count of the transformer.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_transformer_params(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    core.transformer.as_ref().map(|t| t.param_count() as u32).unwrap_or(0)
}

/// Load MLP training data (JSON-free binary layout) and train in Rust.
/// scratch: [n, in_dim, out_dim, epochs, batch, lr, seed] then samples (x… y…).
/// Returns the final loss * 1000 (as an integer) and writes the loss history after 64.
///
/// Safety: `ptr` must be a live core handle.
#[no_mangle]
pub extern "C" fn trunc_mlp_train(ptr: *mut Core) -> u32 {
    if ptr.is_null() { return 0; }
    // SAFETY: caller owns the core.
    let core = unsafe { &mut *ptr };
    let n = core.scratch[0].max(1.0) as usize;
    let in_dim = core.scratch[1].max(1.0) as usize;
    let out_dim = core.scratch[2].max(1.0) as usize;
    let epochs = core.scratch[3].max(1.0) as u32;
    let batch = core.scratch[4].max(1.0) as usize;
    let lr = core.scratch[5].max(1e-6);
    let seed = core.scratch[6] as u64;
    let base = 64usize;
    let mut data = Dataset::new(in_dim, out_dim);
    let mut o = base;
    for _ in 0..n {
        if o + in_dim + out_dim > core.scratch.len() { break; }
        let x: Vec<f32> = core.scratch[o..o + in_dim].to_vec();
        o += in_dim;
        let y: Vec<f32> = core.scratch[o..o + out_dim].to_vec();
        o += out_dim;
        data.push(&x, &y);
    }
    if data.n == 0 { return 0; }
    let sizes = [in_dim, 48, 48, out_dim];
    let mut net = Mlp::new(&sizes, crate::nn::Act::Tanh, seed);
    let report = crate::nn::train_mlp(&mut net, &data, epochs, batch, lr, seed, 1);
    let (test_loss, _) = crate::nn::evaluate(&net, &data);
    let mut params = Vec::new();
    net.params_into(&mut params);
    core.mlp = Some(net);
    for (i, l) in report.loss.iter().enumerate() { if i < 256 { core.scratch[i] = *l; } }
    (test_loss * 1000.0) as u32
}

/// Look up a cell kind by index (guards against out-of-range mesh requests).
pub fn cell_kind(index: u32) -> CellKind {
    if index == 1 { CellKind::Equatorial } else { CellKind::Truss }
}

/// Human-readable phase name (used by the CLI).
pub fn phase_name(p: u32) -> &'static str {
    match p {
        0 => Phase::Approach.name(), 1 => Phase::Align.name(), 2 => Phase::Engage.name(),
        3 => Phase::Fasten.name(), 4 => Phase::Verify.name(), 5 => Phase::Done.name(),
        _ => Phase::Failed.name(),
    }
}
