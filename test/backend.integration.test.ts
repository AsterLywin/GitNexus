import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeGitBackend } from "../src/git/backend";
import { GitError } from "../src/git/errors";
import { GitService } from "../src/git/gitService";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";
import { TagService } from "../src/git/tagService";
import { ConfigService } from "../src/git/configService";
import { RemoteService } from "../src/git/remoteService";
import { RefService } from "../src/git/refService";
import { BranchService } from "../src/features/branch/branchService";

const run = promisify(execFile);

/** Real-Git smoke test for the Phase 1 engine pieces (skips if git is absent). */
test("backend, streaming log and typed services work against a real repository", async t => {
  const gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  if (!gitAvailable) { t.skip("git not available"); return; }

  const dir = await mkdtemp(join(tmpdir(), "gitnexus-it-"));
  try {
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    await run("git", ["config", "user.name", "Test"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "one\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "first"], { cwd: dir });
    await writeFile(join(dir, "a.txt"), "one\ntwo\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "second"], { cwd: dir });

    const executor = new NodeGitProcessExecutor();
    const backend = new NodeGitBackend();
    const git = new GitService(executor, 30000, backend);

    const version = await backend.getVersion();
    assert.ok(version.major >= 2);
    const caps = await git.capabilities(dir);
    assert.equal(caps.porcelainV2, true);

    const streamed: string[] = [];
    for await (const commit of git.logStream(dir, 10)) streamed.push(commit.subject);
    assert.deepEqual(streamed, ["second", "first"]);

    const tags = new TagService(executor);
    await tags.create(dir, "v1.0");
    const tagList = await tags.list(dir);
    assert.equal(tagList.length, 1);
    assert.equal(tagList[0].name, "v1.0");

    const config = new ConfigService(executor);
    assert.equal(await config.get(dir, "user.name"), "Test");
    await config.set(dir, "gitnexus.test", "yes");
    assert.equal(await config.get(dir, "gitnexus.test"), "yes");

    const remotes = new RemoteService(executor);
    await remotes.add(dir, "origin", "https://example.com/a/b.git");
    const remoteList = await remotes.list(dir);
    assert.equal(remoteList[0].fetchUrl, "https://example.com/a/b.git");

    // for-each-ref based services (regression: %x1f is not expanded there,
    // formats must carry a literal separator)
    const refSnapshot = await new RefService(executor).list(dir);
    assert.equal(refSnapshot.branches.length, 1);
    assert.equal(refSnapshot.branches[0].shortName, "main");
    assert.equal(refSnapshot.branches[0].isCurrent, true);
    assert.equal(refSnapshot.tags.length, 1);

    const branchList = await new BranchService(executor).list(dir);
    assert.equal(branchList.length, 1);
    assert.equal(branchList[0].name, "main");
    assert.equal(branchList[0].current, true);

    const status = await git.status(dir);
    assert.equal(status.isClean, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("executor normalizes a not-a-repository failure", async t => {
  const gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  if (!gitAvailable) { t.skip("git not available"); return; }
  const dir = await mkdtemp(join(tmpdir(), "gitnexus-notrepo-"));
  try {
    const executor = new NodeGitProcessExecutor();
    await assert.rejects(
      executor.exec(["status"], { cwd: dir }),
      (error: unknown) => error instanceof GitError && error.code === "NOT_A_REPOSITORY"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
