# GitNexus Engineering Status

## Implemented foundation

- Native Git process execution with timeout/cancellation
- Typed repository state
- Porcelain-v2 status parsing
- Commit history parsing
- DAG-based commit graph layout
- Interactive graph zoom/pan/selection
- Branch, remote and tag ref discovery
- Graph ref decorations
- Commit search qualifiers
- File history
- Blame CodeLens
- Commit details and diff
- Ref comparison
- Initial rebase service
- Initial worktree service

## Architectural rule

Feature code must depend on typed services, not directly on `child_process`.
Mutating Git operations must eventually pass through a repository mutation coordinator
that performs validation, locking, pre-state capture, execution, post-state refresh,
and cache invalidation.

## Next hardening areas

1. Mutation coordinator and repository locks
2. Operation-state detection and conflict UI
3. Full ref-aware graph topology
4. Interactive rebase editor
5. Worktree UI
6. SCM decorations and gutter actions
7. Virtualized graph rendering for large histories
8. Provider-neutral pull request layer
9. AI context engine and provider adapters


## Hardening slice

- Repository mutation coordinator
- Per-repository serialization lock
- Operation state model
- Rebase/merge/cherry-pick conflict detection
- Conflict path extraction
- Initial SCM resource provider
- Worktree manager
- Rebase planning validation

All mutating operations should migrate to `MutationCoordinator`; direct mutation
from feature code is considered a temporary compatibility path and should be removed.


## UI/SCM and Branch Workflow

Implemented in the current slice:

- Native VS Code Source Control provider
- Separate staged/unstaged resource groups
- File-level stage and unstage actions
- Branch discovery with upstream/ahead/behind data
- Branch switching and creation commands
- Rebase planner that enumerates `upstream..HEAD`
- Rebase plan execution through a temporary sequence-editor script
- Mutation Coordinator used for branch/stage/unstage/rebase mutations

Known next hardening targets:

1. full SCM diff/open/revert commands
2. branch delete/rename UI
3. conflict-resolution editor
4. true drag/drop rebase todo editor
5. graph-side branch actions
6. Git status file watching and automatic refresh


## Interactive Rebase + Conflict UX

- Webview interactive rebase planner
- Drag/drop commit ordering
- Rebase action selection: pick/reword/edit/squash/fixup/drop
- Rebase todo validation and serialization
- Conflict index inspection through `git ls-files -u`
- Conflict panel with open/use-ours/use-theirs/stage actions

The planner is intentionally separate from the Git engine so the same rebase
plan can later be driven by a CLI backend, libgit2 backend, or remote execution layer.

## SCM Completion Slice

- Native staged/unstaged SCM groups
- Commit input and staged commit command
- File diff command
- Safe discard confirmation
- Automatic repository refresh through FileSystemWatcher with debounce
- Branch delete/rename commands
- Stash push/list/apply/pop/drop workflow
- Conflict panel command wiring


## Commit Graph Performance Slice

- Render model separates graph topology from DOM/SVG rendering
- Row-based virtualization with overscan
- Graph filtering by text/ref/author/merge visibility
- Keyboard-style next/previous graph navigation model
- Dedicated virtual renderer
- Edge rendering preserves connections touching the visible window

The existing graph UI can adopt `GraphRenderModel` incrementally; this avoids
coupling Git history retrieval to a specific rendering technology.

## Phase 1 — Git Engine correctness core (2026-10-20)

- Normalized error model: all 16 spec `GitErrorCode`s with stderr classification,
  recoverable flags and suggested recovery actions (`src/git/errors.ts`);
  the process executor and the streaming backend both emit it
- Git version parsing + capability detection with a supported floor (Git >= 2.11)
- `GitBackend` contract with buffered `execute()` and chunked `stream()`;
  `GitService.logStream()` yields commits incrementally via `streamCommits()`
- New typed services: Tag, Remote (fetch/pull/push/prune), Merge, CherryPick,
  Revert, Config (scoped, with secret redaction), Submodule
- Engine depth: log options (ranges, first-parent, --follow, author/grep/date,
  path), diff modes (staged/commit/range/word/name-status), blame ranges and
  revisions, pickaxe search (-S/-G), worktree move/lock/unlock/prune
- Metadata TTL cache and a secret-safe in-memory operation log (command family
  + duration + outcome only), wired through executor, backend and extension
- Bug found by the new integration test: `for-each-ref` does not expand
  `%x1f` (that is pretty-format syntax), so RefService, BranchService and
  TagService silently mis-parsed real Git output; formats now carry a literal
  separator and are covered by a real-Git integration test (23 tests total)

## Phase 2 — Repository State Model completion (2026-10-20)

- Full state domains on the snapshot (refs, remotes, worktrees, operation,
  stashes, submodules, derived) each with per-domain freshness
  (observedAt / generation / source / stale) — `src/domain/state.ts`
- Typed event bus (`RepositoryEventBus`) carrying the spec's 11
  `RepositoryStateEvent`s; the §16 invalidation matrix is exported as data
  and events map to minimal refresh scopes via `scopesForEvent`
- RepositoryManager refresh transactions: read → build one coherent
  snapshot → commit → publish diff-derived events; scoped refresh re-reads
  only requested domains and preserves other domains' freshness
  generations; event bursts are coalesced (debounce) before refreshing
