import * as vscode from "vscode";
import { CommitGraph } from "../../domain/graph";
import { GraphNavigator } from "./graphNavigator";
import { createRenderModel, getRenderWindow, GraphRenderNode } from "./graphModel";
import {
  GRAPH_LANE_WIDTH,
  GRAPH_ROW_HEIGHT,
  GraphModel,
  renderGraphWindowSvg
} from "./graphRenderer";
import { GraphDecoration } from "./refDecorations";
import { gravatarUrl } from "./avatar";

export type CommitAction =
  | "checkout" | "createBranch" | "createTag" | "copyHash" | "aiContext"
  | "openRemote" | "showDiff";

export interface GraphRepoOption {
  root: string;
  name: string;
}

/** Payload for the in-panel commit details pane. */
export interface GraphCommitDetails {
  id: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail: string;
  avatarUrl?: string;
  dateIso: string;
  parents: string[];
  files: Array<{ status: string; path: string }>;
}

export interface GraphPanelHandlers {
  onSelect: (commitId: string) => void;
  onCommitAction: (action: CommitAction, commitId: string) => void;
  /** Invoked by the [Fetch More History] button on limitation notices. */
  onFetchMore?: () => void;
  /** Invoked when the user picks another repository in the toolbar. */
  onSwitchRepo?: (root: string) => void;
  /** Invoked when the branch filter changes ("all" | "current"). */
  onBranchFilter?: (mode: string) => void;
  /** Invoked by the toolbar gear button. */
  onOpenSettings?: () => void;
}

const WINDOW_ROWS = 240;

interface PanelMessage {
  type: string;
  commitId?: string;
  startRow?: number;
  query?: string;
  action?: CommitAction;
  root?: string;
  key?: string;
  value?: unknown;
  mode?: string;
}

interface NodeLite {
  id: string;
  subject: string;
  author: string;
  avatarUrl?: string;
  date: string;
  refs?: string[];
}

function rowHeightForDensity(density: string | undefined): number {
  return density === "compact" ? 30 : GRAPH_ROW_HEIGHT;
}

/**
 * Live commit graph panel (v2): virtualized SVG windows from the host,
 * plus a rich hover card, a right-click context menu, a commit details
 * pane, a columns/density popover and a branch filter. Column and
 * density state lives in the `gitnexus.graph.*` settings, so the
 * graphical Settings page and this panel stay in sync both ways.
 */
export class InteractiveGraphPanel {
  private static current: InteractiveGraphPanel | undefined;

