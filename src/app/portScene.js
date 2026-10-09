/**
 * portScene.js — draws the ported TRUNC arm. One renderer, three consumers:
 * the GIF tool, the CPU reference page, and (for its overlay) the WebGPU page.
 *
 * It takes the geometry `MatlabPort.geometry()` already produced — spine
 * samples, truss cells, equatorial guide rings, the nine tendons, the tool —
 * and paints it into a `Raster` (see tools/raster.js). Nothing here re-derives
 * kinematics: if the arm looks wrong, the model is wrong.
 */
import { add, sub, mul, normalize, mix, cross } from '../../tools/raster.js';

export const SCENE = {
  sky: [[28, 32, 44], [10, 12, 17]],
  grid: [[64, 72, 90], [30, 34, 46]],
  base: [72, 80, 96],
  baseTop: [98, 108, 126],
  truss: [140, 148, 164],
  cell: [60, 66, 80],
  cellOuter: [126, 136, 156],
  cellInner: [96, 106, 126],
  pin: [196, 206, 222],
  spring: [104, 132, 150],
  guide: [206, 214, 228],
  tendon: [240, 176, 84],
  tendonIdle: [146, 116, 74],
  tool: [214, 220, 230],
  path: [78, 96, 130],
  pathDone: [120, 190, 255],
  trace: [120, 214, 190],
  target: [112, 232, 188],
  motor: [248, 148, 92],
  text: [228, 234, 244],
  dim: [146, 156, 174],
  accent: [116, 198, 255],
  panel: [14, 17, 24],
  border: [50, 58, 74],
  prop: [96, 106, 124],
  propLit: [152, 162, 182],
  floor: [58, 66, 82],
};

const vlen = (a) => Math.hypot(a[0], a[1], a[2]);

/** Default camera for a task, framing the base and the task volume together. */
export function cameraFor(extent, overrides = {}) {
  const c = extent.centre.map((v) => v / 1000);
  const target = [c[0] * 0.22, Math.max(0.34, c[1] * 0.52), c[2] * 0.22];
  const span = Math.max(0.7, extent.radius + Math.hypot(c[0], c[1], c[2]) * 0.5);
  return {
    yaw: 0.55,
    pitch: 0.26,
    dist: span * 1.45 + 0.34,
    target,
    ...overrides,
  };
}

/** Task furniture, so the five jobs read differently. All in app metres. */
export function portProps(task, trajectory) {
  const items = [];
  if (!trajectory?.length) return items;
  if (task === 'motherboard') {
    const p1 = trajectory[Math.floor(trajectory.length * 0.35)];
    const p2 = trajectory[Math.floor(trajectory.length * 0.55)];
    const x0 = Math.min(p1[0], p2[0]) - 0.06;
    const x1 = Math.max(p1[0], p2[0]) + 0.06;
    const z0 = Math.min(p1[2], p2[2]) - 0.05;
    const z1 = Math.max(p1[2], p2[2]) + 0.05;
    const y = Math.min(...trajectory.map((p) => p[1])) - 0.012;
    items.push({ kind: 'quad', corners: [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], rgb: SCENE.prop });
    for (const q of [p1, p2]) {
      items.push({ kind: 'cyl', a: [q[0], y, q[1] * 0 + q[1], q[2]], b: [q[0], y + 0.022, q[2]], r: 0.011, rgb: SCENE.propLit });
    }
  }
  if (task === 'bulb') {
    const socket = trajectory[trajectory.length - 1];
    items.push({ kind: 'cyl', a: [socket[0], socket[1] - 0.07, socket[2]], b: socket, r: 0.026, rgb: SCENE.prop });
    items.push({ kind: 'sphere', c: [socket[0], socket[1] + 0.045, socket[2]], r: 0.035, rgb: [206, 214, 226] });
  }
  if (task === 'triangle' || task === 'steps') {
    const base = trajectory[0];
    items.push({ kind: 'quad', corners: [
      [base[0] - 0.08, base[1] - 0.01, base[2] - 0.08],
      [base[0] + 0.08, base[1] - 0.01, base[2] - 0.08],
      [base[0] + 0.08, base[1] - 0.01, base[2] + 0.08],
      [base[0] - 0.08, base[1] - 0.01, base[2] + 0.08],
    ], rgb: SCENE.prop });
  }
  return items;
}

function drawProps(r, items) {
  for (const it of items) {
    if (it.kind === 'quad') {
      const n = normalize(cross(sub(it.corners[1], it.corners[0]), sub(it.corners[3], it.corners[0])));
      const up = n[1] < 0 ? mul(n, -1) : n;
      const col = mix(it.rgb, [255, 255, 255], 0.32 * up[1] + 0.1);
      for (let i = 1; i < it.corners.length - 1; i += 1) {
        r.tri3(it.corners[0], it.corners[i], it.corners[i + 1], col);
      }
    } else if (it.kind === 'cyl') {
      r.cyl3(it.a, it.b, it.r, it.rgb, { segments: 14, cap: true });
    } else if (it.kind === 'sphere') {
      r.sphere3(it.c, it.r, it.rgb, { rings: 9, segments: 14 });
    }
  }
}

