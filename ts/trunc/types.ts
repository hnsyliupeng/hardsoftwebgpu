/**
 * types.ts — shared shapes of the ported TRUNC model.
 *
 * Ported from the original MATLAB (TransformativeRoboticsLab/TRUNC):
 *   matlab/training/kinematics.m            constant-curvature segment model
 *   matlab/training/util/robotArm.m         the arm class and its servo loop
 *   matlab/training/util/armMotor.m         relay-pulsed tool motor
 *   matlab/training/generate_trajectory.m   the five task trajectories (mm)
 *   matlab/setup.m                          home / compression cable vectors
 *   matlab/norm_quat.m                      quaternion normalisation
 *   matlab/cross_coupling_analysis.m        trial splitting + error bounds
 *   matlab/efficiency_analysis.m            mechanical efficiency
 *   matlab/plot_cvjoint.m                   CV-joint bend / extension trials
 *
 * Everything is millimetres and degrees at the boundary, because that is what
 * the MATLAB speaks; the conversions happen in `math.ts` only where the maths
 * needs radians.
 */

/** 3-vector in millimetres (world frame, +Z up, matching the MATLAB plots). */
export type Vec3 = [number, number, number];

/** Quaternion in MATLAB order: w first, then x, y, z. */
export type Quat = [number, number, number, number];

/** Column-major 4x4 matrix packed as 16 numbers (MATLAB `T(:)` order). */
export type Mat4 = Float64Array;

/** One row of a generated trajectory: position (mm), quaternion, pause, motor. */
export interface Waypoint {
  /** tool position in millimetres */
  p: Vec3;
  /** tool orientation (w, x, y, z) */
  q: Quat;
  /** seconds to hold here; negative means "wait for the operator" */
  pause: number;
  /** tool-motor pulse length in seconds (0 = no pulse) */
  motor: number;
}

/** The nine servo channels, in the order the MATLAB packs them. */
export type ServoVector = number[];

/** A joint-space configuration of the three segments. */
export interface JointState {
  /** shoulder bend / plane (rad) */
  t1: number;
  t2: number;
  /** elbow */
  t3: number;
  t4: number;
  /** wrist */
  t5: number;
  t6: number;
  /** total insertable length L (mm), the 7/7 of the segment split */
  L: number;
  /** tool offset from the wrist (mm) */
  toolLength: number;
}

/** Result of one pose evaluation. */
export interface ArmPose {
  /** segment transforms, shoulder → wrist → tool */
  T: [Mat4, Mat4, Mat4, Mat4];
  /** cable lengths per segment [s1, s2, s3] in mm, shoulder/elbow/wrist */
  segments: [Vec3, Vec3, Vec3];
  /** all nine cable deltas from home, MATLAB order [w1..w3, e1..e3, s1..s3] */
  cables: number[];
  /** tool position (mm) */
  position: Vec3;
}

/** Serialised geometry sample for the animation. */
export interface LinkSample {
  /** cable attachment triangles: shoulder, elbow, wrist, tool (mm) */
  tris: Float64Array[];
  /** spine points from base to tool tip (mm) */
  spine: Vec3[];
  /** tool frame position (mm) */
  tool: Vec3;
  /** quaternion (w,x,y,z) */
  quat: Quat;
}