  static open(
    context: vscode.ExtensionContext,
    graph: CommitGraph,
    decorations: GraphDecoration[],
    handlers: GraphPanelHandlers,
    notice?: string,
    repos: GraphRepoOption[] = [],
    currentRoot?: string,
    branchMode = "all"
  ): void {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One);
      this.current.setGraph(graph, decorations, handlers, notice, repos, currentRoot, branchMode);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "gitnexus.interactiveGraph",
      "GitNexus Graph",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const instance = new InteractiveGraphPanel(panel, handlers);
    this.current = instance;
    panel.onDidDispose(() => {
      if (this.current === instance) this.current = undefined;
    }, null, context.subscriptions);
    instance.setGraph(graph, decorations, handlers, notice, repos, currentRoot, branchMode);
  }

  /** Push commit details into the open panel's details pane. */
  static showDetails(details: GraphCommitDetails): void {
    this.current?.post({ type: "details", details });
  }

  /**
   * Deep link: select + scroll to a commit in the open panel.
   * Returns false when no panel is open or the commit is not in the
   * loaded model.
   */
  static reveal(commitId: string): boolean {
    if (!this.current) return false;
    const node = this.current.model.nodes.find(n => n.id === commitId);
    if (!node) return false;
    this.current.panel.reveal(vscode.ViewColumn.One);
    this.current.jumpTo(node);
    return true;
  }

  static nextMatch(): void {
    this.current?.stepMatch(1);
  }

  static previousMatch(): void {
    this.current?.stepMatch(-1);
  }

  private model: GraphModel = { nodes: [], edges: [] };
  private navigator = new GraphNavigator([]);
  private matches: GraphRenderNode[] = [];
  private matchIndex = -1;
  private selectedId: string | undefined;
  private windowStart = 0;
  private notice: string | undefined;
  private repos: GraphRepoOption[] = [];
  private currentRoot: string | undefined;
  private branchMode = "all";
  private density = "comfortable";

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private handlers: GraphPanelHandlers
  ) {
    panel.webview.onDidReceiveMessage(message => this.handle(message as PanelMessage));
    const configWatch = vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration("gitnexus.graph")) return;
      const next = vscode.workspace.getConfiguration("gitnexus").get<string>("graph.density", "comfortable");
      if (next !== this.density) {
        // Row geometry changed: rebuild the page so spacer/ROW match.
        this.density = next;
        this.panel.webview.html = this.html();
      } else {
        this.sendWindow(this.windowStart);
      }
    });
    panel.onDidDispose(() => configWatch.dispose());
  }

  private setGraph(
    graph: CommitGraph,
    decorations: GraphDecoration[],
    handlers: GraphPanelHandlers,
    notice?: string,
    repos: GraphRepoOption[] = [],
    currentRoot?: string,
    branchMode = "all"
  ): void {
    this.handlers = handlers;
    this.notice = notice;
    this.repos = repos;
    this.currentRoot = currentRoot;
    this.branchMode = branchMode;
    this.density = vscode.workspace.getConfiguration("gitnexus").get<string>("graph.density", "comfortable");
    this.model = createRenderModel(graph, GRAPH_ROW_HEIGHT, GRAPH_LANE_WIDTH, decorations);
    this.navigator = new GraphNavigator(this.model.nodes);
    this.matches = [];
    this.matchIndex = -1;
    this.selectedId = undefined;
    this.windowStart = 0;
    this.panel.webview.html = this.html();
  }

  private handle(message: PanelMessage): void {
    switch (message.type) {
      case "ready":
        this.sendWindow(0);
        break;
      case "windowRequest":
        if (typeof message.startRow === "number") this.sendWindow(message.startRow);
        break;
      case "selectCommit":
        if (message.commitId) {
          this.selectedId = message.commitId;
          this.handlers.onSelect(message.commitId);
          this.post({ type: "selection", commitId: message.commitId });
          this.sendWindow(this.windowStart); // re-render to move the highlight
        }
        break;
      case "search": {
        this.matches = this.navigator.find(message.query ?? "");
        this.matchIndex = this.matches.length ? 0 : -1;
        this.post({ type: "matches", count: this.matches.length, index: this.matchIndex });
        if (this.matches.length) this.jumpTo(this.matches[0]);
        break;
      }
      case "nextMatch":
        this.stepMatch(1);
        break;
      case "previousMatch":
        this.stepMatch(-1);
        break;
      case "commitAction":
        if (message.action && this.selectedId) {
          this.handlers.onCommitAction(message.action, this.selectedId);
        }
        break;
      case "fetchMore":
        this.handlers.onFetchMore?.();
        break;
      case "switchRepo":
        if (message.root && message.root !== this.currentRoot) {
          this.handlers.onSwitchRepo?.(message.root);
        }
        break;
      case "branchFilter":
        if (message.mode && message.mode !== this.branchMode) {
          this.handlers.onBranchFilter?.(message.mode);
        }
        break;
      case "setConfig":
        if (message.key) {
          void vscode.workspace.getConfiguration("gitnexus")
            .update(message.key, message.value, vscode.ConfigurationTarget.Global);
        }
        break;
      case "openSettings":
        this.handlers.onOpenSettings?.();
        break;
    }
  }

  private stepMatch(delta: number): void {
    if (!this.matches.length) return;
    this.matchIndex = (this.matchIndex + delta + this.matches.length) % this.matches.length;
    this.post({ type: "matches", count: this.matches.length, index: this.matchIndex });
    this.jumpTo(this.matches[this.matchIndex]);
  }

  private jumpTo(node: GraphRenderNode): void {
    this.selectedId = node.id;
    this.handlers.onSelect(node.id);
    const start = Math.max(0, Math.min(node.row - Math.floor(WINDOW_ROWS / 2), this.model.nodes.length - WINDOW_ROWS));
    this.sendWindow(start);
    this.post({ type: "scrollTo", row: node.row, commitId: node.id });
  }

  private sendWindow(startRow: number): void {
    const clamped = Math.max(0, Math.min(startRow, Math.max(0, this.model.nodes.length - WINDOW_ROWS)));
    this.windowStart = clamped;
    const config = vscode.workspace.getConfiguration("gitnexus");
    const rowHeight = rowHeightForDensity(this.density);
    const rendered = renderGraphWindowSvg(this.model, clamped, clamped + WINDOW_ROWS, this.selectedId, {
      avatar: config.get<boolean>("graph.showAvatars", true),
      author: config.get<boolean>("graph.showAuthor", true),
      date: config.get<boolean>("graph.showDate", true),
      hash: config.get<boolean>("graph.showHash", false)
    }, rowHeight);
    const win = getRenderWindow(this.model, clamped, clamped + WINDOW_ROWS);
    const nodes: NodeLite[] = win.nodes.map(node => ({
      id: node.id,
      subject: node.label,
      author: node.author,
      avatarUrl: gravatarUrl(node.authorEmail, 40),
      date: node.authorTimestamp > 0
        ? new Date(node.authorTimestamp * 1000).toISOString().slice(0, 10)
        : "",
      refs: node.refs
    }));
    this.post({ type: "window", startRow: rendered.startRow, svg: rendered.svg, nodes });
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message);
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2);
    const rowHeight = rowHeightForDensity(this.density);
    const totalHeight = this.model.nodes.length * rowHeight;
    const config = vscode.workspace.getConfiguration("gitnexus");
    const notice = this.notice
      ? `<div class="notice">${escapeHtml(this.notice)} <button id="fetchMore">Fetch More History</button></div>`
      : "";
    const repoSelect = this.repos.length > 1
      ? `<select id="repoSwitch">${this.repos.map(repo =>
          `<option value="${escapeHtml(repo.root)}"${repo.root === this.currentRoot ? " selected" : ""}>${escapeHtml(repo.name)}</option>`).join("")}</select>`
      : "";
    const checked = (key: string, fallback: boolean) => (config.get<boolean>(key, fallback) ? " checked" : "");
    return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https://www.gravatar.com">
