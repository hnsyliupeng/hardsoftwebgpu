// RepairHarness: iterates (max 5 rounds) against ValidationHarness feedback.
// Priority: (1) design parameters (strut radius, wall thickness, bio thickness),
//           (2) topology parameters (number of plies),
//           (3) code structure  -- not automated; reported as a limitation when reached.
// Every attempt is kept in repair_history, accepted or rejected, with before/after metrics.

import { getBase } from "../bio/catalog.ts";
import { evaluateSpec, type Evaluation } from "../evaluate.ts";
import type { DesignSpec, HarnessResult, RepairStep } from "../types.ts";
import { scaleWallThickness } from "../program/index.ts";

/** Tolerance on the porosity target (absolute void fraction). */
export const POROSITY_TOLERANCE = 0.02;

export const MAX_REPAIR_ROUNDS = 5;

export interface RepairOutcome {
  spec: DesignSpec;
  evaluation: Evaluation;
  history: RepairStep[];
  stopReason: string;
  rounds: number;
}

type Issue = { kind: "connectivity" | "min_wall" | "volume" | "porosity"; trigger: string };

interface Action {
  parameter: string;
  from: number;
  to: number;
  action: string;
  priority: 1 | 2;
  /** Scale factor applied to heterogeneity min/max when the parameter is a radius/thickness. */
  scalesHetero: boolean;
}

function diagnose(ev: Evaluation): Issue[] {
  const m = ev.validation.data.metrics;
  const floor = ev.spec.constraints.min_printable_wall_mm;
  const issues: Issue[] = [];
  if (!m.connectivity) issues.push({ kind: "connectivity", trigger: `${m.components} solid components (need 1)` });
  if (m.min_wall_thickness < floor)
    issues.push({ kind: "min_wall", trigger: `min wall ${m.min_wall_thickness.toFixed(3)} mm < floor ${floor} mm` });
  const vmax = ev.spec.target_metrics.volume_fraction_max;
  if (vmax !== undefined && m.volume_fraction > vmax)
    issues.push({ kind: "volume", trigger: `volume fraction ${m.volume_fraction.toFixed(3)} > target ${vmax}` });
  const pt = ev.spec.target_metrics.porosity;
  if (pt !== undefined && Math.abs(m.porosity - pt) > POROSITY_TOLERANCE)
    issues.push({
      kind: "porosity",
      trigger: `porosity ${m.porosity.toFixed(3)} differs from target ${pt.toFixed(3)} by more than ${POROSITY_TOLERANCE}`,
    });
  return issues;
}

function num(spec: DesignSpec, key: string, fallback: number): number {
  const v = spec.parameters[key];
  return typeof v === "number" ? v : fallback;
}

