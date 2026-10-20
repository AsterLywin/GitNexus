import { PullRequestSummary } from "../../domain/pr";
import { RefSnapshot } from "../../domain/ref";
import { GraphDecoration } from "../graph/refDecorations";

/**
 * Map open PRs onto graph decorations: a PR label lands on the commit
 * its head branch points at (Layer C state rendered on Layer A topology).
 */
export function buildPrDecorations(
  pullRequests: PullRequestSummary[],
  refs: RefSnapshot
): GraphDecoration[] {
  const decorations: GraphDecoration[] = [];
  for (const pr of pullRequests) {
    const branch = refs.branches.find(b => b.shortName === pr.headBranch);
    if (!branch) continue;
    decorations.push({
      commitId: branch.objectId,
      labels: [{
        text: `PR #${pr.number}${pr.ciStatus ? ` · CI ${pr.ciStatus}` : ""}`,
        kind: "pr"
      }]
    });
  }
  return decorations;
}
