// UI controller: prompt -> worker pipeline -> metrics, repair history, code, exports, viewer.

import { createViewer, type Viewer } from "./viewer.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const promptEl = $<HTMLTextAreaElement>("prompt");
const runBtn = $<HTMLButtonElement>("run");
const statusEl = $<HTMLDivElement>("status");
const backendEl = $<HTMLSpanElement>("backend");
const previewImg = $<HTMLImageElement>("preview");
const metricsEl = $<HTMLTableElement>("metrics");
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
  return String(v);
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
    ["topology", s.design_spec.topology],
    ["bio motif", s.design_spec.bio_motif],
    ["compute time (ms)", msg.ms],
  ];
  for (const [k, v] of rows) {
    const tr = metricsEl.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = fmt(v);
  }

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
  previewImg.src = s.render_preview;

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
  // A canvas can only hold one context type: replace it with a fresh element for each attempt,
  // looked up from the DOM because the previous element has been removed.
  const old = document.getElementById("view") as HTMLCanvasElement;
  const fresh = old.cloneNode(false) as HTMLCanvasElement;
  old.replaceWith(fresh);
  viewer = await createViewer(fresh, mesh);
  backendEl.textContent = viewer.backend === "cpu" ? "CPU (preview image only)" : viewer.backend === "webgpu" ? "WebGPU" : "WebGL2";
  fresh.style.display = viewer.backend === "cpu" ? "none" : "block";
  previewImg.style.display = viewer.backend === "cpu" ? "block" : "none";
}

runBtn.addEventListener("click", () => {
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  runBtn.disabled = true;
  statusEl.textContent = "Running IntentHarness → TopologyHarness → GeometryHarness → ValidationHarness → RepairHarness → ExportHarness …";
  const w = getWorker();
  w.onmessage = async (ev: MessageEvent) => {
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
    prompt,
    sizeMm: Number(sizeEl.value) || undefined,
    resolution: Number(resEl.value) || undefined,
    maxRepairRounds: Number(repairsEl.value),
  });
});

document.querySelectorAll<HTMLButtonElement>("button.example").forEach((b) =>
  b.addEventListener("click", () => {
    promptEl.value = b.dataset.prompt ?? "";
  }),
);
backendEl.textContent = "detecting…";
