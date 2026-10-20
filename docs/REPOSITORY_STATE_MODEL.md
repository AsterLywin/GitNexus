# GitNexus --- Repository State Model

**Version:** 0.1\
**Date:** 2026-10-20\
**Status:** Architecture Baseline

## 1. Purpose

GitNexus needs one authoritative internal model of repository state.
Graph, Blame, History, Diff, Worktree, Rebase, Search, PR indicators,
and AI context must not independently query Git and disagree about
current state.

The model separates authoritative Git state, derived state, external
integration state, and ephemeral AI state.

## 2. State Domains

``` text
Repository
├── Identity
├── HEAD
├── Refs
├── Working Tree
├── Index
├── Remotes
├── Worktrees
├── Operation State
├── Stashes
├── Submodules
└── Derived State
```

Each domain has a source of truth, freshness policy, cache policy, and
invalidation triggers.

## 3. State Layers

### Layer A --- Authoritative Git State

-   HEAD;
-   refs;
-   index;
-   working tree;
-   worktrees;
-   merge/rebase/cherry-pick/revert state;
-   stash refs;
-   submodule state.

### Layer B --- Derived GitNexus State

-   ahead/behind;
-   graph topology;
-   branch relationships;
-   merge-base;
-   changed-file summaries;
-   conflict summaries.

### Layer C --- External State

-   pull requests;
-   reviews;
-   CI;
-   issues;
-   deployment state.

### Layer D --- AI State

-   selected commits;
-   selected files;
-   diff context;
-   prompts;
-   generated answers;
-   agent task state.

External and AI state are never authoritative Git state.

## 4. Core Repository State

``` ts
interface RepositoryState {
  identity: RepositoryIdentity;
  head: HeadState;
  refs: RefState;
  workingTree: WorkingTreeState;
  index: IndexState;
  remotes: RemoteState;
  worktrees: WorktreeState;
  operation: OperationState;
  stashes: StashState;
  submodules: SubmoduleState;
  derived: DerivedState;
  freshness: FreshnessState;
}
```

## 5. Identity

``` ts
interface RepositoryIdentity {
  id: RepositoryId;
  worktreePath?: string;
  commonGitDir: string;
  gitDir: string;
  bare: boolean;
  linkedWorktree: boolean;
}
```

A repository with multiple worktrees shares a common Git directory but
has worktree-specific state.

## 6. HEAD

``` ts
interface HeadState {
  oid: CommitId | null;
  symbolicRef?: RefName;
  detached: boolean;
  unborn: boolean;
}
```

The model must distinguish normal branches, detached HEAD, and an unborn
branch in an empty repository.

## 7. Refs

``` ts
interface RefState {
  branches: Map<RefName, BranchState>;
  remoteBranches: Map<RefName, RemoteBranchState>;
  tags: Map<RefName, TagState>;
  symbolicRefs: Map<string, RefName>;
}
```

``` ts
interface BranchState {
  name: RefName;
  oid: CommitId;
  upstream?: UpstreamState;
  goneUpstream: boolean;
}
```

## 8. Working Tree

``` ts
interface WorkingTreeState {
  entries: Map<string, WorkingTreeEntry>;
  clean: boolean;
  conflicted: boolean;
}
```

Entry states:

``` text
modified
added
deleted
renamed
copied
untracked
ignored
conflicted
```

The model must preserve the distinction between index changes and
working-tree changes.

## 9. Index

``` ts
interface IndexState {
  entries: Map<string, IndexEntry>;
  dirty: boolean;
}
```

The fundamental Git relationship is:

``` text
HEAD → Index → Working Tree
```

## 10. Worktrees

``` ts
interface WorktreeState {
  items: Map<string, Worktree>;
  primaryWorktree?: string;
}
```

Each worktree has independent HEAD, index, working tree, and operation
state while sharing appropriate repository-level objects and refs.

## 11. Operation State

``` ts
type ActiveGitOperation =
  | "merge"
  | "rebase"
  | "cherry-pick"
  | "revert"
  | "bisect"
  | "am"
  | "apply-mailbox"
  | null;
```

``` ts
interface OperationState {
  active: ActiveGitOperation;
  conflicted: boolean;
  step?: number;
  totalSteps?: number;
  todo?: RebaseTodoItem[];
}
```

Active operations have priority over normal mutation commands.

## 12. Repository State Machine

``` text
                 +----------------+
                 |     CLEAN      |
                 +-------+--------+
                         |
                    file/index change
                         |
                         v
                 +----------------+
                 |      DIRTY     |
                 +-------+--------+
                         |
                    mutation starts
                         |
                         v
              +----------------------+
              |   OPERATION ACTIVE   |
              +----+------------+----+
                   |            |
               success       conflict
                   |            |
                   v            v
                CLEAN        CONFLICTED
                                |
                       continue/abort
                                |
                                v
                         CLEAN / DIRTY
```

The model must not assume every mutation ends in a clean repository.

