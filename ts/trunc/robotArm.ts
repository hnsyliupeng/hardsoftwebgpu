/**
 * robotArm.ts — the arm class, ported from matlab/training/util/robotArm.m.
 *
 * The MATLAB talked to a USB serial servo controller and to OptiTrack through
 * the NatNet SDK. Those two transports are replaced by a `SerialLink` and a
 * `PoseSensor` interface, so the *same state machine* runs in Node (against a
 * loopback link), in the browser (against WebSerial), or headless in the
 * animation harness. The control flow is kept line for line:
 *
 *   set_pos()  : clamp-check → command all nine channels → poll until the
 *                squared error is under the threshold, or bail after 20 s
 *   reset_arm(): go to the compressed state, then cycle comp → comp_max ×5
 *   stop_motors(): release the servos
 */

import type { Quat, Vec3 } from './types.js';
import { clampCompression, compressionVector, HOME, SERVO_LIMITS } from './setup.js';

export interface SerialLink {
  /** write one channel (0..8) to the servo controller */
  setServo(channel: number, value: number): number;
  /** read back the channel's current position */
  getServo(channel: number): number;
  /** release the channels */
  stop(channels: number[]): void;
  /** milliseconds since the link started — the MATLAB `tic`/`toc` */
  now(): number;
}

export interface PoseSensor {
  /** the rigid-body frame the MATLAB called `nnc.getFrame().RigidBodies(1)` */
  getRigidBody(id: number): { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } | null;
  isConnected(): boolean;
}

export interface RobotArmOptions {
  link: SerialLink;
  sensor?: PoseSensor | null;
  /** the MATLAB `pause_length`, seconds */
  pauseLength?: number;
  /** squared-error threshold for "the servos have arrived" */
  threshold?: number;
  /** timeout in seconds (the MATLAB used 20) */
  timeout?: number;
  comp?: number[];
  compMax?: number[];
  /** called when a command would leave the servo window */
  onUnsafe?: (min: number, max: number) => void;
}

/** What `reset_arm()` and the auto-sweeps report as they go. */
export interface RobotArmEvent {
  kind: 'command' | 'arrived' | 'timeout' | 'unsafe' | 'reset' | 'stopped';
  detail?: string;
}

export class RobotArm {
  readonly link: SerialLink;
  readonly sensor: PoseSensor | null;
  readonly channels: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  readonly pauseLength: number;
  readonly threshold: number;
  readonly timeout: number;
  comp: number[];
  compMax: number[];
  pauseLengthMs: number;
  private listeners: ((e: RobotArmEvent) => void)[] = [];
  /** last commanded setpoint, the MATLAB's `position` */
  commanded: number[] = HOME.slice();

  constructor(opts: RobotArmOptions) {
    this.link = opts.link;
    this.sensor = opts.sensor ?? null;
    this.pauseLength = opts.pauseLength ?? 3;
    this.threshold = opts.threshold ?? 1;
    this.timeout = opts.timeout ?? 20;
    this.comp = opts.comp ?? compressionVector(0);
    this.compMax = opts.compMax ?? compressionVector(-70);
    this.pauseLengthMs = this.pauseLength * 1000;
    if (opts.onUnsafe) this.listeners.push((e) => { if (e.kind === 'unsafe' && e.detail) opts.onUnsafe?.(0, 0); });
    void clampCompression;
  }

  on(fn: (e: RobotArmEvent) => void): void { this.listeners.push(fn); }
  private emit(e: RobotArmEvent): void { for (const fn of this.listeners) fn(e); }

  /** The MATLAB `get_pose()`: rigid body #1 is the tool. */
  getPose(): { p: Vec3; q: Quat } | null {
    const rb = this.sensor?.getRigidBody(1) ?? null;
    if (!rb) return null;
    return { p: [rb.x, rb.y, rb.z], q: [rb.qw, rb.qx, rb.qy, rb.qz] };
  }

