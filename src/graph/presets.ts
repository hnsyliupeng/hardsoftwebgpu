// Preset save / load (task B2): structure graphs as JSON files, validated on both sides.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { validateGraph, type StructureGraph } from "./graph.ts";

export function savePreset(path: string, g: StructureGraph): void {
  const issues = validateGraph(g);
  if (issues.length) throw new Error(`savePreset rejected: ${issues.map((i) => i.code).join(", ")}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(g, null, 2) + "\n");
}

export function loadPreset(path: string): StructureGraph {
  const g = JSON.parse(readFileSync(path, "utf8")) as StructureGraph;
  const issues = validateGraph(g);
  if (issues.length) throw new Error(`${path}: ${issues.map((i) => i.code + ":" + i.message).join("; ")}`);
  return g;
}
