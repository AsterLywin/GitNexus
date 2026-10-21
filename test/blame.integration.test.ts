import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { BlameService } from "../src/features/blame/blameService";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";

const run = promisify(execFile);

test("blame against a real repository: two authors, dirty line, ranges, revisions, commit info", async t => {
  const gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  if (!gitAvailable) { t.skip("git not available"); return; }

  const dir = await mkdtemp(join(tmpdir(), "gitnexus-blame-"));
  try {
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.name", "First Author"], { cwd: dir });
    await run("git", ["config", "user.email", "first@example.com"], { cwd: dir });
    await writeFile(join(dir, "f.txt"), "alpha\nbeta\ngamma\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "initial commit"], { cwd: dir });

    await run("git", ["config", "user.name", "Second Author"], { cwd: dir });
    await run("git", ["config", "user.email", "second@example.com"], { cwd: dir });
    await writeFile(join(dir, "f.txt"), "alpha\nBETA\ngamma\ndelta\n");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-m", "second subject", "-m", "body line here"], { cwd: dir });

    // One uncommitted edit.
    await writeFile(join(dir, "f.txt"), "alpha\nBETA\ngamma\ndelta\nepsilon\n");

    const blame = new BlameService(new NodeGitProcessExecutor());
    const lines = await blame.blame(dir, "f.txt");
    assert.equal(lines.length, 5);
    assert.equal(lines[0].author, "First Author");
    assert.equal(lines[0].summary, "initial commit");
    assert.equal(lines[1].author, "Second Author");
    assert.equal(lines[1].summary, "second subject");
    assert.equal(lines[4].uncommitted, true);
    assert.equal(lines[4].content, "epsilon");

    const range = await blame.blameRange(dir, "f.txt", 2, 3);
    assert.deepEqual(range.map(l => l.line), [2, 3]);

    const atFirst = await blame.blameAt(dir, "f.txt", "HEAD~1");
    assert.equal(atFirst.length, 3);
    assert.ok(atFirst.every(l => l.author === "First Author"));

    const info = await blame.commitInfo(dir, lines[1].commit);
    assert.equal(info?.author, "Second Author");
    assert.equal(info?.authorEmail, "second@example.com");
    assert.equal(info?.subject, "second subject");
    assert.equal(info?.body, "body line here");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
