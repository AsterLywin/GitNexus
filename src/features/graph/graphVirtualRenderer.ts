import { GraphRenderNode, GraphRenderEdge, RenderWindow } from "./graphModel";
import { gravatarUrl } from "./avatar";

/** Optional info columns rendered to the right of the commit subject. */
export interface GraphColumnOptions {
  avatar?: boolean;
  author?: boolean;
  date?: boolean;
  hash?: boolean;
}

const AUTHOR_X = 545;
const DATE_X = 720;
const HASH_X = 838;

export class GraphVirtualRenderer {
  constructor(
    private readonly rowHeight = 44,
    private readonly laneWidth = 28
  ) {}

  render(
    window: RenderWindow,
    selectedId?: string,
    columns: GraphColumnOptions = {}
  ): string {
    const height = Math.max(1, (window.endRow - window.startRow) * this.rowHeight);
    const nodes = window.nodes.map(node => this.nodeSvg(node, selectedId, window.startRow, columns)).join("");
    const edges = window.edges.map(edge => this.edgeSvg(edge, window.startRow)).join("");

    return `
      <svg class="graph-layer" width="100%" height="${height}" viewBox="0 0 900 ${height}">
        ${edges}
        ${nodes}
      </svg>`;
  }

  private nodeSvg(
    node: GraphRenderNode,
    selectedId: string | undefined,
    startRow: number,
    columns: GraphColumnOptions
  ): string {
    const y = (node.row - startRow) * this.rowHeight;
    const selected = node.id === selectedId ? ' data-selected="true"' : "";
    const label = escapeHtml(node.label || node.id.slice(0, 8));
    const avatar = columns.avatar ? gravatarUrl(node.authorEmail, 32) : undefined;
    const labelX = 12 + (avatar ? 22 : 0);
    const refs = node.refs?.length
      ? `<text class="refs" x="${labelX + label.length * 7 + 10}" y="4">[${escapeHtml(node.refs.join(", "))}]</text>`
      : "";
    const avatarSvg = avatar
      ? `<clipPath id="av-${node.row}"><circle cx="18" cy="0" r="8"/></clipPath>` +
        `<image href="${avatar}" x="10" y="-8" width="16" height="16" clip-path="url(#av-${node.row})"></image>`
      : "";

    // Meta columns sit at fixed SVG x positions (not lane-relative).
    const meta: string[] = [];
    if (columns.author && node.author) {
      meta.push(`<text class="meta" x="${AUTHOR_X}" y="${y + 4}">${escapeHtml(node.author)}</text>`);
    }
    if (columns.date && node.authorTimestamp > 0) {
      const date = new Date(node.authorTimestamp * 1000).toISOString().slice(0, 10);
      meta.push(`<text class="meta" x="${DATE_X}" y="${y + 4}">${date}</text>`);
    }
    if (columns.hash) {
      meta.push(`<text class="meta" x="${HASH_X}" y="${y + 4}">${escapeHtml(node.id.slice(0, 7))}</text>`);
    }

    return `<g class="commit-node"${selected} data-id="${escapeHtml(node.id)}" transform="translate(${node.laneX},${y})">
      <circle r="${node.id === selectedId ? 7 : 5}"></circle>
      ${avatarSvg}
      <text x="${labelX}" y="4">${label}</text>${refs}
    </g>${meta.join("")}`;
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
