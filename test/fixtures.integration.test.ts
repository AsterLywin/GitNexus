import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { RepositoryManager } from "../src/app/repositoryManager";
import { CherryPickService } from "../src/git/cherryPickService";
import { RevertService } from "../src/git/revertService";
import { GitService } from "../src/git/gitService";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";
import { RepositoryOperationDetector } from "../src/git/repositoryOperationDetector";
import { StashService } from "../src/features/stash/stashService";
import { SubmoduleService } from "../src/git/submoduleService";
import { WorktreeService } from "../src/features/worktree/worktreeService";
import { RepositoryStateStore } from "../src/state/repositoryStateStore";

const run = promisify(execFile);
const executor = new NodeGitProcessExecutor();
const git = new GitService(executor);

async function gitAvailable(): Promise<boolean> {
  return run("git", ["--version"]).then(() => true, () => false);
}

async function makeRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await run("git", ["init", "-b", "main"], { cwd: dir });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await run("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

async function commitFile(dir: string, name: string, content: string, message: string): Promise<void> {
  await writeFile(join(dir, name), content);
  await run("git", ["add", "."], { cwd: dir });
  await run("git", ["commit", "-m", message], { cwd: dir });
}

test("fixture: empty repository (unborn HEAD) is handled gracefully", async t => {
  if (!await gitAvailable()) { t.skip("git not available"); return; }
  const dir = await makeRepo("gitnexus-fix-empty-");
  try {
    assert.deepEqual(await git.log(dir), []);
    const head = await git.head(dir);
    assert.equal(head.ref, "main");
    assert.equal(head.detached, false);
    const status = await git.status(dir);
    assert.equal(status.isClean, true);

    const manager = new RepositoryManager(git, new RepositoryStateStore(), { executor, pollIntervalMs: 0 });
    const snapshot = await manager.open(dir);
    assert.equal(snapshot.commits.length, 0);
    assert.equal(snapshot.domains!.derived.clean, true);
    manager.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixtures: detached HEAD, rename and Unicode paths parse correctly", async t => {
  if (!await gitAvailable()) { t.skip("git not available"); return; }
  const dir = await makeRepo("gitnexus-fix-misc-");
  try {
    await commitFile(dir, "old name.txt", "v1\n", "first");
    await commitFile(dir, "other.txt", "x\n", "second");

    // Detached HEAD
    await run("git", ["checkout", "--detach", "HEAD"], { cwd: dir });
    const head = await git.head(dir);
    assert.equal(head.detached, true);
    await run("git", ["checkout", "main"], { cwd: dir });

    // Rename (staged)
    await run("git", ["mv", "old name.txt", "new name.txt"], { cwd: dir });
    // Unicode + spaces (unstaged new files)
    await writeFile(join(dir, "فایل تست.txt"), "سلام\n");
    const status = await git.status(dir);
    const renamed = status.entries.find(e => e.path === "new name.txt");
    assert.equal(renamed?.kind, "renamed");
    assert.equal(renamed?.originalPath, "old name.txt");
    assert.ok(status.entries.some(e => e.path === "فایل تست.txt"), "unicode path parsed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixtures: state transitions clean → dirty → staged → clean, then conflict → abort → clean", async t => {
  if (!await gitAvailable()) { t.skip("git not available"); return; }
  const dir = await makeRepo("gitnexus-fix-state-");
  try {
    await commitFile(dir, "conflict.txt", "base\n", "base");
    const manager = new RepositoryManager(git, new RepositoryStateStore(), { executor, pollIntervalMs: 0 });

    let snapshot = await manager.open(dir);
    assert.equal(snapshot.domains!.derived.clean, true);

    // DIRTY
    await writeFile(join(dir, "conflict.txt"), "dirty\n");
    snapshot = await manager.refresh(dir);
    assert.equal(snapshot.domains!.derived.clean, false);
    assert.ok(snapshot.status.entries[0].worktreeStatus !== ".");

    // INDEX DIRTY (staged)
    await run("git", ["add", "conflict.txt"], { cwd: dir });
    snapshot = await manager.refresh(dir);
    assert.ok(snapshot.status.entries[0].indexStatus !== ".");
    await run("git", ["commit", "-m", "dirty"], { cwd: dir });
    snapshot = await manager.refresh(dir);
    assert.equal(snapshot.domains!.derived.clean, true);
    manager.dispose();

    // CONFLICTED
    await run("git", ["checkout", "-b", "feature"], { cwd: dir });
    await commitFile(dir, "conflict.txt", "feature\n", "feature change");
    await run("git", ["checkout", "main"], { cwd: dir });
    await commitFile(dir, "conflict.txt", "main\n", "main change");
    await run("git", ["merge", "feature"], { cwd: dir }).catch(() => undefined);

    const detector = new RepositoryOperationDetector(executor);
    const detected = await detector.detect(dir);
    assert.equal(detected.phase, "conflict");
    assert.ok(detected.conflictPaths.includes("conflict.txt"));

    // Abort restores the previous clean state (§41 transition).
    await run("git", ["merge", "--abort"], { cwd: dir });
    const after = await detector.detect(dir);
    assert.equal(after.phase, "idle");
    assert.equal((await git.status(dir)).isClean, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixtures: stash / cherry-pick / revert services against real Git", async t => {
  if (!await gitAvailable()) { t.skip("git not available"); return; }
  const dir = await makeRepo("gitnexus-fix-flow-");
  try {
    await commitFile(dir, "a.txt", "a\n", "base");
    const stash = new StashService(executor);
    await writeFile(join(dir, "a.txt"), "stashed\n");
    await stash.push(dir, "wip work");
    assert.equal((await stash.list(dir)).length, 1);
    assert.equal((await git.status(dir)).isClean, true);
    await stash.pop(dir);
    assert.equal((await stash.list(dir)).length, 0);
    await run("git", ["checkout", "--", "a.txt"], { cwd: dir });

    // Cherry-pick a commit from a side branch, then revert it.
    await run("git", ["checkout", "-b", "side"], { cwd: dir });
    await commitFile(dir, "b.txt", "b\n", "side change");
    const sideHead = (await run("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    await run("git", ["checkout", "main"], { cwd: dir });
    await new CherryPickService(executor).pick(dir, [sideHead]);
    assert.ok((await git.log(dir, 5)).some(c => c.subject === "side change"));
    await new RevertService(executor).revert(dir, [sideHead]);
    const subjects = (await git.log(dir, 5)).map(c => c.subject);
    assert.ok(subjects.some(s => s.startsWith("Revert")), "revert commit created");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fixtures: multiple worktrees and a submodule repository", async t => {
  if (!await gitAvailable()) { t.skip("git not available"); return; }
  const dir = await makeRepo("gitnexus-fix-wt-");
  const extra = await mkdtemp(join(tmpdir(), "gitnexus-fix-sub-"));
  try {
    await commitFile(dir, "a.txt", "a\n", "base");
    const worktrees = new WorktreeService(executor);
    await run("git", ["branch", "wt-branch"], { cwd: dir });
    const wtPath = join(extra, "second");
    await worktrees.add(dir, wtPath, "wt-branch");
    assert.equal((await worktrees.list(dir)).length, 2);

    const manager = new RepositoryManager(git, new RepositoryStateStore(), { executor, pollIntervalMs: 0 });
    const snapshot = await manager.open(dir);
    assert.equal(snapshot.domains!.worktrees.length, 2);
    manager.dispose();
    await worktrees.remove(dir, wtPath);
    assert.equal((await worktrees.list(dir)).length, 1);

    // Submodule from a local path repository.
    const sub = await makeRepo("gitnexus-fix-subsrc-");
    try {
      await commitFile(sub, "lib.txt", "lib\n", "lib v1");
      await run("git", ["-c", "protocol.file.allow=always", "submodule", "add", sub, "libs/sub"], { cwd: dir });
      const submodules = await new SubmoduleService(executor).status(dir);
      assert.equal(submodules.length, 1);
      assert.equal(submodules[0].path, "libs/sub");
      assert.equal(submodules[0].status, "clean");
    } finally {
      await rm(sub, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(extra, { recursive: true, force: true });
  }
});

test("fixture: shallow clone still yields status and a one-commit log", async t => {
  if (!await gitAvailable()) { t.skip("git not available"); return; }
  const src = await makeRepo("gitnexus-fix-shallow-src-");
  const dst = await mkdtemp(join(tmpdir(), "gitnexus-fix-shallow-dst-"));
  try {
    await commitFile(src, "a.txt", "1\n", "c1");
    await commitFile(src, "a.txt", "2\n", "c2");
    await commitFile(src, "a.txt", "3\n", "c3");
    await run("git", ["clone", "--depth", "1", `file://${src}`, join(dst, "clone")]);
    const cloneDir = join(dst, "clone");
    assert.equal((await git.log(cloneDir, 50)).length, 1);
    assert.equal((await git.status(cloneDir)).isClean, true);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(dst, { recursive: true, force: true });
  }
});
