//! Invariants of the TRUNC model — the same assertions are mirrored in
//! `tests/kinematics.test.mjs` for the JavaScript core, so both implementations
//! have to agree with the paper's measurements.

use trunc_core::arm::{Arm, ArmConfig, ArmState, MotorCommand, N_CABLES, N_SEGMENTS, SegmentState};
use trunc_core::mathx::{deg, Rng, Transform, Vec3};
use trunc_core::metamaterial::{CellKind, TruncCell, MAX_BEND_RAD};
use trunc_core::nn::{train_mlp, Act, Dataset, Mlp, Transformer, TransformerConfig};
use trunc_core::physics::{self, TaskInput, TaskSpec, TaskState};
use trunc_core::paper;

fn arm() -> Arm { Arm::new(ArmConfig::default()) }

#[test]
fn tendon_kinematics_round_trip() {
    let a = arm();
    let mut rng = Rng::new(1);
    for _ in 0..200 {
        let seg = SegmentState::new(rng.range(0.0, MAX_BEND_RAD), rng.range(-3.1, 3.1), rng.range(0.0, 0.01));
        let cables = a.cable_targets(&[seg, seg, seg]);
        let (bend, plane, _c) = a.segment_from_cables(cables[0], cables[1], cables[2]);
        assert!((bend - seg.bend).abs() < 1e-3, "bend {bend} vs {}", seg.bend);
        let d = (plane - seg.plane).abs().min((plane - seg.plane + std::f32::consts::TAU).abs());
        assert!(d < 1e-2, "plane {plane} vs {}", seg.plane);
    }
}

#[test]
fn truss_is_far_stiffer_in_torsion_than_bending() {
    let cell = TruncCell::truss(0.025, 0.026);
    let ratio = cell.torsional_stiffness() / cell.bending_stiffness();
    assert!(ratio >= 40.0 && ratio <= 60.0, "anisotropy {ratio} (paper: 52×)");
    // and bending stays soft enough for 45° to be reachable by the tendons
    let t = cell.bending_torque(MAX_BEND_RAD);
    assert!(t > 0.005 && t < 0.2, "bending torque {t} N·m at 45°");
}

#[test]
fn rotation_is_continuous_through_a_bent_shaft() {
    let mut a = arm();
    let mut state = ArmState::home();
    state.seg = [SegmentState::new(deg(35.0), 0.4, 0.01); N_SEGMENTS];
    let mut last = 0.0f32;
    for _ in 0..2000 {
        a.step(&mut state, 0.001, trunc_core::arm::Wrench::default(), MotorCommand { speed: 20.0, hold: false });
        assert!(state.motor_angle >= last);
        last = state.motor_angle;
    }
    // several full turns with the arm bent: the whole point of the metamaterial
    assert!(state.motor_angle > 4.0 * std::f32::consts::TAU);
    assert!(state.shaft_twist.abs() < deg(30.0), "wind-up {}", state.shaft_twist);
}

#[test]
fn joint_limit_is_respected() {
    let mut a = arm();
    let mut state = ArmState::home();
    for c in 0..N_CABLES { state.cable_cmd[c] = -0.05; }
    for _ in 0..400 {
        a.step(&mut state, 0.002, trunc_core::arm::Wrench::default(), MotorCommand { speed: 0.0, hold: true });
        for s in state.seg.iter() {
            assert!(s.bend <= MAX_BEND_RAD + 1e-3, "bend {} exceeded 45°", s.bend);
            assert!(s.compress <= a.cfg.max_compression() + 1e-6);
        }
    }
}

#[test]
fn workspace_matches_paper_dimensions() {
    let mut a = arm();
    let pts = a.workspace_cloud(4000, 5);
    let mut max_r = 0.0f32;
    let mut max_y = 0.0f32;
    for p in pts.iter() {
        max_r = max_r.max((p.x * p.x + p.z * p.z).sqrt());
        max_y = max_y.max(p.y);
    }
    // the arm is 710 mm long and reaches ~600 mm laterally when bent
    assert!(max_y > 0.35 && max_y <= paper::NEUTRAL_LENGTH + 1e-3);
    assert!(max_r > 0.25 && max_r < 0.75, "lateral reach {max_r} m");
}