/** Tendon heat: how much shorter this cable is than the slackest one in its set. */
function tendonColour(cableDelta, module, cable) {
  let slack = Infinity;
  for (let k = 0; k < 3; k += 1) {
    const d = cableDelta[module * 3 + k];
    slack = Math.min(slack, d);
  }
  const d = cableDelta[module * 3 + cable];
  const heat = Math.min(1, Math.max(0, Math.abs(d - slack) / 45));
  return mix(SCENE.tendonIdle, SCENE.tendon, heat);
}

/**
 * Paint one frame. `opts` is everything the drawing needs and nothing more:
 *
 *   raster      a Raster
 *   geometry    MatlabPort.geometry() for the frame
 *   trajectory  the commanded path, app metres
 *   trail       where the tool has been, app metres
 *   frame       the animation frame (target/ee/phase/motor/cableDelta)
 *   waypointCount, home, summary, taskName, taskIndex, taskCount
 *   show        { tendons, guides, path, trail, grid, hud }
 *   title       header text (defaults to the port's own)
 */
export function drawScene(raster, opts) {
  const {
    geometry: g, trajectory = [], trail = [], frame,
    taskName = 'task', taskIndex = 0, taskCount = 1,
    waypointCount = 1, home = [0, 0, 0], summary = null,
    items = [], show = {}, title = 'TRUNC ARM', subtitle = 'MATLAB PORT  TS + JS',
  } = opts;
  const view = {
    tendons: true, guides: true, path: true, trail: true, grid: true, hud: true, ...show,
  };
  const r = raster;

  r.clearGradient(SCENE.sky[0], SCENE.sky[1]);

  if (view.grid) {
    const G = 0.62;
    for (let i = -7; i <= 7; i += 1) {
      const t = Math.abs(i / 7);
      const col = mix(SCENE.grid[0], SCENE.grid[1], t);
      r.line3([(i / 7) * G, 0, -G], [(i / 7) * G, 0, G], col, 1);
      r.line3([-G, 0, (i / 7) * G], [G, 0, (i / 7) * G], col, 1);
    }
  }

  // mount
  r.cyl3([0, -0.012, 0], [0, 0.03, 0], 0.082, SCENE.base, { segments: 20, cap: true });
  r.cyl3([0, 0.03, 0], [0, 0.042, 0], 0.055, SCENE.baseTop, { segments: 20, cap: true });

  drawProps(r, items);

  if (view.path && trajectory.length > 1) {
    for (let i = 1; i < trajectory.length; i += 1) {
      const done = i <= frame.waypoint + 1;
      r.line3(trajectory[i - 1], trajectory[i], done ? SCENE.pathDone : SCENE.path, done ? 2 : 1);
    }
  }
  if (view.trail && trail.length > 1) {
    for (let i = 1; i < trail.length; i += 1) r.line3(trail[i - 1], trail[i], SCENE.trace, 1);
  }

  // the commanded target
  const target = frame.target;
  const tcol = frame.motorOn ? SCENE.motor : SCENE.target;
  r.disc3(target, [0, 1, 0], 0.018, tcol, 14);
  r.line3(add(target, [-0.03, 0, 0]), add(target, [0.03, 0, 0]), tcol, 1);
  r.line3(add(target, [0, 0, -0.03]), add(target, [0, 0, 0.03]), tcol, 1);

  // ---- the arm -----------------------------------------------------------
  // Drawn from the paper's geometry (`src/core/truncSpec.js`): seven nested
  // joint units along the chain, each a truss lattice inside an equatorial one,
  // with three-arm cable guides between them and the nine tendons riding at the
  // guide tips. Nothing here is stylised: if the joints look wrong, the spec is
  // wrong.
  const lattice = view.lattice !== false && g.joints?.length;
  if (lattice) {
    // cable guides first: their arms reach out past the cell balls and the
    // tendons thread over the rollers at their tips
    for (const guide of g.cableGuides ?? []) {
      for (const [a, c] of guide.struts) r.cyl3(a, c, 0.004, SCENE.guide, { segments: 6, cap: true });
      // the rollers the tendons ride over, at the ends of the three arms
      for (const tip of guide.rollers ?? []) r.sphere3(tip, 0.0055, SCENE.guide, { rings: 7, segments: 10 });
    }
    for (const joint of g.joints) {
      // the equatorial cell is the outer shell, the truss cell the inner one (drawn as solid 3D struts & pins)
      for (const [a, c] of joint.equatorial) r.cyl3(a, c, 0.0022, SCENE.cellOuter, { segments: 6, cap: true });
      for (const [a, c] of joint.truss) r.cyl3(a, c, 0.0026, SCENE.cellInner, { segments: 6, cap: true });
      for (const pin of joint.pins) r.sphere3(pin, 0.0032, SCENE.pin, { rings: 6, segments: 8 });
      // the conical restoring spring inside the truss cell
      if (view.spring) {
        for (let i = 1; i < joint.spring.length; i += 1) {
          r.cyl3(joint.spring[i - 1], joint.spring[i], 0.0010, SCENE.spring, { segments: 5, cap: true });
        }
      }
    }
  } else {
    // fallback: the solid core, for a quick look or if the spec is unavailable
    r.tube3(g.spine, 0.0245, SCENE.truss, { segments: 16 });
    for (let i = 2; i < g.spine.length - 1; i += 1) {
      const dir = normalize(sub(g.spine[i + 1], g.spine[i - 1]));
      r.disc3(g.spine[i], dir, 0.0255, SCENE.cell, 16);
    }
  }

  // nine tendons, from the MATLAB's own cable triangle, coloured by tension
  if (view.tendons) {
    for (let m = 0; m < g.tendons.length; m += 1) {
      for (let c = 0; c < g.tendons[m].length; c += 1) {
        const line = g.tendons[m][c];
        const col = tendonColour(frame.cableDelta, m, c);
        for (let i = 1; i < line.length; i += 1) r.line3(line[i - 1], line[i], col, 1);
      }
    }
  }

  // the socket-driver end effector (paper Fig. 5): a taper down to the socket
  // head, with the motor's twist sleeve lit when the drill motor is running
  const tip = g.tip;
  const base = g.toolBase;
  const at = (f) => add(base, mul(sub(tip, base), f));
  r.cyl3(at(0), at(0.24), 0.017, SCENE.tool, { segments: 16, cap: true });
  r.cyl3(at(0.24), at(0.60), 0.013, SCENE.tool, { segments: 16, cap: true });
  r.cyl3(at(0.60), at(0.86), 0.019, SCENE.tool, { segments: 16, cap: true });
  r.cyl3(at(0.86), at(1), 0.008, frame.motorOn ? SCENE.motor : SCENE.accent, { segments: 14, cap: true });

  if (!view.hud) return;

  if (!view.hud) return;

  // ---- HUD ---------------------------------------------------------------
  const W = r.outW;
  const H = r.outH;
  const pad = 10;
  r.panel(pad, pad, 196, 32, SCENE.panel, SCENE.border);
  r.text(pad + 6, pad + 5, title, SCENE.accent, 2);
  r.text(pad + 6, pad + 20, subtitle, SCENE.dim, 1);

  const info = [
    `TASK ${taskIndex + 1}/${taskCount}  ${String(taskName).toUpperCase()}`,
    `PHASE ${String(frame.phase).toUpperCase()}`,
    `WAYPOINT ${frame.waypoint + 1}/${waypointCount}`,
    `TOOL ${frame.ee.map((v) => v.toFixed(0)).join(', ')} MM`,
    `ERROR ${frame.err.toFixed(2)} MM`,
    frame.motorOn ? `MOTOR ON  ${frame.motorRemaining.toFixed(1)} S` : 'MOTOR OFF',
  ];
  r.panel(pad, pad + 38, 244, 76, SCENE.panel, SCENE.border);
  info.forEach((line, i) => r.text(pad + 6, pad + 43 + i * 11, line, i === 1 ? SCENE.accent : SCENE.text, 1));

  // legend
  r.panel(pad, pad + 122, 244, 60, SCENE.panel, SCENE.border);
  r.text(pad + 6, pad + 127, 'ARM  TRUSS / EQUATORIAL GUIDES', SCENE.dim, 1);
  const key = [
    [SCENE.truss, 'TRUSS SEGMENT (3)', 0],
    [SCENE.guide, 'GUIDE RING (4)', 1],
    [SCENE.tendon, 'TENDON ×3 PER MODULE', 2],
    [SCENE.trace, 'TOOL TRACE', 3],
  ];
  key.forEach(([col, label, i]) => {
    const ky = pad + 140 + i * 10;
    r.rect(pad + 6, ky, 7, 7, col);
    r.text(pad + 18, ky + 1, label, SCENE.text, 1);
  });
  const kx = pad + 152;
  r.rect(kx, pad + 149, 7, 7, SCENE.pathDone);
  r.text(kx + 12, pad + 150, 'TRAVELLED', SCENE.text, 1);
  r.rect(kx, pad + 159, 7, 7, SCENE.target);
  r.text(kx + 12, pad + 160, 'WAYPOINT', SCENE.text, 1);
  r.rect(kx, pad + 169, 7, 7, SCENE.motor);
  r.text(kx + 12, pad + 170, 'TOOL MOTOR', SCENE.text, 1);

  // nine cable deltas, three per module
  const bx = W - 122;
  const by = pad;
  r.panel(bx, by, 112, 164, SCENE.panel, SCENE.border);
  r.text(bx + 6, by + 5, 'CABLE DELTA MM', SCENE.dim, 1);
  for (let m = 0; m < 3; m += 1) r.text(bx + 12 + m * 36, by + 17, `M${m + 1}`, SCENE.dim, 1);
  for (let i = 0; i < 9; i += 1) {
    const d = frame.cableDelta[i];
    const mod = Math.floor(i / 3);
    const col = i % 3;
    const cx = bx + 8 + mod * 36;
    const cy = by + 30 + col * 42;
    r.text(cx, cy, `${d >= 0 ? '+' : ''}${d.toFixed(0)}`, SCENE.dim, 1);
    const zero = cy + 26;
    r.rect(cx + 2, zero - 1, 18, 1, SCENE.border);
    const h = Math.min(22, Math.abs(d) / 4);
    r.rect(cx + 7, d >= 0 ? zero - h : zero, 8, h, [SCENE.tendon, SCENE.accent, SCENE.tendonIdle][col]);
  }
  ['C1', 'C2', 'C3'].forEach((lab, i) => {
    r.text(bx + 6 + i * 34, by + 158, lab, [SCENE.tendon, SCENE.accent, SCENE.tendonIdle][i], 1);
  });

  // progress + caption
  const prog = (frame.waypoint + 1) / Math.max(1, waypointCount);
  r.rect(pad, H - 22, W - 2 * pad, 7, [24, 28, 38]);
  r.rect(pad, H - 22, (W - 2 * pad) * prog, 7, SCENE.accent);
  const step = Math.max(1, Math.ceil(waypointCount / 48));
  for (let i = frame.waypoint + step; i < waypointCount; i += step) {
    const x = pad + ((W - 2 * pad) * i) / waypointCount;
    r.rect(x, H - 22, 1, 7, [46, 52, 68]);
  }
  const travel = summary?.cableTravel ?? null;
  r.text(pad, H - 38,
    `T ${frame.time.toFixed(1)} S   HOME ${home.map((v) => v.toFixed(0)).join(',')} MM`
    + (travel !== null ? `   CABLE TRAVEL ${travel.toFixed(0)} MM` : ''),
    SCENE.dim, 1);
}

