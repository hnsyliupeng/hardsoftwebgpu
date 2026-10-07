// generated from ts/sim/animation.ts by tools/ts-emit.mjs — do not edit
/**
 * animation.ts — the animated replay of `follow_trajectory.m`.
 *
 * The MATLAB executed a task by looping over the dense waypoint list and, for
 * each one, commanding `arm.set_pos(comp + l_delta(p,:))`, waiting for the
 * servos, holding `pause_length`, sampling the tool pose fifteen times, and
 * pulsing the tool motor where the trajectory asked. The original took its
 * servo commands from a pre-computed inverse table; here the same loop drives
 * the ported kinematic model through the damped-least-squares IK in `solver.ts`,
 * which is what makes it an animation rather than a log replay.
 *
 * Everything the renderer needs for a frame comes out of `step()`:
 *   - the executed joint state and the tool frame (millimetres)
 *   - the nine cable lengths and their deltas from home
 *   - the servo command vector `comp + l_delta` in the MATLAB's own units
 *   - the phase (move / hold / drill / settle / done), the motor relay, the
 *     waypoint cursor and the instantaneous tracking error
 */

                                                                          
import { ArmMotor, MockMotorLink } from '../trunc/armMotor.js';
import { forward, homeState, TRUNC } from '../trunc/kinematics.js';
import { meanRows } from '../trunc/math.js';
import { COMPRESSED } from '../trunc/setup.js';
import { taskWaypoints } from '../trunc/trajectories.js';
import { homeFor, ROBOT_CHAIN_AXIS, robotWaypoints, toRobot } from './placement.js';
import { DEFAULT_LIMITS, Solver, toolAxis } from './solver.js';
                                                

                                                                  

                                   
               
     
                                                                               
                                                                  
     
              
                                    
              
                                              
                       
                                                              
                        
                                                                   
                     
                                                            
                     
                                                                    
                   
                        
                   
     
                                                                                
                                                                      
                                                                              
                                                                             
                                                                          
     
                      
                                                                              
                           
                
 

                        
                
               
                   
                        
               
                                                 
               
                               
           
                                                              
                   
                                         
              
                    
                               
                   
                                                             
                       
                                                     
                  
                  
                  
                   
                   
                         
             
                                                                            
                    
             
 

                                   
               
                    
                 
                  
                     
                    
                   
                                                                          
                 
                                                                 
                          
                                                 
                 
                       
                         
                      
                       
                
                     
 

/** The neutral cable lengths every delta is measured from. */
export const HOME_CABLES           = forward(homeState()).cables.slice();

/**
 * Which way the tool is held: -Z of the robot frame, the direction the chain
 * advances. Every trajectory in `generate_trajectory.m` is "level", so the tool
 * stays square to the work; how the tool body was bolted to the wrist relative
 * to the OptiTrack marker is not recoverable from the repository, so the port
 * holds the chain direction rather than guessing the body offset.
 */
export const CHAIN_AXIS       = ROBOT_CHAIN_AXIS.slice()        ;

export class ArmAnimation {
           opts                                                                                    
                                                                          
   ;
  /** the raw waypoint list (task frame), with its flags */
           waypoints            ;
  /** the same waypoints in the robot frame — what the IK is asked to reach */
           targets        ;
           motor = new ArmMotor(new MockMotorLink());
           limits              ;
           solver        ;

  state            ;
  target            ;
  time = 0;
  frameIndex = 0;
  waypoint = 0;
  done = false;
  /** waypoints that were skipped after `waypointTimeout` */
  missed = 0;
          waypointFrames = 0;
          pauseLeft = 0;
          waitLeft = 0;
          settle = 0;
          sampleBuf             = [];
          axis       = [0, 0, -1];
          errSeries           = [];
          cableVel           = new Array(9).fill(0);
          prevCable                  = null;
          travel           = new Array(9).fill(0);
          pathLength = 0;
          peakVelocity = 0;
          axisError = 0;
          settledErr = 0;

