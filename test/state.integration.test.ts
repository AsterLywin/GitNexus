import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { MutationCoordinator, StateConflictError } from "../src/app/mutationCoordinator";
import { RepositoryManager } from "../src/app/repositoryManager";
import { RepositoryStateEvent } from "../src/domain/state";
import { GitService } from "../src/git/gitService";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";
import { RepositoryOperationDetector } from "../src/git/repositoryOperationDetector";
import { RepositoryEventBus } from "../src/state/eventBus";
import { OperationJournal } from "../src/state/operationJournal";
import { RepositoryStateStore } from "../src/state/repositoryStateStore";

const run = promisify(execFile);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("state model: domains, generations, scoped freshness, bus events, mutation preconditions", async t => {
  const gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  if (!gitAvailable) { t.skip("git not available"); return; }

  const dir = await mkdtemp(join(tmpdir(), "gitnexus-state-"));
  try {
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "one\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "first"], { cwd: dir });

    const executor = new NodeGitProcessExecutor();
    const git = new GitService(executor);
    const store = new RepositoryStateStore();
    const bus = new RepositoryEventBus();
    const events: RepositoryStateEvent[] = [];
    bus.subscribe((root, event) => { if (root === dir) events.push(event); });

    const manager = new RepositoryManager(git, store, { executor, bus, pollIntervalMs: 0 });
    const first = await manager.open(dir);

    // Full domains populated (§4)
    assert.ok(first.domains);
    assert.equal(first.domains.refs.branches[0]?.shortName, "main");
    assert.equal(first.domains.worktrees.length, 1);
    assert.equal(first.domains.operation.phase, "idle");
    assert.equal(first.domains.derived.clean, true);
    assert.equal(first.generation, 1);
    assert.equal(first.domains.freshness.status.generation, 1);

    // External mutation (§23): a commit made outside GitNexus.
    await writeFile(join(dir, "a.txt"), "one\ntwo\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "second"], { cwd: dir });

    const second = await manager.refresh(dir);
    assert.equal(second.generation, 2);
    assert.notEqual(second.head.commit, first.head.commit);
    assert.ok(events.some(e => e.type === "HEAD_CHANGED"), "HEAD_CHANGED published on the bus");
    assert.ok(events.some(e => e.type === "REFS_CHANGED"), "REFS_CHANGED published (log/HEAD + new commit)");

    // Scoped refresh (§37, §14): only status is re-observed; the head
    // domain keeps its original generation in the freshness map.
    await writeFile(join(dir, "a.txt"), "dirty\n");
    const scoped = await manager.refreshScoped(dir, ["status"]);
    assert.equal(scoped.status.entries.length, 1);
    assert.equal(scoped.domains!.freshness.status.generation, scoped.generation);
    assert.equal(scoped.domains!.freshness.head.generation, 2);
    assert.equal(scoped.domains!.derived.clean, false);
    await run("git", ["checkout", "--", "a.txt"], { cwd: dir });

    // Bus-driven refresh: a classified watcher event triggers a coalesced
    // scoped refresh through the manager's own subscription (§15, §19).
    events.length = 0;
    await writeFile(join(dir, "b.txt"), "new\n");
    bus.emit(dir, { type: "WORKTREE_CHANGED", paths: ["b.txt"] });
    await delay(600);
    const afterBus = store.get(dir);
    assert.ok(afterBus && afterBus.status.entries.some(e => e.path === "b.txt"),
      "bus event led to a status refresh that sees the new file");
    await rm(join(dir, "b.txt"));

    // Mutation preconditions (§24) + journal (§32).
    const journal = new OperationJournal();
    const coordinator = new MutationCoordinator(
      executor, new RepositoryOperationDetector(executor), journal
    );
    await assert.rejects(
      coordinator.run({ rootUri: dir, operation: "stage", args: ["add", "--", "a.txt"], expectHead: "deadbeef" }),
      (error: unknown) => error instanceof StateConflictError
    );
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    await coordinator.run({ rootUri: dir, operation: "stage", args: ["add", "--", "a.txt"], expectHead: head });
    const entries = journal.list(dir);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].status, "failed");
    assert.equal(entries[1].status, "success");

    manager.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
