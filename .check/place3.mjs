import { Arm, defaultConfig, homeState } from '../src/core/arm.js';
import { V3, Quat, Transform, rad, deg, Rng } from '../src/core/mathx.js';

const arm = new Arm(defaultConfig());
const rng = new Rng(90210);
const maxB = arm.maxBendPerSegment;
const ok = [];
for (let i = 0; i < 300000 && ok.length < 4000; i++) {
  // smooth arc: clustered bending planes, every joint inside its 45° stop
  const basePlane = rng.nextF32() * 2 * Math.PI - Math.PI;
  const seg = [0,1,2].map(() => ({
    bend: (0.35 + 0.4 * rng.nextF32()) * maxB,
    plane: basePlane + (rng.nextF32() - 0.5) * 0.9,
    compress: rng.nextF32() * (arm.maxCompression / 3) * 0.7,
    hysteresis: 0,
  }));
  const sumBend = seg.reduce((a, s) => a + s.bend, 0);
  if (sumBend < deg(55) || sumBend > deg(100)) continue;
  if (seg.reduce((a, s) => a + s.compress, 0) > 0.04) continue;
  const t = arm.fk(seg, 0, 0);
  const axis = Transform.up(t);
  const r = Math.hypot(t.p.x, t.p.z);
  if (r < 0.13 || r > 0.28) continue;
  if (t.p.y < 0.55 || t.p.y > 0.66) continue;

  // continuity: walk 3 mm of approach in 0.5 mm steps from a warm seed
  let seed = homeState();
  let pos = V3.add(t.p, V3.scale(axis, 0.004));
  let worst = 0, worstJump = 0, prevSeg = null;
  for (let k = 0; k <= 8; k++) {
    const target = { p: pos, q: Quat.fromYTo(axis) };
    const s2 = arm.ik(target, seed, 14, { axisWeight: 0.3 });
    const tip = arm.fk(s2, 0, 0);
    worst = Math.max(worst, V3.len(V3.sub(tip.p, pos)) * 1000);
    const tilt = rad(Math.acos(Math.min(1, Math.abs(V3.dot(Transform.up(tip), axis)))));
    if (prevSeg) worstJump = Math.max(worstJump, Math.max(...s2.map((s, j) => Math.abs(rad(s.bend - prevSeg[j].bend)))) );
    prevSeg = s2.map(s => ({ ...s }));
    seed = { ...seed, seg: s2.map(s => ({ ...s })) };
    pos = V3.add(pos, V3.scale(axis, -0.0005));
  }
  if (worst < 1.2 && worstJump < 2.0) ok.push({ p: t.p, axis, seg, r, sumBend, comp: seg.reduce((a,s)=>a+s.compress,0), worst, worstJump });
}
console.log('verified anchors:', ok.length);
for (const az of [25]) {
  const list = ok.map((g) => ({ g, d: Math.abs(((Math.atan2(g.p.z, g.p.x) * 180 / Math.PI - az + 540) % 360) - 180) }))
    .filter((c) => c.d < 14).sort((a, b) => b.g.sumBend - a.g.sumBend);
  const sorted = list.map(c=>c.g).sort((a,b) => a.worst - b.worst).slice(0, 4);
  for (const g of sorted) {
    console.log(`az=${az} R=${g.r.toFixed(3)} y=${g.p.y.toFixed(3)} bend=${rad(g.sumBend).toFixed(0)}° comp=${(g.comp*1000).toFixed(0)}mm ladderErr=${g.worst.toFixed(2)}mm jump=${g.worstJump.toFixed(1)}° axisTilt=${(Math.acos(Math.abs(g.axis.y))*57.3).toFixed(0)}°`);
    console.log(`   anchor: V3.new(${g.p.x.toFixed(4)}, ${g.p.y.toFixed(4)}, ${g.p.z.toFixed(4)}),  axis: V3.new(${g.axis.x.toFixed(4)}, ${g.axis.y.toFixed(4)}, ${g.axis.z.toFixed(4)}),`);
  }
}
