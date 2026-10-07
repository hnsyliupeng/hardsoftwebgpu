/**
 * sim — the animation sim built on the ported TRUNC model.
 *
 *   solver.ts     damped-least-squares IK for the constant-curvature arm
 *   animation.ts  replay of follow_trajectory.m with live IK and servo timing
 */

export * from './solver.js';
export * from './animation.js';
