import assert from "node:assert/strict";
import test from "node:test";
import { parseBlame } from "../src/features/blame/blameService";
import { BlameCache, resolveBlameTarget } from "../src/features/blame/blameCache";
import { formatRelativeShort, formatRelativeTime, heatBucket } from "../src/features/blame/format";
import { RepositoryStateStore } from "../src/state/repositoryStateStore";

// Real `git blame --line-porcelain` shape: two authors (one Unicode), a
// boundary commit, a "previous" pointer, and an uncommitted line.
const PORCELAIN = `5c50063b82178eaa633160116e06dbcfd4bf877f 1 1 1
author First Author
author-mail <first@example.com>
author-time 1792570802
author-tz +0330
committer First Author
committer-mail <first@example.com>
committer-time 1792570802
committer-tz +0330
summary initial commit
boundary
filename f.txt
\talpha
2601598053b4c5c798143910bdd6598b366f95ca 2 2 1
author Üser Two
author-mail <two@example.com>
author-time 1792570900
author-tz +0330
committer Üser Two
committer-mail <two@example.com>
committer-time 1792570900
committer-tz +0330
summary second commit subject
previous 5c50063b82178eaa633160116e06dbcfd4bf877f f.txt
filename f.txt
\tBETA CHANGED
0000000000000000000000000000000000000000 5 3 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1792570950
author-tz +0330
committer Not Committed Yet
committer-mail <not.committed.yet>
committer-time 1792570950
committer-tz +0330
summary Version of f.txt from f.txt
filename f.txt
\tepsilon dirty`;

test("parses line-porcelain blame: authors, summaries, uncommitted lines", () => {
  const lines = parseBlame(PORCELAIN);
  assert.equal(lines.length, 3);

  assert.equal(lines[0].line, 1);
  assert.equal(lines[0].originalLine, 1);
  assert.equal(lines[0].commit, "5c50063b82178eaa633160116e06dbcfd4bf877f");
  assert.equal(lines[0].author, "First Author");
  assert.equal(lines[0].authorEmail, "first@example.com");
  assert.equal(lines[0].timestamp, 1792570802);
  assert.equal(lines[0].summary, "initial commit");
  assert.equal(lines[0].content, "alpha");
  assert.equal(lines[0].uncommitted, false);

  assert.equal(lines[1].author, "Üser Two");
  assert.equal(lines[1].summary, "second commit subject");
  assert.equal(lines[1].content, "BETA CHANGED");

  assert.equal(lines[2].line, 3);
  assert.equal(lines[2].originalLine, 5);
  assert.equal(lines[2].uncommitted, true);
  assert.equal(lines[2].content, "epsilon dirty");
});

test("relative time formatting: long and compact shapes", () => {
  const now = 1_800_000_000;
  assert.equal(formatRelativeTime(now - 10, now), "just now");
  assert.equal(formatRelativeTime(now - 90, now), "1 minute ago");
  assert.equal(formatRelativeTime(now - 3600, now), "1 hour ago");
  assert.equal(formatRelativeTime(now - 86400 * 3, now), "3 days ago");
  assert.equal(formatRelativeTime(now - 86400 * 65, now), "2 months ago");
  assert.equal(formatRelativeTime(now - 86400 * 800, now), "2 years ago");

  assert.equal(formatRelativeShort(now - 300, now), "5m");
  assert.equal(formatRelativeShort(now - 7200, now), "2h");
  assert.equal(formatRelativeShort(now - 86400 * 4, now), "4d");
  assert.equal(formatRelativeShort(now - 86400 * 90, now), "3mo");
  assert.equal(formatRelativeShort(now - 86400 * 400, now), "1y");
});

test("heat buckets run newest 0 to oldest 9", () => {
  assert.equal(heatBucket(1000, 1000, 0), 0);
  assert.equal(heatBucket(0, 1000, 0), 9);
  assert.equal(heatBucket(500, 1000, 0), 5);
  assert.equal(heatBucket(700, 1000, 0), 3);
});

test("resolveBlameTarget matches files to canonical snapshot roots", () => {
  const store = new RepositoryStateStore();
  const snapshot = {
    identity: { rootUri: "C:/repo", gitDir: "C:/repo/.git", commonDir: "C:/repo/.git", isBare: false },
    generation: 1
  } as never;
  store.set(snapshot);

  const target = resolveBlameTarget(store, "C:\\repo\\src\\main.ts");
  assert.equal(target?.root, "C:/repo");
  assert.equal(target?.relativePath, "src/main.ts");
  assert.equal(resolveBlameTarget(store, "C:/other/x.ts"), undefined);
  assert.equal(resolveBlameTarget(store, "C:/repo"), undefined);
});

test("blame cache dedupes and invalidates on generation change", async () => {
  const store = new RepositoryStateStore();
  let calls = 0;
  const stub = {
    blame: async () => {
      calls++;
      return [{ line: 1, originalLine: 1, commit: "a".repeat(40), author: "A", authorEmail: "", timestamp: 1, summary: "s", content: "x", uncommitted: false }];
    }
  };
  const cache = new BlameCache(stub as never, store);
  const snapshot = {
    identity: { rootUri: "/repo", gitDir: "/repo/.git", commonDir: "/repo/.git", isBare: false },
    generation: 1
  } as never;
  store.set(snapshot);

  await cache.get("/repo", "f.txt");
  await cache.get("/repo", "f.txt");
  assert.equal(calls, 1);

  store.set({ ...(snapshot as object), generation: 2 } as never);
  await cache.get("/repo", "f.txt");
  assert.equal(calls, 2);
});
