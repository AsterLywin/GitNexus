import { CommitSummary, GitObjectId } from "./git";

export interface GraphNode {
  id: GitObjectId;
  commit: CommitSummary;
  lane: number;
  row: number;
  x: number;
  y: number;
  parents: GitObjectId[];
}

export interface GraphEdge {
  from: GitObjectId;
  to: GitObjectId;
  fromLane: number;
  toLane: number;
  isFirstParent: boolean;
}

export interface GraphLane {
  index: number;
  commitIds: GitObjectId[];
}

export interface CommitGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  lanes: GraphLane[];
  width: number;
  height: number;
}
