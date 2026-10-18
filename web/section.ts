// Section and measurement panel (D3 viewer UI). Cuts the displayed mesh with an axis-aligned plane and
// draws the section outline on a 2D canvas, with the enclosed area and basic measurements.
// Geometry comes from src/geometry (tested in tests/section.test.ts); this file only wires the DOM.

import { sectionSegments, sectionArea, type Axis } from "../src/geometry/section.ts";
import { measure, type Measurements } from "../src/geometry/measure.ts";
import type { MeshData } from "../src/types.ts";

export interface SectionView {
  segments: Float64Array;
  count: number;
  area: number;
  /** In-plane axis indices [a, b] and their extents (min, max) from the mesh bounding box. */
  inPlane: [number, number];
  extent: [[number, number], [number, number]];
}

/** Pure part of the panel: the section of a mesh at a plane, with the in-plane frame for drawing. */
export function sectionView(mesh: Pick<MeshData, "positions" | "indices">, axis: Axis, offset: number, bbox: Measurements["bbox"]): SectionView {
  const sec = sectionSegments(mesh, axis, offset);
  const [a, b] = sec.inPlane;
  return {
    segments: sec.segments,
    count: sec.count,
    area: sectionArea(sec),
    inPlane: [a, b],
    extent: [
      [bbox.min[a], bbox.max[a]],
      [bbox.min[b], bbox.max[b]],
    ],
  };
}

/** Map a section to canvas pixels (y axis flipped so that the in-plane b axis points up). */
export function toCanvas(v: SectionView, width: number, height: number, margin = 16): { x: (u: number) => number; y: (w: number) => number } {
  const [[a0, a1], [b0, b1]] = v.extent;
  const span = Math.max(a1 - a0, b1 - b0) || 1;
  const scale = (Math.min(width, height) - 2 * margin) / span;
  const offA = (width - (a1 - a0) * scale) / 2;
  const offB = (height - (b1 - b0) * scale) / 2;
  return {
    x: (u: number) => offA + (u - a0) * scale,
    y: (w: number) => height - (offB + (w - b0) * scale),
  };
}

export interface SectionPanel {
  setMesh(mesh: MeshData | null): void;
}

/** DOM wiring for the section panel. Expects the elements added to web/index.html. */
export function initSectionPanel(doc: Document = document): SectionPanel {
  const axisEl = doc.getElementById("secAxis") as HTMLSelectElement | null;
  const offEl = doc.getElementById("secOffset") as HTMLInputElement | null;
  const offValEl = doc.getElementById("secOffsetVal") as HTMLElement | null;
  const canvas = doc.getElementById("secCanvas") as HTMLCanvasElement | null;
  const tableEl = doc.getElementById("measureTable") as HTMLTableElement | null;
  if (!axisEl || !offEl || !offValEl || !canvas || !tableEl) return { setMesh: () => {} };
  const ctx = canvas.getContext("2d");

  let mesh: MeshData | null = null;
  let meas: Measurements | null = null;
  let pending = false;

  const axisNames = ["x", "y", "z"];

  const draw = () => {
    pending = false;
    if (!mesh || !meas || !ctx) return;
    const axis = Number(axisEl.value) as Axis;
    const offset = Number(offEl.value);
    offValEl.textContent = `${axisNames[axis]} = ${offset.toFixed(2)} mm`;
    const v = sectionView(mesh, axis, offset, meas.bbox);
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    const px = toCanvas(v, W, H);
    ctx.strokeStyle = "#2b5797";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < v.count; k++) {
      const s = v.segments;
      ctx.moveTo(px.x(s[4 * k]), px.y(s[4 * k + 1]));
      ctx.lineTo(px.x(s[4 * k + 2]), px.y(s[4 * k + 3]));
    }
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.font = "12px sans-serif";
    const [a, b] = v.inPlane;
    ctx.fillText(`${axisNames[a]} →`, W - 40, H - 6);
    ctx.fillText(`${axisNames[b]} ↑`, 4, 14);
    const rows: [string, string][] = [
      ["section area", `${v.area.toFixed(2)} mm²`],
      ["section outline segments", String(v.count)],
      ["surface area", `${meas.surfaceAreaMm2.toFixed(1)} mm²`],
      ["volume (divergence theorem)", `${meas.volumeMm3.toFixed(1)} mm³`],
      ["bounding box", meas.bbox.min.map((x, i) => `${(meas!.bbox.max[i] - x).toFixed(2)}`).join(" × ") + " mm"],
      ["triangles", meas.triangles.toLocaleString("en-US")],
    ];
    tableEl.innerHTML = rows.map(([k, val]) => `<tr><td>${k}</td><td>${val}</td></tr>`).join("");
  };

  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  };

  axisEl.addEventListener("change", () => {
    if (!meas) return;
    const axis = Number(axisEl.value);
    offEl.min = String(meas.bbox.min[axis]);
    offEl.max = String(meas.bbox.max[axis]);
    offEl.step = String((meas.bbox.max[axis] - meas.bbox.min[axis]) / 1000);
    offEl.value = String((meas.bbox.min[axis] + meas.bbox.max[axis]) / 2);
    schedule();
  });
  offEl.addEventListener("input", schedule);

  return {
    setMesh(next) {
      mesh = next;
      if (!next) {
        meas = null;
        tableEl.innerHTML = "";
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      meas = measure(next);
      axisEl.dispatchEvent(new Event("change"));
    },
  };
}
