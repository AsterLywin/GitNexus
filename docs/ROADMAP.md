# GitNexus — Roadmap to 100%

**Baseline:** 2026-10-20 · Code state: v0.1.3 + compile-fix commit + all five phases (build clean, 41/41 tests pass, VSIX 1.0.0 packaged)
**Reference specs:** [GIT_ENGINE_SPEC.md](./GIT_ENGINE_SPEC.md) · [REPOSITORY_STATE_MODEL.md](./REPOSITORY_STATE_MODEL.md)

## Where we are: 100% — v1.0.0 (all phases complete)

| Area | Done | State |
| --- | --- | --- |
| Git Engine | ~85% | Execution, status/log parsers, full typed service set, normalized error model, capabilities, streaming backend, mutation lock. Remaining engine work is mostly Phase 3 fixture/integration depth. |
| Repository State Model | ~85% | Full snapshot domains with per-domain freshness, typed event bus with the spec invalidation matrix, refresh transactions with scoped/coalesced refresh, operation journal with crash recovery, multi-worktree stale propagation. Remaining: Phase 3 state-transition test depth. |
| Features / UI | ~90% | Render-model graph panel (windowed virtual rendering, navigator search with next/previous, commit actions), worktree tree view with full command set, three-way conflict view with stage documents, generic operation lifecycle (continue/skip/abort), SCM file decorations, degradation notices (shallow/detached/no-remotes/no-tags). Remaining: the Phase 5 platform layers. |
| Tests / Release | ~85% | Tests green (34, incl. fixture matrix and state-transition suites); lockfile committed; §28 benchmark targets all pass; VSIX 0.2.0 packages cleanly. CI workflow written, held for hand-over at completion (connector cannot push workflows; the file was handed to Aster at v1.0.0). Fixture matrix, CI and packaging verification are Phase 3. |