- Adaptive validation polling per opened repository (HEAD check), and
  multi-worktree propagation: sibling worktrees sharing a common Git dir
  get their refs marked stale and refreshed
- Watcher rework: `.git` paths are classified (HEAD/index/refs/logs/
  operation files/worktrees) into typed events by `classifyGitPath`;
  worktree files map to WORKTREE_CHANGED; the bus drives refresh
- Mutation discipline: MutationCoordinator gains env support, an
  `expectHead` precondition (StateConflictError on unexpected movement),
  an `allowDuringConflict` path for resolution steps, and journal wiring;
  its state record now logs only the command family (secret safety).
  ConflictService checkout/stage and RebasePlanner execution now route
  through the coordinator; extension command mutations already did
- Operation journal persisted in globalState; on activation, operations
  left "running" by a previous session are reported as interrupted and
  never auto-continued (§31)

## Phase 3 — Test & release gates (2026-10-20)

- Fixture matrix (real Git, test/fixtures.integration.test.ts): empty
  repository, detached HEAD, staged rename, Unicode/space paths, merge
  conflict → abort state transitions (State Model §41), stash /
  cherry-pick / revert service flows, multiple worktrees, submodule,
  shallow clone
- Two real bugs the fixtures exposed, both fixed: the porcelain-v2 status
  parser mis-parsed rename records (score token leaked into the path,
  originalPath never populated), and the operation detector resolved
  `git rev-parse --git-path` relative paths against the process cwd
  instead of the repository root. `GitService.log` now returns [] for
  empty repositories
- Performance (§28) via scripts/benchmark.mjs + docs/PERFORMANCE.md:
  status 7.6 ms clean / 8.2 ms with 500 untracked files, 10k-commit
  graph layout 9.6 ms, render window 1.6 ms — every target passes
- Release discipline: package-lock.json committed (npm ci), CHANGELOG.md
  started, version 0.2.0, .vscodeignore added, package entrypoint fixed
  (main now dist/src/extension.js) and `vsce package` verified
  (85 files, ~92 KB VSIX, held locally with the CI workflow)
- CI workflow (matrix: Ubuntu/Windows × Node 20/22, npm ci, tests,
  VSIX artifact) is written and held off-repo at Aster's request until
  project completion — the connector cannot push workflow files

## Phase 4 — Feature completion (2026-10-20)

- Graph panel rebuilt on the render model: createRenderModel +
  getRenderWindow + GraphVirtualRenderer render ~240-row windows that
  swap on scroll (the old whole-graph renderGraphHtml path and the dead
  src/ui panel are gone). Search runs through GraphNavigator with
  next/previous match (toolbar and commands), and selecting a commit
  exposes Checkout / Branch / Tag / Copy hash actions. Ref decorations
  ride the model (node refs now render as badges)
- Worktree UI: explorer tree view with main/locked/prunable state and
  context menus; add / remove (with force retry) / move / lock / unlock /
  prune / open commands, all mutations through the coordinator
- Conflict resolution: stage documents (gitnexus-stage: scheme) serve
  base/ours/theirs content; the panel gained a 3-way view (ours ↔ theirs
  diff + base), per-stage open, and an operation banner with
  continue/abort; the list refreshes after every action
- Operation lifecycle: OperationService maps merge/rebase/cherry-pick/
  revert × continue/skip/abort (merge skip correctly rejected) with
  GIT_EDITOR=true on continue; generic gitnexus.operation* commands;
  RebaseService.action now allows conflicted state. Rebase skip and
  in-progress todo editing (gitnexus.rebaseEditTodo) added; the declared
  but unregistered openRebasePlanner / graphNextMatch /
  graphPreviousMatch commands are now implemented — all 40 declared
  commands have real registrations (verified mechanically)
- Degradation: DerivedState.notices (shallow-clone, detached-head,
  no-remotes, no-tags) computed from real repository facts; surfaced in
  status and as a graph-panel notice for shallow clones
- SCM: resource tooltips carry kind and rename origin; a file decoration
  provider adds letter badges + Git theme colors from the same snapshot

## Phase 5 — Platform layers & v1.0.0 (2026-10-21)

- Layer C (external state): provider-neutral PullRequestProvider with a
  GitHub REST adapter — open PRs, per-branch lookup enriched with CI
  check-run aggregation and review status; remote URLs parsed for all
  common GitHub forms. PRs render as graph decorations on the head
  branch's commit and through prList / prStatus / prCreate commands
- Layer D (AI state): AiContext per State Model §29 — built from a
  snapshot, pinned to its generation, rendered to Markdown, copied via
  command; staleness is computed against the live generation and shown
  in the status bar (none / fresh / stale with both generations); the
  graph can add commits to the AI selection
- Degradation (§35): RepositoryFeatures detection (shallow, partial
  clone via promisor remotes, sparse checkout, sparse index) + Git LFS
  awareness feed DerivedState.notices; Fetch More History offers
  deepen-by-100 or full unshallow from the palette and the graph notice
- Release: README rewritten, version 1.0.0, 41/41 tests, benchmark
  re-verified, VSIX packaged. Marketplace publishing remains a
  maintainer action (needs the publisher's PAT); the CI workflow file
  is handed over with this release for the maintainer to commit
