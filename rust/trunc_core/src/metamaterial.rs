//! Mechanical metamaterial model of a **TRUNC** unit cell.
//!
//! Two cell flavours are used in the arm, exactly as in the paper:
//!
//! * [`CellKind::Truss`] — helical lattice ("complex cell" / truss flex shaft). It is the
//!   *torque channel*: torsionally rigid (up to 52× stiffer than it is in bending) while
//!   staying compliant in bending and extension. It carries the drill motor's rotation
//!   all the way to the end-effector.
//! * [`CellKind::Equatorial`] — slotted ("simple" cell) shell that nests *around* the truss.
//!   It guides the nine actuation tendons and is deliberately torsionally soft.
//!
//! The numbers are calibrated against the paper's Instron characterisation
//! (Fig. 2C/D, Fig. 3, Fig. S5/S6) and its efficiency study (Fig. S6).

use crate::mathx::{clamp, deg, PI};

pub const MAX_BEND_RAD: f32 = deg(45.0); // per TRUNC joint, 45°
pub const ANGULAR_LIMIT_HARD: f32 = deg(48.0); // elastic limit before plastic collapse

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellKind { Truss, Equatorial }

impl CellKind {
    pub fn as_u32(self) -> u32 { match self { CellKind::Truss => 0, CellKind::Equatorial => 1 } }
    pub fn name(self) -> &'static str { match self { CellKind::Truss => "truss", CellKind::Equatorial => "equatorial" } }
    /// Struts / slot count used by the procedural mesh generator.
    pub fn strut_count(self) -> u32 { match self { CellKind::Truss => 8, CellKind::Equatorial => 6 } }
    pub fn ring_count(self) -> u32 { match self { CellKind::Truss => 4, CellKind::Equatorial => 3 } }
}

/// A single printed cell. `length` is the neutral axial length.
#[derive(Clone, Copy, Debug)]
pub struct TruncCell {
    pub kind: CellKind,
    pub length: f32,
    pub outer_radius: f32,
    pub inner_radius: f32,
    pub wall: f32,
    /// Measured torsional/bending stiffness ratio (paper: up to 52).
    pub anisotropy: f32,
}

impl TruncCell {
    pub fn truss(length: f32, radius: f32) -> Self {
        TruncCell { kind: CellKind::Truss, length, outer_radius: radius, inner_radius: radius * 0.62, wall: 0.0016, anisotropy: 52.0 }
    }
    pub fn equatorial(length: f32, radius: f32) -> Self {
        TruncCell { kind: CellKind::Equatorial, length, outer_radius: radius, inner_radius: radius * 0.80, wall: 0.0012, anisotropy: 6.5 }
    }

    /// Bending stiffness, N·m/rad, normalised to a 24.5 mm / 25 mm reference cell.
    ///
    /// Stiffness scales with `1/length` (series springs) and quadratically with the
    /// effective strut lever arm — the trend measured on the Instron.
    pub fn bending_stiffness(&self) -> f32 {
        let r_ref = 0.0245;
        let base = match self.kind {
            CellKind::Truss => 0.085,      // N·m/rad at reference size, soft in bending
            CellKind::Equatorial => 0.052,
        };
        let lever = (self.outer_radius / r_ref).powi(2);
        base * lever * (0.025 / self.length.max(1e-4))
    }

    /// Torsional stiffness, N·m/rad — `anisotropy ×` the bending stiffness.
    pub fn torsional_stiffness(&self) -> f32 { self.bending_stiffness() * self.anisotropy }

    /// Axial (extension) stiffness, N/m.
    pub fn axial_stiffness(&self) -> f32 {
        let base = match self.kind { CellKind::Truss => 340.0, CellKind::Equatorial => 210.0 };
        base * (0.025 / self.length.max(1e-4))
    }

    /// Restoring bending torque; mildly stiffening as the cell approaches its 45° limit
    /// (the struts straighten out and the geometry locks).
    pub fn bending_torque(&self, bend: f32) -> f32 {
        let k = self.bending_stiffness();
        let t = bend / MAX_BEND_RAD;
        k * (bend + 0.45 * bend * t * t)
    }

    /// Bend produced by a bending torque (inverse of [`Self::bending_torque`]).
    pub fn bend_for_torque(&self, torque: f32) -> f32 {
        let k = self.bending_stiffness().max(1e-6);
        // Solve φ + 0.45 φ³/φmax² = τ/k with a few Newton steps.
        let mut phi = torque / k;
        for _ in 0..6 {
            let t = phi / MAX_BEND_RAD;
            let f = k * (phi + 0.45 * phi * t * t) - torque;
            let df = k * (1.0 + 1.35 * t * t);
            phi -= f / df.max(1e-6);
        }
        clamp(phi, -ANGULAR_LIMIT_HARD, ANGULAR_LIMIT_HARD)
    }

