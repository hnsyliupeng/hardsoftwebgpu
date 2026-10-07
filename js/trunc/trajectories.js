// generated from ts/trunc/trajectories.ts by tools/ts-emit.mjs — do not edit
/**
 * trajectories.ts — the five task trajectories, ported from generate_trajectory.m.
 *
 * The MATLAB generated a dense waypoint list per task (position, quaternion,
 * pause flag, tool-motor pulse) and then replayed it with `follow_trajectory.m`.
 * The numbers below are the original offsets in millimetres, added to
 * `home_pos`, exactly as the MATLAB did. `pause_mat` uses -1 for "wait for the
 * operator" and `motor_mat` holds the drill/bulb pulse length in seconds.
 */

                                                       
import { add3, axisAngleToQuat, deg2rad } from './math.js';
import { interpWaypoints } from './interp.js';

/** Placement of the arm pedestal, from kinematics.m (`home_pos`). */
export const HOME_POS       = [0, 0, 0];

/** The raw waypoint blocks, verbatim from generate_trajectory.m. */
                           
               
                                                   
              
                                              
                 
                                                                  
                             
                                       
                  
                                                                             
                  
                                                             
                 
 

const { sin, cos, PI } = Math;

/** circle: r = 90 mm, z = 80 mm, 20 waypoints (generate_trajectory.m §1). */
function circleTask()           {
  const r = 90;
  const z = 80;
  const n = 20;
  const pos         = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * 2 * PI;
    pos.push([r * cos(a), r * sin(a), z]);
  }
  return { name: 'circle', pos, points: 100, method: 'cubic', pause: [], motor: [] };
}

/** triangle: l = 80 mm, offset d = 20 mm, z = 90 mm, rotated 60° about Z. */
function triangleTask()           {
  const l = 80;
  const d = 20;
  const z = 90;
  const rot = deg2rad(60);
  const tri         = [[0, 0, z], [l, 0, z], [l / 2, d, z], [l, 0, z]];
  const pos = tri.map((p)       => [
    p[0] * cos(rot) - p[1] * sin(rot),
    p[0] * sin(rot) + p[1] * cos(rot),
    p[2],
  ]);
  return { name: 'triangle', pos, points: 100, method: 'linear', pause: [], motor: [] };
}

/** steps: dy = -160/3, dz = 25, y0 = 80, z0 = 40. */
function stepsTask()           {
  const dy = -160 / 3;
  const dz = 25;
  const y0 = 80;
  const z0 = 40;
  const pos         = [[0, y0, z0]];
  for (let i = 0; i < 6; i += 1) {
    pos.push([0, y0 + dy * i, z0 + dz]);
    pos.push([0, y0 + dy * (i + 1), z0 + dz]);
  }
  return { name: 'steps', pos, points: 100, method: 'linear', pause: [], motor: [] };
}

/**
 * motherboard: drill and insert. Seven waypoint blocks; the block after the
 * drill retracts first (z_hop), then the next hole. Values verbatim.
 */
function motherboardTask()           {
  const p1       = [-82.32, 104.60, 346.2];
  const p2       = [24.02, 107.07, 347.32];
  const z_hop = 40;
  const z_over = 10;
  const z_drill = -12;
  const z_drill_2 = -9;
  const z_off = 4.25;
  const z_start_off = 5;
  const z_arc = 10;
  const pos         = [];
  const pause           = [];
  const motor           = [];
  const push = (p      , pa = 1, mo = 0) => { pos.push(p); pause.push(pa); motor.push(mo); };

  push(add3(p1, [0, 0, z_off + z_start_off]), 0, 0);          // start above hole 1
  push(add3(p1, [0, 0, z_hop + z_arc]), 0, 0);                 // hop up
  push(add3(p1, [0, 0, z_over]), 0, 0);                       // descend to overshoot
  push(add3(p1, [0, 0, z_drill + z_arc]), 0, 0);               // drill arc start
  push(add3(p1, [0, 0, z_drill]), -1, 14 * (15 / 20));        // drill hole 1 (pause: operator)
  push(add3(p1, [0, 0, 0]), 1, 0);                            // seat the screw
  push(add3(p2, [0, 0, z_off + z_start_off]), 1, 0);          // over hole 2
  push(add3(p2, [0, 0, z_hop + z_arc]), 1, 0);
  push(add3(p2, [0, 0, z_over]), 1, 0);
  push(add3(p2, [0, 0, z_drill_2 + z_arc]), 1, 0);
  push(add3(p2, [0, 0, z_drill_2]), -1, 14 * (15 / 20));      // drill hole 2
  push(add3(p2, [0, 0, 0]), 1, 0);                            // seat the screw
  return { name: 'motherboard', pos, points: 30, method: 'linear', pause, motor };
}

