// IntentHarness: natural language (English or Chinese) -> strict DesignSpec.
// Deterministic rules + local retrieval, no LLM and no network. Every default and every
// ambiguity is recorded as an explicit unknown so that the user can confirm it.

import { BIO_CATALOG, getBase, resolveParams, type BaseEntry } from "../bio/catalog.ts";
import { retrieve } from "./retrieval.ts";
import { makeHeterogeneity } from "../topology/heterogeneous.ts";
import { extractProfileExpression } from "../expr/expr.ts";
import type {
  Axis,
  DesignSpec,
  HarnessResult,
  HeterogeneityRule,
  LatticeType,
  TargetMetrics,
  Topology,
  TpmsType,
} from "../types.ts";

export const DEFAULT_SIZE_MM = 20;
export const DEFAULT_MIN_WALL_MM = 0.4;
export const DEFAULT_RESOLUTION = 96;

const num = (s: string | undefined): number | undefined => (s === undefined ? undefined : Number(s));

function normalise(prompt: string): string {
  return prompt
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\uFF0C/g, ",")
    .replace(/\u00B0/g, " deg ")
    .toLowerCase();
}

function firstIndex(text: string, re: RegExp): number {
  const m = re.exec(text);
  return m ? m.index : Infinity;
}

const RE = {
  tpms: /\btpms\b|triply[- ]periodic|periodic minimal|gyroid|schwarz|neovius|\biwp\b|lidinoid|fischer[ _-]?koch|split[ _-]?p\b|schoen|minimal surface|螺旋曲面|三周期|极小曲面/,
  lattice: /lattice|点阵|晶格|\bbcc\b|\bfcc\b|\bfbcc\b|\bbccz\b|kelvin|tetrakaidecahedr|simple[- ]cubic|\bsc\b|金刚石/,  // 'strut' alone is not a lattice cue: bio prompts say 'struts' (rectangular / thick struts)
  helical: /helic|bouligand|螺旋|twist|\bply\b|\bplies\b/,
  cellular: /cellular|foam|voronoi|honeycomb|蜂窝|泡沫|sandwich|夹层|三明治/,
  tubular: /tubul|\btubes?\b|\bholes?\b|\bpores?\b|channel|管|孔/,
  hetero: /heterogen|graded|gradient|gradually|varying|variable|non-?uniform|渐变|梯度|异构|变化/,
};

type Family = "helical" | "cellular" | "tubular";

function variantFor(category: Family, text: string): string {
  if (category === "helical") {
    if (/rect|bar|square|方形|矩形/.test(text)) return "helical_rectfibers";
    if (/cylind|round fib|圆柱|圆形/.test(text)) return "helical_cylinfibers";
    if (/noise|noisy|random|irregular|噪声|随机|不规则/.test(text)) return "helical_noise";
    return "helical_generic";
  }
  if (category === "cellular") {
    const sand = /sandwich|skin|slab|夹层|三明治|面板/.test(text);
    const smooth = /smooth|rounded|平滑|圆角|光滑/.test(text);
    if (sand && smooth) return "cellular_vorosand";
    if (sand) return "cellular_sandwich";
    if (smooth) return "cellular_voronoi";
    return "cellular_generic";
  }
  if (/cortical|cortex|layer|sleeve|皮质|皮层|外层/.test(text)) return "tubular_layers";
  if (/ellip|椭圆|shape|size|radius|varying/.test(text)) return "tubular_shapesize";
  if (/noise|noisy|random|scatter|jitter|噪声|随机/.test(text)) return "tubular_noise";
  return "tubular_generic";
}

function latticeVariant(text: string): LatticeType | null {
  if (/fbcc/.test(text)) return "fbcc";
  if (/\bbcc\b|body[- ]centered/.test(text)) return "bcc";
  if (/\bfcc\b|face[- ]centered/.test(text)) return "fcc";
  if (/simple[- ]cubic|\bsc\b|cubic lattice|立方/.test(text)) return "sc";
  if (/diamond|金刚石/.test(text)) return "diamond";
  if (/kelvin|tetrakaidecahedr|truncated octahedr|开尔文/.test(text)) return "kelvin";
  if (/\bbccz\b|bcc[- ]?z\b|vertical reinforc/.test(text)) return "bccz";
  return null;
}

