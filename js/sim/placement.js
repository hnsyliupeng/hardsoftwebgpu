// generated from ts/sim/placement.ts by tools/ts-emit.mjs — do not edit
/**
 * placement.ts — reconstructs the two calibration constants the MATLAB kept in
 * data files, so the ported trajectories are actually reachable.
 *
 * `generate_trajectory.m` writes waypoints as offsets in a task frame and adds
 * `home_pos`, loaded from the binary `home_position.mat`; the OptiTrack-to-robot
 * alignment lived in `training/util/coordinate_transform.m`. Neither is in the
 * repository, and both matter: the ported arm can only put its tool between
 * 474 mm and 778 mm from the base (`.check/trunc-port.mjs` measures it), so a
 * task frame that is rotated or shifted wrongly simply is not followable.
 *
 * `.check/trunc-calibrate.mjs` recovers both from the trajectories themselves:
 * it samples the configuration space into a cloud of reachable tool points,
 * tries all 24 axis-aligned task→robot orientations with a grid of offsets, and
 * keeps what makes all five tasks followable. The result, frozen here:
 *
 *   MATLAB_TO_ROBOT  diag(1, -1, -1) — the task frame is rotated 180° about x
 *   TASK_HOMES       one offset per task, because the reachable set is a shell
 *                    and each task volume needs its own standoff
 *
 * With those values the damped-least-squares solver tracks every waypoint of
 * all five trajectories to under 5 mm (worst 3.0 mm on the circle).
 */

                                              
import { TRUNC } from '../trunc/kinematics.js';
import { taskWaypoints } from '../trunc/trajectories.js';
import { Solver } from './solver.js';
                                                

/** Task frame → robot frame, row per robot axis. */
export const MATLAB_TO_ROBOT             = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];

/**
 * Reconstructed `home_pos` per task, millimetres in the MATLAB frame. The
 * search places each task volume where the arm can work on it comfortably —
 * which is what re-mounting the arm between experiments did on the bench.
 */
export const TASK_HOMES                       = {
  circle: [-20, -130, -625],
  triangle: [-20, -10, -650],
  steps: [-20, -70, -650],
  motherboard: [80, -220, -200],
  bulb: [-130, 380, -250],
};

/** The default `home_pos` when a task has no calibration entry. */
export const DEFAULT_HOME       = [0, 0, -650];

/** `home_pos` for a task. */
export function homeFor(task        )       {
  return (TASK_HOMES[task] ?? DEFAULT_HOME).slice()        ;
}

/** Rotate a task-frame vector into the robot frame. */
export function rotateToRobot(p      )       {
  const M = MATLAB_TO_ROBOT;
  return [
    M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2],
    M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2],
    M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2],
  ];
}

/** A task-frame waypoint and its task's `home_pos` → a robot-frame target. */
export function toRobot(p      , home       = DEFAULT_HOME)       {
  const q = rotateToRobot(p);
  return [q[0] + home[0], q[1] + home[1], q[2] + home[2]];
}

/** Every waypoint of a task, already in the robot frame. */
export function robotWaypoints(task        , home       = homeFor(task))         {
  return taskWaypoints(task, [0, 0, 0]).map((w) => toRobot(w.p, home));
}

/** The tool axis the IK keeps, in the robot frame (the chain direction). */
export const ROBOT_CHAIN_AXIS       = [0, 0, -1];

/** Robot frame → app frame: the chain's -Z becomes "up" (+Y), metres free. */
export function robotToApp(p      )       {
  return [p[0], -p[2], p[1]];
}

/**
 * MATLAB frame → app frame in one call: calibrate into the robot frame, then
 * stand the chain up. The renderer only has to divide by 1000 to get metres.
 */
export function toApp(p      , home       = DEFAULT_HOME)       {
  return robotToApp(toRobot(p, home));
}

/** Same mapping for a direction (no translation) — used for the tool axis. */
export function dirToApp(d      )       {
  return robotToApp(d);
}

/** The app-frame unit vector the chain extends along. */
export const APP_CHAIN_AXIS       = [0, 1, 0];

/** Reach geometry of the ported model, for the UI and the checks. */
export const REACH = { min: 474, max: TRUNC.length + TRUNC.toolLength };

                                  
             
                                                            
                
                                
               
                                                                    
               
                                        
                 
                  
 

/**
 * Search `home_pos` for one task: minimise the worst tracking error over the
 * trajectory, break ties on how contorted the arm has to be.
 */
export function calibrate(
  task        ,
  opts   
                    
                          
                                                         
                    
                                                  
                                                     
    = {},
)                  {
  const solver = opts.solver ?? new Solver(opts.limits, { samples: 900, restarts: 5 });
  const stride = opts.stride ?? 1;
  const grid = opts.grid ?? {
    x: [0],
    y: [0],
    z: Array.from({ length: 40 }, (_, i) => -400 - i * 25),
  };
  let best                         = null;

  for (const hx of grid.x) {
    for (const hy of grid.y) {
      for (const hz of grid.z) {
        const home       = [hx, hy, hz];
        const wps = robotWaypoints(task, home);
        let seed = null;
        let worst = 0;
        let mean = 0;
        let bend = 0;
        let missed = 0;
        let count = 0;
        for (let i = 0; i < wps.length; i += stride) {
          const report = solver.solve(wps[i], seed, ROBOT_CHAIN_AXIS, { axisWeight: 0.15 });
          seed = report.state;
          worst = Math.max(worst, report.err);
          mean += report.err;
          bend += report.bend;
          if (report.err > 5) missed += 1;
          count += 1;
        }
        const result                  = {
          home, worst, mean: mean / count, bend: bend / count, missed, sampled: count,
        };
        if (!best
          || result.missed < best.missed
          || (result.missed === best.missed && result.worst < best.worst - 0.05)
          || (result.missed === best.missed && Math.abs(result.worst - best.worst) <= 0.05
              && result.bend < best.bend - 1)) {
          best = result;
        }
      }
    }
  }
  return best                   ;
}

/** Reach summary for the UI: the task volume in app space, in metres. */
export function taskExtent(task        , home       = homeFor(task))   
                                                                     
  {
  const wps = robotWaypoints(task, home).map((p) => robotToApp(p));
  const lo       = [Infinity, Infinity, Infinity];
  const hi       = [-Infinity, -Infinity, -Infinity];
  for (const p of wps) for (let k = 0; k < 3; k += 1) {
    lo[k] = Math.min(lo[k], p[k]);
    hi[k] = Math.max(hi[k], p[k]);
  }
  let length = 0;
  for (let i = 1; i < wps.length; i += 1) {
    length += Math.hypot(wps[i][0] - wps[i - 1][0], wps[i][1] - wps[i - 1][1], wps[i][2] - wps[i - 1][2]);
  }
  const centre       = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return {
    min: lo, max: hi, centre,
    radius: Math.hypot(centre[0], centre[1], centre[2]) / 1000,
    length: length / 1000,
  };
}


//# sourceURL=/home/user/hardsoftwebgpu/ts/sim/placement.ts