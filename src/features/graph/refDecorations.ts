import { CommitGraph } from "../../domain/graph";
import { RefSnapshot } from "../../domain/ref";

export interface GraphDecoration {
  commitId: string;
  labels: Array<{
    text: string;
    kind: "branch" | "remote" | "tag" | "head" | "pr";
  }>;
}

export function buildRefDecorations(graph: CommitGraph, refs: RefSnapshot): GraphDecoration[] {
  const byCommit = new Map<string, GraphDecoration>();

  for (const ref of refs.refs) {
    const node = graph.nodes.find(n => n.id === ref.objectId);
    if (!node) continue;

    const current = byCommit.get(ref.objectId) ?? {
      commitId: ref.objectId,
      labels: []
    };

    current.labels.push({
      text: ref.isCurrent ? `HEAD → ${ref.shortName}` : ref.shortName,
      kind: ref.kind === "localBranch" && ref.isCurrent
        ? "head"
        : ref.kind === "localBranch"
          ? "branch"
          : ref.kind === "remoteBranch"
            ? "remote"
            : "tag"
    });

    byCommit.set(ref.objectId, current);
  }

  return [...byCommit.values()];
}