function tpmsVariant(text: string): TpmsType | null {
  if (/gyroid|螺旋曲面/.test(text)) return "gyroid";
  if (/schwarz[ _-]?p\b|schwarz p|primitive/.test(text)) return "schwarz_p";
  if (/schwarz[ _-]?d\b|schwarz d|diamond (surface|tpms)/.test(text)) return "schwarz_d";
  if (/neovius/.test(text)) return "neovius";
  if (/\biwp\b|i-?wp|wrapped surface/.test(text)) return "iwp";
  if (/lidinoid/.test(text)) return "lidinoid";
  if (/fischer[ _-]?koch/.test(text)) return "fischer_koch_s";
  if (/split[ _-]?p\b|schoen/.test(text)) return "split_p";
  return null;
}

/** Angles that describe the ply rotation, skipping whole-object transforms ("rotate it by 45 degrees around Z"). */
function plyAngles(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(?:degrees?|deg\b)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    const after = text.slice(m.index, m.index + 40);
    const generic = /rotate|rotated|around|about|lay it|stretch|scale|tilt/.test(before) && !/per (layer|ply)|each (layer|ply)|between/.test(after);
    if (!generic) out.push(Number(m[1]));
  }
  return out;
}

function sizeMm(text: string): number | undefined {
  const m =
    /(\d+(?:\.\d+)?)\s*mm\s*(?:cube|edge|side|box|build|volume|wide)/.exec(text) ??
    /(?:size|edge length|cube size|side length|build volume)[^0-9]{0,15}(\d+(?:\.\d+)?)\s*mm/.exec(text);
  return m ? num(m[1]) : undefined;
}

