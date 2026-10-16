// UI controller: prompt or feature program (JSON) -> worker pipeline -> metrics, timeline,
// repair history, code, exports, viewer. `?backend=cpu|webgl2|webgpu` forces a renderer
// (the CPU preview is always available and needs no GPU).

import { createViewer, type Backend, type Viewer } from "./viewer.ts";
import { EXAMPLE_PROGRAMS } from "../src/program/index.ts";
import { loadCoupled, timelineRows, type CoupledBundle } from "./coupled.ts";
import { initGraphPanel } from "./graphPanel.ts";

const COUPLED_DIR = "examples/coupled_bio_lattice/";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const promptEl = $<HTMLTextAreaElement>("prompt");
const programEl = $<HTMLTextAreaElement>("programJson");
const runBtn = $<HTMLButtonElement>("run");
const statusEl = $<HTMLDivElement>("status");
const backendEl = $<HTMLSpanElement>("backend");
const backendSel = $<HTMLSelectElement>("backendSel");
const previewImg = $<HTMLImageElement>("preview");
const metricsEl = $<HTMLTableElement>("metrics");
const timelineEl = $<HTMLDivElement>("timeline");
const repairEl = $<HTMLDivElement>("repair");
const limitsEl = $<HTMLUListElement>("limits");
const unknownsEl = $<HTMLUListElement>("unknowns");
const codeEl = $<HTMLPreElement>("code");
const downloadsEl = $<HTMLDivElement>("downloads");
const stateEl = $<HTMLPreElement>("state");
const sizeEl = $<HTMLInputElement>("size");
const resEl = $<HTMLSelectElement>("resolution");
const repairsEl = $<HTMLInputElement>("repairs");

let viewer: Viewer | null = null;
let worker: Worker | null = null;

const forced = new URLSearchParams(location.search).get("backend") as Backend | null;
if (forced) backendSel.value = forced;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  return worker;
}

function li(parent: HTMLElement, text: string): void {
  const el = document.createElement("li");
  el.textContent = text;
  parent.appendChild(el);
}

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toPrecision(5);
  if (Array.isArray(v)) return `[${v.map((x) => fmt(x)).join(", ")}]`;
  if (v === null || v === undefined) return "—";
  return String(v);
}

function renderTimeline(steps: any[] | null): void {
  timelineEl.innerHTML = "";
  if (!steps || steps.length === 0) {
    timelineEl.textContent = "No timeline (prompt mode or the B-Rep kernel was not used).";
    return;
  }
  const t = document.createElement("table");
  t.innerHTML = "<tr><th>op</th><th>type</th><th>volume (mm³)</th><th>area (mm²)</th><th>ms</th><th>status / note</th></tr>";
  for (const s of steps) {
    const tr = t.insertRow();
    [s.id, s.op, fmt(s.volume), fmt(s.area), String(s.ms), s.ok ? s.note || "ok" : `ERROR: ${s.error}`].forEach((x) => (tr.insertCell().textContent = x));
  }
  timelineEl.appendChild(t);
}

