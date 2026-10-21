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
 * remotes resolve to. Items are grouped into per-repository cards with
 * provider badges, a live text filter and a PR/Issue segmented filter.
 * Actions: open on the web, check out a PR as a local `pr-<n>` branch,
 * or start a branch from an issue.
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
.toolbar { display:flex; align-items:center; gap:10px; padding:10px 16px; flex-wrap:wrap;
  background:var(--vscode-sideBar-background); border-bottom:1px solid var(--vscode-panel-border); }
.toolbar input { width:260px; color:var(--vscode-input-foreground); background:var(--vscode-input-background);
  border:1px solid var(--vscode-input-border); padding:5px 8px; }
button { color:var(--vscode-button-foreground); background:var(--vscode-button-background);
  border:none; padding:5px 12px; cursor:pointer; border-radius:4px; white-space:nowrap; }
button.secondary { color:var(--vscode-input-foreground); background:var(--vscode-input-background);
  border:1px solid var(--vscode-input-border); }
.seg { display:flex; border:1px solid var(--vscode-input-border); border-radius:4px; overflow:hidden; }
.seg button { background:var(--vscode-input-background); color:var(--vscode-input-foreground); border-radius:0; }
.seg button.active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }
#list { padding:14px 16px; display:flex; flex-direction:column; gap:14px; }
.card { border:1px solid var(--vscode-panel-border); border-radius:8px; overflow:hidden;
  background:var(--vscode-sideBar-background); }
.card-head { display:flex; align-items:center; gap:8px; padding:10px 14px;
  border-bottom:1px solid var(--vscode-panel-border); font-weight:600; }
.provider { font-size:11px; padding:2px 8px; border-radius:10px; font-weight:600;
  background:var(--vscode-badge-background); color:var(--vscode-badge-foreground); }
.card-count { margin-left:auto; font-weight:400; opacity:.7; font-size:12px; }
.row { display:flex; align-items:center; gap:10px; padding:9px 14px; }
.row + .row { border-top:1px solid var(--vscode-panel-border); }
.row:hover { background:var(--vscode-list-hoverBackground); }
.kind { font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; white-space:nowrap;
  background:var(--vscode-testing-iconPassed); color:var(--vscode-editor-background); }
.kind.issue { background:var(--vscode-inputValidation-infoBorder); color:var(--vscode-editor-background); }
.main { flex:1; min-width:0; }
.title { font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.num { opacity:.6; }
.meta { opacity:.7; font-size:12px; margin-top:2px; }
.label { display:inline-block; font-size:11px; padding:0 6px; border-radius:8px; margin-left:4px;
  border:1px solid var(--vscode-panel-border); }
.empty { padding:26px 16px; opacity:.75; text-align:center; }
</style>
</head>
<body>
<div class="toolbar">
  <strong>GitNexus Launchpad</strong><span id="count"></span>
  <input id="filter" placeholder="Filter by title, author, repo, #number…">
  <span class="seg" id="kindSeg">
    <button data-kind="all" class="active">All</button>
    <button data-kind="pr">Pull Requests</button>
    <button data-kind="issue">Issues</button>
  </span>
  <span style="flex:1"></span>
  <button id="refresh" class="secondary">Refresh</button>
</div>
<div id="list"><div class="empty">Loading pull requests and issues…</div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const list = document.getElementById("list");
const count = document.getElementById("count");
const filterInput = document.getElementById("filter");
let allItems = [], kindFilter = "all";

document.getElementById("refresh").onclick = () => {
  list.innerHTML = '<div class="empty">Loading…</div>';
  vscode.postMessage({ type: "refresh" });
};
filterInput.addEventListener("input", render);
document.querySelectorAll("#kindSeg button").forEach(b => {
  b.onclick = () => {
    kindFilter = b.dataset.kind;
    document.querySelectorAll("#kindSeg button").forEach(x => x.classList.toggle("active", x === b));
    render();
  };
});

function matches(item) {
  if (kindFilter !== "all" && item.kind !== kindFilter) return false;
  const q = filterInput.value.trim().toLowerCase();
  if (!q) return true;
  const hay = (item.title + " " + item.author + " " + item.repoSlug + " #" + item.number + " " +
    (item.labels || []).join(" ")).toLowerCase();
  return hay.includes(q);
}

function render() {
  list.innerHTML = "";
  const items = allItems.filter(matches);
  count.textContent = allItems.length ? items.length + " / " + allItems.length + " open items" : "";
  if (!items.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = allItems.length
      ? "No items match the current filter."
      : "No open pull requests or issues found. Repositories need a GitHub, GitLab or Bitbucket remote (and sign-in or a stored token) to appear here.";
    list.appendChild(div);
    return;
  }
  let card = null, cardBody = null, lastKey = null, perCard = 0;
  const flush = () => { if (card) card.querySelector(".card-count").textContent = perCard + " open"; };
  for (const item of items) {
    const key = item.providerName + "|" + item.repoSlug;
    if (key !== lastKey) {
      flush();
      lastKey = key; perCard = 0;
      card = document.createElement("div"); card.className = "card";
      const head = document.createElement("div"); head.className = "card-head";
      const badge = document.createElement("span"); badge.className = "provider"; badge.textContent = item.providerName;
      const slug = document.createElement("span"); slug.textContent = item.repoSlug;
      const cnt = document.createElement("span"); cnt.className = "card-count";
      head.append(badge, slug, cnt);
      cardBody = document.createElement("div");
      card.append(head, cardBody);
      list.appendChild(card);
    }
    perCard++;
    const row = document.createElement("div"); row.className = "row";
    const kind = document.createElement("span");
    kind.className = "kind" + (item.kind === "issue" ? " issue" : "");
    kind.textContent = item.kind === "pr" ? "PR" : "Issue";
    const main = document.createElement("div"); main.className = "main";
    const title = document.createElement("div"); title.className = "title";
    const num = document.createElement("span"); num.className = "num"; num.textContent = "#" + item.number + " ";
    title.append(num, document.createTextNode(item.title));
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = "@" + item.author + (item.kind === "pr" ? " · " + item.headBranch + " → " + item.baseBranch : "")
      + (item.fork ? " · fork" : "");
    for (const label of item.labels || []) {
      const pill = document.createElement("span"); pill.className = "label"; pill.textContent = label;
      meta.appendChild(pill);
    }
    main.append(title, meta);
    row.append(kind, main);
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
    cardBody.appendChild(row);
  }
  flush();
}

window.addEventListener("message", event => {
  const m = event.data;
  if (m.type !== "data") return;
  if (m.error) {
    allItems = [];
    list.innerHTML = "";
    const div = document.createElement("div");
    div.className = "empty"; div.textContent = "Could not load: " + m.error;
    list.appendChild(div);
    count.textContent = "";
    return;
  }
  allItems = m.items;
  render();
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
