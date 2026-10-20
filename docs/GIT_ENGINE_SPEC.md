# GitNexus --- Git Engine Specification

**Version:** 0.1\
**Date:** 2026-10-20\
**Status:** Architecture Baseline

## 1. Purpose

The Git Engine is the lowest-level Git abstraction used by GitNexus.
Commit Graph, Blame, History, Diff, Search & Compare, Worktrees, Rebase,
Pull Requests, AI context, and future analytics must consume this layer
instead of executing Git independently.

### Goals

1.  Correctness over convenience.
2.  Native Git compatibility.
3.  No shell interpolation.
4.  Strong typing at the domain boundary.
5.  Cancellation for long-running operations.
6.  Streaming for large histories and diffs.
7.  Explicit Git capability detection.
8.  Centralized error normalization.
9.  Deterministic testing through fixtures.
10. A stable API for UI and AI layers.

## 2. Architecture

``` text
VS Code Extension Host
        |
        v
GitNexus Application Services
        |
        +-----------------------------+
        |                             |
        v                             v
Repository State Model          Feature Services
        |                  Graph / Blame / History / Diff
        |                  Rebase / Worktree / Search / AI
        v
Git Engine
        |
        +-----------------------------+
        |                             |
        v                             v
Native Git CLI                  Future Git Backends
(git executable)                libgit2 / remote API
```

The initial backend is the installed Git executable. The rest of the
application must not depend directly on CLI output formats.

## 3. Backend Contract

``` ts
interface GitBackend {
  execute(request: GitRequest): Promise<GitRawResult>;
  stream(request: GitRequest): AsyncIterable<GitChunk>;
  getVersion(): Promise<GitVersion>;
  dispose(): void;
}
```

Future backends may support libgit2, JGit, remote services, or sandboxed
environments.

## 4. Process Execution

Git must be invoked with an argument array.

``` text
spawn("git", ["log", "--format=...", "--all"])
```

Never construct shell commands from user input.

Every request supports an `AbortSignal`. Cancellation must terminate the
process safely, clean up listeners, return a typed cancellation error,
and trigger state refresh because an interrupted Git operation may have
changed repository state.

Sensitive environment values must never be logged.

## 5. Typed Request

``` ts
interface GitRequest {
  repo: RepositoryId;
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: GitTimeoutPolicy;
  signal?: AbortSignal;
  stdin?: AsyncIterable<string | Uint8Array>;
  outputMode?: "buffer" | "stream";
}
```

## 6. Result and Error Model

``` ts
interface GitRawResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  durationMs: number;
  cancelled: boolean;
}
```

Normalize failures into:

``` ts
type GitErrorCode =
  | "NOT_A_REPOSITORY"
  | "GIT_NOT_FOUND"
  | "UNSUPPORTED_GIT_VERSION"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "LOCKED"
  | "CONFLICT"
  | "INVALID_REVISION"
  | "OPERATION_IN_PROGRESS"
  | "NO_UPSTREAM"
  | "NETWORK_ERROR"
  | "HOOK_FAILED"
  | "SIGNING_FAILED"
  | "CANCELLED"
  | "TIMEOUT"
  | "UNKNOWN";
```

``` ts
interface GitError {
  code: GitErrorCode;
  message: string;
  stderr?: string;
  exitCode?: number;
  operation?: string;
  repo?: RepositoryId;
  recoverable: boolean;
  suggestedActions?: GitRecoveryAction[];
}
```

## 7. Repository Discovery

Support:

-   workspace repositories;
-   nested repositories;
-   repositories outside the workspace;
-   multiple repositories;
-   worktrees;
-   submodules;
-   bare repositories where applicable.

Use:

``` text
git rev-parse --show-toplevel
git rev-parse --git-dir
git rev-parse --git-common-dir
git rev-parse --is-inside-work-tree
git rev-parse --is-bare-repository
```

Identity should distinguish a worktree from its shared Git directory:

``` ts
interface RepositoryId {
  commonGitDir: string;
  worktreePath?: string;
}
```

## 8. Git Version and Capabilities

Run `git --version` and detect capabilities.

``` ts
interface GitCapabilities {
  version: GitVersion;
  worktrees: boolean;
  porcelainV2: boolean;
  pathspecFromFile: boolean;
  sparseCheckout: boolean;
  partialClone: boolean;
  commitGraph: boolean;
  notes: boolean;
  rerere: boolean;
}
```

Features must declare minimum versions or degrade gracefully.

## 9. Command Services

Expose typed services:

``` text
GitRepositoryService
GitRefService
GitCommitService
GitDiffService
GitStatusService
GitBlameService
GitHistoryService
GitBranchService
GitTagService
GitRemoteService
GitWorktreeService
GitStashService
GitRebaseService
GitMergeService
GitCherryPickService
GitRevertService
GitSearchService
GitConfigService
GitSubmoduleService
```

Higher layers should call typed methods rather than arbitrary raw
commands.

## 10. Status Engine

Preferred source:

``` text
git status --porcelain=v2 -z --branch
```

Parse branch, upstream, ahead/behind, staged, unstaged, untracked,
renamed, copied, conflicted, ignored, and submodule information.

``` ts
interface WorkingTreeStatus {
  head: RefName | null;
  oid: CommitId | null;
  upstream?: RefName;
  ahead: number;
  behind: number;
  entries: StatusEntry[];
  operation: RepositoryOperationState;
}
```

## 11. History Engine

Support normal history, all refs, first-parent, path history,
`--follow`, ranges, author filtering, grep filtering, and graph-aware
parent relationships.

