import * as vscode from "vscode";
import { CommitGraph } from "../domain/graph";
import { renderGraphHtml } from "../features/graph/graphRenderer";

export class GraphPanel {
  private static current: GraphPanel | undefined;

  static open(context: vscode.ExtensionContext, graph: CommitGraph): void {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal(vscode.ViewColumn.One);
      GraphPanel.current.render(graph);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "gitnexus.commitGraph",
      "GitNexus Graph",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    GraphPanel.current = new GraphPanel(panel);
    panel.onDidDispose(() => {
      GraphPanel.current = undefined;
    }, null, context.subscriptions);

    GraphPanel.current.render(graph);
  }

  private constructor(private readonly panel: vscode.WebviewPanel) {}

  private render(graph: CommitGraph): void {
    this.panel.webview.html = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
:root {
  color-scheme: light dark;
}
body {
  margin: 0;
  padding: 0;
  overflow: auto;
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
.toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 10px 14px;
  background: var(--vscode-sideBar-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}
.viewport { padding: 16px; }
.graph { overflow: visible; }
.edge {
  fill: none;
  stroke: var(--vscode-textLink-foreground);
  stroke-width: 2;
  opacity: .65;
}
.edge.first-parent { stroke-width: 3; }
.node circle {
  fill: var(--vscode-textLink-foreground);
  stroke: var(--vscode-editor-background);
  stroke-width: 3;
  cursor: pointer;
}
.node text { fill: var(--vscode-foreground); font-size: 12px; }
.node .meta { opacity: .6; font-size: 10px; }
</style>
</head>
<body>
<div class="toolbar">
  <strong>GitNexus Commit Graph</strong>
  <span> · ${graph.nodes.length} commits · ${graph.lanes.length} lanes</span>
</div>
<div class="viewport">${renderGraphHtml(graph)}</div>
</body>
</html>`;
  }
}