/** light bulb: p_bulb / p_socket with the same hop-and-arc shape. */
function bulbTask()           {
  const p_bulb       = [-23.95, 6.60, 107.42];
  const p_socket       = [131.85, 2.81, 209.274];
  const z_off = -25;
  const z_dip = -16;
  const arc_offset = 10;
  const z_retract = 60;
  const pos         = [];
  const pause           = [];
  const motor           = [];
  const push = (p      , pa = 1, mo = 0) => { pos.push(p); pause.push(pa); motor.push(mo); };

  push(add3(p_bulb, [0, 0, 0]), 0, 0);                          // at the bulb
  push(add3(p_bulb, [0, 0, arc_offset]), 0, 0);                 // lift off
  push(add3(p_socket, [0, 0, z_retract + arc_offset]), 0, 0);   // travel to the socket
  push(add3(p_socket, [0, 0, z_dip + arc_offset]), 0, 0);       // approach arc
  push(add3(p_socket, [0, 0, z_dip]), -1, 3.5);                 // thread it in (operator wait, 3.5 s motor)
  push(add3(p_socket, [0, 0, z_off]), 1, 0);                    // seat it
  push(add3(p_socket, [0, 0, z_retract]), 1, 0);                // retract
  return { name: 'light bulb', pos, points: 40, method: 'linear', pause, motor };
}

/** All tasks, in the MATLAB's order. */
export const TASKS                           = {
  circle: circleTask(),
  triangle: triangleTask(),
  steps: stepsTask(),
  motherboard: motherboardTask(),
  bulb: bulbTask(),
};

/** Tool orientation used by the machine tasks: level, tool axis along Z. */
const LEVEL       = [1, 0, 0, 0];

/** Turn a task spec into the dense waypoint list the controller replays. */
export function materialise(spec          , home       = HOME_POS)             {
  const raw             = spec.pos.map((p, i)           => ({
    p: add3(p, home),
    q: LEVEL,
    pause: spec.pause.length ? spec.pause[Math.min(i, spec.pause.length - 1)] : 0,
    motor: spec.motor.length ? spec.motor[Math.min(i, spec.motor.length - 1)] : 0,
  }));

  const dense = interpWaypoints(raw, spec.points, spec.method);

  // The bulb threads in about its own approach axis; everything else stays level.
  if (spec.name === 'light bulb' || spec.name === 'bulb') {
    const twist = axisAngleToQuat([0, 0, 1], deg2rad(720));
    for (const w of dense) w.q = twist;
  }
  return dense;
}

/** Convenience accessor used by the UI and the animation driver. */
export function taskWaypoints(name        , home       = HOME_POS)             {
  const spec = TASKS[name];
  if (!spec) throw new Error(`unknown task "${name}" (have: ${Object.keys(TASKS).join(', ')})`);
  return materialise(spec, home);
}

/** Summary table for the UI: name, waypoint count, path length in mm. */
export function taskSummary(name        , home       = HOME_POS)   
                                                                                
  {
  const wps = taskWaypoints(name, home);
  let length = 0;
  for (let i = 1; i < wps.length; i += 1) {
    const a = wps[i - 1].p;
    const b = wps[i].p;
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const w of wps) for (let k = 0; k < 3; k += 1) {
    lo[k] = Math.min(lo[k], w.p[k]);
    hi[k] = Math.max(hi[k], w.p[k]);
  }
  const duration = wps.reduce((acc, w) => acc + 0.5 + (w.pause > 0 ? w.pause : 0) + w.motor, 0);
  return {
    name,
    waypoints: wps.length,
    length,
    span: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    duration,
  };
}


//# sourceURL=/home/user/hardsoftwebgpu/ts/trunc/trajectories.ts