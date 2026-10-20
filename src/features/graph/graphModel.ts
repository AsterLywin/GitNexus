import { CommitGraph, GraphNode, GraphEdge } from "../../domain/graph";

export interface GraphViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface GraphRenderNode extends GraphNode {
  lane: number;
  laneX: number;
  row: number;
}

export interface GraphRenderEdge extends GraphEdge {
  from: GraphRenderNode;
  to: GraphRenderNode;
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
  laneWidth = 28
): { nodes: GraphRenderNode[]; edges: GraphRenderEdge[] } {
  const nodes: GraphRenderNode[] = graph.nodes.map((node, index) => ({
    ...node,
    lane: node.lane ?? 0,
    laneX: 18 + (node.lane ?? 0) * laneWidth,
    row: index
  }));

  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges: GraphRenderEdge[] = graph.edges
    .map(edge => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      return from && to ? { ...edge, from, to } : undefined;
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