    /// Backlash / wind-up twist for a transmitted torque (includes a small cubic term so
    /// high loads soften the coupling, as seen in the torsion-rotation traces).
    pub fn twist_for_torque(&self, torque: f32) -> f32 {
        let k = self.torsional_stiffness().max(1e-6);
        let lin = torque / k;
        lin + 0.08 * (torque / k).powi(3)
    }

    /// Axial force for a compression (positive = shortened), N.
    pub fn axial_force(&self, compression: f32) -> f32 {
        let k = self.axial_stiffness();
        let c = compression.max(0.0);
        k * c * (1.0 + 0.9 * c / 0.03) // compressing stiffens once the slots close
    }

    /// Transmission efficiency of the joint, from the paper's efficiency study:
    /// it drops with bend (struts load up) and with speed, but stays > 80 % at the
    /// working points used by the demos.
    pub fn efficiency(&self, bend: f32, rpm: f32) -> f32 {
        let bend_pen = 0.16 * (bend / MAX_BEND_RAD).abs().powf(1.4);
        let speed_pen = 0.10 * (rpm.abs() / 300.0).powf(1.6);
        let base = match self.kind { CellKind::Truss => 0.97, CellKind::Equatorial => 0.86 };
        clamp(base - bend_pen - speed_pen, 0.40, 0.995)
    }

    /// Effective torsional stiffness of a *bent* truss: bending loads the lattice and
    /// costs some torsional rigidity (measured as cross-coupling in the paper).
    pub fn torsional_stiffness_at_bend(&self, bend: f32) -> f32 {
        let s = (bend / MAX_BEND_RAD).abs().min(1.4);
        self.torsional_stiffness() * (1.0 - 0.22 * s * s).max(0.35)
    }

    /// Parasitic tool rotation when the shaft spins while the arm is bent, rad per turn.
    pub fn cross_coupling(&self, bend: f32) -> f32 {
        0.010 * (bend / MAX_BEND_RAD) * (bend / MAX_BEND_RAD)
    }

    /// Small history-dependent offset used to reproduce the repeatability experiments.
    pub fn hysteresis_deadband(&self) -> f32 { 0.004 } // rad
}

/// Aggregate model of a chain of `n` cells (a whole active segment / tendon guide).
#[derive(Clone, Copy, Debug)]
pub struct CellChain { pub cell: TruncCell, pub count: u32 }

impl CellChain {
    pub fn new(cell: TruncCell, count: u32) -> Self { CellChain { cell, count } }
    pub fn length(&self) -> f32 { self.cell.length * self.count as f32 }
    /// Series stiffness of `n` identical cells.
    pub fn bending_stiffness(&self) -> f32 { self.cell.bending_stiffness() / self.count as f32 }
    pub fn torsional_stiffness(&self) -> f32 { self.cell.torsional_stiffness() / self.count as f32 }
    pub fn axial_stiffness(&self) -> f32 { self.cell.axial_stiffness() / self.count as f32 }
    pub fn torsional_stiffness_at_bend(&self, bend: f32) -> f32 {
        self.cell.torsional_stiffness_at_bend(bend) / self.count as f32
    }
    pub fn max_bend(&self) -> f32 { MAX_BEND_RAD * self.count as f32 / 3.0 }
    pub fn efficiency(&self, bend: f32, rpm: f32) -> f32 { self.cell.efficiency(bend, rpm) }
    /// Distributed cell bends for rendering / per-cell meshes.
    pub fn distribute(&self, bend: f32) -> f32 { bend / self.count.max(1) as f32 }
    /// Resonant-ish structural damping coefficient, N·m·s/rad.
    pub fn damping(&self) -> f32 { self.bending_stiffness() * 0.04 }
}

/// Preset cell families used by the arm, matching the printed parts of the paper.
pub fn preset_arm_cells(segment_length: f32, radius: f32) -> (CellChain, CellChain) {
    let n_truss = 3u32;
    let n_eq = 4u32;
    let truss = CellChain::new(TruncCell::truss(segment_length / n_truss as f32, radius * 0.94), n_truss);
    let eq = CellChain::new(TruncCell::equatorial(segment_length / n_eq as f32, radius), n_eq);
    (truss, eq)
}

pub fn pi() -> f32 { PI }
