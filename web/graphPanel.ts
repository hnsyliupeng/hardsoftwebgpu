// Structure-graph editor panel (B2). Renders GraphEditor state; all rules live in src/graph/editor.ts.
import { GraphEditor, STARTER_GRAPH } from "../src/graph/editor.ts";

export function initGraphPanel(): void {
  const area = document.getElementById("graphJson") as HTMLTextAreaElement | null;
  if (!area) return;
  const status = document.getElementById("graphStatus") as HTMLElement;
  const expr = document.getElementById("graphExpr") as HTMLElement;
  const undoBtn = document.getElementById("graphUndo") as HTMLButtonElement;
  const redoBtn = document.getElementById("graphRedo") as HTMLButtonElement;

  const ed = new GraphEditor(STARTER_GRAPH);
  const refresh = (msg: string, ok: boolean) => {
    area.value = ed.text;
    undoBtn.disabled = !ed.canUndo;
    redoBtn.disabled = !ed.canRedo;
    status.textContent = msg;
    status.dataset.ok = ok ? "1" : "0";
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
