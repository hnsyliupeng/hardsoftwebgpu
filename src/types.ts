// Shared contracts for the Bioinspired123D-WASM multi-harness pipeline.
// Units: millimetres (mm), mm^3 for volume, mm^2 for area, unless a field says otherwise.

export type Topology = "tubular" | "helical" | "cellular" | "lattice" | "tpms" | "hybrid" | "program";

export type LatticeType = "sc" | "bcc" | "fcc" | "fbcc" | "diamond";
export type TpmsType = "gyroid" | "schwarz_p" | "schwarz_d";

export type HeterogeneityRule = "uniform" | "linear" | "sin" | "parabola" | "expr";
export type Axis = "x" | "y" | "z";

export interface HeterogeneityField {
  /** Thickness / radius profile rule (LatticeQuery heterogeneous_lattice rules). */
  rule: HeterogeneityRule;
  /** Direction along which thickness varies. */
  direction: Axis;
  /** Minimum thickness (mm) or strut radius (mm). For `uniform`, min === max. */
  min: number;
  max: number;
  /** For rule `expr`: thickness(u) expression in u in [0,1] (see src/expr/expr.ts); clamped to [min,max]. */
  expression?: string;
}

export interface TargetMetrics {
  /** Upper bound on solid volume fraction (solid volume / bounding volume). */
  volume_fraction_max?: number;
  /** Required minimum wall / strut thickness (mm). */
  min_wall_thickness_mm?: number;
  /** Require a single connected solid. */
  connectivity?: boolean;
  /** Expected handle count (first Betti number), if the user stated one. */
  genus?: number;
  /** Target solid porosity (void fraction, 0..1) for lattice / TPMS designs. */
  porosity?: number;
}

export interface DesignConstraints {
  /** Edge length of the cubic build volume (mm). */
  size_mm: number;
  /** Printability floor used by the RepairHarness (mm). */
  min_printable_wall_mm: number;
  /** Voxel grid resolution per axis used by the SDF path (validation). */
  resolution: number;
}

export interface RetrievalHit {
  id: string;
  score: number;
}

export interface Evidence {
  /** Fully reproducible parameter set (family, variant and numbers). */
  reproducible_params: Record<string, unknown>;
  /** Human-readable implicit / SDF expression used by the SDF path. */
  sdf_expression?: string;
  /** Short code snippet that reproduces the geometry kernel call. */
  code_snippet?: string;
  /** Reference to the upstream source that the formula / base code comes from. */
  source_refs?: string[];
  [key: string]: unknown;
}

/** Every harness returns its payload plus these four mandatory fields. */
export interface HarnessReport {
  observations: string[];
  limitations: string[];
  unknowns: string[];
  evidence: Evidence;
}

export interface HarnessResult<T> extends HarnessReport {
  harness: string;
  ok: boolean;
  data: T;
}

export interface DesignSpec {
  topology: Topology;
  /** Feature program (topology "program" only): the parametric timeline executed by GeometryHarness. */
  program?: import("./program/types.ts").FeatureProgram;
  bio_motif: string;
  family: string;
  variant: string;
  parameters: Record<string, number | string | boolean>;
  heterogeneity_field: HeterogeneityField | null;
  target_metrics: TargetMetrics;
  constraints: DesignConstraints;
  retrieval: { base_id: string; top_k: RetrievalHit[] };
  confidence: number;
  unknowns: string[];
  notes: string[];
}

export interface DesignMetrics {
  volume: number;
  surface_area: number;
  min_wall_thickness: number;
  connectivity: boolean;
  genus: number;
  center_of_mass: [number, number, number];
  // Extra, non-mandatory metrics (kept separate from the mandatory five).
  volume_source: "brep-exact" | "sdf-mesh";
  volume_fraction: number;
  /** Absolute minimum of the ray chords (mm); can be set by a single junction sample. */
  min_wall_thickness_absolute: number;
  min_wall_thickness_median: number;
  components: number;
  cavities: number;
  euler_characteristic: number;
  triangles: number;
  bbox_mm: [[number, number, number], [number, number, number]];
  brep_vs_sdf_volume_rel_err: number | null;
  preview_coverage: number;
  /** Measured porosity (1 - volume fraction); equals 1 - volume_fraction. */
  porosity: number;
}

export interface RepairStep {
  round: number;
  trigger: string;
  action: string;
  parameter: string;
  from: number;
  to: number;
  before: Partial<DesignMetrics>;
  after: Partial<DesignMetrics>;
  accepted: boolean;
}

/** The mandatory DesignState output (see the task specification). */
export interface DesignState {
  prompt: string;
  design_spec: DesignSpec;
  code: string;
  metrics: {
    volume: number;
    surface_area: number;
    min_wall_thickness: number;
    connectivity: boolean;
    genus: number;
  };
  render_preview: string;
  repair_history: RepairStep[];
  limitations: string[];
  unknowns: string[];
}

export interface MeshData {
  positions: Float32Array; // xyz triples, mm
  normals: Float32Array; // xyz triples
  indices: Uint32Array; // triangle list
}
