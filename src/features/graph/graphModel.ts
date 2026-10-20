import { CommitGraph, GraphNode } from "../../domain/graph";
import { GraphDecoration } from "./refDecorations";

export interface GraphViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface GraphRenderNode extends GraphNode {
  laneX: number;
  /** Display label derived from the commit subject. */
  label: string;
  /** Display author derived from the commit author name. */
  author: string;
  /** Ref label texts decorating this commit (branches, remotes, tags), if any. */
  refs?: string[];
}

/**
 * Render-space edge: endpoints are render nodes, not commit ids, so this is
 * intentionally NOT a subtype of the domain GraphEdge (whose from/to are
 * GitObjectId strings).
 */
export interface GraphRenderEdge {
  from: GraphRenderNode;
  to: GraphRenderNode;
  fromLane: number;
  toLane: number;
  isFirstParent: boolean;
}

export interface RenderWindow {
  startRow: number;
  endRow: number;
  nodes: GraphRenderNode[];
  edges: GraphRenderEdge[];
}

export function createRenderModel(
  graph: CommitGraph,
  rowHeight = 44,
  laneWidth = 28,
  decorations: GraphDecoration[] = []
): { nodes: GraphRenderNode[]; edges: GraphRenderEdge[] } {
  const refsByCommit = new Map<string, string[]>();
  for (const decoration of decorations) {
    refsByCommit.set(
      decoration.commitId,
      decoration.labels.map(label => label.text)
    );
  }

  const nodes: GraphRenderNode[] = graph.nodes.map((node, index) => ({
    ...node,
    lane: node.lane ?? 0,
    laneX: 18 + (node.lane ?? 0) * laneWidth,
    row: index,
    label: node.commit?.subject ?? "",
    author: node.commit?.authorName ?? "",
    refs: refsByCommit.get(node.id)
  }));

  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges: GraphRenderEdge[] = graph.edges
    .map(edge => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return undefined;
      return {
        from,
        to,
        fromLane: edge.fromLane ?? from.lane,
        toLane: edge.toLane ?? to.lane,
        isFirstParent: edge.isFirstParent ?? false
      };
    })
    .filter((x): x is GraphRenderEdge => Boolean(x));

  return { nodes, edges };
}

export function getRenderWindow(
  model: { nodes: GraphRenderNode[]; edges: GraphRenderEdge[] },
  startRow: number,
  endRow: number,
  overscan = 12
): RenderWindow {
  const start = Math.max(0, startRow - overscan);
  const end = Math.min(model.nodes.length, endRow + overscan);

  const nodes = model.nodes.slice(start, end);
  const visibleIds = new Set(nodes.map(n => n.id));

  const edges = model.edges.filter(edge =>
    visibleIds.has(edge.from.id) || visibleIds.has(edge.to.id)
  );

  return { startRow: start, endRow: end, nodes, edges };
}
