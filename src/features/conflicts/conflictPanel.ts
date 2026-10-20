import * as vscode from "vscode";
import * as path from "node:path";
import { ConflictFile, ConflictService } from "./conflictService";

export class ConflictPanel {
  static async open(root: string, service: ConflictService): Promise<void> {
    const conflicts = await service.list(root);
    const panel = vscode.window.createWebviewPanel(
      "gitnexusConflicts",
      "GitNexus — Conflicts",
      vscode.ViewColumn.Active,
      { enableScripts: true }
    );

    panel.webview.html = html(panel.webview.cspSource, conflicts);

    panel.webview.onDidReceiveMessage(async (message: { type: string; path?: string; side?: "ours" | "theirs" }) => {
      try {
        if (message.type === "open") {
          const uri = vscode.Uri.file(path.join(root, message.path ?? ""));
          await vscode.window.showTextDocument(uri, { preview: false });
        }
        if (message.type === "side") {
          await service.checkoutSide(root, message.path ?? "", message.side ?? "ours");
          vscode.window.showInformationMessage(`GitNexus: ${message.side} version selected for ${message.path}`);
        }
        if (message.type === "stage") {
          await service.stage(root, message.path ?? "");
          vscode.window.showInformationMessage(`GitNexus: staged ${message.path}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });
  }
}

function html(cspSource: string, conflicts: ConflictFile[]): string {
  const safe = JSON.stringify(conflicts).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { font-family: var(--vscode-font-family); padding:16px; color:var(--vscode-foreground); }
.item { border:1px solid var(--vscode-panel-border); padding:10px; margin:8px 0; border-radius:4px; }
button { margin-right:6px; padding:5px 9px; }
.path { font-family:var(--vscode-editor-font-family); margin-bottom:8px; }
</style>
</head>
<body>
<h2>Conflicts (${conflicts.length})</h2>
<div id="root"></div>
<script>
const vscode = acquireVsCodeApi();
const conflicts = ${safe};
const root = document.getElementById("root");
conflicts.forEach(c => {
  const div = document.createElement("div");
  div.className = "item";
  const path = document.createElement("div");
  path.className = "path";
  path.textContent = c.path;
  div.appendChild(path);

  [["Open","open"],["Use Ours","ours"],["Use Theirs","theirs"],["Stage","stage"]].forEach(([label,type]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => vscode.postMessage({ type: type === "ours" || type === "theirs" ? "side" : type, path:c.path, side:type });
    div.appendChild(b);
  });
  root.appendChild(div);
});
</script>
</body>
</html>`;
}
