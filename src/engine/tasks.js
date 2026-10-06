/**
 * tasks.js — the job library: what the arm is asked to do.
 *
 * The anchors are not hand-placed: they are read off the arm's own reachable set.
 * With the tool axis pinned to the part axis, the tip can be put anywhere in the
 * 0.58–0.70 m shell, and the axial approach ladder spans 0.05 m, so every anchor
 * sits at |R| ≈ 0.69 m with a 106–124° cumulative bend and ≤ 36 mm of squash
 * (docs/design.md reproduces the sweep). Each task otherwise differs in part
 * axis, clearance, torque window and whether a human pushes on the tool.
 *
 * The last scenario is a multi-stage assembly (peg → bolt → valve → bulb) — the
 * "complex task" case the transformer policy is trained on end to end.
 */

import { V3, deg } from '../core/mathx.js';
import { taskPreset, TASK_KIND, TASK_NAMES } from '../core/physics.js';

/** Fixture kind ids shared with the renderer / mesh generator. */
export const FIXTURE = { PLATE: 0, BRACKET: 1, LAMP: 2, VALVE_BODY: 3, BENCH: 4 };

function boltScenario() {
  // sampled forward from the arm's joint space and *verified continuous*: the
  // approach ladder tracks to 0.7 mm with no re-configuration (docs/design.md)
  const axis = V3.norm(V3.new(0.7709, 0.5912, 0.2370));
  const anchor = V3.new(0.2651, 0.5975, 0.0756);
  return {
    id: 'bolt',
    name: TASK_NAMES[TASK_KIND.BOLT],
    subtitle: 'continuous torque, misalignment tolerance',
    blurb: 'Drive an M8 bolt six turns into a bracket. The TRUNC shaft turns it continuously while the compliant structure swallows the radial offset — the paper\'s headline torque-transmission demo.',
    spec: { ...taskPreset(TASK_KIND.BOLT, anchor, axis), pitch: 0.00125, turnsRequired: 6, clearance: 0.0006, friction: 0.14, torqueLimit: 1.4, forceLimit: 40 },
    fixture: { kind: FIXTURE.BRACKET, size: V3.new(0.16, 0.02, 0.16), color: 0.55 },
    part: { kind: 'bolt', size: 0.008, length: 0.05 },
    metrics: ['depthMm', 'turns', 'loadTorque', 'misalignMm'],
  };
}

function bulbScenario() {
  // socket in a panel that faces the arm, 1.3 mm ladder residual
  const axis = V3.norm(V3.new(-0.3680, 0.4634, 0.8061));
  const anchor = V3.new(-0.1151, 0.5771, 0.2527);
  return {
    id: 'bulb',
    name: TASK_NAMES[TASK_KIND.BULB],
    subtitle: 'fragile torque window',
    blurb: 'Thread a lamp into its socket until it lights. Torque must stay under 0.35 N·m or the glass cracks; the compliant joint keeps the contact force low while the shaft keeps turning.',
    spec: { ...taskPreset(TASK_KIND.BULB, anchor, axis), turnsRequired: 2.4, torqueLimit: 0.35, forceLimit: 12 },
    fixture: { kind: FIXTURE.LAMP, size: V3.new(0.07, 0.05, 0.07), color: 0.85 },
    part: { kind: 'bulb', size: 0.03, length: 0.07 },
    metrics: ['turns', 'loadTorque', 'peakForceN', 'safety'],
  };
}

function valveScenario() {
  // valve stem on a riser, 0.4 mm ladder residual
  const axis = V3.norm(V3.new(-0.6686, 0.5476, -0.5032));
  const anchor = V3.new(-0.2207, 0.5979, -0.1588);
  return {
    id: 'valve',
    name: TASK_NAMES[TASK_KIND.VALVE],
    subtitle: 'multi-turn rotation while bent',
    blurb: 'Close a gate valve: five full turns against stiction and rising friction, with the arm held bent. Soft robots stall here; the TRUNC transmits the turns through the bend.',
    spec: { ...taskPreset(TASK_KIND.VALVE, anchor, axis), turnsRequired: 5, stiction: 0.45, torqueLimit: 1.6, forceLimit: 60 },
    fixture: { kind: FIXTURE.VALVE_BODY, size: V3.new(0.09, 0.06, 0.09), color: 0.42 },
    part: { kind: 'valve', size: 0.045, length: 0.05 },
    metrics: ['turns', 'opening', 'loadTorque', 'peakForceN'],
  };
}

