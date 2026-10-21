# Changelog

All notable changes to GitNexus are documented here.
Format follows Keep a Changelog; versions follow SemVer once 1.0 ships.

## [1.1.0] — 2026-10-21

### Added — Phase 6: editor annotation layer (the GitLens signature)
- **Current-line blame**: an inline annotation at the end of the cursor
  line — author, relative time, commit summary
  (`gitnexus.blame.currentLine.enabled`).
- **Full-file gutter blame** (`gitnexus.blameToggle`, editor context
  menu): author + age column per line with an optional age heat tint
  (`gitnexus.blame.gutter.heatmap`); state persists per workspace.
- **Commit hover card** on any line: subject, body, author, absolute +
  relative dates, copy-hash and show-commit actions
  (`gitnexus.blame.hover.enabled`).
- Blame engine completed: line-porcelain summaries, author emails,
  original line numbers, uncommitted-line detection, and a cached
  `commitInfo` read for hover cards.

### Changed
- **CodeLens rewritten GitLens-style**: one file-level lens (most recent
  change) plus one lens per function/method/class — replacing one lens
  per line. Disable with `gitnexus.blame.codeLens.enabled`.
- Blame results are shared through a cache keyed by canonical root +
  repository generation + file fingerprint (mtime/size), so annotations
  never survive a commit or a saved edit.
- RepositoryStateStore gained an `all()` enumeration used by the
  annotation layer to resolve files to repositories.

### Known limitation
- Annotations read the file from disk; unsaved (dirty) buffers show no
  annotations until saved, so line numbers can never drift.

## [1.0.4] — 2026-10-21

### Fixed
- Scoped refreshes silently degraded to full refreshes when the caller
  held a different spelling of the repository path than Git's canonical
  root: on GitHub's Windows runners `os.tmpdir()` yields the 8.3 short
  form (`C:\\Users\\RUNNER~1\\...`) while `git rev-parse
  --show-toplevel` reports the long form, so the snapshot lookup missed
  and every domain was re-stamped with the new generation (the state
  integration freshness assertion failed: expected head generation 2,
  got 3 — reproduced locally with a symlinked path alias).
  `RepositoryManager.refreshScoped` now resolves a missed path through
  Git discovery to the canonical identity and retries the lookup once
  before falling back; the integration test also uses the canonical
  root for its scoped call, like the rest of the test.

## [1.0.3] — 2026-10-21

### Fixed
- RepositoryManager reacted to its own diff publications: every refresh
  that changed HEAD/refs emitted bus events that the manager's own
  subscription treated as invalidations, scheduling a phantom scoped
  refresh ~120 ms later and inflating snapshot generations
  nondeterministically. On the fast Linux runners the extra refresh
  landed in harmless windows; on Windows it landed mid-refresh and a
  state integration generation assertion failed (expected 2, got 3).
  Diff publications are notifications of already-applied state, not
  invalidations — the manager now marks its own emissions (the bus is
  synchronous) and ignores them; watcher events and multi-worktree
  sibling propagation still schedule refreshes as designed. A
  regression assertion (generation stays put after a diff publication)
  fails deterministically without the fix.

## [1.0.2] — 2026-10-21

### Fixed
- Test script portability: `node --test dist/test/*.test.js` relied on
  glob expansion that Windows shells (cmd/PowerShell via npm) never
  perform and Node 20's test runner does not do either, so the Windows
  Node 20 CI job failed with "Could not find 'dist\\test\\*.test.js'".
  A small runner (`scripts/run-tests.mjs`) now enumerates the compiled
  test files and passes an explicit list — identical behavior on every
  OS, shell and supported Node version.

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
