/**
 * Repository State Model types (REPOSITORY_STATE_MODEL §2–§16, §27, §35–§37).
 *
 * State is split into domains, each with its own freshness. Layer A
 * (authoritative Git state) is what Git reports; Layer B (derived) can
 * always be discarded and recomputed; Layers C (external) and D (AI) are
 * separate models and are never mixed into this snapshot.
 */

import { GitRemote } from "../git/remoteService";
import { SubmoduleEntry } from "../git/submoduleService";
import { DetectedOperation } from "../git/repositoryOperationDetector";
import { StashEntry } from "../features/stash/stashService";
import { Worktree } from "../features/worktree/worktreeService";
import { RefSnapshot } from "./ref";

export type StateDomain =
  | "head"
  | "refs"
  | "status"
  | "worktrees"
  | "operation"
  | "remotes"
  | "stashes"
  | "submodules"
  | "derived";

export const STATE_DOMAINS: StateDomain[] = [
  "head", "refs", "status", "worktrees", "operation",
  "remotes", "stashes", "submodules", "derived"
];

export type StateSource = "git" | "filesystem" | "integration" | "derived";

/** Freshness for one domain (§13): when and how it was observed, and the
 * repository generation it was observed at. */
export interface StateFreshness {
  observedAt: number;
  generation: number;
  source: StateSource;
  stale: boolean;
}

export type FreshnessMap = Record<StateDomain, StateFreshness>;

export function freshDomains(generation: number, observedAt = Date.now()): FreshnessMap {
  const entry = (): StateFreshness => ({ observedAt, generation, source: "git", stale: false });
  return {
    head: entry(), refs: entry(), status: entry(), worktrees: entry(),
    operation: entry(), remotes: entry(), stashes: entry(),
    submodules: entry(),
    derived: { observedAt, generation, source: "derived", stale: false }
  };
}

/**
 * Repository feature/limitation facts (REPOSITORY_STATE_MODEL §35),
 * detected from Git itself — never guessed.
 */
export interface RepositoryFeatures {
  shallow: boolean;
  partialClone: boolean;
  sparseCheckout: boolean;
  sparseIndex: boolean;
}

export const FULL_FEATURES: RepositoryFeatures = {
  shallow: false,
  partialClone: false,
  sparseCheckout: false,
  sparseIndex: false
};

/**
 * Repository limitations the UI must degrade around: limited history
 * (shallow / partial / sparse), detached HEAD, Git LFS content, or
 * nothing to fetch from / tag against.
 */
export type DerivedNotice =
  | "shallow-clone"
  | "partial-clone"
  | "sparse-checkout"
  | "detached-head"
  | "git-lfs"
  | "no-remotes"
  | "no-tags";

/** Layer B — derived state (§27). Always recomputable from Layer A. */
export interface DerivedState {
  basedOnGeneration: number;
  clean: boolean;
  conflicted: boolean;
  changedFiles: number;
  aheadBehind: Record<string, { ahead: number; behind: number }>;
  conflictPaths: string[];
  notices: DerivedNotice[];
}

/** The full Layer A + B snapshot domains attached to a RepositorySnapshot. */
export interface RepositoryDomains {
  refs: RefSnapshot;
  remotes: GitRemote[];
  worktrees: Worktree[];
  /** Primary (first-listed / main) worktree path, if any. */
  primaryWorktree?: string;
  operation: DetectedOperation;
  stashes: StashEntry[];
  submodules: SubmoduleEntry[];
  derived: DerivedState;
  freshness: FreshnessMap;
}

export type ActiveGitOperation =
  | "merge" | "rebase" | "cherry-pick" | "revert" | "bisect" | "am" | "apply-mailbox"
  | null;

