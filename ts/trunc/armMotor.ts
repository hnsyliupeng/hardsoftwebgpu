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

export interface MotorLink {
  relay(on: boolean): void;
  /** seconds since the link started */
  now(): number;
}

/** Mock relay used by the animation and the tests. */
export class MockMotorLink implements MotorLink {
  on = false;
  /** cumulative seconds the relay has been energised */
  duty = 0;
  pulses: { start: number; seconds: number }[] = [];
  private t = 0;
  private startedAt: number | null = null;

  relay(next: boolean): void {
    if (next === this.on) return;
    if (next) this.startedAt = this.t;
    else if (this.startedAt !== null) {
      this.pulses.push({ start: this.startedAt, seconds: this.t - this.startedAt });
      this.startedAt = null;
    }
    this.on = next;
  }
  now(): number { return this.t; }
  advance(dt: number): void {
    this.t += dt;
    if (this.on) this.duty += dt;
  }
  /** Seconds the relay has been on for the pulse in progress. */
  get currentPulse(): number { return this.startedAt === null ? 0 : this.t - this.startedAt; }
}

export class ArmMotor {
  readonly link: MotorLink;
  /** seconds of relay-on time commanded so far */
  totalOn = 0;
  /** every pulse commanded, for the log panel */
  history: { seconds: number; at: number }[] = [];
  private pending = 0;

  constructor(link: MotorLink) { this.link = link; }

  turnOnRelay(): void { this.link.relay(true); }
  turnOffRelay(): void { this.link.relay(false); }

  /**
   * `pulse(t)`: hold the relay for `t` seconds. The MATLAB blocked with
   * `pause(t)`; here the duration is queued and `update(dt)` releases the relay,
   * so the animation loop stays in charge of time. Returns the queued seconds.
   */
  pulse(seconds: number): number {
    if (!(seconds > 0)) return 0;
    this.pending += seconds;
    this.totalOn += seconds;
    this.history.push({ seconds, at: this.link.now() });
    this.link.relay(true);
    return seconds;
  }

  /** Remaining relay-on time still to elapse. */
  get remaining(): number { return this.pending; }

  update(dt: number): void {
    if (this.pending <= 0) return;
    this.pending = Math.max(0, this.pending - dt);
    if (this.pending === 0) this.link.relay(false);
  }

  /** `delete(obj)` — release the relay. */
  dispose(): void { this.pending = 0; this.link.relay(false); }
}
