//! `trunc_cli` — headless experiments for the TRUNC lab.
//!
//! ```text
//! cargo run --release --bin trunc_cli -- bench
//! cargo run --release --bin trunc_cli -- repeat --points 100 --trials 5
//! cargo run --release --bin trunc_cli -- workspace --n 20000 --out cloud.json
//! cargo run --release --bin trunc_cli -- sim --task valve --seconds 30
//! cargo run --release --bin trunc_cli -- train --epochs 400 --samples 3000
//! cargo run --release --bin trunc_cli -- mesh --part cell-truss --out cell.obj
//! ```
//!
//! It shares 100 % of its maths with the WebGPU front-end (same crate), so numbers
//! printed here are the numbers the browser shows.

use std::env;
use std::fs::File;
use std::io::Write;

use trunc_core::arm::{Arm, ArmConfig, ArmState, MotorCommand, N_CABLES, SEGMENT_NAMES};
use trunc_core::mathx::{clamp, deg, Rng, Transform, Vec3};
use trunc_core::metamaterial::{CellKind, MAX_BEND_RAD};
use trunc_core::nn::{evaluate, train_mlp, Act, Dataset, Mlp};
use trunc_core::physics::{self, TaskInput, TaskSpec, TaskState};
use trunc_core::{mesh, paper};

fn arg_value(args: &[String], key: &str, default: f32) -> f32 {
    args.iter()
        .position(|a| a == key)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse::<f32>().ok())
        .unwrap_or(default)
}

fn arg_string(args: &[String], key: &str, default: &str) -> String {
    args.iter()
        .position(|a| a == key)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).cloned().unwrap_or_else(|| "help".to_string());
    match cmd.as_str() {
        "bench" => cmd_bench(),
        "repeat" => cmd_repeat(&args),
        "workspace" => cmd_workspace(&args),
        "sim" => cmd_sim(&args),
        "dataset" => cmd_dataset(&args),
        "train" => cmd_train(&args),
        "mesh" => cmd_mesh(&args),
        "layout" => println!("{}", trunc_core::ffi::LAYOUT),
        _ => {
            println!("trunc_core {} — TRUNC soft-arm simulation core", trunc_core::VERSION);
            println!("paper anchors: {} m arm, {}° per joint, {}× torsion/bending, {} mm compression",
                paper::NEUTRAL_LENGTH, paper::MAX_BEND_DEG, paper::ANISOTROPY, paper::MAX_COMPRESSION * 1000.0);
            println!("commands: bench | repeat | workspace | sim | dataset | train | mesh | layout");
        }
    }
}

fn task_spec(kind: &str, anchor: Vec3) -> TaskSpec {
    match kind {
        "bulb" => TaskSpec::bulb(anchor, Vec3::up()),
        "valve" => TaskSpec::valve(anchor, Vec3::up()),
        "peg" => TaskSpec::peg(anchor, Vec3::up()),
        _ => TaskSpec::bolt(anchor, Vec3::up()),
    }
}

/// Simple scripted supervisor: move to the part, align, then turn until done.
fn scripted_control(spec: &TaskSpec, st: &TaskState, arm: &Arm, state: &mut ArmState, t: f32) {
    let target = Transform::new(spec.anchor.add(spec.axis.scale(0.02)), state.tool.q);
    let seg = arm.ik(&target, state, 10);
    let cables = arm.cable_targets(&seg);
    let _ = st;
    for c in 0..N_CABLES { state.cable_cmd[c] = cables[c] * clamp(t / 0.6, 0.0, 1.0); }
}