<style>
body { margin:0; overflow:hidden; font-family:var(--vscode-font-family);
  color:var(--vscode-foreground); background:var(--vscode-editor-background); }
.toolbar { min-height:44px; display:flex; align-items:center; gap:8px; padding:4px 12px; flex-wrap:wrap;
  background:var(--vscode-sideBar-background); border-bottom:1px solid var(--vscode-panel-border); }
.notice { width:100%; color:var(--vscode-editorWarning-foreground); font-size:12px; }
.main { display:flex; height:calc(100vh - 53px); }
.viewport { flex:1; overflow:auto; position:relative; }
.spacer { position:relative; width:100%; }
.layer { position:absolute; left:0; width:100%; }
.commit-node { cursor:pointer; }
.commit-node circle { fill:var(--vscode-textLink-foreground); stroke:var(--vscode-editor-background); stroke-width:2; }
.commit-node text { fill:var(--vscode-foreground); font-size:12px; }
text.meta { fill:var(--vscode-descriptionForeground); font-size:11px; }
.commit-node[data-selected="true"] circle { stroke:var(--vscode-editor-foreground); stroke-width:3; }
.graph-layer path { fill:none; stroke:var(--vscode-textLink-foreground); stroke-width:2; opacity:.6; }
button, input, select { color:var(--vscode-input-foreground); background:var(--vscode-input-background);
  border:1px solid var(--vscode-input-border); padding:5px 8px; }