#[test]
fn ik_converges_for_reachable_targets() {
    let a = arm();
    let mut rng = Rng::new(9);
    let mut ok = 0;
    let total = 40;
    for _ in 0..total {
        let seg = [SegmentState::new(rng.range(deg(5.0), deg(40.0)), rng.range(-3.1, 3.1), 0.0); N_SEGMENTS];
        let target = a.fk(&seg, 0.0, 0.0);
        let seed = ArmState::home();
        let solved = a.ik(&target, &seed, 24);
        let got = a.fk(&solved, 0.0, 0.0);
        if got.p.sub(target.p).len() < 0.01 { ok += 1; }
    }
    assert!(ok as f32 / total as f32 > 0.75, "IK success {ok}/{total}");
}

#[test]
fn mlp_learns_inverse_kinematics() {
    let a = arm();
    let mut rng = Rng::new(3);
    let mut data = Dataset::new(N_CABLES, 3);
    for _ in 0..400 {
        let seg = [SegmentState::new(rng.range(0.0, MAX_BEND_RAD), rng.range(-3.1, 3.1), 0.0); N_SEGMENTS];
        let cables = a.cable_targets(&seg);
        let p = a.fk(&seg, 0.0, 0.0).p;
        data.push(&cables, &[p.x, p.y, p.z]);
    }
    let mut net = Mlp::new(&[N_CABLES, 32, 32, 3], Act::Tanh, 1);
    let before = trunc_core::nn::evaluate(&net, &data).0;
    let _ = train_mlp(&mut net, &data, 120, 16, 0.01, 1, 20);
    let after = trunc_core::nn::evaluate(&net, &data).0;
    assert!(after < before * 0.5, "training did not reduce error: {before} → {after}");
}

#[test]
fn transformer_is_causal_and_normalised() {
    let cfg = TransformerConfig { d_model: 16, n_heads: 2, n_layers: 2, d_ff: 32, seq_len: 8, out_dim: 9 };
    let t = Transformer::new(cfg, 64, 12, 4);
    let tokens = [3u32, 1, 4, 1, 5, 9, 2, 6];
    let cond = vec![0.1f32; 12];
    let mut out = Vec::new();
    let mut attn = Vec::new();
    t.forward(&tokens, &cond, &mut out, Some(&mut attn));
    assert_eq!(out.len(), 8 * 9);
    assert!(out.iter().all(|v| v.is_finite() && v.abs() <= 1.0 + 1e-6), "tanh-bounded outputs");
    assert_eq!(attn.len(), 2 * 8 * 8);
    // causality: no weight above the diagonal
    for head in 0..2 {
        for i in 0..8 {
            let mut row_sum = 0.0;
            for j in 0..8 {
                let w = attn[(head * 8 + i) * 8 + j];
                if j > i { assert!(w.abs() < 1e-6, "future attention leaked"); }
                row_sum += w;
            }
            assert!((row_sum - 1.0).abs() < 1e-3, "row {i} sums to {row_sum}");
        }
    }
    assert!(t.param_count() > 1000);
}

#[test]
fn misalignment_inside_clearance_is_survivable() {
    let spec = TaskSpec::bolt(Vec3::new(0.0, 0.0, 0.0), Vec3::up());
    let mut st = TaskState::default();
    let mut spin = 0.0f32;
    let mut t = 0.0f32;
    let dt = 0.002f32;
    while t < 6.0 && !st.success && !st.damaged {
        let input = TaskInput {
            tool_pos: Vec3::new(0.0004, 0.02, 0.0),
            tool_axis: Vec3::up(),
            spin,
            torque: 0.25,
            speed: 10.0,
            compliance_gain: 1.0,
            lateral_error: 0.0004,
            tilt_error: 0.0,
            time: t,
        };
        spin += 10.0 * dt;
        t += dt;
        physics::step(&spec, &mut st, &input, spin - 10.0 * dt, dt);
    }
    assert!(!st.damaged, "0.4 mm misalignment should be absorbed by compliance");
    assert!(st.absorbed > 0.0);
    assert!(st.turns > 0.0);
}

