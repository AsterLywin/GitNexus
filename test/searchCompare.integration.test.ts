import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DiffService } from "../src/features/diff/diffService";
import { CommitSearchService } from "../src/features/search/commitSearch";
import { parseCommitSearch } from "../src/features/search/searchParser";
import { GitService } from "../src/git/gitService";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";

const run = promisify(execFile);

test("search (qualifiers + pickaxe) and compare (ranges + name-status) on diverged branches", async t => {
  const gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  if (!gitAvailable) { t.skip("git not available"); return; }

  const dir = await mkdtemp(join(tmpdir(), "gitnexus-scmp-"));
  const executor = new NodeGitProcessExecutor();
  try {
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.name", "Ada"], { cwd: dir });
    await run("git", ["config", "user.email", "ada@example.com"], { cwd: dir });
    const commit = async (file: string, content: string, message: string) => {
      await writeFile(join(dir, file), content);
      await run("git", ["add", "."], { cwd: dir });
      await run("git", ["commit", "-m", message], { cwd: dir });
    };
    await commit("shared.txt", "needle one\n", "base adds needle");
    await run("git", ["switch", "-c", "feature"], { cwd: dir });
    await commit("feat.txt", "feature work\n", "feature: first");
    await commit("feat2.txt", "more feature\n", "feature: second");
    await run("git", ["switch", "main"], { cwd: dir });
    await commit("main.txt", "main work\n", "main: diverges");

    const search = new CommitSearchService(executor);
    const byMessage = await search.search(dir, parseCommitSearch('message:"feature: first"'));
    assert.equal(byMessage.length, 1);
    assert.equal(byMessage[0].subject, "feature: first");

    const byAuthor = await search.search(dir, parseCommitSearch("author:Ada"));
    assert.equal(byAuthor.length, 4);

    const pickaxe = await search.pickaxe(dir, "needle", "string");
    assert.equal(pickaxe.length, 1);
    assert.equal(pickaxe[0].subject, "base adds needle");

    const git = new GitService(executor);
    const ahead = await git.log(dir, 200, { range: "main..feature" });
    const behind = await git.log(dir, 200, { range: "feature..main" });
    assert.deepEqual(ahead.map(c => c.subject), ["feature: second", "feature: first"]);
    assert.deepEqual(behind.map(c => c.subject), ["main: diverges"]);

    const diffs = new DiffService(executor);
    const files = await diffs.nameStatus(dir, ["main...feature"]);
    assert.deepEqual(files.map(f => f.path).sort(), ["feat.txt", "feat2.txt"]);
    assert.ok(files.every(f => f.status === "A"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