/** Typed state-change events (§15). All state changes flow through these. */
export type RepositoryStateEvent =
  | { type: "HEAD_CHANGED" }
  | { type: "REFS_CHANGED" }
  | { type: "INDEX_CHANGED" }
  | { type: "WORKTREE_CHANGED"; paths?: string[] }
  | { type: "WORKTREE_LIST_CHANGED" }
  | { type: "OPERATION_STARTED"; operation: ActiveGitOperation }
  | { type: "OPERATION_CHANGED" }
  | { type: "OPERATION_COMPLETED" }
  | { type: "REMOTE_UPDATED"; remote: string }
  | { type: "SUBMODULE_CHANGED" }
  | { type: "FULL_REFRESH_REQUIRED" };

export type RepositoryStateEventType = RepositoryStateEvent["type"];

export type RefreshScope =
  | "all" | "head" | "refs" | "status" | "worktrees"
  | "operation" | "remotes" | "submodules";

/**
 * Invalidation matrix (§16), as data: for each event, which feature areas
 * must refresh vs invalidate vs ignore. Deliberately conservative.
 */
export type InvalidationAction = "refresh" | "invalidate" | "optional" | "no";
export interface InvalidationRow {
  status: InvalidationAction;
  graph: InvalidationAction;
  blame: InvalidationAction;
  diff: InvalidationAction;
  worktrees: InvalidationAction;
  aiContext: InvalidationAction;
}

export const INVALIDATION_MATRIX: Record<RepositoryStateEventType, InvalidationRow> = {
  HEAD_CHANGED:        { status: "refresh", graph: "invalidate", blame: "optional",   diff: "invalidate", worktrees: "refresh", aiContext: "invalidate" },
  REFS_CHANGED:        { status: "refresh", graph: "invalidate", blame: "no",         diff: "optional",   worktrees: "refresh", aiContext: "optional" },
  INDEX_CHANGED:       { status: "refresh", graph: "no",         blame: "no",         diff: "invalidate", worktrees: "no",      aiContext: "invalidate" },
  WORKTREE_CHANGED:    { status: "refresh", graph: "no",         blame: "optional",   diff: "invalidate", worktrees: "no",      aiContext: "invalidate" },
  WORKTREE_LIST_CHANGED:{ status: "refresh", graph: "optional",   blame: "no",         diff: "no",         worktrees: "refresh", aiContext: "optional" },
  OPERATION_STARTED:   { status: "refresh", graph: "invalidate", blame: "optional",   diff: "invalidate", worktrees: "refresh", aiContext: "invalidate" },
  OPERATION_CHANGED:   { status: "refresh", graph: "invalidate", blame: "optional",   diff: "invalidate", worktrees: "refresh", aiContext: "invalidate" },
  OPERATION_COMPLETED: { status: "refresh", graph: "invalidate", blame: "optional",   diff: "invalidate", worktrees: "refresh", aiContext: "invalidate" },
  REMOTE_UPDATED:      { status: "optional", graph: "optional",  blame: "no",         diff: "no",         worktrees: "no",      aiContext: "optional" },
  SUBMODULE_CHANGED:   { status: "refresh", graph: "no",         blame: "no",         diff: "invalidate", worktrees: "no",      aiContext: "optional" },
  FULL_REFRESH_REQUIRED:{ status: "refresh", graph: "invalidate", blame: "optional",  diff: "invalidate", worktrees: "refresh", aiContext: "invalidate" }
};

/** Map an event to the smallest refresh scopes that can answer it (§37). */
export function scopesForEvent(event: RepositoryStateEvent): RefreshScope[] {
  switch (event.type) {
    case "HEAD_CHANGED": return ["head", "status", "operation"];
    case "REFS_CHANGED": return ["refs", "status"];
    case "INDEX_CHANGED": return ["status"];
    case "WORKTREE_CHANGED": return ["status"];
    case "WORKTREE_LIST_CHANGED": return ["worktrees", "refs"];
    case "OPERATION_STARTED":
    case "OPERATION_CHANGED":
    case "OPERATION_COMPLETED": return ["operation", "status", "head"];
    case "REMOTE_UPDATED": return ["remotes", "refs"];
    case "SUBMODULE_CHANGED": return ["submodules", "status"];
    case "FULL_REFRESH_REQUIRED": return ["all"];
  }
}
