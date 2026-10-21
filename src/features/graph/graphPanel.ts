import * as vscode from "vscode";
import { CommitGraph } from "../../domain/graph";
import { GraphNavigator } from "./graphNavigator";
import { createRenderModel, GraphRenderNode } from "./graphModel";
import {
  GRAPH_LANE_WIDTH,
  GRAPH_ROW_HEIGHT,
  GraphModel,
  renderGraphWindowSvg
} from "./graphRenderer";
import { GraphDecoration } from "./refDecorations";

export type CommitAction = "checkout" | "createBranch" | "createTag" | "copyHash" | "aiContext";

export interface GraphRepoOption {
  root: string;
  name: string;
}

export interface GraphPanelHandlers {
  onSelect: (commitId: string) => void;
  onCommitAction: (action: CommitAction, commitId: string) => void;
  /** Invoked by the [Fetch More History] button on limitation notices. */
  onFetchMore?: () => void;
  /** Invoked when the user picks another repository in the toolbar. */
  onSwitchRepo?: (root: string) => void;
}

const WINDOW_ROWS = 240;

interface PanelMessage {
  type: string;
  commitId?: string;
  startRow?: number;
  query?: string;
  action?: CommitAction;
  root?: string;
}

/**
 * Live commit graph panel, built on the render model + virtual renderer:
 * the extension owns the full model, the webview owns only a ~240-row
 * window of SVG that is swapped as the user scrolls. Search runs through
 * GraphNavigator over the model; next/previous match navigation is shared
 * between the toolbar and the gitnexus.graphNextMatch /
 * graphPreviousMatch commands. Selecting a commit exposes branch actions
 * (checkout / create branch / create tag / copy hash) in the toolbar.
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
    currentRoot?: string
  ): void {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One);
      this.current.setGraph(graph, decorations, handlers, notice, repos, currentRoot);
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
    instance.setGraph(graph, decorations, handlers, notice, repos, currentRoot);
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

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private handlers: GraphPanelHandlers
  ) {
    panel.webview.onDidReceiveMessage(message => this.handle(message as PanelMessage));
    const configWatch = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("gitnexus.graph")) this.sendWindow(this.windowStart);
    });
    panel.onDidDispose(() => configWatch.dispose());
  }

  private repos: GraphRepoOption[] = [];
  private currentRoot: string | undefined;

  private setGraph(
    graph: CommitGraph,
    decorations: GraphDecoration[],
    handlers: GraphPanelHandlers,
    notice?: string,
    repos: GraphRepoOption[] = [],
    currentRoot?: string
  ): void {
    this.handlers = handlers;
    this.notice = notice;
    this.repos = repos;
    this.currentRoot = currentRoot;
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
    const rendered = renderGraphWindowSvg(this.model, clamped, clamped + WINDOW_ROWS, this.selectedId, {
      avatar: config.get<boolean>("graph.showAvatars", true),
      author: config.get<boolean>("graph.showAuthor", true),
      date: config.get<boolean>("graph.showDate", true),
      hash: config.get<boolean>("graph.showHash", false)
    });
    this.post({ type: "window", startRow: rendered.startRow, svg: rendered.svg });
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message);
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2);
    const totalHeight = this.model.nodes.length * GRAPH_ROW_HEIGHT;
    const notice = this.notice
      ? `<div class="notice">${escapeHtml(this.notice)} <button id="fetchMore">Fetch More History</button></div>`
      : "";
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
.viewport { width:100vw; height:calc(100vh - 53px); overflow:auto; position:relative; }
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
</style>
</head>
<body>
<div class="toolbar">
<strong>GitNexus Graph</strong>
${this.repos.length > 1 ? `<select id="repoSwitch">${this.repos.map(repo => `<option value="${escapeHtml(repo.root)}"${repo.root === this.currentRoot ? " selected" : ""}>${escapeHtml(repo.name)}</option>`).join("")}</select>` : ""}
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
${notice}
</div>
<div id="viewport" class="viewport">
  <div class="spacer" style="height:${totalHeight}px"><div id="layer" class="layer"></div></div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const ROW = ${GRAPH_ROW_HEIGHT};
const viewport = document.getElementById("viewport");
const layer = document.getElementById("layer");
const actions = document.getElementById("actions");
const selectedLabel = document.getElementById("selectedLabel");
const matchesLabel = document.getElementById("matches");
let windowStart = -1, ticking = false, selectedId = null;

layer.addEventListener("click", e => {
  const node = e.target.closest(".commit-node");
  if (node) vscode.postMessage({ type: "selectCommit", commitId: node.dataset.id });
});
document.getElementById("search").addEventListener("input", e => {
  vscode.postMessage({ type: "search", query: e.target.value });
});
const fetchMore = document.getElementById("fetchMore");
if (fetchMore) fetchMore.onclick = () => vscode.postMessage({ type: "fetchMore" });
const repoSwitch = document.getElementById("repoSwitch");
if (repoSwitch) repoSwitch.onchange = () => vscode.postMessage({ type: "switchRepo", root: repoSwitch.value });
document.getElementById("nextMatch").onclick = () => vscode.postMessage({ type: "nextMatch" });
document.getElementById("prevMatch").onclick = () => vscode.postMessage({ type: "previousMatch" });
actions.querySelectorAll("button").forEach(b => {
  b.onclick = () => vscode.postMessage({ type: "commitAction", action: b.dataset.action });
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
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[char]!));
}
