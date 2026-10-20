import { GraphRenderNode } from "./graphModel";

export class GraphNavigator {
  constructor(private readonly nodes: GraphRenderNode[]) {}

  find(query: string): GraphRenderNode[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return this.nodes.filter(node =>
      node.id.toLowerCase().startsWith(q) ||
      (node.label ?? "").toLowerCase().includes(q) ||
      (node.author ?? "").toLowerCase().includes(q) ||
      Boolean(node.refs?.some(ref => ref.toLowerCase().includes(q)))
    );
  }

  next(currentId?: string): GraphRenderNode | undefined {
    if (!this.nodes.length) return undefined;
    if (!currentId) return this.nodes[0];

    const index = this.nodes.findIndex(n => n.id === currentId);
    return this.nodes[(index + 1) % this.nodes.length];
  }

  previous(currentId?: string): GraphRenderNode | undefined {
    if (!this.nodes.length) return undefined;
    if (!currentId) return this.nodes[this.nodes.length - 1];

    const index = this.nodes.findIndex(n => n.id === currentId);
    return this.nodes[(index - 1 + this.nodes.length) % this.nodes.length];
  }
}
