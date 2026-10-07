import { Arm, defaultConfig, homeState } from '../src/core/arm.js';
import { V3, Quat, Transform, deg, rad } from '../src/core/mathx.js';
import { STANDOFF } from '../src/core/physics.js';

const arm = new Arm(defaultConfig());
const LADDER = [0.05, 0.02, 0.005, 0];

/** cold-start reachability: plain ik from the straight home pose, 24 iterations */
function trial(anchor, axis) {
  let worstPos = 0, worstOrient = 0, worstComp = 0, worstBend = 0, best = null, bestScore = 1e9;
  for (const s of LADDER) {
    const p = V3.add(anchor, V3.scale(axis, -s));
    let bp = 1e9, bo = 1e9, bs = null;
    for (const [iters, axw] of [[24, 0.3], [40, 0.3], [24, 1.0], [40, 1.0]]) {
      const seg = arm.ik({ p, q: Quat.fromYTo(axis) }, homeState(), iters, { axisWeight: axw });
      const t = arm.fk(seg, 0, 0);
      const pos = V3.len(V3.sub(t.p, p));
      const orient = rad(Math.acos(Math.min(1, Math.abs(V3.dot(Transform.up(t), axis)))));
      const sc = pos + orient * 0.05;
      if (sc < bestScore) { bestScore = sc; best = { iters, axw, pos, orient, seg }; }
      if (sc < bp + bo * 0.05) { bp = pos; bo = orient; bs = seg; }
    }
    worstPos = Math.max(worstPos, bp); worstOrient = Math.max(worstOrient, bo);
    if (bs) { worstComp = Math.max(worstComp, bs.reduce((a,x)=>a+x.compress,0)*1000); worstBend = Math.max(worstBend, rad(bs.reduce((a,x)=>a+x.bend,0))); }
  }
  return { worstPos, worstOrient, worstComp, worstBend, best };
}

const rows = [];
for (const az of [25, 105, 195, 285]) {
  for (const r of [0.10, 0.14, 0.18, 0.22, 0.26, 0.30]) {
    for (const h of [0.46, 0.50, 0.54, 0.58, 0.62, 0.66]) {
      for (let tl = -40; tl <= 40; tl += 10) {
        const ca = Math.cos(deg(az)), sa = Math.sin(deg(az));
        const anchor = V3.new(r * ca, h, r * sa);
        const axis = V3.norm(V3.new(Math.sin(deg(tl)) * ca, Math.cos(deg(tl)), Math.sin(deg(tl)) * sa));
        const t = trial(anchor, axis);
        if (t.worstPos < 4e-3 && t.worstOrient < deg(3) && t.worstComp < 70 && t.worstBend > 30) {
          rows.push({ az, r, h, tl, R: V3.len(anchor), anchor, axis, ...t });
        }
      }
    }
  }
}
rows.sort((a,b) => (a.worstComp + a.worstPos*150) - (b.worstComp + b.worstPos*150));
console.log(rows.length, 'cold-start feasible');
for (const az of [25, 105, 195, 285]) {
  const mine = rows.filter(o => o.az === az).slice(0, 4);
  console.log('--- az', az, '(' + rows.filter(o=>o.az===az).length + ' total)');
  for (const o of mine) console.log(`  r=${o.r} h=${o.h} tilt=${String(o.tl).padStart(3)} |R|=${o.R.toFixed(3)} pos=${(o.worstPos*1000).toFixed(1)}mm orient=${o.worstOrient.toFixed(2)}° bend=${o.worstBend.toFixed(0)}° comp=${o.worstComp.toFixed(0)}mm  anchor=(${V3.toArray(o.anchor).map(v=>v.toFixed(3)).join(',')}) axis=(${V3.toArray(o.axis).map(v=>v.toFixed(3)).join(',')}) iters=${o.best.iters}/axw=${o.best.axw}`);
}
