import assert from "node:assert/strict";
import test from "node:test";
import { GitRef } from "../src/domain/ref";
import { branchNodes, commitNodes, remoteNodes, stashNodes, tagNodes } from "../src/features/explorer/models";
import { parseShortlog } from "../src/git/parsers/shortlogParser";

function ref(partial: Partial<GitRef> & { shortName: string; kind: GitRef["kind"] }): GitRef {
  return {
    name: `refs/${partial.kind === "tag" ? "tags" : "heads"}/${partial.shortName}`,
    objectId: "a".repeat(40),
    ...partial
  };
}

test("branch nodes: local/remote split, current first, upstream tracking kept", () => {
  const { local, remote } = branchNodes([
    ref({ shortName: "zeta", kind: "localBranch" }),
    ref({ shortName: "main", kind: "localBranch", isCurrent: true, upstream: "origin/main", ahead: 2, behind: 1 }),
    ref({ shortName: "origin/main", kind: "remoteBranch" }),
    ref({ shortName: "origin/dev", kind: "remoteBranch" }),
    ref({ shortName: "v1.0", kind: "tag" })
  ]);
  assert.deepEqual(local.map(n => n.label), ["main", "zeta"]);
  assert.equal(local[0].isCurrent, true);
  assert.deepEqual(remote.map(n => n.label), ["origin/dev", "origin/main"]);
});

test("tag nodes sort newest-looking first with numeric awareness", () => {
  const nodes = tagNodes([
    ref({ shortName: "v1.9", kind: "tag" }),
    ref({ shortName: "v1.10", kind: "tag" }),
    ref({ shortName: "v1.2", kind: "tag" })
  ]);
  assert.deepEqual(nodes.map(n => n.label), ["v1.10", "v1.9", "v1.2"]);
});

test("remote, stash and commit nodes shape their inputs", () => {
  const remotes = remoteNodes([
    { name: "upstream", fetchUrl: "https://x/up.git" },
    { name: "origin", fetchUrl: "https://x/o.git", pushUrl: "https://x/o.git" }
  ]);
  assert.deepEqual(remotes.map(r => r.label), ["origin", "upstream"]);
  assert.equal(remotes[1].detail, "https://x/up.git");

  const stashes = stashNodes([
    { index: 2, ref: "stash@{2}", subject: "older" },
    { index: 0, ref: "stash@{0}", subject: "newest" }
  ]);
  assert.deepEqual(stashes.map(s => s.entry.index), [0, 2]);

  const commits = commitNodes([
    { id: "b".repeat(40), parents: [], authorName: "A", authorEmail: "", authorTimestamp: 2, committerName: "A", committerEmail: "", committerTimestamp: 2, subject: "second" },
    { id: "a".repeat(40), parents: [], authorName: "B", authorEmail: "", authorTimestamp: 1, committerName: "B", committerEmail: "", committerTimestamp: 1, subject: "first" }
  ], 1);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].label, "second");
  assert.match(commits[0].detail, /^A · bbbbbbbb$/);
});

test("parses git shortlog output into contributor rows", () => {
  const rows = parseShortlog("   128\tAda Lovelace <ada@example.com>\n     3\tÜser Two <two@example.com>\nnot a row\n");
  assert.deepEqual(rows, [
    { commits: 128, name: "Ada Lovelace", email: "ada@example.com" },
    { commits: 3, name: "Üser Two", email: "two@example.com" }
  ]);
  assert.deepEqual(parseShortlog(""), []);
});