button { cursor:pointer; }
input { width:240px; }
#actions { display:none; align-items:center; gap:6px; }
#matches { opacity:.7; font-size:12px; }
.popover { display:none; position:absolute; top:48px; right:12px; z-index:40; min-width:210px;
  background:var(--vscode-editorWidget-background); border:1px solid var(--vscode-editorWidget-border);
  border-radius:6px; padding:10px 12px; box-shadow:0 4px 16px rgba(0,0,0,.35); }
.popover.open { display:block; }
.popover h4 { margin:6px 0; font-size:12px; opacity:.8; }
.popover label { display:flex; align-items:center; gap:8px; padding:3px 0; font-size:13px; cursor:pointer; }
.popover label input { width:auto; }
#hoverCard { display:none; position:fixed; z-index:50; max-width:340px; pointer-events:none;
  background:var(--vscode-editorHoverWidget-background); border:1px solid var(--vscode-editorHoverWidget-border);
  border-radius:6px; padding:10px 12px; box-shadow:0 4px 16px rgba(0,0,0,.35); }
#hoverCard .hc-head { display:flex; gap:8px; align-items:center; }
#hoverCard img { width:28px; height:28px; border-radius:50%; }
#hoverCard .hc-subject { font-weight:600; margin:6px 0 2px; }
#hoverCard .hc-meta { opacity:.75; font-size:12px; }
#hoverCard .hc-refs { margin-top:4px; font-size:12px; color:var(--vscode-textLink-foreground); }
#ctxMenu { display:none; position:fixed; z-index:60; min-width:200px; padding:4px;
  background:var(--vscode-menu-background); border:1px solid var(--vscode-menu-border); border-radius:6px;
  box-shadow:0 4px 16px rgba(0,0,0,.35); }
#ctxMenu button { display:block; width:100%; text-align:left; background:none; border:none;
  color:var(--vscode-menu-foreground); padding:6px 10px; border-radius:4px; }
#ctxMenu button:hover { background:var(--vscode-menu-selectionBackground); }
#details { width:0; overflow:hidden; transition:width .15s ease; border-left:1px solid var(--vscode-panel-border);
  background:var(--vscode-sideBar-background); flex:none; }
#details.open { width:310px; overflow-y:auto; }
#details .d-inner { padding:14px; width:282px; }
#details h3 { margin:0 0 6px; font-size:14px; }
#details h4 { margin:12px 0 4px; font-size:12.5px; }
#details .d-meta { opacity:.75; font-size:12px; margin-bottom:8px; }
#details .d-body { white-space:pre-wrap; font-size:12.5px; opacity:.9; }
#details .d-file { display:flex; gap:8px; font-size:12.5px; padding:3px 0; }
#details .d-status { font-weight:700; width:14px; }
#details img { width:32px; height:32px; border-radius:50%; vertical-align:middle; margin-right:8px; }
</style>
</head>
<body>
<div class="toolbar">
<strong>GitNexus Graph</strong>
${repoSelect}
<select id="branchFilter" title="History scope">
  <option value="all"${this.branchMode === "all" ? " selected" : ""}>All refs</option>
  <option value="current"${this.branchMode === "current" ? " selected" : ""}>Current branch</option>
</select>
<input id="search" placeholder="Search commits, authors, refs…">
<button id="prevMatch" title="Previous match">↑</button>
<button id="nextMatch" title="Next match">↓</button>
<span id="matches"></span>
<span>${this.model.nodes.length} commits</span>
<span id="actions">
  <span id="selectedLabel"></span>
  <button data-action="checkout">Checkout</button>
  <button data-action="createBranch">Branch…</button>
  <button data-action="createTag">Tag…</button>
  <button data-action="copyHash">Copy hash</button>
  <button data-action="aiContext">Add to AI context</button>
</span>
<span style="flex:1"></span>
<button id="columnsBtn" title="Columns & density">Columns</button>
<button id="settingsBtn" title="GitNexus settings">⚙</button>
${notice}
</div>
<div class="main">
<div id="viewport" class="viewport">
  <div class="spacer" style="height:${totalHeight}px"><div id="layer" class="layer"></div></div>