Use stable custom machine-readable formats rather than localized human
output.

``` ts
interface CommitRecord {
  oid: CommitId;
  parents: CommitId[];
  author: Signature;
  committer: Signature;
  authoredAt: Date;
  committedAt: Date;
  subject: string;
  body?: string;
  decorations: RefDecoration[];
}
```

## 12. Ref Engine

Handle local branches, remote-tracking branches, tags, symbolic refs,
HEAD, detached HEAD, and upstream relationships.

Prefer `git for-each-ref` with machine-readable formatting.

Mutations include create, delete, rename, update, checkout, merge,
reset, push, and fetch. Destructive operations require explicit caller
intent.

## 13. Diff Engine

Support:

-   working-tree diff;
-   staged diff;
-   commit diff;
-   range diff;
-   file and directory diff;
-   rename detection;
-   binary detection;
-   whitespace modes;
-   word diff;
-   combined merge diff.

Large diffs must be streamable.

## 14. Blame Engine

Use porcelain blame output where possible.

Support:

``` text
git blame
git blame --line-porcelain
git blame -L start,end
```

A blame record contains commit, original/final path, line range, author,
author time, committer, and summary.

## 15. Search Engine

Compose Git-native searches from:

``` text
git log --grep
git log -S
git log -G
git rev-list
git log -- path
```

``` ts
type GitSearchQuery =
  | { kind: "message"; text: string }
  | { kind: "author"; text: string }
  | { kind: "path"; path: string }
  | { kind: "pickaxe"; text: string; mode: "string" | "regex" }
  | { kind: "revision"; expression: string };
```

## 16. Worktree Engine

Support:

``` text
git worktree list --porcelain
git worktree add
git worktree remove
git worktree move
git worktree lock
git worktree unlock
git worktree prune
```

``` ts
interface Worktree {
  path: string;
  head?: CommitId;
  branch?: RefName;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isMainWorktree: boolean;
}
```

## 17. Rebase Engine

Detect interactive and merge rebase state, conflicts, pauses, and
sequencer state.

Operations:

``` text
start
continue
skip
abort
edit-todo
```

Interactive rebase should use a controlled temporary editor. Never
overwrite an existing rebase state silently.

## 18. Merge / Cherry-pick / Revert

Support:

``` text
merge
merge --abort
cherry-pick
cherry-pick --continue
cherry-pick --abort
revert
revert --continue
revert --abort
```

Before a mutation, detect incompatible active operations.

## 19. Stash and Remote Engines

Support stash list/show/push/pop/apply/drop/branch.

Support remote listing, fetch, push, prune, URL inspection, and upstream
configuration.

Credentials must never enter logs. Authentication should integrate with
VS Code facilities where possible.

## 20. Git Config

Read configuration at local, worktree, global, and system scopes.

Sensitive keys must be classified and redacted, including credential and
password-like values.

## 21. Streaming

Large operations should expose:

``` ts
AsyncIterable<CommitRecord>
AsyncIterable<DiffChunk>
AsyncIterable<BlameRecord>
```

Consumers must be able to stop consuming without waiting for the full
process.

## 22. Parsing Rules

Parsers must be deterministic, byte-safe, fixture-tested, tolerant of
unusual filenames, null-delimiter aware, and independent of
localization.

Never parse human-readable output when porcelain/custom formats exist.

## 23. Caching

Safe candidates:

-   Git version;
-   repository metadata;
-   immutable commit metadata;
-   ref metadata;
-   parsed graph nodes.

Working-tree status and operation state require validation before reuse.

## 24. Mutation Pipeline

``` text
Validate
  ↓
Acquire repository mutation lock
  ↓
Capture pre-state
  ↓
Execute Git
  ↓
Capture post-state
  ↓
Publish invalidation
  ↓
Release lock
  ↓
Return typed result
```

## 25. Concurrency

Read-only commands may run concurrently.

Mutations serialize per repository to avoid races between fetch, merge,
rebase, reset, checkout, worktree, stash, and agent operations.

## 26. Observability

Track operation ID, repository, command family, duration, result, and
cache behavior. Never log secrets, credential prompts, or sensitive
environment values.

## 27. Testing

Parser fixtures must cover:

-   normal repositories;
-   detached HEAD;
-   empty repositories;
-   merge/rebase;
-   conflicts;
-   rename/copy;
-   Unicode and unusual paths;
-   submodules;
-   shallow clones;
-   multiple worktrees.

Integration tests must exercise init → commit → branch → merge/rebase,
stash, cherry-pick, revert, conflict recovery, and worktree workflows.

## 28. Performance Targets

Engineering targets:

  Operation                                              Target
  ------------------------ ------------------------------------
  Repository discovery                                 \<100 ms
  Status refresh                                       \<150 ms
  Current-line blame                                   \<150 ms
  Cached commit metadata                               \<100 ms
  Initial graph                                     Progressive
  Large graph                                         Streaming
  Large diff                 First content as soon as available

These are targets, not correctness guarantees.

## 29. Definition of Done

The Git Engine is MVP-ready when discovery, argument-array execution,
cancellation, status/history/diff/blame parsing, refs, worktrees,
operation-state detection, normalized errors, mutation serialization,
fixture coverage, and secret-safe logging are all implemented.

## 30. Future Extension Points

Leave clean interfaces for Git LFS, sparse/partial clones, signed
commits, commit-graph acceleration, provider APIs, AI context
extraction, and agent-specific worktrees.