/** The results card the GIF ends on: the port's own numbers per task. */
export function drawSummaryCard(raster, rows, totals, title = 'TRUNC MATLAB PORT') {
  const r = raster;
  const W = r.outW;
  const H = r.outH;
  r.clearGradient([20, 24, 34], [10, 12, 17]);
  const top = Math.round(H * 0.16);
  r.text(W / 2 - 156, top, title, SCENE.accent, 3);
  r.text(W / 2 - 156, top + 34, 'TS + JS  TENDON-DRIVEN ARM  REPLAY', SCENE.dim, 1);
  let y = top + 76;
  const cols = [56, 262, 366, 486, 606];
  ['TASK', 'WAYPOINTS', 'SETTLED MM', 'CABLE MM', 'MOTOR S'].forEach((h, i) => r.text(cols[i], y, h, SCENE.dim, 1));
  y += 14;
  r.rect(46, y - 4, W - 92, 1, SCENE.border);
  for (const row of rows) {
    y += 20;
    cols.forEach((cx, i) => r.text(cx, y, String(row[i]), i === 0 ? SCENE.text : SCENE.dim, 2));
  }
  y += 34;
  r.rect(46, y - 10, W - 92, 1, SCENE.border);
  y += 6;
  r.text(56, y, `MISSED WAYPOINTS ${totals.missed}   SIM FRAMES ${totals.frames}   MEAN ERROR ${totals.mean.toFixed(2)} MM`, SCENE.text, 1);
  r.text(56, y + 16, `SIMULATED ${totals.seconds.toFixed(1)} S   GEOMETRY FROM THE PORTED FORWARD KINEMATICS`, SCENE.dim, 1);
  r.text(56, y + 32, 'TRUNC = TRUSS + EQUATORIAL GUIDE  TORQUE-TRANSMITTING JOINTS', SCENE.dim, 1);
}

/** Handy for a legend or a tooltip: the cables in module/cable order. */
export const CABLE_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `M${Math.floor(i / 3) + 1}C${(i % 3) + 1}`);

/** Distance travelled by a polyline, metres. */
export function pathLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i += 1) L += vlen(sub(points[i], points[i - 1]));
  return L;
}
