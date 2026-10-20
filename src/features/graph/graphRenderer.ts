import { CommitGraph } from "../../domain/graph";
import { GraphDecoration } from "./refDecorations";

export function renderGraphHtml(
  graph: CommitGraph,
  decorations: GraphDecoration[] = []
): string {
  const decorationMap = new Map(decorations.map(d => [d.commitId, d]));

  const edges = graph.edges.map(edge => {
    const from = graph.nodes.find(n => n.id === edge.from);
    const to = graph.nodes.find(n => n.id === edge.to);
    if (!from || !to) return "";
    const midY = (from.y + to.y) / 2;
    const d = `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
    return `<path class="edge ${edge.isFirstParent ? "first-parent" : ""}" d="${d}" />`;
  }).join("");

  const nodes = graph.nodes.map(node => {
    const labels = decorationMap.get(node.id)?.labels ?? [];
    const labelHtml = labels.map((label, i) =>
      `<g transform="translate(${i * 8}, 0)">
        <rect class="ref-${label.kind}" x="0" y="-30" rx="4" ry="4"
          width="${Math.max(42, label.text.length * 7 + 12)}" height="18"></rect>
        <text class="ref-label" x="6" y="-17">${escapeHtml(label.text)}</text>
      </g>`
    ).join("");

    return `
      <g class="node" data-id="${escapeHtml(node.id)}" transform="translate(${node.x},${node.y})">
        <circle r="7"></circle>
        <text x="16" y="5">${escapeHtml(node.commit.subject)}</text>
        <text class="meta" x="16" y="21">${escapeHtml(node.commit.authorName)}</text>
        <g transform="translate(16, 0)">${labelHtml}</g>
      </g>`;
  }).join("");

  return `<svg class="graph" viewBox="0 0 ${graph.width} ${graph.height}"
    width="${graph.width}" height="${graph.height}" aria-label="Git commit graph">
    <g class="edges">${edges}</g>
    <g class="nodes">${nodes}</g>
  </svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[char]!));
}