function proposeAction(issue: Issue, ev: Evaluation): Action | null {
  const spec = ev.spec;
  const floor = spec.constraints.min_printable_wall_mm;
  const minWall = Math.max(1e-6, ev.validation.data.metrics.min_wall_thickness);
  const grow = issue.kind === "connectivity" ? 1.15 : Math.min(1.6, Math.max(1.05, (floor / minWall) * 1.05));
  const shrink = 0.9;
  const isLattice = spec.topology === "lattice" || spec.topology === "hybrid";
  const isTpms = spec.topology === "tpms";
  const cell = num(spec, "cell_size_mm", 4);

  if (issue.kind === "porosity") {
    // Porosity: void fraction = 1 - solid fraction. Solid fraction scales ~ r^2 for struts, ~ t for sheets.
    const target = spec.target_metrics.porosity ?? 0;
    const solid = Math.max(1e-6, ev.validation.data.metrics.volume_fraction);
    const need = 1 - target;
    if (isLattice) {
      const from = num(spec, "strut_radius_mm", 0.1 * cell);
      const k = Math.min(1.25, Math.max(0.8, Math.sqrt(need / solid)));
      const to = Math.min(0.45 * cell, from * k);
      if (to === from) return null;
      return { parameter: "strut_radius_mm", from, to, action: `porosity target ${target}: scale strut radius x${(to / from).toFixed(3)} (cap 0.45 cell)`, priority: 1, scalesHetero: true };
    }
    if (isTpms) {
      const from = num(spec, "wall_thickness_mm", 0.12 * cell);
      const k = Math.min(1.25, Math.max(0.8, need / solid));
      const to = Math.min(0.45 * cell, from * k);
      if (to === from) return null;
      return { parameter: "wall_thickness_mm", from, to, action: `porosity target ${target}: scale sheet thickness x${(to / from).toFixed(3)} (cap 0.45 period)`, priority: 1, scalesHetero: true };
    }
    return null;
  }
  if (spec.topology === "program") {
    if (issue.kind !== "min_wall") return null;
    const prog = spec.program!;
    const probe = scaleWallThickness(prog, grow);
    if (!probe) return null;
    // Scale factor semantics: from = 1, to = grow (applied to the op's thickness expression / value).
    return { parameter: `ops.${probe.opId}.thickness`, from: 1, to: grow, action: `scale wall thickness of op ${probe.opId} x${grow.toFixed(3)}`, priority: 1, scalesHetero: false };
  }

  // Lattice and hybrid: the strut radius is the thickening parameter (hybrid bio part is left fixed).
  if (isLattice) {
    const from = num(spec, "strut_radius_mm", 0.1 * cell);
    const factor = issue.kind === "volume" ? shrink : grow;
    const cap = 0.45 * cell;
    const to = Math.min(cap, from * factor);
    if (to === from) return null;
    return { parameter: "strut_radius_mm", from, to, action: `scale strut radius x${(to / from).toFixed(3)} (cap 0.45 cell)`, priority: 1, scalesHetero: true };
  }
  if (isTpms) {
    const from = num(spec, "wall_thickness_mm", 0.12 * cell);
    const factor = issue.kind === "volume" ? shrink : grow;
    const to = Math.min(0.45 * cell, from * factor);
    if (to === from) return null;
    return { parameter: "wall_thickness_mm", from, to, action: `scale sheet thickness x${(to / from).toFixed(3)} (cap 0.45 period)`, priority: 1, scalesHetero: true };
  }
  if (spec.topology === "cellular") {
    const range = getBase(spec.bio_motif).params.thickness;
    if (range) {
      const from = num(spec, "thickness", range.default);
      const factor = issue.kind === "volume" ? shrink : grow;
      const to = Math.min(range.max, Math.max(range.min, from * factor));
      if (to !== from) return { parameter: "thickness", from, to, action: `scale base thickness x${(to / from).toFixed(3)} (catalog range ${range.min}-${range.max})`, priority: 1, scalesHetero: false };
    }
  }
  if (spec.topology === "helical" && issue.kind !== "volume") {
    const from = num(spec, "num_plies", 10);
    const to = Math.max(5, from - 1);
    if (to !== from) return { parameter: "num_plies", from, to, action: "fewer, thicker plies (topology parameter)", priority: 2, scalesHetero: false };
  }
  return null;
}

function metricSubset(ev: Evaluation): Partial<import("../types.ts").DesignMetrics> {
  const m = ev.validation.data.metrics;
  return {
    volume: m.volume,
    min_wall_thickness: m.min_wall_thickness,
    connectivity: m.connectivity,
    genus: m.genus,
    components: m.components,
    volume_fraction: m.volume_fraction,
    porosity: m.porosity,
  };
}

function improved(kind: Issue["kind"], before: Evaluation, after: Evaluation): boolean {
  const a = after.validation.data.metrics;
  const b = before.validation.data.metrics;
  if (a.components > b.components) return false; // never trade a fix for a split
  if (kind === "connectivity") return a.components < b.components || (a.connectivity && !b.connectivity);
  if (kind === "min_wall") return a.min_wall_thickness > b.min_wall_thickness + 1e-9;
  if (kind === "porosity") {
    const t = before.spec.target_metrics.porosity ?? 0;
    return Math.abs(a.porosity - t) < Math.abs(b.porosity - t) - 1e-9;
  }
  return a.volume_fraction < b.volume_fraction - 1e-9;
}

