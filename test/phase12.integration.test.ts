import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DiffService } from "../src/features/diff/diffService";
import { StashService } from "../src/features/stash/stashService";
import { GitService } from "../src/git/gitService";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";

const run = promisify(execFile);

test("file history follows renames; stash show returns the patch; compare diff is path-scoped", async t => {
  const gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  if (!gitAvailable) { t.skip("git not available"); return; }

  const dir = await mkdtemp(join(tmpdir(), "gitnexus-p12-"));
  const executor = new NodeGitProcessExecutor();
  try {
    await run("git", ["init", "-b", "main"], { cwd: dir });
    await run("git", ["config", "user.name", "Ada"], { cwd: dir });
    await run("git", ["config", "user.email", "ada@example.com"], { cwd: dir });
    const commit = async (message: string) => {
      await run("git", ["add", "."], { cwd: dir });
      await run("git", ["commit", "-m", message], { cwd: dir });
    };
    await writeFile(join(dir, "old.txt"), "v1\n");
    await writeFile(join(dir, "other.txt"), "other\n");
    await commit("create old");
    await rename(join(dir, "old.txt"), join(dir, "new.txt"));
    await commit("rename old to new");
    await writeFile(join(dir, "new.txt"), "v2\n");
    await commit("edit new");

    const git = new GitService(executor);
    const history = await git.log(dir, 200, { path: "new.txt", follow: true });
    assert.deepEqual(history.map(c => c.subject), ["edit new", "rename old to new", "create old"]);

    // Stash: dirty the file, stash it, the patch shows the change.
    await writeFile(join(dir, "new.txt"), "stashed change\n");
    await run("git", ["stash", "push", "-m", "wip"], { cwd: dir });
    const stash = new StashService(executor);
    const entries = await stash.list(dir);
    assert.equal(entries.length, 1);
    const patch = await stash.show(dir, entries[0].ref);
    assert.ok(patch.includes("+stashed change"));
    await run("git", ["stash", "drop"], { cwd: dir });

    // Compare diff for one path between refs.
    await run("git", ["switch", "-c", "feature"], { cwd: dir });
    await writeFile(join(dir, "feat.txt"), "feature file\n");
    await commit("add feat");
    const diffs = new DiffService(executor);
    const scoped = await diffs.diff(dir, ["main...feature", "--", "feat.txt"]);
    assert.ok(scoped.rawPatch.includes("+feature file"));
    const empty = await diffs.diff(dir, ["main...feature", "--", "other.txt"]);
    assert.equal(empty.rawPatch.trim(), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