export function parseIntent(prompt: string): HarnessResult<DesignSpec> {
  const text = normalise(prompt);
  const unknowns: string[] = [];
  const notes: string[] = [];
  const observations: string[] = [];
  const limitations: string[] = [
    "IntentHarness is rule-based (keywords, numbers, retrieval); it is not an LLM and handles paraphrases only where the keyword rules cover them.",
    "General whole-object transforms (rotate / stretch / scale the final part) are detected but not applied.",
  ];

  // ---- family detection ---------------------------------------------------------------------
  const bioFamilies = (["helical", "tubular", "cellular"] as Family[])
    .map((f) => ({ f, at: firstIndex(text, RE[f]) }))
    .filter((x) => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at);
  const hasLattice = RE.lattice.test(text);
  const hasTpms = RE.tpms.test(text);

  let topology: Topology;
  let variant = "";
  let bioCategory: Family | null = bioFamilies[0]?.f ?? null;
  let bioMotif = "";
  let confidence = 0.3;
  let notRecognised = false;

  if (hasTpms && !(hasLattice && bioFamilies.length)) {
    topology = "tpms";
    const v = tpmsVariant(text);
    variant = v ?? "gyroid";
    if (!v) unknowns.push("TPMS type not stated; defaulting to gyroid.");
    confidence = 0.75 + (v ? 0.1 : 0);
    bioCategory = null;
    if (bioFamilies.length) notes.push("Bioinspired family mentioned together with TPMS; it is ignored in this version.");
  } else if (hasLattice && bioFamilies.length) {
    topology = "hybrid";
    variant = `lattice:${latticeVariant(text) ?? "bcc"}`;
    if (!latticeVariant(text)) unknowns.push("Lattice type not stated; defaulting to BCC for the hybrid.");
    confidence = 0.6;
  } else if (hasLattice) {
    topology = "lattice";
    const v = latticeVariant(text);
    variant = v ?? "bcc";
    if (!v) unknowns.push("Lattice type not stated; defaulting to BCC.");
    confidence = 0.75 + (v ? 0.1 : 0);
    bioCategory = null;
  } else if (bioFamilies.length) {
    topology = bioFamilies[0].f;
    confidence = 0.7;
    if (bioFamilies.length > 1) {
      notes.push(`Multiple bioinspired families mentioned (${bioFamilies.map((b) => b.f).join(", ")}); only ${bioFamilies[0].f} is generated (multi-family union not supported).`);
      unknowns.push(`Secondary family (${bioFamilies.slice(1).map((b) => b.f).join(", ")}) ignored; confirm whether a union is intended.`);
    }
    bioMotif = variantFor(bioFamilies[0].f, text);
  } else {
    // No structure keyword (bioinspired family, lattice or TPMS). Do not force a biological family: the nearest
    // catalogue entry is only reported as evidence. A default BCC lattice is the placeholder, and ok is false.
    notRecognised = true;
    topology = "lattice";
    variant = "bcc";
    confidence = 0.1;
    unknowns.push("No structure keyword recognised (bioinspired family, lattice or TPMS). A default BCC lattice placeholder is shown; describe the structure to get a real design.");
  }

  // ---- retrieval -----------------------------------------------------------------------------
  const retrievalCategory = bioCategory ?? undefined;
  const top_k = retrieve(prompt, retrievalCategory).slice(0, 3);
  if (topology === "helical" || topology === "tubular" || topology === "cellular" || topology === "hybrid") {
    if (!bioMotif) {
      const cat = (topology === "hybrid" ? "cellular" : topology) as Family;
      bioMotif = topology === "hybrid" ? "cellular_generic" : variantFor(cat, text);
    }
  }
  if (topology === "hybrid") {
    bioMotif = variantFor((bioFamilies[0]?.f ?? "cellular") as Family, text);
  }
  const baseEntry: BaseEntry | null = bioMotif && BIO_CATALOG.some((b) => b.id === bioMotif) ? getBase(bioMotif) : null;

  // ---- numeric parameters --------------------------------------------------------------------
  const size = sizeMm(text);
  const size_mm = size ?? DEFAULT_SIZE_MM;
  if (size === undefined) unknowns.push(`Build edge length not given; ${DEFAULT_SIZE_MM} mm cube assumed.`);
  const minWall = (() => {
    const m = /(?:min(?:imum)?\s*)?(?:wall|strut|feature)\s*(?:thickness|size)[^0-9]{0,20}(\d+(?:\.\d+)?)\s*mm/.exec(text);
    return m ? num(m[1])! : undefined;
  })();
  const printable = (() => {
    const m = /printab\w*[^0-9]{0,20}(\d+(?:\.\d+)?)\s*mm/.exec(text);
    return m ? num(m[1])! : DEFAULT_MIN_WALL_MM;
  })();
  if (printable === DEFAULT_MIN_WALL_MM && !/printab/.test(text)) unknowns.push(`Printability floor not given; ${DEFAULT_MIN_WALL_MM} mm assumed for the RepairHarness.`);

  const parameters: Record<string, number | string | boolean> = {};
  let heterogeneity_field: DesignSpec["heterogeneity_field"] = null;
  const target: TargetMetrics = { connectivity: !/disconnected|allow (?:the )?disconnect/.test(text) };

  const porosity = /porosity[^0-9]{0,20}(\d+(?:\.\d+)?)\s*%/.exec(text);
  const volFrac = /volume fraction[^0-9]{0,20}(\d+(?:\.\d+)?)\s*%/.exec(text);
  if (porosity) target.porosity = Number(porosity[1]) / 100;
  if (volFrac) target.volume_fraction_max = Number(volFrac[1]) / 100;
  if (minWall !== undefined) target.min_wall_thickness_mm = minWall;
  const genus = /genus[^0-9]{0,10}(\d+)/.exec(text);
  if (genus) target.genus = Number(genus[1]);

  if (topology === "helical" || topology === "tubular" || topology === "cellular" || topology === "hybrid") {
    const base = baseEntry ?? getBase(bioMotif || "cellular_generic");
    const requested: Record<string, number | undefined> = {};
    if (base.category === "helical") {
      const m = /(\d+)\s*(?:-\s*)?(?:layers?|plies|ply|层)\b/.exec(text);
      if (m) requested.num_plies = Number(m[1]);
      const angles = plyAngles(text);
      if (angles.length) requested.rotation = angles[0];
      if (base.id === "helical_noise") {
        const n = /noise[^0-9]{0,20}(\d+(?:\.\d+)?)/.exec(text);
        if (n) requested.noise = Number(n[1]);
        else if (angles.length > 1) requested.noise = angles[1];
      }
    }
    if (base.category === "tubular") {
      const m = /(\d+)\s*(?:tubules?|tubes?|holes?|pores?|channels?|孔|管)/.exec(text);
      if (m) requested.num_tubules = Number(m[1]);
      const e = /ellipti\w*[^0-9]{0,20}(\d+(?:\.\d+)?)/.exec(text);
      if (e) requested.ellipticity = Number(e[1]);
      const r = /radius[^0-9]{0,20}(\d+(?:\.\d+)?)/.exec(text);
      if (r) requested.radius = Number(r[1]);
      const t = /(?:layer|cortical|cortex|sleeve)\s*thickness[^0-9]{0,20}(\d+(?:\.\d+)?)|thickness[^0-9]{0,20}(\d+(?:\.\d+)?)/.exec(text);
      if (t) requested.thickness = Number(t[1] ?? t[2]);
      const n = /noise[^0-9]{0,20}(\d+(?:\.\d+)?)/.exec(text);
      if (n) requested.noise = Number(n[1]);
    }
    if (base.category === "cellular") {
      const t = /thickness[^0-9]{0,20}(\d+(?:\.\d+)?)/.exec(text);
      if (t) requested.thickness = Number(t[1]);
      const s = /smooth\w*[^0-9]{0,20}(\d+)/.exec(text);
      if (s) requested.smoothlevel = Number(s[1]);
      const sk = /(?:skin|sandwich|face)\s*(?:thickness|size)?[^0-9]{0,15}(\d+(?:\.\d+)?)/.exec(text);
      if (sk) requested.size = Number(sk[1]);
    }
    const resolved = resolveParams(base.id, requested);
    for (const [k, v] of Object.entries(resolved.values)) parameters[k] = v;
    for (const c of resolved.clamped) notes.push(`Requested ${c} (clamped to the benchmark range).`);
    for (const d of resolved.defaulted) unknowns.push(`Parameter ${d} not stated; default ${resolved.values[d]} used.`);
    if (!baseEntry && topology !== "hybrid") {
      unknowns.push(`Bioinspired base structure not determined; ${base.id} used.`);
    }
    variant = topology === "hybrid" ? variant : base.id;
    bioMotif = base.id;
    observations.push(`Bioinspired base ${base.id}: ${base.description}.`);
  }
  if (topology === "lattice" || topology === "tpms" || topology === "hybrid") {
    // lattice / tpms (and the lattice half of a hybrid): parameters in millimetres.
    const cell =
      /(\d+(?:\.\d+)?)\s*mm\s*(?:unit\s*)?cells?\b/.exec(text) ??
      /(?:unit cell|cell size|cell|period)\s*(?:of|=|:|is)?\s*(\d+(?:\.\d+)?)\s*mm/.exec(text);
    if (cell) parameters.cell_size_mm = Number(cell[1]);
    else unknowns.push("Unit cell size not given; 4 mm assumed.");
    const rad =
      /(\d+(?:\.\d+)?)\s*mm\s*(?:strut\s*)?radius/.exec(text) ??
      /(?:strut\s*)?radius\s*(?:of|=|:|is)?\s*(\d+(?:\.\d+)?)\s*mm/.exec(text);
    const dia = /diameter[^0-9]{0,20}(\d+(?:\.\d+)?)\s*mm/.exec(text);
    const wall = /(?:wall|sheet|shell)\s*thickness[^0-9]{0,20}(\d+(?:\.\d+)?)\s*mm|thickness[^0-9]{0,20}(\d+(?:\.\d+)?)\s*mm/.exec(text);
    if (topology === "lattice" || topology === "hybrid") {
      if (rad) parameters.strut_radius_mm = Number(rad[1]);
      else if (dia) parameters.strut_radius_mm = Number(dia[1]) / 2;
      else unknowns.push("Strut radius not given; 10% of the cell size assumed.");
    }
    if (topology === "tpms") {
      if (wall) parameters.wall_thickness_mm = Number(wall[1] ?? wall[2]);
      else unknowns.push("TPMS wall thickness not given; 12% of the period assumed.");
    }
    // A user-stated profile law `thickness(u) = expr` (u = normalised position along the axis).
    let exprText: string | undefined;
    const extracted = extractProfileExpression(text);
    if (extracted) {
      exprText = extracted.expr;
      if (extracted.rest) unknowns.push(`Heterogeneity expression stops at "${exprText}"; trailing text "${extracted.rest}" ignored.`);
    } else if (/(?:thickness|radius)\s*\(\s*u\s*\)\s*=/.test(text)) {
      unknowns.push("Heterogeneity expression could not be parsed; a preset profile is used instead.");
    }
    if (RE.hetero.test(text) || exprText || /sin\b|sinus|parabol/.test(text)) {
      let rule: HeterogeneityRule = exprText ? "expr" : "linear";
      if (exprText) observations.push(`Heterogeneity law: thickness(u) = ${exprText} (u in [0,1] along the axis, clamped to the min..max range).`);
      else if (/parabol/.test(text)) rule = "parabola";
      else if (/\bsin|sinus/.test(text)) rule = "sin";
      const dm = /(?:along|in|on) (?:the )?(x|y|z)\b|(?:沿|沿着)\s*(x|y|z)/.exec(text);
      const direction: Axis = (dm ? (dm[1] ?? dm[2]) : "z") as Axis;
      if (!dm) unknowns.push("Heterogeneity direction not stated; z assumed.");
      const range = /(\d+(?:\.\d+)?)\s*mm?\s*(?:to|-|–|→)\s*(\d+(?:\.\d+)?)\s*mm/.exec(text);
      const isStrut = topology !== "tpms";
      const baseVal = isStrut ? (parameters.strut_radius_mm as number | undefined) : (parameters.wall_thickness_mm as number | undefined);
      const fallbackBase = baseVal ?? ((parameters.cell_size_mm as number | undefined) ?? 4) * (isStrut ? 0.1 : 0.12);
      let min = range ? Number(range[1]) : fallbackBase * 0.6;
      let max = range ? Number(range[2]) : fallbackBase * 1.4;
      if (!range) unknowns.push(`Heterogeneity range not stated; ${min.toFixed(3)}-${max.toFixed(3)} mm assumed around the base value.`);
      heterogeneity_field = makeHeterogeneity(rule, direction, min, max, exprText);
      observations.push(`Heterogeneous profile: ${rule} along ${direction}, ${min.toFixed(3)}..${max.toFixed(3)} mm.`);
    }
    if (topology !== "hybrid") bioMotif = `${topology}:${variant}`;
    if (RE.hetero.test(text) && !heterogeneity_field) unknowns.push("Heterogeneity mentioned but no profile resolved.");
  }

  // ---- final assembly ------------------------------------------------------------------------
  if (confidence < 0.5) {
    unknowns.push("Low intent confidence: please confirm the topology.");
  }
  const family = topology === "lattice" || topology === "tpms" || topology === "hybrid" ? topology : (getBase(bioMotif || "helical_generic").category);
  const spec: DesignSpec = {
    topology,
    bio_motif: bioMotif,
    family,
    variant,
    parameters: { ...parameters, seed: 42 },
    heterogeneity_field,
    target_metrics: target,
    constraints: {
      size_mm,
      min_printable_wall_mm: printable,
      resolution: DEFAULT_RESOLUTION,
    },
    retrieval: { base_id: notRecognised ? "none" : top_k[0]?.id ?? bioMotif, top_k },
    confidence: Math.min(0.95, Math.round(confidence * 100) / 100),
    unknowns: [...new Set(unknowns)],
    notes,
  };
  observations.unshift(`Topology ${topology}${variant ? ` / ${variant}` : ""} (confidence ${spec.confidence}).`);
  return {
    harness: "IntentHarness",
    ok: !notRecognised,
    data: spec,
    observations,
    limitations,
    unknowns: spec.unknowns,
    evidence: {
      reproducible_params: { prompt, topology, variant, bio_motif: bioMotif, parameters: spec.parameters, size_mm },
      matched_families: bioFamilies.map((b) => b.f),
      lattice_matched: hasLattice,
      tpms_matched: hasTpms,
      retrieval_top_k: top_k,
      source_refs: ["Bioinspired123D eval/benchmark.csv (prompt templates)", "Bioinspired123D data/raw/biodataset_basecodes.csv (base structures)"],
    },
  };
}
