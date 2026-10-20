import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";
import { RepositoryOperationDetector } from "../src/git/repositoryOperationDetector";
import { OperationService, operationArgs } from "../src/git/operationService";

const run = promisify(execFile);
const executor = new NodeGitProcessExecutor();
const detector = new RepositoryOperationDetector(executor);
const operations = new OperationService(executor, detector);

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gitnexus-ops-"));
  await run("git", ["init", "-b", "main"], { cwd: dir });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await run("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

async function commitFile(dir: string, content: string, message: string): Promise<void> {
  await writeFile(join(dir, "f.txt"), content);
  await run("git", ["add", "."], { cwd: dir });
  await run("git", ["commit", "-m", message], { cwd: dir });
}

async function conflictedMerge(dir: string): Promise<void> {
  await run("git", ["checkout", "-b", "feature"], { cwd: dir });
  await commitFile(dir, "feature\n", "feature change");
  await run("git", ["checkout", "main"], { cwd: dir });
  await commitFile(dir, "main\n", "main change");
  await run("git", ["merge", "feature"], { cwd: dir }).catch(() => undefined);
}

test("operation lifecycle: merge cannot skip, resolve+continue completes, abort restores", async t => {
  const available = await run("git", ["--version"]).then(() => true, () => false);
  if (!available) { t.skip("git not available"); return; }
  const dir = await makeRepo();
  try {
    await commitFile(dir, "base\n", "base");
    await conflictedMerge(dir);

    const current = await operations.current(dir);
    assert.equal(current.operation, "merge");
    assert.equal(current.phase, "conflict");

    // Skip is not a merge action.
    await assert.rejects(operations.plan(dir, "skip"), /Cannot skip a merge/);
    assert.equal(operationArgs("merge", "skip"), undefined);
    assert.deepEqual(operationArgs("rebase", "skip"), ["rebase", "--skip"]);

    // Resolve, stage, continue — with GIT_EDITOR=true, no editor opens.
    await writeFile(join(dir, "f.txt"), "resolved\n");
    await run("git", ["add", "f.txt"], { cwd: dir });
    const kind = await operations.run(dir, "continue");
    assert.equal(kind, "merge");
    assert.equal((await operations.current(dir)).phase, "idle");
    const subjects = (await run("git", ["log", "--format=%s"], { cwd: dir })).stdout;
    assert.ok(subjects.includes("Merge branch 'feature'"), "merge commit created");

    // A second conflicted merge, aborted this time.
    await run("git", ["checkout", "-b", "second"], { cwd: dir });
    await commitFile(dir, "second\n", "second change");
    await run("git", ["checkout", "main"], { cwd: dir });
    await commitFile(dir, "main again\n", "main again");
    await run("git", ["merge", "second"], { cwd: dir }).catch(() => undefined);
    assert.equal((await operations.current(dir)).phase, "conflict");
    await operations.run(dir, "abort");
    assert.equal((await operations.current(dir)).phase, "idle");
    assert.equal(
      (await run("git", ["status", "--porcelain"], { cwd: dir })).stdout.trim(),
      "",
      "abort restored a clean tree"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("operation lifecycle: cherry-pick conflict can be skipped; idle repo rejects actions", async t => {
  const available = await run("git", ["--version"]).then(() => true, () => false);
  if (!available) { t.skip("git not available"); return; }
  const dir = await makeRepo();
  try {
    await commitFile(dir, "base\n", "base");
    await assert.rejects(operations.plan(dir, "continue"), /No Git operation is in progress/);

    await run("git", ["checkout", "-b", "side"], { cwd: dir });
    await commitFile(dir, "side\n", "side change");
    const sideHead = (await run("git", ["rev-parse", "HEAD"], { cwd: dir })).stdout.trim();
    await run("git", ["checkout", "main"], { cwd: dir });
    await commitFile(dir, "main\n", "main change");
    await run("git", ["cherry-pick", sideHead], { cwd: dir }).catch(() => undefined);

    const current = await operations.current(dir);
    assert.equal(current.operation, "cherry-pick");
    assert.equal(current.phase, "conflict");

    await operations.run(dir, "skip");
    assert.equal((await operations.current(dir)).phase, "idle");
    const subjects = (await run("git", ["log", "--format=%s"], { cwd: dir })).stdout;
    assert.ok(!subjects.includes("side change"), "skipped pick left no commit");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
