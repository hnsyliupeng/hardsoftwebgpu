// Structure-graph editor panel (B2, D1). Renders GraphEditor state and parameter sliders; all rules
// live in src/graph/editor.ts and src/graph/params.ts. A slider commits on release (change event), so
// one drag is one undo step.
import { GraphEditor, STARTER_GRAPH } from "../src/graph/editor.ts";
import { paramSlots, setParam } from "../src/graph/params.ts";
import type { StructureGraph } from "../src/graph/graph.ts";

export function initGraphPanel(): void {
  const area = document.getElementById("graphJson") as HTMLTextAreaElement | null;
  if (!area) return;
  const status = document.getElementById("graphStatus") as HTMLElement;
  const expr = document.getElementById("graphExpr") as HTMLElement;
  const undoBtn = document.getElementById("graphUndo") as HTMLButtonElement;
  const redoBtn = document.getElementById("graphRedo") as HTMLButtonElement;
  const paramBox = document.getElementById("graphParams") as HTMLElement | null;

  const ed = new GraphEditor(STARTER_GRAPH);

  const renderParams = () => {
    if (!paramBox) return;
    const g = JSON.parse(ed.text) as StructureGraph;
    paramBox.replaceChildren();
    for (const s of paramSlots(g)) {
      const row = document.createElement("label");
      row.className = "param";
      const name = document.createElement("span");
      name.textContent = `${s.nodeId}.${s.field} `;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = s.integer ? "1" : String((s.max - s.min) / 200);
      input.value = String(s.value);
      const out = document.createElement("output");
      out.textContent = String(s.value);
      input.addEventListener("input", () => (out.textContent = input.value));
      input.addEventListener("change", () => {
        const cur = JSON.parse(ed.text) as StructureGraph;
        const r = setParam(cur, s.nodeId, s.field, Number(input.value));
        const applied = ed.apply(JSON.stringify(r.graph));
        if (applied.ok) {
          expr.textContent = applied.expr;
          refresh(`set ${s.nodeId}.${s.field} = ${r.value}`, true);
        } else {
          refresh(`rejected: ${applied.error}`, false);
          renderParams();
        }
      });
      row.append(name, input, out);
      paramBox.append(row);
    }
  };

  const refresh = (msg: string, ok: boolean) => {
    area.value = ed.text;
    undoBtn.disabled = !ed.canUndo;
    redoBtn.disabled = !ed.canRedo;
    status.textContent = msg;
    status.dataset.ok = ok ? "1" : "0";
    renderParams();
  };

  refresh("loaded starter graph", true);
  // Re-applying the current text is a no-op for history and returns the compiled expression.
  const first = ed.apply(ed.text);
  expr.textContent = first.ok ? first.expr : first.error;

  document.getElementById("graphApply")?.addEventListener("click", () => {
    const r = ed.apply(area.value);
    if (r.ok) {
      expr.textContent = r.expr;
      refresh(`applied (structure ${r.structure})`, true);
    } else {
      refresh(`rejected: ${r.error}`, false);
    }
  });
  undoBtn.addEventListener("click", () => {
    if (ed.undo()) refresh("undo", true);
  });
  redoBtn.addEventListener("click", () => {
    if (ed.redo()) refresh("redo", true);
  });
  document.getElementById("graphReset")?.addEventListener("click", () => {
    // Applied as an ordinary edit, so Undo returns to the previous graph.
    const r = ed.apply(JSON.stringify(STARTER_GRAPH));
    if (r.ok) {
      expr.textContent = r.expr;
      refresh("starter graph applied (undo returns to the previous graph)", true);
    }
  });
}
