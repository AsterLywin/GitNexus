import assert from "node:assert/strict";
import test from "node:test";
import { RepositorySnapshot } from "../src/domain/git";
import { INVALIDATION_MATRIX, freshDomains, scopesForEvent } from "../src/domain/state";
import { diffSnapshotEvents } from "../src/app/repositoryManager";
import { OperationJournal } from "../src/state/operationJournal";
import { classifyGitPath } from "../src/features/scm/gitWatcher";

function snapshot(partial: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    identity: { rootUri: "/r", gitDir: "/r/.git", commonDir: "/r/.git", isBare: false },
    head: { commit: "aaa", ref: "main", detached: false },
    status: { ahead: 0, behind: 0, entries: [], isClean: true },
    commits: [],
    generation: 1,
    updatedAt: 1,
    domains: {
      refs: { refs: [], branches: [], remotes: [], tags: [] },
      remotes: [],
      worktrees: [{ path: "/r", detached: false, locked: false, prunable: false }],
      operation: { phase: "idle", conflictPaths: [] },
      stashes: [],
      submodules: [],
      derived: { basedOnGeneration: 1, clean: true, conflicted: false, changedFiles: 0, aheadBehind: {}, conflictPaths: [] },
      freshness: freshDomains(1)
    },
    ...partial
  };
}

test("scopesForEvent maps events to the smallest refresh scopes", () => {
  assert.deepEqual(scopesForEvent({ type: "INDEX_CHANGED" }), ["status"]);
  assert.deepEqual(scopesForEvent({ type: "HEAD_CHANGED" }), ["head", "status", "operation"]);
  assert.deepEqual(scopesForEvent({ type: "REMOTE_UPDATED", remote: "origin" }), ["remotes", "refs"]);
  assert.deepEqual(scopesForEvent({ type: "FULL_REFRESH_REQUIRED" }), ["all"]);
  assert.equal(Object.keys(INVALIDATION_MATRIX).length, 11);
  assert.equal(INVALIDATION_MATRIX.HEAD_CHANGED.graph, "invalidate");
});

test("diffSnapshotEvents detects head, stash and operation transitions", () => {
  const before = snapshot();
  const after = snapshot({
    head: { commit: "bbb", ref: "main", detached: false },
    generation: 2
  });
  after.domains!.stashes = [{ index: 0, ref: "stash@{0}", subject: "wip" }];
  after.domains!.operation = { phase: "running", operation: "merge", conflictPaths: [] };

  const types = diffSnapshotEvents(before, after).map(e => e.type);
  assert.ok(types.includes("HEAD_CHANGED"));
  assert.ok(types.includes("REFS_CHANGED")); // stash is ref state
  assert.ok(types.includes("OPERATION_STARTED"));

  assert.deepEqual(diffSnapshotEvents(before, snapshot()), []);
});

test("journal marks operations left running across a restart as interrupted", () => {
  const journal = new OperationJournal();
  const id = journal.begin({ type: "rebase", repo: "/r", preGeneration: 3 });
  const doneId = journal.begin({ type: "commit", repo: "/r", preGeneration: 3 });
  journal.complete(doneId, 4);

  // Simulate a restart: serialize, reload.
  const restored = new OperationJournal(undefined, journal.serialize());
  const interrupted = restored.interrupted();
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].operationId, id);
  assert.equal(interrupted[0].type, "rebase");
  // The completed entry survives untouched; nothing is auto-continued.
  assert.equal(restored.list("/r").find(e => e.operationId === doneId)?.status, "success");
});

test("classifies .git paths into typed state events", () => {
  assert.equal(classifyGitPath("/r/.git/HEAD")?.type, "HEAD_CHANGED");
  assert.equal(classifyGitPath("/r/.git/index")?.type, "INDEX_CHANGED");
  assert.equal(classifyGitPath("/r/.git/refs/heads/main")?.type, "REFS_CHANGED");
  assert.equal(classifyGitPath("/r/.git/logs/HEAD")?.type, "HEAD_CHANGED");
  assert.equal(classifyGitPath("/r/.git/MERGE_HEAD")?.type, "OPERATION_CHANGED");
  assert.equal(classifyGitPath("/r/.git/rebase-merge/done")?.type, "OPERATION_CHANGED");
  assert.equal(classifyGitPath("/r/.git/worktrees/wt2/HEAD")?.type, "WORKTREE_LIST_CHANGED");
  assert.equal(classifyGitPath("/r/.git/objects/ab/cdef"), undefined);
  assert.equal(classifyGitPath("/r/src/a.ts")?.type, "WORKTREE_CHANGED");
});