</div>
<aside id="details"><div class="d-inner" id="detailsInner"></div></aside>
</div>
<div class="popover" id="columnsPop">
  <h4>Columns</h4>
  <label><input type="checkbox" data-key="graph.showAvatars"${checked("graph.showAvatars", true)}> Avatars</label>
  <label><input type="checkbox" data-key="graph.showAuthor"${checked("graph.showAuthor", true)}> Author</label>
  <label><input type="checkbox" data-key="graph.showDate"${checked("graph.showDate", true)}> Date</label>
  <label><input type="checkbox" data-key="graph.showHash"${checked("graph.showHash", false)}> Short hash</label>
  <h4>Density</h4>
  <label><input type="radio" name="density" value="comfortable"${this.density === "comfortable" ? " checked" : ""}> Comfortable</label>
  <label><input type="radio" name="density" value="compact"${this.density === "compact" ? " checked" : ""}> Compact</label>
</div>
<div id="hoverCard"></div>
<div id="ctxMenu">
  <button data-action="showDiff">Show Diff</button>
  <button data-action="checkout">Checkout</button>
  <button data-action="createBranch">Create Branch…</button>
  <button data-action="createTag">Create Tag…</button>
  <button data-action="openRemote">Open on Remote</button>
  <button data-action="aiContext">Add to AI Context</button>
  <button data-action="copyHash">Copy Hash</button>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ROW = ${rowHeight};
const viewport = document.getElementById("viewport");
const layer = document.getElementById("layer");
const actions = document.getElementById("actions");
const selectedLabel = document.getElementById("selectedLabel");
const matchesLabel = document.getElementById("matches");
const hoverCard = document.getElementById("hoverCard");
const ctxMenu = document.getElementById("ctxMenu");
const details = document.getElementById("details");
const detailsInner = document.getElementById("detailsInner");
let windowStart = -1, ticking = false, selectedId = null;
const nodeData = new Map();

function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }

layer.addEventListener("click", e => {
  const node = e.target.closest(".commit-node");
  if (node) vscode.postMessage({ type: "selectCommit", commitId: node.dataset.id });
});
layer.addEventListener("contextmenu", e => {
  const node = e.target.closest(".commit-node");
  if (!node) return;
  e.preventDefault();
  vscode.postMessage({ type: "selectCommit", commitId: node.dataset.id });
  ctxMenu.style.display = "block";
  ctxMenu.style.left = Math.min(e.clientX, innerWidth - 220) + "px";
  ctxMenu.style.top = Math.min(e.clientY, innerHeight - 260) + "px";
});
layer.addEventListener("mousemove", e => {
  const node = e.target.closest(".commit-node");
  if (!node) { hoverCard.style.display = "none"; return; }
  const d = nodeData.get(node.dataset.id);
  if (!d) { hoverCard.style.display = "none"; return; }
  hoverCard.innerHTML =
    '<div class="hc-head">' + (d.avatarUrl ? '<img src="' + d.avatarUrl + '">' : "") +
    "<div><div>" + esc(d.author) + '</div><div class="hc-meta">' + esc(d.date) + " · " + esc(d.id.slice(0, 10)) + "</div></div></div>" +
    '<div class="hc-subject">' + esc(d.subject) + "</div>" +
    (d.refs && d.refs.length ? '<div class="hc-refs">● ' + esc(d.refs.join(" · ")) + "</div>" : "");
  hoverCard.style.display = "block";
  hoverCard.style.left = Math.min(e.clientX + 16, innerWidth - 360) + "px";
  hoverCard.style.top = Math.min(e.clientY + 14, innerHeight - 150) + "px";
});
layer.addEventListener("mouseleave", () => { hoverCard.style.display = "none"; });
document.addEventListener("click", e => {
  if (!ctxMenu.contains(e.target)) ctxMenu.style.display = "none";
  const pop = document.getElementById("columnsPop");
  if (!pop.contains(e.target) && e.target.id !== "columnsBtn") pop.classList.remove("open");
});
ctxMenu.querySelectorAll("button").forEach(b => {
  b.onclick = () => {
    ctxMenu.style.display = "none";
    vscode.postMessage({ type: "commitAction", action: b.dataset.action });
  };
});
document.getElementById("search").addEventListener("input", e => {
  vscode.postMessage({ type: "search", query: e.target.value });
});
const fetchMore = document.getElementById("fetchMore");
if (fetchMore) fetchMore.onclick = () => vscode.postMessage({ type: "fetchMore" });
const repoSwitch = document.getElementById("repoSwitch");
if (repoSwitch) repoSwitch.onchange = () => vscode.postMessage({ type: "switchRepo", root: repoSwitch.value });
document.getElementById("branchFilter").onchange = e => vscode.postMessage({ type: "branchFilter", mode: e.target.value });
document.getElementById("nextMatch").onclick = () => vscode.postMessage({ type: "nextMatch" });
document.getElementById("prevMatch").onclick = () => vscode.postMessage({ type: "previousMatch" });
document.getElementById("settingsBtn").onclick = () => vscode.postMessage({ type: "openSettings" });
document.getElementById("columnsBtn").onclick = () => document.getElementById("columnsPop").classList.toggle("open");
document.querySelectorAll("#columnsPop input[data-key]").forEach(input => {
  input.onchange = () => vscode.postMessage({ type: "setConfig", key: input.dataset.key, value: input.checked });
});
document.querySelectorAll('#columnsPop input[name="density"]').forEach(input => {
  input.onchange = () => vscode.postMessage({ type: "setConfig", key: "graph.density", value: input.value });
});
actions.querySelectorAll("button").forEach(b => {
  b.onclick = () => vscode.postMessage({ type: "commitAction", action: b.dataset.action });
});
detailsInner.addEventListener("click", e => {
  if (e.target.id === "openDiffBtn") vscode.postMessage({ type: "commitAction", action: "showDiff" });
});