fn cmd_bench() {
    println!("TRUNC benchmark — reproducing the paper's four demonstrations\n");
    println!("{:<34} {:>8} {:>8} {:>9} {:>9} {:>9} {}", "task", "turns", "depth", "torque", "absorb", "safety", "result");
    for kind in ["bolt", "bulb", "valve", "peg"] {
        let anchor = Vec3::new(0.18, 0.05, 0.0);
        let spec = task_spec(kind, anchor);
        let mut arm = Arm::new(ArmConfig::default());
        let mut state = ArmState::home();
        let mut task_state = TaskState::default();
        let mut prev_spin = 0.0;
        let dt = 0.002f32;
        let mut t = 0.0f32;
        while t < 25.0 && !task_state.success && !task_state.damaged {
            scripted_control(&spec, &task_state, &arm, &mut state, t);
            let ext = task_state.reaction;
            arm.step(&mut state, dt, ext, MotorCommand { speed: 6.0, hold: true });
            let spin = state.tool_spin();
            let d = spec.anchor.sub(state.tool.p);
            let along = d.dot(spec.axis);
            let input = TaskInput {
                tool_pos: state.tool.p,
                tool_axis: state.tool_axis(),
                spin,
                torque: state.tool_torque,
                speed: state.motor_speed,
                compliance_gain: 1.0,
                lateral_error: d.sub(spec.axis.scale(along)).len(),
                tilt_error: state.tool_axis().cross(spec.axis).len(),
                time: t,
            };
            let reaction = physics::step(&spec, &mut task_state, &input, prev_spin, dt);
            task_state.reaction = reaction;
            prev_spin = spin;
            t += dt;
        }
        let m = physics::metrics(&spec, &task_state, t, arm.cfg.compliance);
        println!("{:<34} {:>8.2} {:>8.1} {:>9.3} {:>9.2} {:>9.2} {}",
            spec.kind.name(), m.turns, m.depth_mm, m.load_torque, m.absorbed_mm, m.safety,
            if m.success && !m.damaged { "✅ complete" } else if m.damaged { "❌ damaged" } else { "… timeout" });
    }
    println!("\npaper reference: point repeatability {:.1} mm, trajectory repeatability {:.1} mm, angular {:.1}°",
        paper::POINT_REPEATABILITY_MM, paper::TRAJECTORY_REPEATABILITY_MM, paper::ANGULAR_REPEATABILITY_DEG);
}

fn cmd_repeat(args: &[String]) {
    let points = arg_value(args, "--points", 100.0) as u32;
    let trials = arg_value(args, "--trials", 5.0) as u32;
    let mut arm = Arm::new(ArmConfig::default());
    for (ordered, label) in [(false, "point positioning (random order)"), (true, "trajectory following (sorted order)")] {
        let study = arm.repeatability_study(points as usize, trials, ordered, 7);
        println!("{:<38} pos SD {:>6.2} mm   ang SD {:>5.3}°   ({} points × {} trials)",
            label, study.pos_sd_mm, study.ang_sd_deg, study.points, study.trials);
    }
    println!("\npaper: 2.1 mm / 0.1° point, 0.4 mm / 0.1° trajectory");
}

fn cmd_workspace(args: &[String]) {
    let n = arg_value(args, "--n", 20000.0) as u32;
    let out = arg_string(args, "--out", "");
    let mut arm = Arm::new(ArmConfig::default());
    let pts = arm.workspace_cloud(n, 42);
    let mut min = Vec3::splat(1e9);
    let mut max = Vec3::splat(-1e9);
    for p in pts.iter() {
        min = Vec3::new(min.x.min(p.x), min.y.min(p.y), min.z.min(p.z));
        max = Vec3::new(max.x.max(p.x), max.y.max(p.y), max.z.max(p.z));
    }
    let reach = (max.y - min.y) * 1000.0;
    println!("workspace: {} poses", pts.len());
    println!("  bounding box x[{:.0},{:.0}] y[{:.0},{:.0}] z[{:.0},{:.0}] mm",
        min.x * 1000.0, max.x * 1000.0, min.y * 1000.0, max.y * 1000.0, min.z * 1000.0, max.z * 1000.0);
    println!("  axial extent {:.1} mm (paper: {} mm compression, {:.0} mm reach)", reach,
        (paper::MAX_COMPRESSION * 1000.0) as u32, paper::WORKSPACE_DIAMETER * 1000.0);
    if !out.is_empty() {
        let mut s = String::from("[");
        for (i, p) in pts.iter().enumerate() {
            if i > 0 { s.push(','); }
            s.push_str(&format!("[{:.4},{:.4},{:.4}]", p.x, p.y, p.z));
        }
        s.push(']');
        File::create(&out).and_then(|mut f| f.write_all(s.as_bytes())).unwrap();
        println!("  wrote {}", out);
    }
}

