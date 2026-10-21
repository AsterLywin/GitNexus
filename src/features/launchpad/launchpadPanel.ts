import * as vscode from "vscode";
import { LaunchpadItem } from "./launchpadModel";

export interface LaunchpadHandlers {
  /** Collect items across all known repositories. */
  onCollect: () => Promise<LaunchpadItem[]>;
  onOpenUrl: (url: string) => void;
  onCheckout: (item: LaunchpadItem) => Promise<void>;
  onBranchFromIssue: (item: LaunchpadItem) => Promise<void>;
}

/**
 * Launchpad: a cross-repository hub of open pull requests and issues
 * (GitLens-style), fed by whichever PR providers the workspace's
 * remotes resolve to. Actions: open on the web, check out a PR as a
 * local `pr-<n>` branch, or start a branch from an issue.
 */
export class LaunchpadPanel {
  private static current: LaunchpadPanel | undefined;

  static open(context: vscode.ExtensionContext, handlers: LaunchpadHandlers): void {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One);
      this.current.handlers = handlers;
      void this.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "gitnexus.launchpad",
      "GitNexus Launchpad",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const instance = new LaunchpadPanel(panel, handlers);
    this.current = instance;
    panel.onDidDispose(() => {
      if (this.current === instance) this.current = undefined;
    }, null, context.subscriptions);
    panel.webview.html = instance.html();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private handlers: LaunchpadHandlers
  ) {
    panel.webview.onDidReceiveMessage(message => { void this.handle(message as LaunchpadMessage); });
  }

  private async refresh(): Promise<void> {
    try {
      const items = await this.handlers.onCollect();
      void this.panel.webview.postMessage({ type: "data", items });
    } catch (error) {
      void this.panel.webview.postMessage({
        type: "data",
        items: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async handle(message: LaunchpadMessage): Promise<void> {
    switch (message.type) {
      case "ready":
      case "refresh":
        await this.refresh();
        break;
      case "open":
        if (message.item) this.handlers.onOpenUrl(message.item.url);
        break;
      case "checkout":
        if (message.item) await this.handlers.onCheckout(message.item);
        break;
      case "branch":
        if (message.item) await this.handlers.onBranchFromIssue(message.item);
        break;
    }
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
body { margin:0; font-family:var(--vscode-font-family); color:var(--vscode-foreground);
  background:var(--vscode-editor-background); }
.toolbar { display:flex; align-items:center; gap:10px; padding:10px 14px;
  background:var(--vscode-sideBar-background); border-bottom:1px solid var(--vscode-panel-border); }
button { color:var(--vscode-button-foreground); background:var(--vscode-button-background);
  border:none; padding:4px 10px; cursor:pointer; border-radius:3px; }
button.secondary { color:var(--vscode-input-foreground); background:var(--vscode-input-background);
  border:1px solid var(--vscode-input-border); }
.repo { padding:10px 14px 4px; font-weight:600; opacity:.85; }
.row { display:flex; align-items:center; gap:10px; padding:7px 14px; border-bottom:1px solid var(--vscode-panel-border); }
.kind { font-size:11px; padding:2px 7px; border-radius:8px; background:var(--vscode-badge-background);
  color:var(--vscode-badge-foreground); white-space:nowrap; }
.kind.issue { background:var(--vscode-inputValidation-infoBorder); }
.title { flex:1; }
.meta { opacity:.7; font-size:12px; white-space:nowrap; }
.empty { padding:22px 14px; opacity:.75; }
</style>
</head>
<body>
<div class="toolbar"><strong>GitNexus Launchpad</strong><span id="count"></span>
<button id="refresh" class="secondary">Refresh</button></div>
<div id="list"><div class="empty">Loading pull requests and issues…</div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const list = document.getElementById("list");
const count = document.getElementById("count");
document.getElementById("refresh").onclick = () => {
  list.innerHTML = '<div class="empty">Loading…</div>';
  vscode.postMessage({ type: "refresh" });
};
window.addEventListener("message", event => {
  const m = event.data;
  if (m.type !== "data") return;
  list.innerHTML = "";
  count.textContent = m.items.length ? m.items.length + " open items" : "";
  if (m.error) {
    const div = document.createElement("div");
    div.className = "empty"; div.textContent = "Could not load: " + m.error;
    list.appendChild(div); return;
  }
  if (!m.items.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "No open pull requests or issues found. Repositories need a GitHub, GitLab or Bitbucket remote (and sign-in or a stored token) to appear here.";
    list.appendChild(div); return;
  }
  let lastRepo = null;
  for (const item of m.items) {
    if (item.repoSlug !== lastRepo) {
      lastRepo = item.repoSlug;
      const header = document.createElement("div");
      header.className = "repo";
      header.textContent = item.providerName + " · " + item.repoSlug;
      list.appendChild(header);
    }
    const row = document.createElement("div"); row.className = "row";
    const kind = document.createElement("span"); kind.className = "kind" + (item.kind === "issue" ? " issue" : "");
    kind.textContent = item.kind === "pr" ? "PR" : "Issue";
    const title = document.createElement("span"); title.className = "title";
    title.textContent = "#" + item.number + " " + item.title;
    const meta = document.createElement("span"); meta.className = "meta";
    meta.textContent = "@" + item.author + (item.kind === "pr" ? " · " + item.headBranch + " → " + item.baseBranch : "")
      + (item.fork ? " · fork" : "") + (item.labels && item.labels.length ? " · " + item.labels.join(", ") : "");
    row.append(kind, title, meta);
    const open = document.createElement("button"); open.className = "secondary"; open.textContent = "Open";
    open.onclick = () => vscode.postMessage({ type: "open", item });
    row.appendChild(open);
    if (item.kind === "pr" && !(item.providerId === "bitbucket" && item.fork)) {
      const checkout = document.createElement("button"); checkout.textContent = "Checkout";
      checkout.onclick = () => vscode.postMessage({ type: "checkout", item });
      row.appendChild(checkout);
    }
    if (item.kind === "issue") {
      const branch = document.createElement("button"); branch.textContent = "Start Branch";
      branch.onclick = () => vscode.postMessage({ type: "branch", item });
      row.appendChild(branch);
    }
    list.appendChild(row);
  }
});
vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}

interface LaunchpadMessage {
  type: string;
  item?: LaunchpadItem;
}