export async function repairDesign(initial: Evaluation, maxRounds = MAX_REPAIR_ROUNDS): Promise<HarnessResult<RepairOutcome>> {
  const observations: string[] = [];
  const limitations: string[] = [];
  const unknowns: string[] = [];
  const history: RepairStep[] = [];
  let ev = initial;
  let stopReason = "";
  let rounds = 0;

  for (let round = 1; ; round++) {
    const issues = diagnose(ev);
    if (issues.length === 0) {
      stopReason = rounds === 0 ? "no repair needed: all checks pass" : "all checks pass after repair";
      break;
    }
    if (round > maxRounds) {
      stopReason = `round limit (${maxRounds}) reached with open issues: ${issues.map((i) => i.trigger).join("; ")}`;
      break;
    }
    const issue = issues[0];
    const action = proposeAction(issue, ev);
    if (!action) {
      stopReason = `no automatic parameter for "${issue.trigger}" (${ev.spec.topology}); needs user input or code-structure change`;
      unknowns.push(stopReason);
      break;
    }
    const candidate = structuredClone(ev.spec);
    if (candidate.topology === "program" && candidate.program) {
      const k = action.to / action.from;
      const scaled = scaleWallThickness(candidate.program, k)!;
      candidate.program = scaled.program;
    } else {
      candidate.parameters[action.parameter] = action.to;
    }
    if (action.scalesHetero && candidate.heterogeneity_field) {
      const k = action.to / action.from;
      const het = candidate.heterogeneity_field;
      het.min *= k;
      het.max *= k;
      // A user law thickness(u)=expr is scaled as a whole so that the profile keeps its shape.
      if (het.expression) het.expression = `(${het.expression}) * ${k}`;
    }
    const next = await evaluateSpec(candidate);
    const ok = improved(issue.kind, ev, next);
    rounds = round;
    history.push({
      round,
      trigger: issue.trigger,
      action: action.action,
      parameter: action.parameter,
      from: action.from,
      to: action.to,
      before: metricSubset(ev),
      after: metricSubset(next),
      accepted: ok,
    });
    if (!ok) {
      stopReason = `repair of ${action.parameter} did not improve "${issue.kind}" or split the solid; reverted`;
      unknowns.push(stopReason);
      break;
    }
    ev = next;
  }
  if (history.length === 0) observations.push("No repair attempts were required.");
  else observations.push(`${history.length} repair attempt(s), ${history.filter((h) => h.accepted).length} accepted. Stop: ${stopReason}`);
  limitations.push(`Repair is capped at ${maxRounds} rounds and runs one parameter change per round (greedy, no search).`);
  limitations.push("Repairs act on the SDF/B-Rep parameters; they do not change the code structure (priority 3 is not automated).");
  if (ev.spec.topology === "program") limitations.push("Program repair: only the first shell / graded_shell thickness is adjusted (priority 1); other ops are not changed.");
  if (ev.spec.topology === "tpms") limitations.push("TPMS: the absolute chord minimum is junction-dominated and does not track thickness, so repairs use the 5th-percentile wall.");
  return {
    harness: "RepairHarness",
    ok: diagnose(ev).length === 0,
    data: { spec: ev.spec, evaluation: ev, history, stopReason, rounds },
    observations,
    limitations,
    unknowns,
    evidence: {
      reproducible_params: { family: ev.spec.family, variant: ev.spec.variant, parameters: ev.spec.parameters, heterogeneity_field: ev.spec.heterogeneity_field },
      priority_order: ["design parameters (min wall, porosity, volume)", "topology parameters", "code structure (manual)"],
      history_length: history.length,
    },
  };
}
