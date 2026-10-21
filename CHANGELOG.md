# Changelog

All notable changes to GitNexus are documented here.
Format follows Keep a Changelog; versions follow SemVer once 1.0 ships.

## [3.2.0] — 2026-10-21 — GitLens-look graph release

### Added — Phase 15: rich graph rows, generated avatars, Working Changes bar
- **Generated initial avatars**: every commit now shows a colored
  initial avatar (deterministic color per author) in the graph, the
  hover card and the details pane — no Gravatar dependency.
- **Colored lanes**: each graph lane gets its own color from a stable
  palette; edges and commit markers follow the lane color.
- **Ref pills**: branch / remote / tag / HEAD / PR decorations render
  as rounded colored chips on the commit's second line.
- **Two-line rows** at comfortable density (54px): subject, then pills
  + short hash + relative time ("5h ago"); text starts after the lanes
  area instead of indenting per lane. Compact density stays one line.
- **Working Changes bar** pinned above the graph: changed-file count
  badge, expandable file list, and a shortcut to the SCM view.
- **Richer sidebar**: commit items now show author · relative time ·
  short hash.

## [3.1.0] — 2026-10-21 — UI polish release (near-10/10 design pass)

### Added — Phase 14: graph v2, graphical settings, Launchpad cards
- **Graph v2**: rich hover cards (avatar, author, date, hash, refs),
  a right-click context menu (Show Diff / Checkout / Branch / Tag /
  Open on Remote / AI Context / Copy Hash), and an in-panel commit
  details pane (subject, body, author, changed files with statuses)
  that replaces opening a diff document on every click.
- **Columns & density popover** in the graph toolbar, backed by the
  `gitnexus.graph.*` settings; new `gitnexus.graph.density`
  (comfortable 44px / compact 30px rows).
- **Branch filter**: All refs vs Current branch history scopes.
- **Graphical Settings page** (`gitnexus.openSettings`, gear in the
  Commits view title bar and the graph toolbar): Blame, Graph, AI/BYOK
  (keys written straight to SecretStorage), Autolinks and provider
  hosts — all controls write the same `gitnexus.*` settings.
- **Launchpad redesign**: per-repository cards with provider badges,
  a live text filter and an All / PRs / Issues segmented filter.
- **Grouped gutter blame**: annotation text shows only on the first
  line of a same-commit run (heat tint remains on every line).

## [3.0.0] — 2026-10-21 — GitLens Pro parity release

### Added — Phase 13: Launchpad, Code Suggest, BYOK AI, deeper integrations
- **Launchpad** (`gitnexus.openLaunchpad`): a cross-repository hub of
  open pull requests and issues from every workspace repository with a
  GitHub/GitLab/Bitbucket remote — open on the web, check out a PR as
  a local `pr-<n>` branch (PR refs on GitHub/GitLab, source branch on
  Bitbucket), or start a `<issue#>-<slug>` branch from an issue.
  Providers gained `listIssues()` (PRs filtered out on GitHub) and
  fork detection on PR summaries.
- **Code Suggest** (`gitnexus.suggestChanges`, SCM title bar): with a
  PR branch checked out and local changes present, stage + commit +
  push them onto the PR as a suggestion commit (fork PRs are refused
  with a clear message; confirmation is modal).
- **Bring-your-own-key AI**: Gemini (default model gemini-2.5-flash)
  or any OpenAI-compatible endpoint, keys in SecretStorage via
  "GitNexus: Set AI API Key" (`gitnexus.ai.provider`: auto/lm/gemini/
  openai). Generate/explain prefer BYOK, then the editor model.
- **Deeper integrations**: "#123" autolinks now resolve on GitLab and
  Bitbucket remotes too, and "Open Commit on Remote" deep-links a
  commit to its page on any of the three hosts.
- Worktree management re-verified complete (add/remove/move/lock/
  unlock/prune/open-in-new-window, service + view + menus).

## [2.0.0] — 2026-10-21 — PROJECT COMPLETE

The full roadmap is delivered: the original engine/state/features
specs (v1.0) plus the complete GitLens-parity track (Phases 6–12).
71 tests, 68 commands, three PR providers, buffer-accurate blame,
and platform-model AI features.

### Added — Phase 12: file history, graph repo switcher, polish
- **File history**: "Show File History" (editor + Explorer context
  menus) lists a file's commits — following renames — in the
  Search & Compare view, replacing the old text-dump command.
- **Graph repository switcher**: multi-repo workspaces get a repo
  picker in the graph toolbar; switching rebuilds the graph in place.
