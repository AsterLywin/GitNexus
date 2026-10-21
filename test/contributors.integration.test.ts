import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { GitService } from "../src/git/gitService";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";

const run = promisify(execFile);

test("contributors ranks authors by commit count against a real repository", async t => {
  const gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  if (!gitAvailable) { t.skip("git not available"); return; }

  const dir = await mkdtemp(join(tmpdir(), "gitnexus-contrib-"));
  try {
    await run("git", ["init", "-b", "main"], { cwd: dir });
    const commitAs = async (name: string, email: string, file: string, message: string) => {
      await run("git", ["config", "user.name", name], { cwd: dir });
      await run("git", ["config", "user.email", email], { cwd: dir });
      await writeFile(join(dir, file), `${message}\n`);
      await run("git", ["add", "."], { cwd: dir });
      await run("git", ["commit", "-m", message], { cwd: dir });
    };
    await commitAs("Ada", "ada@example.com", "a.txt", "one");
    await commitAs("Ada", "ada@example.com", "b.txt", "two");
    await commitAs("Bob", "bob@example.com", "c.txt", "three");

    const git = new GitService(new NodeGitProcessExecutor());
    const rows = await git.contributors(dir);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { name: "Ada", email: "ada@example.com", commits: 2 });
    assert.deepEqual(rows[1], { name: "Bob", email: "bob@example.com", commits: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