## 13. Freshness

``` ts
interface StateFreshness {
  observedAt: number;
  generation: number;
  source: "git" | "filesystem" | "integration" | "derived";
  stale: boolean;
}
```

This lets consumers know not only a value but when and how it was
observed.

## 14. Generations

Each repository has a monotonically increasing generation.

``` text
generation 100
      |
external file change
      v
generation 101
```

Derived caches record the generation from which they were calculated.

``` ts
interface DerivedCacheEntry<T> {
  value: T;
  basedOnGeneration: number;
}
```

If the cache generation differs from the repository generation, the
cache is potentially stale.

## 15. Event Bus

All state changes flow through one repository event bus.

``` ts
type RepositoryEvent =
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
```

## 16. Invalidation Matrix

  -------------------------------------------------------------------------------------------------
  Event               Status     Graph        Blame      Diff              Worktrees   AI Context
  ------------------- ---------- ------------ ---------- ----------------- ----------- ------------
  HEAD_CHANGED        refresh    invalidate   optional   invalidate        refresh     invalidate

  REFS_CHANGED        refresh    invalidate   no         range-dependent   refresh     optional

  INDEX_CHANGED       refresh    no           no         invalidate        no          invalidate

  WORKTREE_CHANGED    refresh    no           current    invalidate        no          invalidate
                                              file                                     

  OPERATION_CHANGED   refresh    invalidate   optional   invalidate        refresh     invalidate

  REMOTE_UPDATED      optional   optional     no         no                no          optional
  -------------------------------------------------------------------------------------------------

The matrix is deliberately conservative for correctness.

## 17. Filesystem Watching

Watch relevant Git paths including:

``` text
.git/HEAD
.git/index
.git/refs/
.git/logs/
.git/MERGE_HEAD
.git/CHERRY_PICK_HEAD
.git/REVERT_HEAD
.git/rebase-merge/
.git/rebase-apply/
.git/worktrees/
```

For linked worktrees, resolve the real Git directory first.

Filesystem events are hints, not authoritative state. A relevant event
triggers targeted Git refresh.

## 18. Polling

Watchers may miss events on network filesystems or after external
changes. The state manager therefore supports adaptive validation
polling.

Suggested behavior:

``` text
active repository   → frequent lightweight validation
inactive repository → slower validation
focused view        → immediate validation
```

## 19. Debouncing

A single Git command can produce many filesystem events. Batch event
bursts:

``` text
event burst
   ↓
debounce
   ↓
classify affected domains
   ↓
one refresh transaction
```

## 20. Refresh Transactions

A refresh should produce a coherent snapshot as far as Git permits.

``` text
begin refresh
read required state
validate consistency
retry if obviously inconsistent
commit snapshot
publish one update
```

The implementation must tolerate external Git mutations occurring
between individual reads.

## 21. Snapshot

``` ts
interface RepositorySnapshot {
  generation: number;
  capturedAt: number;
  head: HeadState;
  refs: RefState;
  workingTree: WorkingTreeState;
  index: IndexState;
  worktrees: WorktreeState;
  operation: OperationState;
}
```

Feature services should consume snapshots rather than repeatedly
querying individual fields.

## 22. Optimistic UI

GitNexus may optimistically update UI after a requested mutation, but
authoritative Git state always wins.

``` text
User action
   ↓
optimistic UI
   ↓
Git operation
   ↓
authoritative refresh
   ↓
reconcile
```

If the operation fails, discard the optimistic state.

## 23. External Mutations

Git can change through terminals, other extensions, IDE commands, hooks,
agents, other worktrees, and automation.

Never assume:

``` text
read → wait → mutate
```

is safe without validating the expected state.

## 24. Mutation Preconditions

Destructive operations validate preconditions.

Examples:

``` text
reset       → expected HEAD still matches
rebase      → no incompatible active operation
branch del  → branch still points to expected commit
worktree rm → target worktree still exists
```

If the repository changed unexpectedly, return a state-conflict result
and require an explicit retry policy.

## 25. Repository Mutex

``` ts
interface RepositoryMutex {
  acquire(operationId: string): Promise<Release>;
}
```

Read operations can run concurrently. Mutations serialize per
repository.

## 26. Multi-Worktree Semantics

Model:

``` text
Common Git Directory
├── Worktree A → main
├── Worktree B → feature-a
└── Worktree C → agent/task-42
```

Shared and per-worktree state must never be conflated.

## 27. Derived State

``` ts
interface DerivedState {
  aheadBehind: Map<RefName, AheadBehind>;
  mergeBases: Map<string, CommitId[]>;
  graph: GraphState;
  fileHistory: Map<string, HistorySummary>;
  conflictSummary?: ConflictSummary;
}
```

Derived state can always be discarded and recomputed.

## 28. Commit Graph State

The graph is incremental and progressively rendered.

