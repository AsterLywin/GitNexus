# Changelog

All notable changes to GitNexus are documented here.
Format follows Keep a Changelog; versions follow SemVer once 1.0 ships.

## [1.0.1] — 2026-10-21

### Fixed
- Windows path canonicalization: Git reports repository roots with
  forward slashes (`C:/repo`) while Node/VS Code use backslashes
  (`C:\repo`), so snapshot-store keys, watcher bus events and the SCM
  provider's root comparison silently mismatched on Windows — watcher-
  driven refresh and SCM updates never fired. All root keys now pass
  through `normalizeRootPath` (separators, drive-letter case, trailing
  slash) at the store/manager boundary. Caught by the Windows CI matrix
  (state integration: HEAD_CHANGED bus assertion); the same test now
  uses the canonical root from the opened snapshot.

## [1.0.0] — 2026-10-21

First stable release. Both specifications are implemented end to end.

### Added
- Provider-neutral pull-request layer (Layer C) with a GitHub adapter:
  open-PR listing, PR decorations on the graph, per-branch PR status
  enriched with CI check-runs and review state, and a create-PR flow
- AI context engine (State Model §29): context packages (commits, files,
  diffs, prompt lines) pinned to the repository generation, a graph
  "Add to AI context" selection, Markdown rendering, clipboard copy,
  and status-bar staleness surfacing with rebuild offers
- Full repository-feature detection (State Model §35): shallow,
  partial clone, sparse checkout, sparse index, plus Git LFS awareness;
  degradation notices extended accordingly and a Fetch More History
  command (deepen or unshallow) wired into the graph notice
- README rewritten for v1.0; roadmap complete (see docs/ROADMAP.md)

### Notes
- The CI workflow (.github/workflows/ci.yml) is maintained with the
  release: build + test matrix on Ubuntu/Windows × Node 20/22 with a
  VSIX artifact. It is added by the maintainer (the automation account
  cannot push workflow files).
- Marketplace publishing requires the publisher's own credentials:
  `npx @vscode/vsce publish`.

## [0.3.0] — 2026-10-20

### Added
- Graph panel on the render model: windowed virtual rendering (bounded
  DOM at any history size), navigator search with next/previous match,
  and commit actions (checkout, create branch/tag, copy hash)
- Worktrees explorer view with add/remove/move/lock/unlock/prune/open
- Three-way conflict view: base/ours/theirs stage documents and an
  ours ↔ theirs diff, plus operation continue/abort from the panel
- Generic operation lifecycle commands (continue/skip/abort for merge,
  rebase, cherry-pick, revert), rebase skip, and in-progress rebase
  todo editing
- Derived degradation notices (shallow clone, detached HEAD, no
  remotes, no tags) in status and the graph panel
- SCM file decorations: letter badges and Git theme colors per change

### Fixed
- Declared commands gitnexus.openRebasePlanner, gitnexus.graphNextMatch
  and gitnexus.graphPreviousMatch had no registrations; all 40 declared
  commands are now implemented
- Rebase continue/abort ran through the mutation coordinator without
  the conflict allowance, so continuing a conflicted rebase failed

## [0.2.0] — 2026-10-20

First packaged build (developer preview). Produced by the Phase 1–3
program described in docs/ROADMAP.md; packaged VSIX verified locally.

### Added
- Spec-complete error model: 16 normalized `GitErrorCode`s with stderr
  classification, recoverability and suggested actions, emitted by both
  the process executor and the Git backend
- Git version detection and capability matrix (floor: Git ≥ 2.11)
- `GitBackend` abstraction with bounded execution and output streaming
  (`GitService.logStream`)
- Missing engine services: Tag, Remote, Merge, Cherry-pick, Revert,
  Config (with secret redaction), Submodule
- Engine depth: staged/commit/range/word diffs, name-status diffs,
  ranged blame and blame at a revision, pickaxe search (`-S`/`-G`),
  worktree move/lock/unlock/prune
- Full repository state model: snapshot domains (refs, remotes,
  worktrees, operation, stashes, submodules, derived) with per-domain
  freshness, a typed event bus with the spec invalidation matrix,
  refresh transactions and scoped/coalesced refreshes, adaptive
  validation polling, multi-worktree stale propagation
- Operation journal persisted across sessions; interrupted operations
  are reported on activation and never auto-continued
- Mutation preconditions (`expectHead` → `StateConflictError`) and
  conflict-resolution routing through the `MutationCoordinator`
- Parser fixture matrix and real-Git integration suites (34 tests):
  empty repositories, detached HEAD, renames, Unicode paths, merge
  conflicts and aborts, stash/cherry-pick/revert flows, submodules,
  shallow clones, multiple worktrees, state transitions
- Performance benchmark (`npm run benchmark`) — all §28 targets pass
  with wide margins; see docs/PERFORMANCE.md
- This changelog; committed `package-lock.json` (installs use `npm ci`)

### Fixed
- v9 compile errors in the graph render model and SCM provider
  (the snapshot now builds cleanly and its tests run)
- `for-each-ref` parsing: `%x1f` is not expanded outside pretty formats;
  ref/branch/tag listings now use literal separators (they silently
  mis-parsed real Git output before)
- Status parser: rename/copy records (porcelain v2 type 2) now parse
  the path correctly and populate `originalPath`
- Operation detector: `git rev-parse --git-path` results are resolved
  against the repository root, not the process working directory
  (conflict detection silently depended on where VS Code was launched)
- `GitService.log` returns an empty history for empty repositories
  instead of surfacing Git's "does not have any commits" error
- Package entrypoint: `main` pointed at `dist/extension.js`, which the
  build never produced (`dist/src/extension.js`); VSIX packaging works

## [0.1.3] — 2026-10-20

- Imported v9 graph-performance snapshot (did not compile; see 0.2.0).