  constructor(options                  ) {
    const { task, ...rest } = options;
    const home = options.home ?? homeFor(task);
    this.opts = {
      task,
      home,
      dt: rest.dt ?? 1 / 60,
      pauseLength: rest.pauseLength ?? 0.5,
      operatorWait: rest.operatorWait ?? 2,
      servoRate: rest.servoRate ?? 900,
      tolerance: rest.tolerance ?? 1.5,
      samples: rest.samples ?? 15,
      limits: rest.limits ?? DEFAULT_LIMITS,
      ikIters: rest.ikIters ?? 20,
      axisWeight: rest.axisWeight ?? 0,
      waypointTimeout: rest.waypointTimeout ?? 3,
      seed: rest.seed ?? 7,
    };
    this.limits = this.opts.limits;
    this.targets = robotWaypoints(task, this.opts.home);
    this.waypoints = taskWaypoints(task, [0, 0, 0]);
    if (!this.waypoints.length) throw new Error(`task "${task}" produced no waypoints`);
    this.solver = new Solver(this.limits, { samples: 900, restarts: 5 });
    this.state = homeState();
    const first = this.targets[0];
    this.axis = CHAIN_AXIS.slice()        ;
    this.target = this.solver.solve(first, this.state, this.axis, {
      iters: this.opts.ikIters, axisWeight: this.opts.axisWeight,
    }).state;
  }

  /** Advance one frame — the body of the MATLAB's replay loop. */
  step()        {
    const dt = this.opts.dt;
    this.time += dt;
    this.frameIndex += 1;
    this.motor.update(dt);

    const wp = this.targets[Math.min(this.waypoint, this.targets.length - 1)];
    const cableFrom = forward(this.state).cables;
    const cableTo = forward(this.target).cables;
    let maxDelta = 0;
    for (let i = 0; i < 9; i += 1) maxDelta = Math.max(maxDelta, Math.abs(cableTo[i] - cableFrom[i]));
    // one servo count is one millimetre of cable in this model
    const budget = this.opts.servoRate * dt;
    const step = maxDelta > 1e-6 ? Math.min(1, budget / maxDelta) : 1;

    const moved = step < 0.999;
    this.state = moved ? lerpState(this.state, this.target, step) : this.target;

    const pose = forward(this.state);
    const cable = pose.cables.slice();
    const pos = pose.position;
    const err = Math.hypot(pos[0] - wp[0], pos[1] - wp[1], pos[2] - wp[2]);
    this.waypointFrames += 1;
    const timedOut = this.waypointFrames > this.opts.waypointTimeout / dt;
    const arrived = (!moved && err <= this.opts.tolerance) || timedOut;
    if (timedOut && err > this.opts.tolerance) this.missed += 1;

    // fifteen-sample average, exactly as the MATLAB averaged the OptiTrack poses
    this.sampleBuf.push(pos.slice());
    if (this.sampleBuf.length > this.opts.samples) this.sampleBuf.shift();
    const eeFiltered = meanRows(this.sampleBuf)        ;

    if (this.prevCable) {
      for (let i = 0; i < 9; i += 1) {
        const v = Math.abs(cable[i] - this.prevCable[i]) / dt;
        this.cableVel[i] = v;
        this.travel[i] += Math.abs(cable[i] - this.prevCable[i]);
        this.peakVelocity = Math.max(this.peakVelocity, v);
      }
    }
    this.prevCable = cable.slice();
    this.errSeries.push(err);
    if (!moved && err > this.settledErr) this.settledErr = err;

    // ------- pause / drill / cursor logic of follow_trajectory.m -------
    let phase        = moved ? 'move' : 'settle';
    let paused = false;
    let waiting = false;

    if (arrived) {
      if (this.pauseLeft > 0) {
        this.pauseLeft = Math.max(0, this.pauseLeft - dt);
        paused = true;
        phase = this.motor.remaining > 0 ? 'drill' : 'hold';
      } else if (this.waitLeft > 0) {
        this.waitLeft = Math.max(0, this.waitLeft - dt);
        waiting = true;
        paused = true;
        phase = 'hold';
      } else if (this.settle < 1) {
        this.settle += 1;
        phase = 'settle';
      } else {
        const w = this.waypoints[this.waypoint];
        if (w.motor > 0) this.motor.pulse(w.motor);
        if (w.pause < 0) this.waitLeft = this.opts.operatorWait;
        else this.pauseLeft = Math.max(w.pause, this.opts.pauseLength);
        this.settle = 0;
        this.waypointFrames = 0;
        if (this.waypoint < this.waypoints.length - 1) {
          const a = this.targets[this.waypoint];
          const b = this.targets[this.waypoint + 1];
          this.pathLength += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          this.waypoint += 1;
          const next = this.targets[this.waypoint];
          const solved = this.solver.solve(next, this.state, this.axis, {
            iters: this.opts.ikIters, axisWeight: this.opts.axisWeight,
          });
          this.target = solved.state;
          this.axisError = solved.axisErr;
        } else {
          this.done = true;
          phase = 'done';
        }
      }
    }

    return {
      index: this.frameIndex,
      time: this.time,
      waypoint: this.waypoint,
      waypointCount: this.waypoints.length,
      phase: this.done ? 'done' : phase,
      target: wp.slice()        ,
      ee: pos,
      eeFiltered,
      err,
      state: this.state,
      cables: cable,
      cableDelta: cable.map((c, i) => c - HOME_CABLES[i]),
      servo: cable.map((c, i) => COMPRESSED[i] + (c - HOME_CABLES[i])),
      moving: moved,
      paused,
      waiting,
      motorOn: this.motor.remaining > 0,
      motorRemaining: this.motor.remaining,
      axis: toolAxis(this.state),
      axisError: this.axisError,
      quat: quaternionOf(this.state),
    };
  }