fn cmd_sim(args: &[String]) {
    let task = arg_string(args, "--task", "bolt");
    let seconds = arg_value(args, "--seconds", 12.0);
    let dt = 0.002f32;
    let spec = task_spec(&task, Vec3::new(0.18, 0.05, 0.0));
    let mut arm = Arm::new(ArmConfig::default());
    let mut state = ArmState::home();
    let mut task_state = TaskState::default();
    let mut prev_spin = 0.0;
    let mut t = 0.0f32;
    println!("sim: {} for {:.0}s", spec.kind.name(), seconds);
    while t < seconds && !task_state.success && !task_state.damaged {
        scripted_control(&spec, &task_state, &arm, &mut state, t);
        let ext = task_state.reaction;
        arm.step(&mut state, dt, ext, MotorCommand { speed: 6.0, hold: true });
        let spin = state.tool_spin();
        let d = spec.anchor.sub(state.tool.p);
        let along = d.dot(spec.axis);
        let input = TaskInput {
            tool_pos: state.tool.p, tool_axis: state.tool_axis(), spin,
            torque: state.tool_torque, speed: state.motor_speed, compliance_gain: 1.0,
            lateral_error: d.sub(spec.axis.scale(along)).len(),
            tilt_error: state.tool_axis().cross(spec.axis).len(), time: t,
        };
        let reaction = physics::step(&spec, &mut task_state, &input, prev_spin, dt);
        task_state.reaction = reaction;
        prev_spin = spin;
        t += dt;
        if ((t / dt) as i32) % 500 == 0 {
            println!("  t={:5.2}s tool=({:.3},{:.3},{:.3}) bend=[{:.1},{:.1},{:.1}]° twist={:.3}° τ={:.3} N·m cablesΔ={:.4} m",
                t, state.tool.p.x, state.tool.p.y, state.tool.p.z,
                state.seg[0].bend.to_degrees(), state.seg[1].bend.to_degrees(), state.seg[2].bend.to_degrees(),
                state.shaft_twist.to_degrees(), state.tool_torque, state.cables[0]);
        }
    }
    let m = physics::metrics(&spec, &task_state, t, arm.cfg.compliance);
    println!("result: {} after {:.2}s — turns {:.2}, depth {:.1} mm, peak force {:.1} N, safety {:.2}",
        if m.success { "SUCCESS" } else if m.damaged { "DAMAGED" } else { "TIMEOUT" },
        m.time_s, m.turns, m.depth_mm, m.peak_force_n, m.safety);
}

/// Generate the inverse-kinematics dataset the paper trains on: measured cable lengths
/// → tool pose, with hysteresis + encoder noise, so the learned model must be robust.
fn cmd_dataset(args: &[String]) {
    let samples = arg_value(args, "--samples", 3000.0) as usize;
    let out = arg_string(args, "--out", "ik_dataset.csv");
    let cfg = ArmConfig::default();
    let arm = Arm::new(cfg);
    let mut rng = Rng::new(20241203);
    let mut state = ArmState::home();
    let mut rows = String::from("l0,l1,l2,l3,l4,l5,l6,l7,l8,px,py,pz,qx,qy,qz,qw,depth_mm\n");
    for _ in 0..samples {
        let mut seg = state.seg;
        for s in 0..3 {
            seg[s].bend = rng.range(0.0, MAX_BEND_RAD);
            seg[s].plane = rng.range(-std::f32::consts::PI, std::f32::consts::PI);
            seg[s].compress = rng.range(0.0, cfg.max_compression() / 3.0);
        }
        state.seg = seg;
        state.tension = [cfg.preload + rng.range(0.0, 4.0); N_CABLES];
        state.cables = arm.cable_targets(&seg);
        let measured = arm.measured_cables(&state, &mut rng);
        let pose = arm.measured_pose(&state, &mut rng);
        for c in 0..N_CABLES { rows.push_str(&format!("{:.6},", measured[c])); }
        rows.push_str(&format!("{:.5},{:.5},{:.5},{:.5},{:.5},{:.5},{:.5},{:.2}\n",
            pose.p.x, pose.p.y, pose.p.z, pose.q.x, pose.q.y, pose.q.z, pose.q.w, seg[0].compress * 1000.0));
    }
    File::create(&out).and_then(|mut f| f.write_all(rows.as_bytes())).unwrap();
    println!("dataset: {} samples → {} (cable lengths → tool pose)", samples, out);
}

