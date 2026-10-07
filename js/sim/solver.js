// generated from ts/sim/solver.ts by tools/ts-emit.mjs — do not edit
/**
 * solver.ts — inverse kinematics for the ported constant-curvature arm.
 *
 * The MATLAB shipped a learned inverse model (`motor_pos_inverse_fast.mat`,
 * 7500 samples of `predicted_motor_inputs_fast_7500.csv`) instead of an
 * analytic IK, which is why `follow_trajectory.m` just replayed a table. The
 * animation needs an IK that runs live, so this is a damped least-squares
 * solver over the seven actuators of the ported model: six joint angles plus
 * the insertable length L.
 *
 * Residuals: three position components (mm) and three tool-axis components, so
 * the solver both reaches the waypoint and keeps the tool pointing where the
 * waypoint quaternion asked. The Jacobian is finite-differenced; each iteration
 * solves (J'J + lambda I) dx = -J'r with Gaussian elimination.
 */

                                                          
import { forward, homeState, sweepConfigurations, TRUNC } from '../trunc/kinematics.js';
import { deg2rad, makeRng, norm3, quat2rotm, sub3 } from '../trunc/math.js';

                               
                   
                
                
                    
                    
 

/** Joint bounds in radians — the same numbers `JointState` carries. */
export const DEFAULT_LIMITS               = {
  shoulder: TUNC_DEG(TRUNC.maxShoulder),
  elbow: TUNC_DEG(TRUNC.maxElbow),
  wrist: TUNC_DEG(TRUNC.maxWrist),
  minLength: TRUNC.length - TRUNC.maxCompression,
  maxLength: TRUNC.length,
};

/** `TRUNC.max*` are the manufacturing limits in degrees. */
function TUNC_DEG(deg        )         {
  return deg * (Math.PI / 180);
}

                               
                 
                  
                                                                  
                      
                                                
                     
                                                            
                      
 

/** Tool axis = the last segment's approach direction, from the wrist transform. */
export function toolAxis(state            )       {
  const m = forward(state).T[2];
  // each segment advances along -Z of its own frame; the tool continues it
  return [-m[8], -m[9], -m[10]];
}

/** Desired tool axis from a waypoint quaternion (tool body approach = +Z). */
export function desiredAxis(q                                  )       {
  const R = quat2rotm(q);
  return [R[8], R[9], R[10]];
}

function gaussSolve(A            , b          )           {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) continue;
    const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/** Residual vector: [dx, dy, dz, axisWeight*(a - a_desired)]. */
function residual(state            , target      , axis      , axisWeight        )           {
  const p = forward(state).position;
  const a = toolAxis(state);
  return [
    p[0] - target[0],
    p[1] - target[1],
    p[2] - target[2],
    axisWeight * (a[0] - axis[0]),
    axisWeight * (a[1] - axis[1]),
    axisWeight * (a[2] - axis[2]),
  ];
}

/** Clamp a joint state into the manufactured limits. */
export function clampState(s            , limits               = DEFAULT_LIMITS)             {
  const cl = (v        , m        ) => Math.max(-m, Math.min(m, v));
  return {
    t1: cl(s.t1, limits.shoulder),
    t2: cl(s.t2, limits.shoulder),
    t3: cl(s.t3, limits.elbow),
    t4: cl(s.t4, limits.elbow),
    t5: cl(s.t5, limits.wrist),
    t6: cl(s.t6, limits.wrist),
    L: Math.max(limits.minLength, Math.min(limits.maxLength, s.L)),
    toolLength: s.toolLength,
  };
}

/** Damped least squares. `seed` gives frame-to-frame continuity. */
export function solveIk(
  target      ,
  seed            ,
  axis       = [0, 0, 1],
  limits               = DEFAULT_LIMITS,
  opts               = {},
)                                                    {
  const iters = opts.iters ?? 14;
  const lambda = opts.lambda ?? 25;
  const axisWeight = opts.axisWeight ?? 0.35;
  const stepLimit = (opts.stepLimit ?? 5) * deg2rad(1);
  const lengthGain = opts.lengthGain ?? 0.35;
  const keys                       = ['t1', 't2', 't3', 't4', 't5', 't6', 'L'];
  // scaling so a degree and a millimetre are comparable in the damping term
  const scale = [1, 1, 1, 1, 1, 1, 1 / 8];
  let state = clampState(seed, limits);
  let err = norm3(sub3(forward(state).position, target));

  for (let it = 0; it < iters; it += 1) {
    const r = residual(state, target, axis, axisWeight);
    if (norm3(r.slice(0, 3)        ) < 0.05) break;
    const J             = [];
    for (let k = 0; k < 7; k += 1) {
      const h = keys[k] === 'L' ? 0.6 : deg2rad(0.25);
      const probe             = { ...state };
      (probe[keys[k]]          ) += h;
      const rp = residual(clampState(probe, limits), target, axis, axisWeight);
      J.push(r.map((v, i) => (rp[i] - v) / h));
    }
    const n = 7;
    const A             = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n; b += 1) {
        let s = 0;
        for (let i = 0; i < r.length; i += 1) s += J[a][i] * J[b][i];
        A[a][b] = s + (a === b ? lambda * scale[a] * scale[a] : 0);
      }
      let s = 0;
      for (let i = 0; i < r.length; i += 1) s += J[a][i] * r[i];
      g[a] = -s;
    }
    const dx = gaussSolve(A, g);
    for (let k = 0; k < 7; k += 1) {
      let step = dx[k];
      if (!Number.isFinite(step)) step = 0;
      if (keys[k] === 'L') step *= lengthGain;
      else step = Math.max(-stepLimit, Math.min(stepLimit, step));
      (state[keys[k]]          ) += step;
    }
    state = clampState(state, limits);
    err = norm3(sub3(forward(state).position, target));
  }
  return { state, err, iters };
}

