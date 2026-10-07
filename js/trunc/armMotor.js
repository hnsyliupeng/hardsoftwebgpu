// generated from ts/trunc/armMotor.ts by tools/ts-emit.mjs — do not edit
/**
 * armMotor.ts — the relay-pulsed tool motor, ported from
 * matlab/training/util/armMotor.m.
 *
 * In the original this opened a 9600 baud serial port to an Arduino and sent
 * the characters '1' (relay on) and '0' (relay off), which is how the screwdriver
 * and the bulb grip were driven. `pulse(t)` therefore means: relay on for `t`
 * seconds, then off. The transport is injected so the same logic runs over
 * WebSerial, over a mock in the animation, or over Node's serialport.
 */

                            
                           
                                       
                
 

/** Mock relay used by the animation and the tests. */
export class MockMotorLink                      {
  on = false;
  /** cumulative seconds the relay has been energised */
  duty = 0;
  pulses                                       = [];
          t = 0;
          startedAt                = null;

  relay(next         )       {
    if (next === this.on) return;
    if (next) this.startedAt = this.t;
    else if (this.startedAt !== null) {
      this.pulses.push({ start: this.startedAt, seconds: this.t - this.startedAt });
      this.startedAt = null;
    }
    this.on = next;
  }
  now()         { return this.t; }
  advance(dt        )       {
    this.t += dt;
    if (this.on) this.duty += dt;
  }
  /** Seconds the relay has been on for the pulse in progress. */
  get currentPulse()         { return this.startedAt === null ? 0 : this.t - this.startedAt; }
}

export class ArmMotor {
           link           ;
  /** seconds of relay-on time commanded so far */
  totalOn = 0;
  /** every pulse commanded, for the log panel */
  history                                    = [];
          pending = 0;

  constructor(link           ) { this.link = link; }

  turnOnRelay()       { this.link.relay(true); }
  turnOffRelay()       { this.link.relay(false); }

  /**
   * `pulse(t)`: hold the relay for `t` seconds. The MATLAB blocked with
   * `pause(t)`; here the duration is queued and `update(dt)` releases the relay,
   * so the animation loop stays in charge of time. Returns the queued seconds.
   */
  pulse(seconds        )         {
    if (!(seconds > 0)) return 0;
    this.pending += seconds;
    this.totalOn += seconds;
    this.history.push({ seconds, at: this.link.now() });
    this.link.relay(true);
    return seconds;
  }

  /** Remaining relay-on time still to elapse. */
  get remaining()         { return this.pending; }

  update(dt        )       {
    if (this.pending <= 0) return;
    this.pending = Math.max(0, this.pending - dt);
    if (this.pending === 0) this.link.relay(false);
  }

  /** `delete(obj)` — release the relay. */
  dispose()       { this.pending = 0; this.link.relay(false); }
}


//# sourceURL=/home/user/hardsoftwebgpu/ts/trunc/armMotor.ts