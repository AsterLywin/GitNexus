import * as vscode from "vscode";
import { RebaseAction, RebasePlanItem, serializeRebaseTodo } from "./rebasePlan";

export interface RebasePlannerResult {
  todo: string;
}

export class RebasePlannerPanel {
  static async open(items: RebasePlanItem[]): Promise<RebasePlannerResult | undefined> {
    const panel = vscode.window.createWebviewPanel(
      "gitnexusRebasePlanner",
      "GitNexus — Interactive Rebase",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const nonce = String(Date.now());
    panel.webview.html = html(panel.webview.cspSource, nonce, items);

    return new Promise(resolve => {
      let finished = false;

      const dispose = () => {
        if (!finished) resolve(undefined);
        panel.dispose();
      };

      panel.webview.onDidReceiveMessage(message => {
        if (message.type === "cancel") {
          finished = true;
          resolve(undefined);
          panel.dispose();
          return;
        }

        if (message.type === "apply") {
          const plan = (message.items as RebasePlanItem[]).map((item, index) => ({
            ...item,
            originalIndex: index
          }));
          try {
            const todo = serializeRebaseTodo(plan);
            finished = true;
            resolve({ todo });
            panel.dispose();
          } catch (error) {
            panel.webview.postMessage({
              type: "error",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      });

      panel.onDidDispose(dispose);
    });
  }
}

function html(cspSource: string, nonce: string, items: RebasePlanItem[]): string {
  const safe = JSON.stringify(items).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta charset="UTF-8">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
.toolbar { display:flex; gap:8px; margin-bottom:12px; position:sticky; top:0; background:var(--vscode-editor-background); padding-bottom:10px; }
button, select { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:0; padding:6px 10px; }
#list { display:flex; flex-direction:column; gap:6px; }
.row { display:grid; grid-template-columns: 34px 120px 100px 1fr; align-items:center; gap:8px; padding:8px; border:1px solid var(--vscode-panel-border); border-radius:4px; }
.row.dragging { opacity:.5; }
.handle { cursor:grab; color:var(--vscode-descriptionForeground); }
.commit { font-family:var(--vscode-editor-font-family); }
.subject { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#error { color:var(--vscode-errorForeground); min-height:20px; margin-bottom:8px; }
</style>
</head>
<body>
<h2>Interactive Rebase</h2>
<div class="toolbar">
<button id="apply">Apply Rebase Plan</button>
<button id="cancel">Cancel</button>
</div>
<div id="error"></div>
<div id="list"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let items = ${safe};
let dragged = null;

function render() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "row";
    row.draggable = true;
    row.dataset.index = String(index);
    row.innerHTML =
      '<span class="handle">☷</span>' +
      '<select class="action">' +
      ["pick","reword","edit","squash","fixup","drop"].map(a =>
        '<option value="' + a + '"' + (a === item.action ? ' selected' : '') + '>' + a + '</option>'
      ).join("") +
      '</select>' +
      '<span class="commit">' + item.commit.slice(0, 10) + '</span>' +
      '<span class="subject"></span>';
    row.querySelector(".subject").textContent = item.subject;
    row.querySelector(".action").addEventListener("change", e => {
      item.action = e.target.value;
      clearError();
    });
    row.addEventListener("dragstart", () => { dragged = index; row.classList.add("dragging"); });
    row.addEventListener("dragend", () => { dragged = null; row.classList.remove("dragging"); });
    row.addEventListener("dragover", e => e.preventDefault());
    row.addEventListener("drop", e => {
      e.preventDefault();
      const target = index;
      if (dragged === null || dragged === target) return;
      const moved = items.splice(dragged, 1)[0];
      items.splice(target, 0, moved);
      render();
    });
    list.appendChild(row);
  });
}

function clearError() { document.getElementById("error").textContent = ""; }

document.getElementById("apply").onclick = () => {
  clearError();
  vscode.postMessage({ type: "apply", items });
};
document.getElementById("cancel").onclick = () => vscode.postMessage({ type: "cancel" });

window.addEventListener("message", event => {
  if (event.data.type === "error") document.getElementById("error").textContent = event.data.message;
});

render();
</script>
</body>
</html>`;
}
