import { CommitGraph, GraphEdge, GraphLane, GraphNode } from "../../domain/graph";
import { CommitSummary } from "../../domain/git";

export interface GraphLayoutOptions {
  rowHeight?: number;
  laneWidth?: number;
  maxLanes?: number;
}

export class CommitGraphLayout {
  constructor(private readonly options: GraphLayoutOptions = {}) {}

  build(commits: CommitSummary[]): CommitGraph {
    const rowHeight = this.options.rowHeight ?? 64;
    const laneWidth = this.options.laneWidth ?? 42;
    const maxLanes = this.options.maxLanes ?? 32;

    const active: string[] = [];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const lanes: GraphLane[] = Array.from(
      { length: maxLanes },
      (_, index) => ({ index, commitIds: [] })
    );

    const laneFor = (id: string): number => {
      const existing = active.indexOf(id);
      if (existing >= 0) return existing;
      const lane = Math.min(active.length, maxLanes - 1);
      active.splice(lane, 0, id);
      return lane;
    };

    commits.forEach((commit, row) => {
      let lane = active.indexOf(commit.id);
      if (lane < 0) lane = laneFor(commit.id);

      active.splice(lane, 1);
      lanes[lane].commitIds.push(commit.id);

      const node: GraphNode = {
        id: commit.id,
        commit,
        lane,
        row,
        x: lane * laneWidth + 18,
        y: row * rowHeight + 24,
        parents: commit.parents
      };
      nodes.push(node);

      commit.parents.forEach((parent, parentIndex) => {
        const parentLane = laneFor(parent);
        edges.push({
          from: commit.id,
          to: parent,
          fromLane: lane,
          toLane: parentLane,
          isFirstParent: parentIndex === 0
        });
      });
    });

    const usedLanes = lanes.filter(lane => lane.commitIds.length > 0);

    return {
      nodes,
      edges,
      lanes: usedLanes,
      width: Math.max(360, (usedLanes.length + 1) * laneWidth + 280),
      height: Math.max(160, commits.length * rowHeight + 48)
    };
  }
}