#[test]
fn large_misalignment_cross_threads() {
    let spec = TaskSpec::bolt(Vec3::new(0.0, 0.0, 0.0), Vec3::up());
    let mut st = TaskState::default();
    let mut spin = 0.0f32;
    let mut t = 0.0f32;
    let dt = 0.002f32;
    while t < 4.0 && !st.damaged {
        let input = TaskInput {
            tool_pos: Vec3::new(0.006, 0.02, 0.0),
            tool_axis: Vec3::up(),
            spin,
            torque: 0.4,
            speed: 10.0,
            compliance_gain: 0.2,
            lateral_error: 0.006,
            tilt_error: 0.0,
            time: t,
        };
        spin += 10.0 * dt;
        t += dt;
        physics::step(&spec, &mut st, &input, spin - 10.0 * dt, dt);
    }
    assert!(st.damaged, "6 mm of misalignment must damage the thread");
}

#[test]
fn burst_torque_breaks_a_bulb_but_not_the_arm() {
    let spec = TaskSpec::bulb(Vec3::new(0.0, 0.0, 0.0), Vec3::up());
    let mut st = TaskState::default();
    let mut spin = 0.0f32;
    let dt = 0.002f32;
    let mut t = 0.0f32;
    while t < 8.0 && !st.damaged && !st.success {
        let input = TaskInput {
            tool_pos: Vec3::up().scale(0.01),
            tool_axis: Vec3::up(),
            spin,
            torque: 0.3,
            speed: 40.0,
            compliance_gain: 1.0,
            lateral_error: 0.0,
            tilt_error: 0.0,
            time: t,
        };
        spin += 40.0 * dt;
        t += dt;
        physics::step(&spec, &mut st, &input, spin - 40.0 * dt, dt);
    }
    assert!(st.damaged, "0.3 N·m into a bulb should crack it");
}

#[test]
fn safety_index_tracks_force_and_stiffness() {
    let soft = physics::safety_index(8.0, 0.4, 3.0);
    let stiff = physics::safety_index(8.0, 0.4, 0.4);
    assert!(soft < stiff, "a softer arm must score safer: {soft} vs {stiff}");
    assert!(physics::safety_index(60.0, 1.4, 1.0) > 1.0);
}

#[test]
fn mesh_generators_produce_sane_geometry() {
    let truss = trunc_core::mesh::trunc_cell(CellKind::Truss.as_u32(), 0.08, 0.026, 4, 8, 6);
    let eq = trunc_core::mesh::trunc_cell(CellKind::Equatorial.as_u32(), 0.08, 0.026, 3, 6, 6);
    assert!(truss.tri_count() > 200 && eq.tri_count() > 100);
    for m in [&truss, &eq] {
        assert_eq!(m.positions.len(), m.vertex_count() * 3);
        assert_eq!(m.normals.len(), m.positions.len());
        assert!(m.indices.iter().all(|i| (*i as usize) < m.vertex_count()));
        assert!(m.positions.iter().all(|v| v.is_finite()));
    }
    let bolt = trunc_core::mesh::bolt(0.004, 0.03, 0.00125, 8);
    assert!(bolt.tri_count() > 100);
}

#[test]
fn determinism_same_seed_same_numbers() {
    let run = |seed: u64| {
        let mut a = arm();
        let pts = a.workspace_cloud(200, seed);
        let s: f32 = pts.iter().map(|p| p.x + p.y * 2.0 + p.z * 3.0).sum();
        s
    };
    assert!((run(11) - run(11)).abs() < 1e-9);
    assert!((run(11) - run(12)).abs() > 1e-6);
}

#[test]
fn fk_uses_a_straight_arm_at_home() {
    let a = arm();
    let t = a.fk(&[SegmentState::default(); N_SEGMENTS], 0.0, 0.0);
    assert!((t.p.y - a.cfg.total_length()).abs() < 1e-4);
    assert!(t.p.x.abs() < 1e-6 && t.p.z.abs() < 1e-6);
    let _: Transform = t;
}
