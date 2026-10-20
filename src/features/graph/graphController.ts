import { CommitGraph } from "../../domain/graph";

export interface GraphSelection {
  commitId: string;
}

export class GraphController {
  constructor(private readonly graph: CommitGraph) {}

  select(commitId: string): GraphSelection | undefined {
    return this.graph.nodes.some(n => n.id === commitId)
      ? { commitId }
      : undefined;
  }

  neighbors(commitId: string): string[] {
    const node = this.graph.nodes.find(n => n.id === commitId);
    if (!node) return [];
    const parents = node.parents;
    const children = this.graph.edges
      .filter(edge => edge.to === commitId)
      .map(edge => edge.from);
    return [...new Set([...parents, ...children])];
  }
}
