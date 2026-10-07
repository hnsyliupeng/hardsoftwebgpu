// generated from ts/trunc/robotArm.ts by tools/ts-emit.mjs — do not edit
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

                                             
import { clampCompression, compressionVector, HOME, SERVO_LIMITS } from './setup.js';

                             
                                                         
                                                   
                                                 
                                    
                             
                                 
                                                                     
                
 

                             
                                                                               
                                                                                                                       
                         
 

                                  
                   
                             
                                           
                       
                                                              
                     
                                                
                   
                  
                     
                                                           
                                                
 

/** What `reset_arm()` and the auto-sweeps report as they go. */
                                
                                                                           
                  
 

export class RobotArm {
           link            ;
           sensor                   ;
           channels           = [0, 1, 2, 3, 4, 5, 6, 7, 8];
           pauseLength        ;
           threshold        ;
           timeout        ;
  comp          ;
  compMax          ;
  pauseLengthMs        ;
          listeners                                 = [];
  /** last commanded setpoint, the MATLAB's `position` */
  commanded           = HOME.slice();

  constructor(opts                 ) {
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

  on(fn                            )       { this.listeners.push(fn); }
          emit(e               )       { for (const fn of this.listeners) fn(e); }

  /** The MATLAB `get_pose()`: rigid body #1 is the tool. */
  getPose()                              {
    const rb = this.sensor?.getRigidBody(1) ?? null;
    if (!rb) return null;
    return { p: [rb.x, rb.y, rb.z], q: [rb.qw, rb.qx, rb.qy, rb.qz] };
  }

  /** Mid and top rigid bodies, which `follow_trajectory.m` also logged. */
  getBodies()                                         {
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
  setPos(motorPos          )                                   {
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
  resetArm(onCycle                                                  )       {
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
  stopMotors()       {
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
export class LoopbackLink                       {
  targets = new Array(9).fill(0);
  positions = new Array(9).fill(0);
  speed        ;
          t = 0;
  constructor(speed = 900, start = 0) {
    this.speed = speed;
    this.positions = new Array(9).fill(start);
    this.targets = this.positions.slice();
  }

  setServo(channel        , value        )         {
    this.targets[channel] = value;
    return value;
  }
  getServo(channel        )         { return this.positions[channel]; }
  stop(_channels          )       { this.targets = this.positions.slice(); }
  now()         { return this.t; }

  /** Advance the simulated servos — the animation calls this every frame. */
  advance(dtMs        )       {
    this.t += dtMs;
    const step = (this.speed * dtMs) / 1000;
    for (let i = 0; i < 9; i += 1) {
      const d = this.targets[i] - this.positions[i];
      if (Math.abs(d) <= step) this.positions[i] = this.targets[i];
      else this.positions[i] += Math.sign(d) * step;
    }
  }
}


//# sourceURL=/home/user/hardsoftwebgpu/ts/trunc/robotArm.ts