  /** Mid and top rigid bodies, which `follow_trajectory.m` also logged. */
  getBodies(): { mid: Vec3 | null; top: Vec3 | null } {
    const mid = this.sensor?.getRigidBody(2) ?? null;
    const top = this.sensor?.getRigidBody(3) ?? null;
    return {
      mid: mid ? [mid.x, mid.y, mid.z] : null,
      top: top ? [top.x, top.y, top.z] : null,
    };
  }

  /**
   * `set_pos(motor_pos)`: command all nine channels then poll until the
   * squared error is below `threshold`. Returns the elapsed seconds.
   */
  setPos(motorPos: number[]): { seconds: number; ok: boolean } {
    const lo = Math.min(...motorPos);
    const hi = Math.max(...motorPos);
    if (lo < SERVO_LIMITS.min || hi > SERVO_LIMITS.max) {
      this.emit({ kind: 'unsafe', detail: `motor range [${lo.toFixed(1)}, ${hi.toFixed(1)}]` });
      return { seconds: 0, ok: false };
    }

    const finalPos = new Array(9).fill(0);
    for (let idx = 0; idx <= 8; idx += 1) {
      finalPos[idx] = this.link.setServo(idx, motorPos[idx]);
    }

    const start = this.link.now();
    let reached = false;
    let current = new Array(9).fill(0);
    while (!reached) {
      for (let idx = 0; idx <= 8; idx += 1) current[idx] = this.link.getServo(idx);
      let e = 0;
      for (let idx = 0; idx <= 8; idx += 1) { const d = finalPos[idx] - current[idx]; e += d * d; }
      if (e <= this.threshold) { reached = true; break; }
      if ((this.link.now() - start) / 1000 > this.timeout) {
        this.emit({ kind: 'timeout', detail: `servos did not arrive within ${this.timeout} s (e=${e.toFixed(3)})` });
        this.commanded = finalPos.slice();
        return { seconds: (this.link.now() - start) / 1000, ok: false };
      }
    }
    const seconds = (this.link.now() - start) / 1000;
    this.commanded = finalPos.slice();
    this.emit({ kind: 'arrived', detail: `${seconds.toFixed(2)} s` });
    return { seconds, ok: true };
  }

  /** `reset_arm()`: compressed state, then five cycles to `comp_max`. */
  resetArm(onCycle?: (i: number, phase: 'comp' | 'comp_max') => void): void {
    this.emit({ kind: 'reset' });
    this.setPos(this.comp);
    for (let rep = 0; rep < 5; rep += 1) {
      onCycle?.(rep, 'comp_max');
      this.setPos(this.compMax);
      onCycle?.(rep, 'comp');
      this.setPos(this.comp);
    }
  }

  /** `stop_motors()`. */
  stopMotors(): void {
    this.link.stop(this.channels);
    this.emit({ kind: 'stopped' });
  }
}

/**
 * A loopback serial link: the animation harness drives it at 60 Hz instead of
 * waiting for real hardware, but the servo state machine is unchanged. Each
 * channel eases toward its target at `speed` counts per second and reports a
 * position, which is exactly the feedback `set_pos` polls.
 */
export class LoopbackLink implements SerialLink {
  targets = new Array(9).fill(0);
  positions = new Array(9).fill(0);
  speed: number;
  private t = 0;
  constructor(speed = 900, start = 0) {
    this.speed = speed;
    this.positions = new Array(9).fill(start);
    this.targets = this.positions.slice();
  }

  setServo(channel: number, value: number): number {
    this.targets[channel] = value;
    return value;
  }
  getServo(channel: number): number { return this.positions[channel]; }
  stop(_channels: number[]): void { this.targets = this.positions.slice(); }
  now(): number { return this.t; }

  /** Advance the simulated servos — the animation calls this every frame. */
  advance(dtMs: number): void {
    this.t += dtMs;
    const step = (this.speed * dtMs) / 1000;
    for (let i = 0; i < 9; i += 1) {
      const d = this.targets[i] - this.positions[i];
      if (Math.abs(d) <= step) this.positions[i] = this.targets[i];
      else this.positions[i] += Math.sign(d) * step;
    }
  }
}