  /** Run to completion (or a frame cap) and return the summary. */
  run(maxFrames = 200000)                   {
    while (!this.done && this.frameIndex < maxFrames) this.step();
    const errs = this.errSeries;
    let meanErr = 0;
    let maxErr = 0;
    for (const e of errs) { meanErr += e; if (e > maxErr) maxErr = e; }
    if (errs.length) meanErr /= errs.length;
    let peakTravel = 0;
    let sumTravel = 0;
    for (const t of this.travel) { if (t > peakTravel) peakTravel = t; sumTravel += t; }
    const dists = this.targets.map((p) => Math.hypot(p[0], p[1], p[2]));
    const reachMax = TRUNC.length + TRUNC.toolLength;
    return {
      task: this.opts.task,
      waypoints: this.waypoints.length,
      frames: this.frameIndex,
      seconds: this.time,
      pathLength: this.pathLength,
      meanError: meanErr,
      maxError: maxErr,
      missed: this.missed,
      maxSettledError: this.settledErr,
      pulses: this.motor.history.length,
      motorSeconds: this.motor.totalOn,
      peakCableDelta: peakTravel,
      cableTravel: sumTravel,
      velocityPeak: this.peakVelocity,
      reach: Math.max(...dists),
      reachable: dists.every((d) => d <= reachMax),
    };
  }

  /** Cable velocity of the last frame, mm/s — drives the tendon colouring. */
  get cableVelocity()           { return this.cableVel; }
  /** Total travel per cable so far, mm. */
  get cableTravel()           { return this.travel; }
}

function lerpState(a            , b            , t        )             {
  const l = (x        , y        ) => x + (y - x) * t;
  return {
    t1: l(a.t1, b.t1), t2: l(a.t2, b.t2), t3: l(a.t3, b.t3),
    t4: l(a.t4, b.t4), t5: l(a.t5, b.t5), t6: l(a.t6, b.t6),
    L: l(a.L, b.L), toolLength: a.toolLength,
  };
}

/** Tool orientation from the wrist frame (quaternion, w-first). */
export function quaternionOf(state            )       {
  const m = forward(state).T[2];
  const trace = m[0] + m[5] + m[10];
  let q      ;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [0.25 * s, (m[9] - m[6]) / s, (m[2] - m[8]) / s, (m[4] - m[1]) / s];
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2;
    q = [(m[9] - m[6]) / s, 0.25 * s, (m[4] + m[1]) / s, (m[2] + m[8]) / s];
  } else if (m[5] > m[10]) {
    const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2;
    q = [(m[2] - m[8]) / s, (m[4] + m[1]) / s, 0.25 * s, (m[9] + m[6]) / s];
  } else {
    const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2;
    q = [(m[4] - m[1]) / s, (m[2] + m[8]) / s, (m[9] + m[6]) / s, 0.25 * s];
  }
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Reachability report for a task — used by the calibration check. */
export function reachability(task        , home       = homeFor(task))   
                                                               
  {
  const wps = robotWaypoints(task, home);
  const dist = wps.map((p) => Math.hypot(p[0], p[1], p[2]));
  const reachMax = TRUNC.length + TRUNC.toolLength;
  return {
    max: Math.max(...dist),
    min: Math.min(...dist),
    unreachable: dist.filter((d) => d > reachMax).length,
    total: wps.length,
  };
}


//# sourceURL=/home/user/hardsoftwebgpu/ts/sim/animation.ts