/** Distance from the base to a point — used to sanity-check task reachability. */
export function reach(target      )         {
  return Math.hypot(target[0], target[1], target[2]);
}


// ----------------------------------------------------------------- multi-start

                              
                    
                           
              
                                                                            
                  
                                         
                          
                                                                                
               
 

/** Total bend of a state, degrees. */
export function bendOf(s            )         {
  return (Math.abs(s.t1) + Math.abs(s.t3) + Math.abs(s.t5)) * (180 / Math.PI);
}

/**
 * Multi-start solver. The arm has seven actuators and up to three independent
 * bending planes, so it folds into shapes that make the plain damped-least-
 * squares iteration stick in local minima. A cached coarse sample of the
 * configuration space gives the first guess candidates; the caller's previous
 * pose is always tried first, which keeps a whole trajectory continuous.
 */
export class Solver {
           limits              ;
           coarse              ;
           coarsePos        ;
  /** number of coarse seeds tried when the continuity seed fails */
  restarts        ;

  constructor(limits               = DEFAULT_LIMITS, opts                                                         = {}) {
    this.limits = limits;
    const n = opts.samples ?? 1200;
    const rand = makeRng(opts.seed ?? 8);
    // `sweepConfigurations` takes its bounds in degrees, as the MATLAB did
    this.coarse = sweepConfigurations(n, rand, {
      maxShoulder: (limits.shoulder * 180) / Math.PI,
      maxElbow: (limits.elbow * 180) / Math.PI,
      maxWrist: (limits.wrist * 180) / Math.PI,
      maxCompression: TRUNC.length - limits.minLength,
    });
    this.coarse[0] = homeState();
    this.coarsePos = this.coarse.map((c) => forward(c).position);
    this.restarts = opts.restarts ?? 6;
  }

  /** Candidates closest to the target, by coarse sample distance. */
          nearest(target      , k        )               {
    const scored = this.coarsePos.map((p, i) => ({ i, d: Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]) }));
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, k).map((s) => this.coarse[s.i]);
  }

          score(state            , target      , axis      , axisWeight        )              {
    const p = forward(state).position;
    const a = toolAxis(state);
    const err = norm3(sub3(p, target));
    const axisErr = Math.acos(Math.max(-1, Math.min(1, a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2]))) * (180 / Math.PI);
    return { state, err, axisErr, from: 'seed', bend: bendOf(state) };
  }

  /**
   * Solve one pose. `seedState` is the continuity hint (usually the previous
   * frame); the coarse restarts only run when that fails to get under
   * `restartThreshold` millimetres.
   */
  solve(
    target      ,
    seedState                   ,
    axis       = [0, 0, 1],
    opts                                                                  = {},
  )              {
    const axisWeight = opts.axisWeight ?? 0.3;
    const iters = opts.iters ?? 24;
    const threshold = opts.restartThreshold ?? Math.max(4, (opts.lambda ?? 25) / 25 * 4);
    const k = opts.restarts ?? this.restarts;

    let best                     = null;
    const consider = (r             ) => {
      if (!best) { best = r; return; }
      // prefer position, then axis, then the least contorted pose
      const better = r.err < best.err - 0.5
        || (Math.abs(r.err - best.err) <= 0.5 && r.axisErr < best.axisErr - 2)
        || (Math.abs(r.err - best.err) <= 0.5 && Math.abs(r.axisErr - best.axisErr) <= 2 && r.bend < best.bend - 5);
      if (better) best = r;
    };

    if (seedState) {
      const r = solveIk(target, seedState, axis, this.limits, { ...opts, iters, axisWeight });
      consider(this.score(r.state, target, axis, axisWeight));
      if (best.err <= threshold) return best;
    }
    for (const start of this.nearest(target, k)) {
      const r = solveIk(target, start, axis, this.limits, { ...opts, iters, axisWeight });
      const rep = this.score(r.state, target, axis, axisWeight);
      rep.from = 'coarse';
      consider(rep);
    }
    return best;
  }
}



//# sourceURL=/home/user/hardsoftwebgpu/ts/sim/solver.ts