fn cmd_train(args: &[String]) {
    let samples = arg_value(args, "--samples", 3000.0) as usize;
    let epochs = arg_value(args, "--epochs", 300.0) as u32;
    let lr = arg_value(args, "--lr", 0.003);
    let path = arg_string(args, "--out", "ik_weights.json");
    let arm = Arm::new(ArmConfig::default());
    let mut rng = Rng::new(20241203);
    let mut data = Dataset::new(N_CABLES, 7);
    let mut state = ArmState::home();
    for _ in 0..samples {
        let mut seg = state.seg;
        for s in 0..3 {
            seg[s].bend = rng.range(0.0, MAX_BEND_RAD);
            seg[s].plane = rng.range(-std::f32::consts::PI, std::f32::consts::PI);
            seg[s].compress = rng.range(0.0, arm.cfg.max_compression() / 3.0);
        }
        state.seg = seg;
        state.cables = arm.cable_targets(&seg);
        state.tension = [arm.cfg.preload + rng.range(0.0, 4.0); N_CABLES];
        let x = arm.measured_cables(&state, &mut rng);
        let p = arm.measured_pose(&state, &mut rng);
        data.push(&x, &[p.p.x, p.p.y, p.p.z, p.q.x, p.q.y, p.q.z, p.q.w]);
    }
    let (train, test) = data.split(0.15);
    let mut net = Mlp::new(&[N_CABLES, 64, 64, 7], Act::Tanh, 7);
    println!("training {} params on {} samples ({} held out)…", net.param_count(), train.n, test.n);
    let report = train_mlp(&mut net, &train, epochs, 32, lr, 11, (epochs / 12).max(1));
    let (test_err, mae) = evaluate(&net, &test);
    println!("loss history: {:?}", report.loss.iter().map(|l| (l * 1000.0).round() / 1000.0).collect::<Vec<f32>>());
    println!("held-out MAE {:.5} (position channels ≈ {:.2} mm)",
        test_err, ((mae[0] + mae[1] + mae[2]) / 3.0) * 1000.0);
    let mut flat = Vec::new();
    net.params_into(&mut flat);
    let mut s = String::from("{\"arch\":[9,64,64,7],\"act\":\"tanh\",\"params\":[");
    for (i, v) in flat.iter().enumerate() {
        if i > 0 { s.push(','); }
        s.push_str(&format!("{:.6}", v));
    }
    s.push_str("]}");
    File::create(&path).and_then(|mut f| f.write_all(s.as_bytes())).unwrap();
    println!("wrote {} ({} parameters)", path, flat.len());
}

fn cmd_mesh(args: &[String]) {
    let part = arg_string(args, "--part", "cell-truss");
    let out = arg_string(args, "--out", "part.obj");
    let m = match part.as_str() {
        "cell-eq" => mesh::trunc_cell(CellKind::Equatorial.as_u32(), 0.08, 0.026, 3, 6, 6),
        "cell-truss" => mesh::trunc_cell(CellKind::Truss.as_u32(), 0.08, 0.026, 4, 8, 6),
        "bolt" => mesh::bolt(0.004, 0.03, 0.00125, 8),
        "bulb" => mesh::light_bulb(0.03),
        "valve" => mesh::valve_wheel(0.06, 5),
        "socket" => mesh::hex_socket(0.012, 0.03),
        "hand" => mesh::hand_proxy(),
        "board" => mesh::motherboard(0.2, 0.14, 0.004),
        _ => mesh::trunc_cell(CellKind::Truss.as_u32(), 0.08, 0.026, 4, 8, 6),
    };
    let obj = m.to_obj();
    File::create(&out).and_then(|mut f| f.write_all(obj.as_bytes())).unwrap();
    println!("{}: {} vertices, {} triangles → {}", part, m.vertex_count(), m.tri_count(), out);
    let _ = deg(1.0);
    let _ = SEGMENT_NAMES[0];
}
