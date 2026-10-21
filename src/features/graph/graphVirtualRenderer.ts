import { GraphRenderNode, GraphRenderEdge, RenderWindow } from "./graphModel";
import { authorColor, authorInitials, formatRelativeTime, laneColor } from "./graphStyle";

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

/** Pill background per ref kind (GitLens-style chips). */
const PILL_FILLS: Record<string, string> = {
  head: "#1a7f37",
  branch: "#0969da",
  remote: "#57606a",
  tag: "#bf8700",
  pr: "#8250df"
};

/**
 * Windowed SVG renderer for the live graph. Rows are GitLens-style:
 * colored lanes, a generated initial avatar on each commit, the
 * subject on line one and — at comfortable density — ref pills plus
 * hash/author/relative-time on line two. Compact density collapses to
 * a single line. All colors are inline styles so they win over the
 * panel stylesheet's theme defaults.
 */
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
    const textX = 16 + (window.maxLane + 1) * this.laneWidth + 16;
    const nodes = window.nodes.map(node => this.nodeSvg(node, selectedId, window.startRow, columns, textX)).join("");
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
    columns: GraphColumnOptions,
    textX: number
  ): string {
    const y = (node.row - startRow) * this.rowHeight;
    const centerY = y + this.rowHeight / 2;
    const twoLine = this.rowHeight >= 40;
    const selected = node.id === selectedId;
    const label = escapeHtml(node.label || node.id.slice(0, 8));
    const showAvatar = columns.avatar !== false;
    const identity = node.authorEmail || node.author;
    const subjectY = twoLine ? centerY - 3 : centerY + 4;

    // Commit marker: generated initial avatar, or a plain lane dot.
    let marker: string;
    if (showAvatar) {
      const r = twoLine ? 11 : 8;
      const initials = escapeHtml(authorInitials(node.author, node.authorEmail));
      marker =
        (selected ? `<circle cx="${node.laneX}" cy="${centerY}" r="${r + 2.5}" style="fill:none;stroke:${laneColor(node.lane)}" stroke-width="2"></circle>` : "") +
        `<circle cx="${node.laneX}" cy="${centerY}" r="${r}" style="fill:${authorColor(identity)}"></circle>` +
        `<text x="${node.laneX}" y="${centerY + (twoLine ? 3.5 : 2.5)}" text-anchor="middle" style="fill:#fff;font-weight:700" font-size="${twoLine ? 8.5 : 6.5}">${initials}</text>`;
    } else {
      marker = `<circle cx="${node.laneX}" cy="${centerY}" r="${selected ? 7 : 5}" style="fill:${laneColor(node.lane)}"></circle>`;
    }

    // Fixed meta columns, aligned with the subject line.
    const meta: string[] = [];
    if (columns.author && node.author) {
      meta.push(`<text class="meta" x="${AUTHOR_X}" y="${subjectY}">${escapeHtml(node.author)}</text>`);
    }
    if (columns.date && node.authorTimestamp > 0) {
      const date = new Date(node.authorTimestamp * 1000).toISOString().slice(0, 10);
      meta.push(`<text class="meta" x="${DATE_X}" y="${subjectY}">${date}</text>`);
    }
    if (columns.hash) {
      meta.push(`<text class="meta" x="${HASH_X}" y="${subjectY}">${escapeHtml(node.id.slice(0, 7))}</text>`);
    }

    // Second line: ref pills, then hash · relative time.
    let secondLine = "";
    if (twoLine) {
      const parts: string[] = [];
      let pillX = textX;
      const pillY = centerY + 5;
      for (const ref of node.refLabels ?? []) {
        const width = 14 + ref.text.length * 6.1;
        const fill = PILL_FILLS[ref.kind] ?? PILL_FILLS.remote;
        parts.push(
          `<rect x="${pillX}" y="${pillY}" width="${width}" height="15" rx="7.5" style="fill:${fill}"></rect>` +
          `<text x="${pillX + 7}" y="${pillY + 11}" style="fill:#fff" font-size="9.5">${escapeHtml(ref.text)}</text>`
        );
        pillX += width + 6;
      }
      const rel = formatRelativeTime(node.authorTimestamp);
      const metaText = `${node.id.slice(0, 7)}${rel ? " · " + rel : ""}`;
      parts.push(`<text class="meta" x="${pillX + 2}" y="${pillY + 11}">${escapeHtml(metaText)}</text>`);
      secondLine = parts.join("");
    }

    return `<g class="commit-node"${selected ? ' data-selected="true"' : ""} data-id="${escapeHtml(node.id)}">
      ${marker}
      <text x="${textX}" y="${subjectY}">${label}</text>
      ${secondLine}
    </g>${meta.join("")}`;
  }

  private edgeSvg(edge: GraphRenderEdge, startRow: number): string {
    const y1 = (edge.from.row - startRow) * this.rowHeight + this.rowHeight / 2;
    const y2 = (edge.to.row - startRow) * this.rowHeight + this.rowHeight / 2;
    const x1 = edge.from.laneX;
    const x2 = edge.to.laneX;
    const mid = (y1 + y2) / 2;
    return `<path class="graph-edge" style="stroke:${laneColor(edge.toLane)}" d="M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}"></path>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]!));
}
