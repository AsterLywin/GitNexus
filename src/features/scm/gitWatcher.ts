/**
 * Filesystem watching classification (REPOSITORY_STATE_MODEL §17).
 *
 * Filesystem events are hints, not authoritative state: a relevant path is
 * classified into the typed state event it implies, and the state manager
 * answers with a targeted Git refresh. Irrelevant `.git` internals
 * (objects, hooks, …) are ignored.
 */

import { RepositoryStateEvent } from "../../domain/state";

export function classifyGitPath(path: string): RepositoryStateEvent | undefined {
  const normalized = path.replace(/\\/g, "/");
  const gitSegment = "/.git/";
  const gitIndex = normalized.indexOf(gitSegment);
  const isGitPath = gitIndex >= 0 || normalized.endsWith("/.git") || normalized.startsWith(".git/");

  if (!isGitPath) {
    return { type: "WORKTREE_CHANGED", paths: [normalized] };
  }

  const inside = gitIndex >= 0
    ? normalized.slice(gitIndex + gitSegment.length)
    : normalized.slice(normalized.indexOf(".git/") + ".git/".length);

  // Active-operation state files first: they outrank generic ref changes.
  if (
    inside.startsWith("rebase-merge/") || inside.startsWith("rebase-apply/") ||
    inside === "MERGE_HEAD" || inside === "CHERRY_PICK_HEAD" ||
    inside === "REVERT_HEAD" || inside === "BISECT_LOG" ||
    inside.startsWith("sequencer/")
  ) {
    return { type: "OPERATION_CHANGED" };
  }
  if (inside.startsWith("worktrees/")) {
    return { type: "WORKTREE_LIST_CHANGED" };
  }
  if (inside === "index") {
    return { type: "INDEX_CHANGED" };
  }
  if (inside === "HEAD" || inside === "logs/HEAD") {
    return { type: "HEAD_CHANGED" };
  }
  if (inside === "packed-refs" || inside.startsWith("refs/") || inside.startsWith("logs/")) {
    return { type: "REFS_CHANGED" };
  }
  if (inside === "config") {
    return { type: "FULL_REFRESH_REQUIRED" };
  }
  return undefined;
}
