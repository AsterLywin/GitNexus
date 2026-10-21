# GitNexus

GitNexus is an open-source, local-first Git intelligence extension for
VS Code. It is built on two specifications — a strict Git engine and a
repository state model — so every view reads the same coherent snapshot
instead of shelling out to Git on its own.

**v1.0.0** implements both specifications end to end: the engine, the
state model, the full feature surface, a provider-neutral pull-request
layer (GitHub adapter included), and an AI context engine.

## Features

- **Commit graph** — virtualized rendering (bounded DOM at any history
  size), ref and PR decorations, search with next/previous match, and
  per-commit actions: checkout, create branch/tag, copy hash, add to AI
  context.
- **Launchpad** — a cross-repository hub of open pull requests and
  issues (GitHub/GitLab/Bitbucket) with web open, PR checkout as a
  local branch, and start-work branches from issues; plus Code Suggest
  to push changes onto the current PR.
- **AI assist** — generate a commit message from the staged diff and
  explain any commit, via the editor's language model (e.g. Copilot)
  or your own Gemini/OpenAI API key (SecretStorage); issue references
  in commit text autolink to your host or tracker.
- **Blame annotations** — current-line blame (author, relative time,
  summary), full-file gutter blame with age heat (toggle from the editor
  context menu), commit hover cards, and file/per-function CodeLens —
  all accurate on unsaved buffers too (`git blame --contents`).
- **Sidebar views** — a GitNexus activity-bar container with Commits,
  Branches, Tags, Stashes, Remotes, Contributors, Worktrees and a
  Search & Compare view (qualifier + pickaxe search, two-ref compare,
  per-file history), with checkout / create / delete / stash / fetch
  actions in context.
- **Source control** — staged/unstaged groups, stage/unstage/discard,
  commit, file badges and Git theme colors, rename-aware tooltips.
- **Branches, tags, remotes, stash** — full CRUD plus fetch/pull/push
  building blocks, pickaxe search, ranged blame, file history.
- **Worktrees** — explorer tree view with add / remove / move / lock /
  unlock / prune / open, and cross-worktree state propagation.
- **Conflicts** — three-way view (base / ours / theirs served from the
  index), ours↔theirs diff, one-click ours/theirs resolution, staging.
- **Operation lifecycle** — continue / skip / abort for merge, rebase,
  cherry-pick and revert; interactive rebase planner with todo editing,
  including editing the todo of a rebase already in progress.
- **Pull requests (GitHub incl. Enterprise, GitLab, Bitbucket)** —
  open-PR list and decorations on the graph, per-branch PR status with
  CI and review state on all three providers, create-PR flow; GitLab
  tokens and Bitbucket app passwords live in SecretStorage.
- **AI context** — build a Markdown context package (commits, changed
  files, limitations) pinned to the repository generation; the status
  bar flags it when it goes stale.
- **Graceful degradation** — shallow clones, partial clones, sparse
  checkouts, detached HEAD, Git LFS and missing remotes/tags are
  detected from Git and surfaced, with a Fetch More History action.

## Architecture

```text
VS Code commands / panels
        ↓
Feature services (graph, SCM, conflicts, rebase, worktrees, PR, AI)
        ↓
Repository Manager — refresh transactions, event bus, operation journal
        ↓
Repository State Store — snapshots with full domains + freshness
        ↓
Git services + backend — normalized errors, capabilities, streaming
        ↓
Git CLI (array argv, never a shell)
```

See `docs/GIT_ENGINE_SPEC.md`, `docs/REPOSITORY_STATE_MODEL.md`,
`docs/ROADMAP.md`, `docs/ENGINEERING_STATUS.md` and
`docs/PERFORMANCE.md`.

## Performance (10,000-commit repository)

| Measurement | Target | Measured |
|---|---:|---:|
| status, clean tree | < 150 ms | 7.6 ms |
| status, 500 untracked files | < 400 ms | 8.2 ms |
| graph layout, 10k commits | < 2 s | 9.6 ms |

Reproduce with `npm run benchmark`.

## Development

```bash
npm ci
npm test          # build + unit and real-Git integration suites (41 tests)
npm run package   # produce a .vsix with vsce
```

Press `F5` in VS Code to launch an Extension Development Host.

## Publishing

```bash
npx @vscode/vsce publish   # requires a publisher account + PAT
```

## License

Apache-2.0
