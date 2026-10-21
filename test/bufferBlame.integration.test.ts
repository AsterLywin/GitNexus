import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { BlameCache } from "../src/features/blame/blameCache";
import { BlameService } from "../src/features/blame/blameService";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";
import { RepositoryStateStore } from "../src/state/repositoryStateStore";

const run = promisify(execFile);

test("buffer blame: inserted and edited lines are uncommitted, shifted lines keep attribution", async t => {
  const gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  if (!gitAvailable) { t.skip("git not available"); return; }

  const dir = await mkdtemp(join(tmpdir(), "gitnexus-bufblame-"));
  try {
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.name", "Original Author"], { cwd: dir });
    await run("git", ["config", "user.email", "orig@example.com"], { cwd: dir });
    await writeFile(join(dir, "f.txt"), "alpha\nbeta\ngamma\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "base"], { cwd: dir });

    const blame = new BlameService(new NodeGitProcessExecutor());
    // The buffer (unsaved): a new first line, "beta" edited, rest untouched.
    const buffer = "INSERTED\nalpha\nBETA EDITED\ngamma\n";
    const lines = await blame.blameBuffer(dir, "f.txt", buffer);
    assert.equal(lines.length, 4);
    assert.equal(lines[0].uncommitted, true);
    assert.equal(lines[0].content, "INSERTED");
    assert.equal(lines[1].author, "Original Author");
    assert.equal(lines[1].content, "alpha");
    assert.equal(lines[1].line, 2);
    assert.equal(lines[1].originalLine, 1);
    assert.equal(lines[2].uncommitted, true);
    assert.equal(lines[2].content, "BETA EDITED");
    assert.equal(lines[3].author, "Original Author");
    assert.equal(lines[3].content, "gamma");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buffer cache dedupes identical content and separates edits", async () => {
  let calls = 0;
  const stub = {
    blameBuffer: async () => {
      calls++;
      return [];
    },
    blame: async () => []
  };
  const cache = new BlameCache(stub as never, new RepositoryStateStore());
  await cache.getBuffer("/repo", "f.txt", "same content");
  await cache.getBuffer("/repo", "f.txt", "same content");
  assert.equal(calls, 1);
  await cache.getBuffer("/repo", "f.txt", "edited content");
  assert.equal(calls, 2);
});
