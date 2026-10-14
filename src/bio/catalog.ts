// The 12 bioinspired base structures of Bioinspired123D (lamm-mit/Bioinspired123D, Apache-2.0),
// re-expressed as parameterised descriptors. Parameter ranges and semantics come from the
// "Parameters" column and the Blender base codes of data/raw/biodataset_basecodes.csv.
// Units: the base frame is x,y in [-1, 1] and z in [0, 2] (the upstream "2-unit" cube).

export interface ParamSpec {
  default: number;
  min: number;
  max: number;
  integer?: boolean;
  unit: string;
  description: string;
}

export interface BaseEntry {
  id: string;
  category: "helical" | "cellular" | "tubular";
  subcategory: string;
  description: string;
  params: Record<string, ParamSpec>;
  keywords: string[];
  source: string;
}

export const BIO_CATALOG: BaseEntry[] = [
  {
    id: "helical_generic",
    category: "helical",
    subcategory: "generic",
    description: "stacked helical plate structure (Bouligand-like twisted plies)",
    params: {
      num_plies: { default: 10, min: 5, max: 15, integer: true, unit: "plies", description: "number of plies" },
      rotation: { default: 10, min: 3, max: 20, unit: "deg", description: "rotation between successive plies" },
    },
    keywords: ["helical", "helicoidal", "bouligand", "twisted", "ply", "plies", "layer", "layers", "stacked", "rotation", "螺旋", "旋转", "层", "堆叠", "薄层"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: helical_generic",
  },
  {
    id: "helical_rectfibers",
    category: "helical",
    subcategory: "rectfibers",
    description: "stacked helical structure made of rectangular fibers",
    params: {
      num_plies: { default: 10, min: 5, max: 15, integer: true, unit: "plies", description: "number of plies" },
      rotation: { default: 10, min: 3, max: 20, unit: "deg", description: "rotation between successive plies" },
    },
    keywords: ["helical", "bouligand", "rectangular", "rect", "fiber", "fibers", "fibre", "square", "bar", "bars", "矩形", "纤维", "方形"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: helical_rectfibers",
  },
  {
    id: "helical_cylinfibers",
    category: "helical",
    subcategory: "cylinfibers",
    description: "stacked helical structure made of cylindrical fibers",
    params: {
      num_plies: { default: 10, min: 5, max: 15, integer: true, unit: "plies", description: "number of plies" },
      rotation: { default: 10, min: 3, max: 20, unit: "deg", description: "rotation between successive plies" },
    },
    keywords: ["helical", "bouligand", "cylindrical", "cylinder", "cylinders", "round", "fiber", "fibers", "fibre", "圆柱", "圆形", "纤维"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: helical_cylinfibers",
  },
  {
    id: "helical_noise",
    category: "helical",
    subcategory: "noise",
    description: "stacked helical plate structure with induced noise in rotation",
    params: {
      num_plies: { default: 10, min: 5, max: 15, integer: true, unit: "plies", description: "number of plies" },
      rotation: { default: 10, min: 3, max: 20, unit: "deg", description: "rotation between successive plies" },
      noise: { default: 5, min: 3, max: 10, unit: "deg", description: "maximum random deviation of each ply rotation" },
    },
    keywords: ["helical", "twisted", "noise", "noisy", "random", "randomness", "irregular", "irregularity", "perturbed", "扰动", "噪声", "随机", "不规则"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: helical_noise",
  },
  {
    id: "cellular_generic",
    category: "cellular",
    subcategory: "generic",
    description: "cellular (Voronoi foam) structure",
    params: {
      thickness: { default: 0.2, min: 0.1, max: 0.3, unit: "base", description: "strut / wall thickness" },
    },
    keywords: ["cellular", "cell", "cells", "foam", "voronoi", "honeycomb", "porous", "lattice", "网状", "蜂窝", "泡沫", "多孔"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: cellular_generic",
  },
  {
    id: "cellular_voronoi",
    category: "cellular",
    subcategory: "voronoi",
    description: "cellular structure with smoothed edges",
    params: {
      thickness: { default: 0.2, min: 0.1, max: 0.3, unit: "base", description: "strut / wall thickness" },
      smoothlevel: { default: 3, min: 1, max: 6, integer: true, unit: "passes", description: "smoothing passes applied to the field" },
    },
    keywords: ["cellular", "voronoi", "foam", "smooth", "smoothed", "rounded", "smoothing", "soft", "平滑", "圆角", "光滑"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: cellular_voronoi",
  },
  {
    id: "cellular_sandwich",
    category: "cellular",
    subcategory: "sandwich",
    description: "sandwiched cellular structure",
    params: {
      thickness: { default: 0.2, min: 0.1, max: 0.3, unit: "base", description: "strut / wall thickness" },
      size: { default: 0.2, min: 0.05, max: 0.4, unit: "base", description: "thickness of the top and bottom sandwich skins" },
    },
    keywords: ["sandwich", "skin", "skins", "face", "faces", "slab", "slabs", "core", "cellular", "cell", "foam", "layered", "夹层", "三明治", "面板"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: cellular_sandwich",
  },
  {
    id: "cellular_vorosand",
    category: "cellular",
    subcategory: "vorosand",
    description: "sandwiched cellular structure with smooth edges",
    params: {
      thickness: { default: 0.2, min: 0.1, max: 0.3, unit: "base", description: "strut / wall thickness" },
      smoothlevel: { default: 3, min: 1, max: 6, integer: true, unit: "passes", description: "smoothing passes applied to the field" },
      size: { default: 0.2, min: 0.05, max: 0.4, unit: "base", description: "thickness of the top and bottom sandwich skins" },
    },
    keywords: ["sandwich", "cellular", "voronoi", "smooth", "smoothed", "rounded", "skin", "foam", "夹层", "平滑", "圆角"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: cellular_vorosand",
  },
  {
    id: "tubular_generic",
    category: "tubular",
    subcategory: "generic",
    description: "cube with grid of tubule holes",
    params: {
      num_tubules: { default: 16, min: 9, max: 25, integer: true, unit: "count", description: "number of tubules (grid)" },
    },
    keywords: ["tubular", "tubule", "tubules", "tube", "tubes", "hole", "holes", "pore", "pores", "channel", "channels", "grid", "管", "小管", "孔", "孔洞", "管状"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: tubular_generic",
  },
  {
    id: "tubular_shapesize",
    category: "tubular",
    subcategory: "shapesize",
    description: "cube with grid of tubule holes of varying shape and size",
    params: {
      num_tubules: { default: 16, min: 9, max: 25, integer: true, unit: "count", description: "number of tubules (grid)" },
      ellipticity: { default: 1.5, min: 1, max: 2, unit: "ratio", description: "x-stretch of each tubule (elliptical holes)" },
      radius: { default: 0.1, min: 0.05, max: 0.1, unit: "base", description: "base tubule radius" },
    },
    keywords: ["tubular", "tubule", "tube", "hole", "holes", "elliptical", "ellipse", "ellipticity", "shape", "size", "radius", "椭圆", "孔径", "管径", "形状"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: tubular_shapesize",
  },
  {
    id: "tubular_layers",
    category: "tubular",
    subcategory: "layers",
    description: "cube with grid of tubule holes, each hole with a cortical layer",
    params: {
      num_tubules: { default: 16, min: 9, max: 25, integer: true, unit: "count", description: "number of tubules (grid)" },
      thickness: { default: 0.04, min: 0.02, max: 0.08, unit: "base", description: "cortical layer thickness" },
    },
    keywords: ["tubular", "tubule", "tube", "cortical", "cortex", "layer", "layers", "sleeve", "shell", "ring", "皮质", "皮层", "外层", "分层"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: tubular_layers",
  },
  {
    id: "tubular_noise",
    category: "tubular",
    subcategory: "noise",
    description: "cube with grid of tubule holes, placement scattered by noise",
    params: {
      num_tubules: { default: 16, min: 9, max: 25, integer: true, unit: "count", description: "number of tubules (grid)" },
      noise: { default: 0.07, min: 0.05, max: 0.1, unit: "base", description: "maximum positional jitter of tubules" },
    },
    keywords: ["tubular", "tubule", "tube", "hole", "holes", "noise", "noisy", "random", "scattered", "jitter", "irregular", "随机", "噪声", "不规则"],
    source: "Bioinspired123D/data/raw/biodataset_basecodes.csv: tubular_noise",
  },
];

export function getBase(id: string): BaseEntry {
  const e = BIO_CATALOG.find((b) => b.id === id);
  if (!e) throw new RangeError(`unknown bioinspired base id: ${id}`);
  return e;
}

/** Clamp and round user-supplied numbers into the documented benchmark ranges. */
export function resolveParams(id: string, requested: Record<string, number | undefined>): {
  values: Record<string, number>;
  clamped: string[];
  defaulted: string[];
} {
  const entry = getBase(id);
  const values: Record<string, number> = {};
  const clamped: string[] = [];
  const defaulted: string[] = [];
  for (const [name, spec] of Object.entries(entry.params)) {
    let v = requested[name];
    if (v === undefined || !Number.isFinite(v)) {
      v = spec.default;
      defaulted.push(name);
    } else {
      if (spec.integer) v = Math.round(v);
      if (v < spec.min || v > spec.max) {
        clamped.push(`${name}=${v} -> ${Math.min(spec.max, Math.max(spec.min, v))}`);
        v = Math.min(spec.max, Math.max(spec.min, v));
      }
    }
    values[name] = v;
  }
  return { values, clamped, defaulted };
}
