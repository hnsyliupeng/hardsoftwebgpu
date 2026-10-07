/**
 * port.test.mjs — the MATLAB port under `node --test`.
 *
 * The full 44-row verification lives in `src/app/matlabPort.js` (it runs in the
 * CPU page, from the CLI, and here); this file adds the unit-level assertions
 * that should fail fast in CI: the maths identities, the trajectory constants
 * from the MATLAB source, and the two transports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => import(pathToFileURL(join(ROOT, 'js', p)).href);

test('forward kinematics: home pose and cable anchors', async () => {
  const { forward, homeState, TRUNC } = await J('trunc/kinematics.js');
  const pose = forward(homeState());
  assert.ok(Math.abs(pose.position[2] + 778) < 1e-9, `tool z = ${pose.position[2]}`);
  assert.ok(Math.abs(pose.cables[0] - TRUNC.split[1] * TRUNC.length) < 1e-9);
  assert.ok(Math.abs(pose.cables[2] - TRUNC.split[0] * TRUNC.length) < 1e-9);
});

test('rotm2quat and quat2rotm are inverses in the column-major convention', async () => {
  const { rotm2quat, quat2rotm, mul, rotZ, rotX } = await J('trunc/math.js');
  const R = mul(rotZ(1.1), rotX(-0.35));
  const back = quat2rotm(rotm2quat(R));
  for (let k = 0; k < 16; k += 1) assert.ok(Math.abs(back[k] - R[k]) < 1e-12, `m[${k}]`);
});

test('every task generator produces a dense, flagged waypoint list', async () => {
  const { TASKS, taskWaypoints } = await J('trunc/trajectories.js');
  for (const name of Object.keys(TASKS)) {
    const wps = taskWaypoints(name);
    assert.ok(wps.length > 10, `${name} has ${wps.length} waypoints`);
    for (const w of wps) {
      assert.equal(w.p.length, 3);
      assert.equal(w.q.length, 4);
      assert.ok(Number.isFinite(w.pause) && Number.isFinite(w.motor));
    }
  }
});

test('interpWaypoints keeps the flags on block boundaries only', async () => {
  const { taskWaypoints } = await J('trunc/trajectories.js');
  const { interpWaypoints } = await J('trunc/interp.js');
  const wps = taskWaypoints('motherboard');
  const dense = interpWaypoints(wps, wps.length * 3, 'cubic');
  const flagged = dense.filter((w) => w.pause !== 0 || w.motor > 0);
  const sources = wps.filter((w) => w.pause !== 0 || w.motor > 0);
  assert.equal(flagged.length, sources.length);
  assert.equal(dense.reduce((a, w) => a + w.motor, 0), 21, 'the two drills total 21 s');
});

test('the servo link arrives, and refuses an out-of-range command', async () => {
  const { RobotArm, LoopbackLink } = await J('trunc/robotArm.js');
  const { HOME, SERVO_LIMITS } = await J('trunc/setup.js');
  const arm = new RobotArm({ link: new LoopbackLink(900, 0), threshold: 1, timeout: 20 });
  const res = arm.setPos(HOME.map((v, k) => v + (k % 2 ? 20 : -20)));
  assert.equal(res.ok, true);
  assert.ok(res.seconds > 0 && res.seconds < 1, `arrived in ${res.seconds} s of simulated time`);
  const bad = arm.setPos(HOME.map(() => SERVO_LIMITS.max + 1));
  assert.equal(bad.ok, false);
});

test('the tool motor relay is energised for exactly the commanded time', async () => {
  const { ArmMotor, MockMotorLink } = await J('trunc/armMotor.js');
  const link = new MockMotorLink();
  const motor = new ArmMotor(link);
  const dt = 1 / 120;
  const steps = 600;                 // an integer count: no float drift in the loop
  motor.pulse(2.25);
  for (let i = 0; i < steps; i += 1) { link.advance(dt); motor.update(dt); }
  // the relay model is discrete: the step in which the pulse expires still
  // counts as fully on, so the duty lands within one timestep of the command.
  assert.ok(Math.abs(link.duty - 2.25) <= dt + 1e-9, `duty ${link.duty} vs 2.25 ± ${dt}`);
  assert.ok(Math.abs(motor.totalOn - 2.25) < 1e-12, `commanded ${motor.totalOn}`);
  assert.equal(link.pulses.length, 1);
});

test('the placement map is a proper rotation and the homes are reachable', async () => {
  const { MATLAB_TO_ROBOT, TASK_HOMES, robotWaypoints } = await J('sim/placement.js');
  const M = MATLAB_TO_ROBOT;
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
    - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
    + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  assert.ok(Math.abs(det - 1) < 1e-12, `det = ${det}`);
  for (const name of Object.keys(TASK_HOMES)) {
    const wps = robotWaypoints(name);
    assert.ok(wps.length > 10, `${name}`);
    for (const p of wps) assert.ok(Math.hypot(...p) > 400 && Math.hypot(...p) < 800, `${name}: |p| = ${Math.hypot(...p)}`);
  }
});

test('the animation replays every task without missing a waypoint', async () => {
  const { ArmAnimation } = await J('sim/animation.js');
  for (const task of ['circle', 'triangle', 'steps', 'motherboard', 'bulb']) {
    const anim = new ArmAnimation({ task, dt: 1 / 30, pauseLength: 0, operatorWait: 0 });
    const s = anim.run();
    assert.equal(s.missed, 0, `${task} missed ${s.missed} waypoints`);
    assert.ok(s.maxSettledError < 2, `${task} settled error ${s.maxSettledError} mm`);
    assert.ok(s.frames > 100, `${task} only ${s.frames} frames`);
  }
});
