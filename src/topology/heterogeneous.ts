// Heterogeneous thickness / radius profiles. Port of the rule set exposed by
// LatticeQuery's *_heterogeneous_lattice functions (linear | sin | parabola), expressed as
// pure functions of a normalised coordinate u in [0, 1].
//
// Deviation (documented in limitations): LatticeQuery's `sin` rule evaluates sin() on raw
// integer layer indices (radians). We use the normalised form sin(2*pi*u) so the profile is
// independent of the number of cells.

import type { HeterogeneityField, HeterogeneityRule } from "../types.ts";

export function heteroValue(rule: HeterogeneityRule, u: number, min: number, max: number): number {
  const t = Math.min(1, Math.max(0, u));
  switch (rule) {
    case "uniform":
      return min;
    case "linear":
      return min + (max - min) * t;
    case "sin":
      return (min + max) / 2 + 0.5 * (max - min) * Math.sin(2 * Math.PI * t);
    case "parabola":
      // LatticeQuery: frep = -4*d_max*(x-0.5)^2 + d_max + d_min  (peaks at d_min + d_max mid-way).
      return -4 * max * (t - 0.5) * (t - 0.5) + max + min;
    default: {
      const never: never = rule;
      throw new Error(`unknown heterogeneity rule ${String(never)}`);
    }
  }
}

/** Build a heterogeneity field from a spec; `uniform` ignores `direction`. */
export function makeHeterogeneity(
  rule: HeterogeneityRule,
  direction: "x" | "y" | "z",
  min: number,
  max: number,
): HeterogeneityField {
  if (min <= 0 || max <= 0) throw new RangeError("thickness/radius must be positive");
  if (rule === "uniform") return { rule, direction, min, max: min };
  return { rule, direction, min: Math.min(min, max), max: Math.max(min, max) };
}

/** Thickness/radius at a normalised position along the field direction (0..1). */
export function valueAt(field: HeterogeneityField, u: number): number {
  return heteroValue(field.rule, u, field.min, field.max);
}

/** Largest value the profile can take (used for search radii). */
export function maxValue(field: HeterogeneityField): number {
  if (field.rule === "parabola") return field.min + field.max;
  return field.max;
}