function pegScenario() {
  // plate normal on a post, 0.8 mm ladder residual
  const axis = V3.norm(V3.new(0.2183, 0.4525, -0.8647));
  const anchor = V3.new(0.0579, 0.5837, -0.2739);
  return {
    id: 'peg',
    name: TASK_NAMES[TASK_KIND.PEG],
    subtitle: 'human in the loop',
    blurb: 'Insert a peg while a human pushes on the tool. The compliance absorbs the disturbance, the force stays under the safety threshold, and the insertion still completes.',
    // the peg is pushed, not threaded: one actuation turn = one insertion step,
    // and the 30 mm stroke stays inside the arm's 31 mm of smooth axial travel
    spec: { ...taskPreset(TASK_KIND.PEG, anchor, axis), pitch: 0.01, turnsRequired: 3, disturbance: 1.6, forceLimit: 30 },
    fixture: { kind: FIXTURE.PLATE, size: V3.new(0.14, 0.015, 0.14), color: 0.6 },
    part: { kind: 'peg', size: 0.006, length: 0.045 },
    metrics: ['depthMm', 'peakForceN', 'safety', 'absorbedMm'],
    human: true,
  };
}

/** Multi-stage capstone: three jobs back to back, one shared controller. */
function assemblyScenario() {
  const bolt = boltScenario();
  const valve = valveScenario();
  const bulb = bulbScenario();
  return {
    id: 'assembly',
    name: 'multi-stage assembly',
    subtitle: 'peg → bolt → valve → bulb, one policy',
    blurb: 'A full work cycle: align and insert, then fasten, then turn a valve, then install a bulb. The transformer policy sequences all four stages from the same conditioning vector — the "complex task" case.',
    spec: bolt.spec,
    stages: [pegScenario(), bolt, valve, bulb],
    fixture: bolt.fixture,
    part: bolt.part,
    metrics: ['turns', 'loadTorque', 'peakForceN', 'safety'],
  };
}

export const TASK_LIBRARY = [boltScenario(), bulbScenario(), valveScenario(), pegScenario(), assemblyScenario()];

export function scenarioById(id) {
  return TASK_LIBRARY.find((s) => s.id === id) ?? TASK_LIBRARY[0];
}

/** Stage list for a scenario (single-stage scenarios return a one-element list). */
/** World-space mount of a scenario's fixture: anchor + outward part axis. */
export function mountOf(scenario) {
  const spec = scenario?.spec;
  return spec ? { anchor: spec.anchor, axis: V3.norm(spec.axis) } : null;
}

export function stagesOf(scenario) {
  return scenario.stages ?? [scenario];
}

/** Human-readable objective string for the HUD. */
export function objectiveOf(scenario, stageIndex = 0) {
  const stages = stagesOf(scenario);
  const s = stages[Math.min(stageIndex, stages.length - 1)];
  return s ? `${s.name} — ${s.subtitle}` : scenario.name;
}

/** Cheap procedural “workbench” geometry description used by the renderer. */
export function benchLayout() {
  return {
    // the parts sit on risers so the arm can curl up to them; the anchors all
    // live between y = 0.594 and 0.644 and |r| = 0.18–0.28 (docs/design.md)
    size: { x: 1.15, y: 0.035, z: 0.95 },
    center: V3.new(0, 0.3825, 0),
    top: 0.40,
    color: 0.3,
    gridLines: 24,
    gridSpacing: 0.1,
  };
}

export { TASK_KIND, TASK_NAMES };