``` ts
interface GraphState {
  loadedCommits: Map<CommitId, CommitRecord>;
  lanes: GraphLane[];
  visibleRange: RevisionRange;
  complete: boolean;
}
```

Load order can prioritize the current HEAD, visible branches, and then
older history on demand.

## 29. AI Context

AI state is explicitly separate:

``` ts
interface AiContext {
  repositoryGeneration: number;
  commits: CommitId[];
  files: string[];
  diffs: DiffReference[];
  promptContext: string[];
}
```

When repository generation changes, AI context may be stale and the UI
should offer a refresh.

## 30. Persistence

Do not persist the full repository state. Persist only non-authoritative
UX metadata such as graph preferences, pinned branches, and optionally
search history.

Authoritative repository state is reconstructed from Git.

## 31. Crash Recovery

After extension restart:

1.  rediscover repositories;
2.  detect active Git operations;
3.  rebuild authoritative state;
4.  discard stale in-memory caches;
5.  restore UI preferences;
6.  show interrupted GitNexus operations if an operation journal exists.

Never automatically continue a Git operation merely because Git reports
an active operation.

## 32. Operation Journal

``` ts
interface OperationJournalEntry {
  operationId: string;
  type: string;
  repo: RepositoryId;
  startedAt: number;
  status: "running" | "success" | "failed" | "cancelled";
  preGeneration: number;
  postGeneration?: number;
}
```

The journal is for diagnostics and UI recovery, not a replacement for
Git state.

## 33. Conflict Model

``` ts
interface ConflictSummary {
  paths: string[];
  count: number;
  operation: ActiveGitOperation | null;
}
```

This supports future conflict UI and resolver integration.

## 34. Submodules

``` ts
interface SubmoduleState {
  path: string;
  recordedCommit: CommitId;
  actualCommit?: CommitId;
  dirty: boolean;
  initialized: boolean;
}
```

Submodules are separate repositories and must be tracked without
contaminating the parent repository's state model.

## 35. Sparse, Partial, and Shallow Repositories

Record limitations:

``` ts
interface RepositoryFeatures {
  shallow: boolean;
  partialClone: boolean;
  sparseCheckout: boolean;
  sparseIndex: boolean;
}
```

Features should degrade gracefully, for example:

``` text
History is limited because this repository is shallow.
[Fetch More History]
```

## 36. State API

``` ts
interface RepositoryStateStore {
  getSnapshot(repo: RepositoryId): RepositorySnapshot;

  refresh(
    repo: RepositoryId,
    scope?: RefreshScope
  ): Promise<RepositorySnapshot>;

  subscribe(
    repo: RepositoryId,
    listener: RepositoryStateListener
  ): Disposable;

  invalidate(
    repo: RepositoryId,
    reason: RepositoryEvent
  ): void;
}
```

## 37. Refresh Scope

``` ts
type RefreshScope =
  | "all"
  | "head"
  | "refs"
  | "status"
  | "worktrees"
  | "operation"
  | "remotes"
  | "submodules";
```

Features should request the smallest scope that can answer their
question.

## 38. UI Consumption Rule

UI components subscribe to state and normally do not invoke Git
directly.

``` text
                    Repository State Store
                    /    |     |                       Graph Blame Diff    Status
```

This prevents duplicated Git work and inconsistent UI.

## 39. Feature Dependency Graph

``` text
Repository Discovery
        ↓
Repository State
        ↓
Git Engine
        ↓
+------+------+------+------+------+
|      |      |      |      |      |
Graph Blame History Diff Worktree Rebase
|      |      |      |      |      |
+------+------+-+----+------+------+
               |
               v
        Search & Compare
               |
               v
          AI Context
               |
               v
          AI / Agents
```

## 40. Performance Strategy

Prefer:

1.  targeted refresh;
2.  cached immutable data;
3.  streaming;
4.  debounce;
5.  batching;
6.  background refresh;
7.  progressive rendering.

Avoid re-running status, log, and diff for every UI event.

## 41. Testing

Test state transitions as workflows:

``` text
CLEAN
→ file changed
→ DIRTY

DIRTY
→ git add
→ INDEX_DIRTY

INDEX_DIRTY
→ commit
→ CLEAN + HEAD_CHANGED

CLEAN
→ merge
→ OPERATION_ACTIVE

OPERATION_ACTIVE
→ conflict
→ CONFLICTED

CONFLICTED
→ continue
→ CLEAN

CONFLICTED
→ abort
→ coherent previous state
```

Also test external mutations occurring between reads.

## 42. Definition of Done

The state model is MVP-ready when HEAD, refs, status/index/worktree,
active operations, multi-worktree repositories, filesystem invalidation,
debouncing, generations, cache invalidation, serialized mutations,
snapshot consumption, external mutations, and state-transition
integration tests are implemented.

## 43. Key Architectural Decision

**Git Engine answers: "What can Git do, and what did Git return?"**

**Repository State Model answers: "What does this repository currently
look like, and which parts may be stale?"**

These responsibilities must remain separate.
