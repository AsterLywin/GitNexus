import * as vscode from "vscode";
import * as path from "node:path";
import { ConflictFile, ConflictService } from "./conflictService";
import { StageDocumentProvider } from "./stageDocumentProvider";

interface ConflictMessage {
  type: string;
  path?: string;
  side?: "ours" | "theirs";
  stage?: 1 | 2 | 3;
}

/**
 * Conflict resolution panel: lists unmerged files with working-copy open,
 * a three-way view (base document + ours ↔ theirs diff), one-click
 * ours/theirs resolution, staging, and — when an operation is in
 * progress — continue / abort controls for it. The list re-renders after
 * every action so resolved files drop off immediately.
 */
export class ConflictPanel {
  private static current: ConflictPanel | undefined;

  static async open(root: string, service: ConflictService, operationLabel?: string): Promise<void> {
    if (this.current && this.current.root === root) {
      this.current.panel.reveal();
      await this.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "gitnexusConflicts",
      "GitNexus — Conflicts",
      vscode.ViewColumn.Active,
      { enableScripts: true }
    );
    const instance = new ConflictPanel(panel, root, service, operationLabel);
    this.current = instance;
    panel.onDidDispose(() => {
      if (this.current === instance) this.current = undefined;
    });
    await instance.refresh();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly root: string,
    private readonly service: ConflictService,
    private readonly operationLabel?: string
  ) {
    panel.webview.onDidReceiveMessage(message => this.handle(message as ConflictMessage));
  }

  private async refresh(): Promise<void> {
    const conflicts = await this.service.list(this.root);
    this.panel.webview.html = html(this.panel.webview.cspSource, conflicts, this.operationLabel);
  }

  private async handle(message: ConflictMessage): Promise<void> {
    const filePath = message.path ?? "";
    try {
      switch (message.type) {
        case "open": {
          const uri = vscode.Uri.file(path.join(this.root, filePath));
          await vscode.window.showTextDocument(uri, { preview: false });
          break;
        }
        case "viewStage": {
          const uri = StageDocumentProvider.uriFor(this.root, filePath, message.stage ?? 2);
          await vscode.window.showTextDocument(uri, { preview: true });
          break;
        }
        case "threeWay": {
          const ours = StageDocumentProvider.uriFor(this.root, filePath, 2);
          const theirs = StageDocumentProvider.uriFor(this.root, filePath, 3);
          const base = StageDocumentProvider.uriFor(this.root, filePath, 1);
          await vscode.commands.executeCommand("vscode.diff", ours, theirs, `${filePath} — Ours ↔ Theirs`);
          await vscode.window.showTextDocument(base, { preview: true, viewColumn: vscode.ViewColumn.Beside });
          break;
        }
        case "side": {
          await this.service.checkoutSide(this.root, filePath, message.side ?? "ours");
          vscode.window.showInformationMessage(`GitNexus: ${message.side} version selected for ${filePath}`);
          await this.refresh();
          break;
        }
        case "stage": {
          await this.service.stage(this.root, filePath);
          vscode.window.showInformationMessage(`GitNexus: staged ${filePath}`);
          await this.refresh();
          break;
        }
        case "opContinue":
          await vscode.commands.executeCommand("gitnexus.operationContinue");
          await this.refresh();
          break;
        case "opAbort":
          await vscode.commands.executeCommand("gitnexus.operationAbort");
          await this.refresh();
          break;
      }
    } catch (error) {
      vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }
}

function html(cspSource: string, conflicts: ConflictFile[], operationLabel?: string): string {
  const safe = JSON.stringify(conflicts).replace(/</g, "\\u003c");
  const banner = operationLabel
    ? `<div class="banner"><span>${escapeHtml(operationLabel)}</span>
         <button id="opContinue">Continue</button>
         <button id="opAbort">Abort</button></div>`
    : "";
  return `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { font-family: var(--vscode-font-family); padding:16px; color:var(--vscode-foreground); }
.item { border:1px solid var(--vscode-panel-border); padding:10px; margin:8px 0; border-radius:4px; }
button { margin-right:6px; padding:5px 9px; }
.path { font-family:var(--vscode-editor-font-family); margin-bottom:8px; }
.banner { display:flex; align-items:center; gap:10px; border:1px solid var(--vscode-editorWarning-foreground);
  padding:10px; margin:8px 0; border-radius:4px; }
</style>
</head>
<body>
<h2>Conflicts (${conflicts.length})</h2>
${banner}
<div id="root"></div>
<script>
const vscode = acquireVsCodeApi();
const conflicts = ${safe};
const root = document.getElementById("root");
const cont = document.getElementById("opContinue");
if (cont) cont.onclick = () => vscode.postMessage({ type: "opContinue" });
const ab = document.getElementById("opAbort");
if (ab) ab.onclick = () => vscode.postMessage({ type: "opAbort" });
conflicts.forEach(c => {
  const div = document.createElement("div");
  div.className = "item";
  const path = document.createElement("div");
  path.className = "path";
  path.textContent = c.path;
  div.appendChild(path);

  const actions = [
    ["Open", { type: "open" }],
    ["3-Way", { type: "threeWay" }],
    ["Base", { type: "viewStage", stage: 1 }],
    ["Ours", { type: "viewStage", stage: 2 }],
    ["Theirs", { type: "viewStage", stage: 3 }],
    ["Use Ours", { type: "side", side: "ours" }],
    ["Use Theirs", { type: "side", side: "theirs" }],
    ["Stage", { type: "stage" }]
  ];
  actions.forEach(([label, msg]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => vscode.postMessage({ path: c.path, ...msg });
    div.appendChild(b);
  });
  root.appendChild(div);
});
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[char]!));
}