- **Stash diff**: "Show Stash Diff" opens a stash entry's full patch.
- **Compare file diff**: changed files in a compare result can open
  their merge-base diff directly.

## [1.6.0] — 2026-10-21

### Added — Phase 11: deep links + provider depth
- **Reveal Commit in Graph**: deep link from the Commits and
  Search & Compare views (and the palette) — opens the graph if
  needed and selects/scrolls to the commit.
- **GitHub Enterprise**: remotes on hosts declared in
  `gitnexus.pr.githubEnterpriseHosts` resolve to the GitHub provider
  with the https://<host>/api/v3 base and enterprise web URLs.
- **GitLab enrichment**: per-branch MRs now carry CI status (latest
  pipeline for the head SHA) and review status (approvals API).
- **Bitbucket enrichment**: per-branch PRs now carry CI status
  (commit build statuses) and review status (participants/reviewers).

## [1.5.0] — 2026-10-21

### Added — Phase 10: GitLab & Bitbucket PR adapters
- **GitLab adapter** (gitlab.com + self-hosted): merge requests list
  and per-branch lookup via the v4 API, nested group paths, web create
  URL. Auth: the GitLab auth session when a provider extension is
  installed, otherwise a personal access token stored in
  SecretStorage via "GitNexus: Set GitLab Token". Extra self-hosted
  hosts can be declared in `gitnexus.pr.gitlabHosts`.
- **Bitbucket Cloud adapter**: pull requests via the 2.0 API with
  Basic app-password auth, credentials stored in SecretStorage via
  "GitNexus: Set Bitbucket Credentials".
- Provider resolution now walks remotes (origin first) across all
  three hosts; the PR commands, branch decorations and web
  create-PR flow work unchanged on the chosen provider.

## [1.4.0] — 2026-10-21

### Added — Phase 9: graph polish, autolinks, AI features
- **Graph polish**: Gravatar avatars beside each commit, plus author /
  date / short-hash columns (fixed-position SVG columns over the
  virtual window). Toggle each via `gitnexus.graph.showAvatars`,
  `showAuthor`, `showDate`, `showHash`; open panels re-render on change.
- **Autolinks**: commit text in blame hovers and Commits tooltips now
  links issue references — "#123" resolves to the repository's GitHub
  issues automatically, and custom trackers come from the
  `gitnexus.autolinks` setting ({ prefix, url with <num> }).
- **AI features** on the platform language model (`vscode.lm`, e.g.
  Copilot — no key of ours): "Generate Commit Message (AI)" writes a
  message from the staged diff into the GitNexus SCM input (also on the
  SCM title bar), and "Explain Commit (AI)" explains any commit into a
  Markdown document. Both degrade gracefully when no model is present.

## [1.3.0] — 2026-10-21

### Added — Phase 8: buffer-accurate blame + Search & Compare
- **Buffer-accurate blame**: annotations (current line, gutter, hover,
  CodeLens) now work on unsaved buffers via `git blame --contents`.
  Inserted/edited lines show as uncommitted, shifted lines keep their
  true attribution, and results are cached by content hash. This lifts
  the v1.1.0 "dirty buffers show no annotations" limitation.
- **Search & Compare view** in the GitNexus container:
  `gitnexus.searchCommits` runs qualifier searches
  (`author:`, `message:`, `file:`, `after:`/`before:`) and pickaxe
  searches (`code:text`) into the view; `gitnexus.compareRefs` compares
  two refs — commits in target-not-in-base, commits in base-not-in-
  target, and changed files (merge-base diff). Result commits support
  the usual checkout / create-branch / copy-hash actions.

### Changed
- The palette "Search Commits" command now presents results in the
  Search & Compare view instead of a plain text document.

## [1.2.0] — 2026-10-21

### Added — Phase 7: sidebar views (GitNexus activity-bar container)
- A dedicated **GitNexus activity-bar container** with seven views:
  **Commits** (snapshot history, click to open the commit), **Branches**
  (Local/Remote groups, current first, upstream + ahead/behind),
  **Tags**, **Stashes**, **Remotes**, **Contributors** (author ranking
  from `git shortlog`), and **Worktrees** (moved from the Explorer).
- Tree actions with the repository as context: checkout branch/tag/
  commit, create branch at any ref, delete branch/tag, stash
  apply/pop/drop, fetch remote — mutations route through the same
  coordinator/journal as the palette commands, and views refresh from
  the snapshot store automatically.
- View-title actions: refresh, create branch/tag, stash push.
- `GitService.contributors()` engine read + shortlog parser.

### Notes
- Views render the state engine's snapshot for the primary workspace
  repository; they never call Git directly (Contributors caches per
  snapshot generation).

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
