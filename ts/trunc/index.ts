/**
 * TRUNC — the MATLAB reference implementation, ported to TypeScript.
 *
 * Source of truth: https://github.com/TransformativeRoboticsLab/TRUNC
 * (companion to "Bridging Hard and Soft: A Modular Soft Robot with a Rigid
 * Truss Core", arXiv:2412.02650).
 *
 *   kinematics.ts     constant-curvature segments + the nine tendons
 *   trajectories.ts   the five task trajectories (mm)
 *   interp.ts         interp_waypoints.m
 *   robotArm.ts       set_pos / reset_arm / stop_motors state machine
 *   armMotor.ts       the relay-pulsed tool motor
 *   analysis.ts       the four analysis scripts
 *   setup.ts          home vector, compression pattern, servo limits
 *   math.ts           quat/rot helpers MATLAB got from its toolboxes
 *
 * The same files are bundled into `hardsoftwebgpu-matlab.mjs` for plain-JavaScript
 * consumers (`node hardsoftwebgpu-matlab.mjs --selftest`).
 */

export * from './types.js';
export * as math from './math.js';
export * as kinematics from './kinematics.js';
export * as trajectories from './trajectories.js';
export * as interp from './interp.js';
export * as robotArm from './robotArm.js';
export * as armMotor from './armMotor.js';
export * as analysis from './analysis.js';
export * as setup from './setup.js';