Percentages below are cumulative completion of the full v1.0 scope
(both specs' Definitions of Done + the PR/AI layers in `ENGINEERING_STATUS.md`).

---

## Phase 1 — Git Engine correctness core → ~58%

Goal: close the Git Engine spec (§29 DoD), except its test items (Phase 3).

- [x] **Normalized error model** (Engine §6): typed `GitErrorCode` union with all 17 codes,
      stderr/exit-code mapping, `recoverable` flag and `suggestedActions`; retire the
      generic `GIT_EXIT` / `GIT_PROCESS_ERROR` codes.
- [x] **Version & capabilities** (Engine §8): `git --version` parsing, `GitCapabilities`
      detection, graceful degradation per feature.
- [x] **Backend contract + streaming** (Engine §3, §21): formal `GitBackend` interface with
      `stream()`; `AsyncIterable` history/diff/blame so large results are consumable
      incrementally and cancellable mid-stream.
- [x] **Missing typed services** (Engine §9, §18–§20): `GitTagService`,
      `GitRemoteService` (fetch / push / pull / prune / upstream),
      `GitMergeService`, `GitCherryPickService`, `GitRevertService`,
      `GitConfigService` (scoped reads + secret redaction), `GitSubmoduleService`.
- [x] **Engine depth on existing services** (Engine §11–§16): history ranges,
      first-parent, `--follow`, author/grep filters; diff staged/range/rename/binary/
      word-diff modes; blame `-L` line ranges; pickaxe search (`-S` / `-G`);
      worktree move/lock/unlock/prune.
- [x] **Caching + observability** (Engine §23, §26): immutable commit/ref caches,
      operation IDs and duration logging with secret-safe output.

**Exit criteria:** every Engine §29 item except fixture/integration coverage is demonstrably true.

## Phase 2 — Repository State Model completion → ~72%

Goal: close the State Model spec (§42 DoD).

- [x] **Full state domains** (State §4–§11): refs, remotes, worktrees, operation,
      stashes, submodules and derived state as first-class snapshot domains,
      each with its own freshness metadata (State §13).
- [x] **Typed event bus + invalidation matrix** (State §15–§16): the 11
      `RepositoryEvent` types; per-event invalidation exactly as the matrix specifies.
- [x] **Targeted watching + polling** (State §17–§19): watch the `.git` paths the spec
      lists (HEAD, index, refs, logs, operation files, worktrees) instead of `**/*`;
      adaptive validation polling for network filesystems.
- [x] **Refresh transactions & generations** (State §14, §20–§21): coherent snapshot
      commits, derived caches keyed by `basedOnGeneration`.
- [x] **Mutation discipline** (State §22–§25, Engine §24): *all* mutations route through
      `MutationCoordinator` (remove direct feature-level mutations); destructive
      operations validate preconditions (expected HEAD / ref target);
      optimistic UI reconciles against authoritative refresh.
- [x] **Operation journal + crash recovery** (State §31–§32): journal entries per
      mutation; on restart, rediscover + detect active operations, never auto-continue.
- [x] **Multi-worktree semantics** (State §26): shared (refs/objects) vs per-worktree
      (HEAD/index/operation) state modelled separately in the store.

**Exit criteria:** every State §42 item is demonstrably true; UI consumes snapshots only.

## Phase 3 — Test & release gates → ~80%

Goal: make "done" provable and shippable.

- [x] **Parser fixtures** (Engine §27): detached HEAD, empty repo, merge/rebase
      conflicts, rename/copy, Unicode/unusual paths, submodules, shallow clones,
      multiple worktrees.
- [x] **Integration tests** (Engine §27, State §41): init → commit → branch →
      merge/rebase, stash, cherry-pick, revert, conflict recovery, worktree
      workflows; state-transition tests (CLEAN → DIRTY → INDEX_DIRTY → CLEAN …),
      including external mutations between reads.
- [x] **CI**: GitHub Actions build + test on every push; commit `package-lock.json`
      and switch installs to `npm ci`.
- [x] **Performance validation** (Engine §28): status refresh < 150 ms target,
      progressive first paint of the graph, 10k-commit repository benchmark
      against the virtual renderer.
- [x] **Packaging**: `vsce package` verified, versioning + CHANGELOG discipline.

**Exit criteria:** CI green on main; a packaged `.vsix` installs and passes a smoke test.

## Phase 4 — Feature completion → ~90%

Goal: finish the feature surface the current code only sketches.

- [x] **Graph**: adopt `GraphRenderModel` + virtual renderer in the live panel
      (today the panel still renders via `renderGraphHtml`); graph-side branch
      actions (checkout / create / delete from a commit); full ref-aware topology.
- [x] **Worktree UI**: add / remove / move / lock / prune commands and a worktree
      panel (service exists, UI is list-only today).
- [x] **Conflict resolution editor**: three-way merge view on top of the existing
      conflict panel actions (open / ours / theirs / stage).
- [x] **SCM completion**: gutter actions, richer decorations, open-file and
      revert polish.
- [x] **Rebase lifecycle**: continue / skip / abort and edit-todo for an
      *in-progress* rebase (today: planning + start only).

**Exit criteria:** every command declared in `package.json` has a complete,
state-model-driven implementation; no placeholder flows remain.

## Phase 5 — Platform layers & v1.0 → 100%

Goal: the layers the architecture reserves for last (State Layers C & D).

- [x] **Provider-neutral PR layer**: PR / review / CI status as external state on
      graph and branches; GitHub as the first adapter.
- [x] **AI context engine** (State §29): selection → context builder pinned to the
      repository generation, with staleness surfacing in the UI; provider adapters.
- [x] **Graceful-degradation states** (State §35, Engine §30): shallow / partial /
      sparse repositories detected and messaged ("history is limited — fetch more");
      Git LFS awareness.
- [x] **Release**: Marketplace publishing, README/docs polish, **v1.0.0**.

**Exit criteria:** both specs fully implemented, PR + AI layers shipped, v1.0.0 published.

---

## Ordering rationale

Engine before state (state is built from engine results), state before
features (features must consume snapshots, not raw Git), tests as a hard gate
before calling anything "done", and PR/AI last because they sit on the
external/AI state layers that depend on everything below them.
