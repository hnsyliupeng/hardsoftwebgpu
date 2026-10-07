// generated from ts/trunc/analysis.ts by tools/ts-emit.mjs — do not edit
/**
 * analysis.ts — the three data-analysis scripts, ported.
 *
 *   cross_coupling_analysis.m  split Instron trials on a rotation threshold,
 *                              plot rotation against torque with error bounds
 *   efficiency_analysis.m      mechanical efficiency against bending angle for
 *                              the three joints (TRUNC / rubber / steel)
 *   plot_cvjoint.m             CV-joint bend and extension trials
 *   norm_quat.m                re-express tool orientations relative to the
 *                              first recorded pose
 *
 * The TDMS loaders and plot formatting are gone; the arithmetic and the
 * thresholds are kept, because the animation panel re-uses them.
 */

                                       
import {
  findPeaks, meanRows, quatConj, quatMul, quatNorm, quat2rotm, rotm2quat, wrapTo180,
} from './math.js';

/** ---------------------------------------------------------- cross coupling */

                                
                            
                   
                      
                 
                               
                
 

/** The threshold that split trials in cross_coupling_analysis.m. */
export const CROSS_COUPLING_ROTATION_THRESHOLD = 5;
/** The reference line the MATLAB drew: 5·(0.05/100)·1000. */
export const CROSS_COUPLING_REFERENCE = 5 * (0.05 / 100) * 1000;

/** Split a trial into monotone rotation runs, as the MATLAB's threshold did. */
export function splitTrials(samples                 )                    {
  const runs                    = [];
  let current                  = [];
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    const prev = samples[i - 1];
    if (!current.length || s.joint === current[current.length - 1].joint) {
      if (prev && Math.abs(s.rotation - prev.rotation) > CROSS_COUPLING_ROTATION_THRESHOLD) {
        if (current.length) runs.push(current);
        current = [];
      }
      current.push(s);
    } else {
      runs.push(current);
      current = [s];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

/** Binned mean ± standard error, the shape the MATLAB plotted. */
export function binnedErrorBars(
  samples                 ,
  binCount = 21,
)                                                          {
  if (!samples.length) return { rotation: [], torque: [], err: [] };
  const lo = Math.min(...samples.map((s) => s.rotation));
  const hi = Math.max(...samples.map((s) => s.rotation));
  const span = (hi - lo) || 1;
  const bins                    = Array.from({ length: binCount }, () => []);
  for (const s of samples) {
    const k = Math.min(binCount - 1, Math.floor(((s.rotation - lo) / span) * binCount));
    bins[k].push(s);
  }
  const rotation           = [];
  const torque           = [];
  const err           = [];
  for (const bin of bins) {
    if (!bin.length) continue;
    const t = bin.map((s) => s.torque);
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    const variance = t.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, t.length - 1);
    rotation.push(bin.reduce((a, s) => a + s.rotation, 0) / bin.length);
    torque.push(mean);
    err.push(Math.sqrt(variance) / Math.sqrt(t.length));
  }
  return { rotation, torque, err };
}

/** ---------------------------------------------------------------- efficiency */

export const EFFICIENCY_BETAS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
export const EFFICIENCY_JOINTS = ['TRUNC', 'rubber', 'steel']         ;
/** steel only got 0…10° in efficiency_analysis.m. */
export const STEEL_BETAS = [0, 5, 10];
/** Samples are windowed 800 long, starting at index 300. */
export const EFFICIENCY_WINDOW = { offset: 300, length: 800 };
/** Detection thresholds on (r, torque) from the MATLAB. */
export const EFFICIENCY_THRESHOLDS                                           = {
  TRUNC: { r: 29, t: 0.225 },
  rubber: { r: 29, t: 0.0 },
  steel: { r: 28, t: 0.0 },
};

                                                                                

/** `100*power_out/power_in` over the windowed portion of a trial. */
export function efficiency(samples               )         {
  const win = samples.slice(EFFICIENCY_WINDOW.offset, EFFICIENCY_WINDOW.offset + EFFICIENCY_WINDOW.length);
  const rows = win.filter((s) => s.powerIn > 0).map((s) => [100 * s.powerOut / s.powerIn]);
  if (!rows.length) return 0;
  return meanRows(rows)[0];
}

/** Turn the raw encoder traces of one β into the efficiency number. */
export function efficiencySweep(
  trials                                               ,
)                                                         {
  const out                                                         = {};
  for (const joint of EFFICIENCY_JOINTS) {
    const betas = joint === 'steel' ? STEEL_BETAS : EFFICIENCY_BETAS;
    out[joint] = betas
      .filter((b) => trials[joint]?.[b])
      .map((b) => ({ beta: b, efficiency: efficiency(trials[joint][b]) }));
  }
  return out;
}

/** ------------------------------------------------------------------ cv joint */

                                                            

const ENCODER_COUNTS_PER_DEG = 360 / 1024;

/** Raw encoder counts → wrapped joint angle in degrees. */
export function decodeCvTrace(counts          , sampleRate = 1000)          {
  const time = counts.map((_, i) => i / sampleRate);
  const angle = counts.map((c) => wrapTo180(c * ENCODER_COUNTS_PER_DEG));
  return { time, angle };
}

/** Phase-to-phase amplitude of a CV trace (peak-to-peak), degrees. */
export function cvAmplitude(trial         )         {
  const { pks } = findPeaks(trial.angle.map(Math.abs));
  if (pks.length < 2) return 0;
  return Math.max(...pks) - Math.min(...pks);
}

/** The bend and extension conditions from `plot_cvjoint.m`, in degrees / mm. */
export const CV_CONDITIONS = {
  bend: ['0°', '5°', '10°', '15°', '20°'],
  extend: ['-13mm', '-6.5mm', '+6.5mm', '+13mm', '+22.5mm'],
}         ;
export const CV_AXES = { bend: { x: 0.7, y: 180 }, extend: { x: 1.3, y: 180 } };

/** ------------------------------------------------------------ quat norm */

/**
 * `norm_quat.m`: express every tool orientation relative to the first one.
 * `q1 = rotm2quat(eye(3))` in the original, i.e. the identity quaternion, so
 * this is a plain re-conjugation of each sample — kept as-is so the numbers
 * line up with the original CSV.
 */
export function normaliseQuaternions(rows                                                )   
                                           
    {
  if (!rows.length) return [];
  const q1 = rotm2quat(new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  return rows.map((row) => {
    const rel = quat2rotm(quatMul(quatConj(q1), row.q));
    const qNew = rotm2quat(rel);
    return { x: row.x, y: row.y, z: row.z, q: quatNorm(qNew) };
  });
}

/** Parse the positions.csv the MATLAB read (x,y,z,qx,qy,qz,qw per row). */
export function parsePositionsCsv(text        )                                                 {
  const rows                                                 = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(',').map((s) => Number(s.trim()));
    if (parts.length < 7 || parts.some((v) => !Number.isFinite(v))) continue;
    rows.push({ x: parts[0], y: parts[1], z: parts[2], q: [parts[6], parts[3], parts[4], parts[5]] });
  }
  return rows;
}


//# sourceURL=/home/user/hardsoftwebgpu/ts/trunc/analysis.ts