viewport.addEventListener("scroll", () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const startRow = Math.floor(viewport.scrollTop / ROW);
    if (Math.abs(startRow - windowStart) > 30) {
      vscode.postMessage({ type: "windowRequest", startRow });
    }
  });
});

window.addEventListener("message", event => {
  const m = event.data;
  if (m.type === "window") {
    windowStart = m.startRow;
    layer.style.top = (m.startRow * ROW) + "px";
    layer.innerHTML = m.svg;
    nodeData.clear();
    for (const n of m.nodes || []) nodeData.set(n.id, n);
  } else if (m.type === "selection") {
    selectedId = m.commitId;
    selectedLabel.textContent = m.commitId.slice(0, 10);
    actions.style.display = "flex";
  } else if (m.type === "scrollTo") {
    selectedId = m.commitId;
    selectedLabel.textContent = m.commitId.slice(0, 10);
    actions.style.display = "flex";
    viewport.scrollTo({ top: Math.max(0, m.row * ROW - viewport.clientHeight / 2), behavior: "smooth" });
  } else if (m.type === "matches") {
    matchesLabel.textContent = m.count ? (m.index + 1) + " / " + m.count : "";
  } else if (m.type === "details") {
    const d = m.details;
    details.classList.add("open");
    detailsInner.innerHTML =
      "<h3>" + (d.avatarUrl ? '<img src="' + d.avatarUrl + '">' : "") + esc(d.subject) + "</h3>" +
      '<div class="d-meta">' + esc(d.authorName) + " &lt;" + esc(d.authorEmail) + "&gt;<br>" +
      esc(d.dateIso) + " · " + esc(d.id.slice(0, 12)) + "</div>" +
      (d.body ? '<div class="d-body">' + esc(d.body) + "</div>" : "") +
      "<h4>Changed files (" + d.files.length + ")</h4>" +
      d.files.map(f => '<div class="d-file"><span class="d-status">' + esc(f.status) + '</span><span>' + esc(f.path) + "</span></div>").join("") +
      '<p><button id="openDiffBtn">Open Full Diff</button></p>';
  }
});

vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]!));
}