function renderResult(msg: any): void {
  const s = msg.state;
  const m = s.metrics;
  metricsEl.innerHTML = "";
  const rows: [string, unknown][] = [
    ["volume (mm³)", m.volume],
    ["surface area (mm²)", m.surface_area],
    ["min wall thickness (mm)", m.min_wall_thickness],
    ["connectivity", m.connectivity],
    ["genus", m.genus],
    ["porosity (1 − volume fraction of bounding box)", msg.porosity],
    ["B-Rep vs SDF volume error", msg.crossCheck === null ? "n/a (no exact B-Rep)" : `${(msg.crossCheck * 100).toFixed(2)} %`],
    ["topology", s.design_spec.topology],
    ["bio motif / variant", `${s.design_spec.bio_motif || "—"} / ${s.design_spec.variant}`],
    ["compute time (ms)", msg.ms],
  ];
  for (const [k, v] of rows) {
    const tr = metricsEl.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = fmt(v);
  }

  renderTimeline(msg.timeline);

  repairEl.innerHTML = "";
  if (!s.repair_history.length) repairEl.textContent = "No repair needed (or none possible).";
  else {
    const t = document.createElement("table");
    t.innerHTML = "<tr><th>round</th><th>trigger</th><th>action</th><th>from → to</th><th>min wall before → after</th><th>accepted</th></tr>";
    for (const h of s.repair_history) {
      const tr = t.insertRow();
      [String(h.round), h.trigger, h.action, `${fmt(h.from)} → ${fmt(h.to)}`, `${fmt(h.before.min_wall_thickness)} → ${fmt(h.after.min_wall_thickness)}`, String(h.accepted)].forEach((x) => (tr.insertCell().textContent = x));
    }
    repairEl.appendChild(t);
  }

  limitsEl.innerHTML = "";
  for (const x of s.limitations) li(limitsEl, x);
  unknownsEl.innerHTML = "";
  for (const x of s.unknowns) li(unknownsEl, x);

  codeEl.textContent = msg.code;
  stateEl.textContent = JSON.stringify(s, null, 2);
  previewImg.src = msg.snapshot ?? s.render_preview;

  downloadsEl.innerHTML = "";
  for (const item of msg.manifest as { name: string; bytes: number }[]) {
    const data = msg.files[item.name];
    const blob = new Blob([data], { type: item.name.endsWith(".json") ? "application/json" : "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = item.name;
    a.textContent = `${item.name} (${(item.bytes / 1024).toFixed(1)} KiB)`;
    downloadsEl.appendChild(a);
    downloadsEl.appendChild(document.createElement("br"));
  }
}

async function showViewer(mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array }): Promise<void> {
  viewer?.destroy();
  // A canvas can only hold one context type: replace it with a fresh element for each attempt.
  const old = document.getElementById("view") as HTMLCanvasElement;
  const fresh = old.cloneNode(false) as HTMLCanvasElement;
  old.replaceWith(fresh);
  const choice = (backendSel.value || undefined) as Backend | undefined;
  viewer = await createViewer(fresh, mesh, choice);
  backendEl.textContent = viewer.backend === "cpu" ? "CPU (software render, no GPU)" : viewer.backend === "webgpu" ? "WebGPU" : "WebGL2";
  fresh.style.display = viewer.backend === "cpu" ? "none" : "block";
}

type Mode = "prompt" | "program" | "coupled";

function setMode(mode: Mode): void {
  const isProgram = mode === "program";
  const isCoupled = mode === "coupled";
  promptEl.style.display = mode === "prompt" ? "block" : "none";
  programEl.style.display = isProgram ? "block" : "none";
  $<HTMLDivElement>("programExamples").style.display = isProgram ? "flex" : "none";
  $<HTMLDivElement>("coupledInfo").style.display = isCoupled ? "block" : "none";
  if (isProgram && !programEl.value.trim()) programEl.value = JSON.stringify(EXAMPLE_PROGRAMS.rounded_hollow_box, null, 2);
}

document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((r) =>
  r.addEventListener("change", () => setMode(r.value as Mode)),
);

function renderCoupled(b: CoupledBundle): void {
  const d = b.design;
  const m = d.metrics_detail;
  const v = b.verify;
  metricsEl.innerHTML = "";
  const rows: [string, unknown][] = [
    ["volume (mm³)", m.volume],
    ["surface area (mm²)", m.surface_area],
    ["centre of mass (mm)", m.center_of_mass],
    ["bounding box (mm)", m.bbox_mm],
    ["min wall thickness (mm), B-Rep proxy", m.min_wall_thickness],
    ["connectivity (solids)", m.connectivity ? 1 : "not 1"],
    ["genus, outer boundary", m.genus],
    ["internal voids (enclosed lattice gaps)", `${m.internal_void_count} (genus ${JSON.stringify(m.internal_void_genera)})`],
    ["porosity (1 − V / envelope)", m.porosity],
    ["L0 envelope / L1 skin / L2 core volume (mm³)", `${m.levels.L0_envelope_volume} / ${m.levels.L1_skin_volume} / ${m.levels.L2_lattice_core_volume}`],
    ["skin ∩ core overlap (mm³)", m.levels.overlap_skin_core],
    ["analytic face fraction (B-Rep)", m.analytic_face_fraction],
    ["lattice", `${d.design_spec.parameters.lattice.topology} · cell ${d.design_spec.parameters.lattice.cell} mm · twist ${d.design_spec.parameters.lattice.twist_deg_per_mm} °/mm`],
    ["struts per radius tier", `${JSON.stringify(b.design.lattice.struts_per_tier)} (radii ${JSON.stringify(b.design.lattice.tier_radii_mm)} mm)`],
    ["STEP re-import: solids / volume error", `${v.step.reimported_solids} / ${v.step.volume_rel_error}`],
    ["STEP editable B-Rep (no shell-based model)", String(v.step.editable_brep_ok)],
    ["STEP analytic faces (cylinder / plane)", JSON.stringify(v.step.reimported_face_types)],
    ["mesh: triangles / watertight", `${v.mesh.triangles} / ${v.mesh.watertight}`],
    ["verification pass", String(v.pass)],
    ["build time (s, offline)", d.timing_s.build],
  ];
  for (const [k, val] of rows) {
    const tr = metricsEl.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = fmt(val);
  }
  renderTimeline(timelineRows(b.timeline));
  repairEl.innerHTML = "Single parametric build; no repair rounds (the CadQuery build is deterministic from the spec).";
  limitsEl.innerHTML = "";
  for (const x of d.limitations) li(limitsEl, x);
  unknownsEl.innerHTML = "";
  for (const x of d.unknowns) li(unknownsEl, x);
  codeEl.textContent = b.code;
  stateEl.textContent = JSON.stringify(d, null, 2);
  previewImg.src = `${COUPLED_DIR}coupled_bio_lattice.png`;
  const links = $<HTMLDivElement>("coupledLinks");
  links.innerHTML = "";
  for (const [label, file] of [
    ["STEP (editable B-Rep, 48 MB)", "coupled_bio_lattice.step"],
    ["design.json", "design.json"],
    ["design_code.py", "design_code.py"],
    ["verify.json", "verify.json"],
    ["timeline.json", "timeline.json"],
  ]) {
    const a = document.createElement("a");
    a.href = `${COUPLED_DIR}${file}`;
    a.download = file;
    a.textContent = label;
    a.style.marginRight = "12px";
    links.appendChild(a);
  }
  downloadsEl.innerHTML = "";
  for (const [label, file] of [
    ["coupled_bio_lattice.step", "coupled_bio_lattice.step"],
    ["design.json", "design.json"],
    ["design_code.py", "design_code.py"],
  ]) {
    const a = document.createElement("a");
    a.href = `${COUPLED_DIR}${file}`;
    a.download = file;
    a.textContent = `${label}`;
    downloadsEl.appendChild(a);
    downloadsEl.appendChild(document.createElement("br"));
  }
}

let runToken = 0; // only the newest run may update the page (older worker results are dropped)

async function runCoupled(): Promise<void> {
  const token = ++runToken;
  runBtn.disabled = true;
  statusEl.textContent = "Loading the offline CadQuery build (OpenCASCADE B-Rep, high-res mesh) …";
  const t0 = performance.now();
  try {
    const bundle = await loadCoupled(COUPLED_DIR);
    if (token !== runToken) return;
    statusEl.textContent = `Loaded in ${Math.round(performance.now() - t0)} ms: ${bundle.meshTriangles} triangles. Verification pass: ${bundle.verify.pass}.`;
    renderCoupled(bundle);
    await showViewer(bundle.mesh);
  } catch (err) {
    if (token === runToken) statusEl.textContent = `Error: ${(err as Error).message}`;
  } finally {
    if (token === runToken) runBtn.disabled = false;
  }
}

runBtn.addEventListener("click", () => {
  const mode = (document.querySelector<HTMLInputElement>("input[name=mode]:checked")?.value ?? "prompt") as Mode;
  if (mode === "coupled") {
    void runCoupled();
    return;
  }
  const prompt = mode === "program" ? `feature program: ${programEl.value.length} characters of JSON` : promptEl.value.trim();
  if (!prompt && mode === "prompt") return;
  runBtn.disabled = true;
  statusEl.textContent = "Running IntentHarness → TopologyHarness → GeometryHarness → ValidationHarness → RepairHarness → ExportHarness …";
  const w = getWorker();
  const token = ++runToken;
  w.onmessage = async (ev: MessageEvent) => {
    if (token !== runToken) return; // superseded by a newer run (e.g. coupled mode was chosen)
    const msg = ev.data;
    runBtn.disabled = false;
    if (msg.type === "error") {
      statusEl.textContent = `Error: ${msg.message}`;
      return;
    }
    statusEl.textContent = `Done in ${msg.ms} ms. Repairs: ${msg.state.repair_history.length}.`;
    renderResult(msg);
    await showViewer(msg.mesh);
  };
  w.postMessage({
    type: "run",
    mode,
    prompt,
    programJson: programEl.value,
    sizeMm: Number(sizeEl.value) || undefined,
    resolution: Number(resEl.value) || undefined,
    maxRepairRounds: Number(repairsEl.value),
    minWallMm: Number((document.getElementById("minWall") as HTMLInputElement).value) || undefined,
  });
});

document.querySelectorAll<HTMLButtonElement>("button.example").forEach((b) =>
  b.addEventListener("click", () => {
    promptEl.value = b.dataset.prompt ?? "";
    const r = document.querySelector<HTMLInputElement>("input[name=mode][value=prompt]");
    if (r) {
      r.checked = true;
      setMode("prompt");
    }
  }),
);

document.querySelectorAll<HTMLButtonElement>("button.program").forEach((b) =>
  b.addEventListener("click", () => {
    const key = b.dataset.program as keyof typeof EXAMPLE_PROGRAMS;
    programEl.value = JSON.stringify(EXAMPLE_PROGRAMS[key], null, 2);
  }),
);

initGraphPanel();

backendEl.textContent = "detecting…";

// Show a model as soon as the page opens (the default prompt), instead of an empty viewer.
runBtn.click();
