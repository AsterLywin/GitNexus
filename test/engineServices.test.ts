import assert from "node:assert/strict";
import test from "node:test";
import { parseRemoteList } from "../src/git/remoteService";
import { parseTagList } from "../src/git/tagService";
import { isSensitiveConfigKey, parseConfigList, redactConfigValue } from "../src/git/configService";
import { parseSubmoduleStatus } from "../src/git/submoduleService";
import { buildLogArgs } from "../src/git/gitService";
import { parseWorktrees } from "../src/features/worktree/worktreeService";

test("parses remote -v output into fetch/push pairs", () => {
  const remotes = parseRemoteList(
    "origin\thttps://github.com/a/b.git (fetch)\norigin\thttps://github.com/a/b.git (push)\nup\tgit@github.com:c/d.git (fetch)\n"
  );
  assert.equal(remotes.length, 2);
  assert.equal(remotes[0].fetchUrl, "https://github.com/a/b.git");
  assert.equal(remotes[0].pushUrl, "https://github.com/a/b.git");
  assert.equal(remotes[1].pushUrl, undefined);
});

test("parses tag list with annotated peel targets", () => {
  const tags = parseTagList("v1.0\x1f111aaa\x1f222bbb\x1ftag\nv0.9\x1f333ccc\x1f\x1fcommit\n");
  assert.deepEqual(tags[0], { name: "v1.0", objectId: "111aaa", targetId: "222bbb", annotated: true });
  assert.deepEqual(tags[1], { name: "v0.9", objectId: "333ccc", targetId: "333ccc", annotated: false });
});

test("redacts sensitive config values and URL userinfo", () => {
  assert.equal(isSensitiveConfigKey("credential.helper"), true);
  assert.equal(isSensitiveConfigKey("user.password"), true);
  assert.equal(isSensitiveConfigKey("user.name"), false);
  assert.equal(redactConfigValue("credential.helper", "osxkeychain"), "***redacted***");
  assert.equal(
    redactConfigValue("remote.origin.url", "https://user:secret@example.com/r.git"),
    "https://***@example.com/r.git"
  );
  assert.deepEqual(parseConfigList("user.name=Aster\ncore.bare=false\n"), [
    { key: "user.name", value: "Aster" },
    { key: "core.bare", value: "false" }
  ]);
});

test("parses submodule status prefixes", () => {
  const entries = parseSubmoduleStatus(
    " abc1234 libs/a (v1.0)\n-def5678 libs/b\n+9999999 libs/c (heads/main)\n"
  );
  assert.deepEqual(entries.map(e => e.status), ["clean", "uninitialized", "modified"]);
  assert.equal(entries[0].path, "libs/a");
  assert.equal(entries[0].describe, "v1.0");
});

test("builds log args for ranges, filters and path history", () => {
  const args = buildLogArgs(50, { firstParent: true, author: "Aster", range: "main..HEAD", path: "src/a.ts", follow: true });
  assert.ok(args.includes("--first-parent"));
  assert.ok(args.includes("--follow"));
  assert.ok(args.includes("--author=Aster"));
  assert.ok(args.includes("main..HEAD"));
  assert.deepEqual(args.slice(-2), ["--", "src/a.ts"]);
});

test("parses worktree porcelain blocks", () => {
  const trees = parseWorktrees(
    "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt2\nHEAD def\ndetached\nlocked\n"
  );
  assert.equal(trees.length, 2);
  assert.equal(trees[0].branch, "refs/heads/main");
  assert.equal(trees[1].detached, true);
  assert.equal(trees[1].locked, true);
});
