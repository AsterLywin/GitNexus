import { GraphRenderNode, GraphRenderEdge, RenderWindow } from "./graphModel";

export class GraphVirtualRenderer {
  constructor(
    private readonly rowHeight = 44,
    private readonly laneWidth = 28
  ) {}

  render(
    window: RenderWindow,
    selectedId?: string
  ): string {
    const height = Math.max(1, (window.endRow - window.startRow) * this.rowHeight);
    const nodes = window.nodes.map(node => this.nodeSvg(node, selectedId, window.startRow)).join("");
    const edges = window.edges.map(edge => this.edgeSvg(edge, window.startRow)).join("");

    return `
      <svg class="graph-layer" width="100%" height="${height}" viewBox="0 0 900 ${height}">
        ${edges}
        ${nodes}
      </svg>`;
  }

  private nodeSvg(node: GraphRenderNode, selectedId: string | undefined, startRow: number): string {
    const y = (node.row - startRow) * this.rowHeight;
    const selected = node.id === selectedId ? ' data-selected="true"' : "";
    const label = escapeHtml(node.label || node.id.slice(0, 8));
    return `<g class="commit-node"${selected} data-id="${escapeHtml(node.id)}" transform="translate(${node.laneX},${y})">
      <circle r="${node.id === selectedId ? 7 : 5}"></circle>
      <text x="12" y="4">${label}</text>
    </g>`;
  }

  private edgeSvg(edge: GraphRenderEdge, startRow: number): string {
    const y1 = (edge.from.row - startRow) * this.rowHeight;
    const y2 = (edge.to.row - startRow) * this.rowHeight;
    const x1 = edge.from.laneX;
    const x2 = edge.to.laneX;
    const mid = (y1 + y2) / 2;
    return `<path class="graph-edge" d="M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}"></path>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]!));
}
