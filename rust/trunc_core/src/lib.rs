//! `trunc_core` — simulation core for the **TRUNC** (TRuss/equatorial Unit Nesting Cell)
//! soft robotic arm from *"Bridging Hard and Soft: Mechanical Metamaterials Enable
//! Rigid Torque Transmission in Soft Robots"* (Carton, Kowalewski, Guo, Alpert, Garg,
//! Revier, Lipton — arXiv:2412.02650).
//!
//! The crate is deliberately **dependency free** so it can be compiled for
//! `wasm32-unknown-unknown` (browser, via `src/ffi.rs` C-ABI exports) *and* run
//! natively (`src/bin/trunc_cli.rs`, headless experiments & dataset generation).
//!
//! Module map
//! ----------
//! * [`mathx`]        — vectors/quaternions/transforms/PRNG (mirrored 1:1 in `src/core/mathx.js`)
//! * [`metamaterial`] — mechanical characterisation of a TRUNC cell (torsion vs. bending)
//! * [`arm`]          — 9-tendon, 3-active-joint arm: cable model, FK, IK, workspace, hysteresis
//! * [`nn`]           — MLP inverse-kinematics net + causal trajectory transformer + Adam
//! * [`physics`]      — contact/thread/valve physics, compliance, torque limiting, safety
//! * [`mesh`]         — procedural geometry (cell lattices, cables, tools, props)
//! * [`ffi`]          — the WebAssembly ABI used by the WebGPU front-end
//!
//! All lengths are metres, angles radians, forces newtons, torques newton-metres.

#![allow(clippy::needless_range_loop)]

pub mod arm;
pub mod ffi;
pub mod mathx;
pub mod mesh;
pub mod metamaterial;
pub mod nn;
pub mod physics;

/// Version string surfaced in the UI so the page can prove which core is live.
pub const VERSION: &str = "0.3.0"; // keep in sync with Cargo.toml

/// Paper constants (arXiv:2412.02650) reproduced for reference / UI copy.
pub mod paper {
    /// Neutral arm length, `l = 710 mm`.
    pub const NEUTRAL_LENGTH: f32 = 0.710;
    /// Max axial compression measured, `Δl = 94.3 mm` (13.3 % of length).
    pub const MAX_COMPRESSION: f32 = 0.0943;
    /// Max end-effector tilt from the ground plane, 83.9°.
    pub const MAX_TILT_DEG: f32 = 83.9;
    /// Workspace xy extent, ø 600 mm ≈ 84.5 % of neutral length.
    pub const WORKSPACE_DIAMETER: f32 = 0.600;
    /// Reconstructed workspace volume, 18 272 cm³.
    pub const WORKSPACE_VOLUME_CM3: f32 = 18_272.0;
    /// Sampled poses used to measure the workspace.
    pub const WORKSPACE_SAMPLES: u32 = 18_300;
    /// Per-joint bend limit, 45°.
    pub const MAX_BEND_DEG: f32 = 45.0;
    /// Torsional stiffness / bending stiffness of the truss cell.
    pub const ANISOTROPY: f32 = 52.0;
    /// Point-positioning repeatability (1σ), 2.1 mm.
    pub const POINT_REPEATABILITY_MM: f32 = 2.1;
    /// Trajectory-positioning repeatability (1σ), 0.4 mm.
    pub const TRAJECTORY_REPEATABILITY_MM: f32 = 0.4;
    /// Angular repeatability (1σ), 0.1°.
    pub const ANGULAR_REPEATABILITY_DEG: f32 = 0.1;
}
