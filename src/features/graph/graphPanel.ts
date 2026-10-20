import * as vscode from "vscode";
import { CommitGraph } from "../../domain/graph";
import { renderGraphHtml } from "./graphRenderer";
import { GraphDecoration } from "./refDecorations";

export class InteractiveGraphPanel {
  private static current: InteractiveGraphPanel | undefined;

  static open(
    context: vscode.ExtensionContext,
    graph: CommitGraph,
    decorations: GraphDecoration[],
    onSelect: (commitId: string) => void
  ): void {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One);
      this.current.render(graph, decorations);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "gitnexus.interactiveGraph",
      "GitNexus Graph",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const instance = new InteractiveGraphPanel(panel, onSelect);
    this.current = instance;
    panel.onDidDispose(() => {
      if (this.current === instance) this.current = undefined;
    }, null, context.subscriptions);

    instance.render(graph, decorations);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly onSelect: (commitId: string) => void
  ) {
    panel.webview.onDidReceiveMessage(message => {
      if (message?.type === "selectCommit" && typeof message.commitId === "string") {
        this.onSelect(message.commitId);
      }
    });
  }

  private render(graph: CommitGraph, decorations: GraphDecoration[]): void {
    const nonce = Math.random().toString(36).slice(2);
    const graphSvg = renderGraphHtml(graph, decorations);

    this.panel.webview.html = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
body { margin:0; overflow:hidden; font-family:var(--vscode-font-family);
  color:var(--vscode-foreground); background:var(--vscode-editor-background); }
.toolbar { height:44px; display:flex; align-items:center; gap:8px; padding:0 12px;
  background:var(--vscode-sideBar-background); border-bottom:1px solid var(--vscode-panel-border); }
.viewport { width:100vw; height:calc(100vh - 45px); overflow:auto; cursor:grab; }
.viewport.dragging { cursor:grabbing; }
.graph { transform-origin:0 0; transition:transform .08s linear; }
.edge { fill:none; stroke:var(--vscode-textLink-foreground); stroke-width:2; opacity:.65; }
.edge.first-parent { stroke-width:3; }
.node circle { fill:var(--vscode-textLink-foreground); stroke:var(--vscode-editor-background);
  stroke-width:3; cursor:pointer; }
.node.selected circle { stroke:var(--vscode-editor-foreground); stroke-width:4; }
.node text { fill:var(--vscode-foreground); font-size:12px; }
.node .meta { opacity:.6; font-size:10px; }
.ref-label { font-size:10px !important; fill:var(--vscode-editor-background) !important; }
.ref-branch, .ref-head { fill:var(--vscode-testing-iconPassed); }
.ref-remote { fill:var(--vscode-textLink-foreground); }
.ref-tag { fill:var(--vscode-editorWarning-foreground); }
button, input { color:var(--vscode-input-foreground); background:var(--vscode-input-background);
  border:1px solid var(--vscode-input-border); padding:5px 8px; }
button { cursor:pointer; }
input { width:280px; }
</style>
</head>
<body>
<div class="toolbar">
<strong>GitNexus Graph</strong>
<input id="search" placeholder="Search commits…">
<button id="zoomOut">−</button><button id="zoomIn">+</button><button id="reset">Reset</button>
<span>${graph.nodes.length} commits · ${graph.lanes.length} lanes</span>
</div>
<div id="viewport" class="viewport"><div id="graph" class="graph">${graphSvg}</div></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const viewport = document.getElementById("viewport");
const graph = document.getElementById("graph");
let scale = 1, dragging = false, sx=0, sy=0, sl=0, st=0;

function applyScale(){ graph.style.transform = "scale(" + scale + ")"; }
document.getElementById("zoomIn").onclick=()=>{scale=Math.min(3,scale+.15);applyScale()};
document.getElementById("zoomOut").onclick=()=>{scale=Math.max(.35,scale-.15);applyScale()};
document.getElementById("reset").onclick=()=>{scale=1;applyScale();viewport.scrollTo({left:0,top:0})};

graph.querySelectorAll(".node").forEach(node=>{
  node.addEventListener("click",()=>{
    graph.querySelectorAll(".node.selected").forEach(x=>x.classList.remove("selected"));
    node.classList.add("selected");
    vscode.postMessage({type:"selectCommit",commitId:node.dataset.id});
  });
});

document.getElementById("search").addEventListener("input", e=>{
  const q=e.target.value.toLowerCase();
  graph.querySelectorAll(".node").forEach(node=>{
    const text=node.textContent.toLowerCase();
    node.style.opacity=!q || text.includes(q) ? "1" : ".15";
  });
});

viewport.addEventListener("mousedown",e=>{
  if(e.target.closest(".node")) return;
  dragging=true;viewport.classList.add("dragging");
  sx=e.clientX;sy=e.clientY;sl=viewport.scrollLeft;st=viewport.scrollTop;
});
window.addEventListener("mouseup",()=>{dragging=false;viewport.classList.remove("dragging")});
window.addEventListener("mousemove",e=>{
  if(!dragging)return;
  viewport.scrollLeft=sl-(e.clientX-sx);
  viewport.scrollTop=st-(e.clientY-sy);
});
viewport.addEventListener("wheel",e=>{
  if(!e.ctrlKey)return;
  e.preventDefault();
  scale=Math.max(.35,Math.min(3,scale+(e.deltaY<0?.1:-.1)));applyScale();
},{passive:false});
</script>
</body>
</html>`;
  }
}
