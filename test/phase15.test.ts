import assert from "node:assert/strict";
import test from "node:test";
import { CommitSummary } from "../src/domain/git";
import { CommitGraphLayout } from "../src/features/graph/graphLayout";
import { createRenderModel } from "../src/features/graph/graphModel";
import { renderGraphWindowSvg } from "../src/features/graph/graphRenderer";
import {
  authorColor,
  authorInitials,
  formatRelativeTime,
  laneColor
} from "../src/features/graph/graphStyle";

const NOW = 1_800_000_000;

test("phase 15: author initials and colors are deterministic", () => {
  assert.equal(authorInitials("Aster Lywin"), "AL");
  assert.equal(authorInitials("Aster"), "AS");
  assert.equal(authorInitials("", "ada.lovelace@example.com"), "AL");
  assert.equal(authorInitials(""), "?");
  assert.equal(authorColor("ada@example.com"), authorColor("ADA@example.com"));
  assert.ok(authorColor("ada@example.com").startsWith("#"));
  assert.notEqual(authorColor("ada@example.com"), authorColor("grace@example.com"));
});

test("phase 15: lane colors cycle through the palette", () => {
  assert.equal(laneColor(0), laneColor(10));
  assert.notEqual(laneColor(0), laneColor(1));
  assert.equal(laneColor(-1), laneColor(9));
});

test("phase 15: relative time buckets", () => {
  assert.equal(formatRelativeTime(0, NOW), "");
  assert.equal(formatRelativeTime(NOW - 30, NOW), "just now");
  assert.equal(formatRelativeTime(NOW - 5 * 60, NOW), "5m ago");
  assert.equal(formatRelativeTime(NOW - 5 * 3600, NOW), "5h ago");
  assert.equal(formatRelativeTime(NOW - 3 * 86400, NOW), "3d ago");
  assert.equal(formatRelativeTime(NOW - 14 * 86400, NOW), "2w ago");
  assert.equal(formatRelativeTime(NOW - 90 * 86400, NOW), "3mo ago");
  assert.equal(formatRelativeTime(NOW - 400 * 86400, NOW), "1y ago");
});

function history(): CommitSummary[] {
  const base = {
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    committerName: "Ada Lovelace",
    committerEmail: "ada@example.com"
  };
  const fiveHoursAgo = Math.floor(Date.now() / 1000) - 5 * 3600;
  return [
    { ...base, id: "a3", parents: ["a2", "b1"], authorTimestamp: fiveHoursAgo, committerTimestamp: fiveHoursAgo, subject: "merge feature" },
    { ...base, id: "a2", parents: ["a1"], authorTimestamp: fiveHoursAgo, committerTimestamp: fiveHoursAgo, subject: "main work" },
    { ...base, id: "b1", parents: ["a1"], authorTimestamp: fiveHoursAgo, committerTimestamp: fiveHoursAgo, subject: "feature work" },
    { ...base, id: "a1", parents: [], authorTimestamp: fiveHoursAgo, committerTimestamp: fiveHoursAgo, subject: "root" }
  ];
}

test("phase 15: comfortable rows render pills, initial avatars, colored lanes, relative time", () => {
  const graph = new CommitGraphLayout().build(history());
  const model = createRenderModel(graph, 54, 28, [
    { commitId: "a3", labels: [{ text: "HEAD → main", kind: "head" }, { text: "main", kind: "branch" }] },
    { commitId: "a2", labels: [{ text: "v1.0", kind: "tag" }] }
  ]);

  const { svg } = renderGraphWindowSvg(model, 0, 10, undefined, {}, 54);
  assert.ok(svg.includes('rx="7.5"'), "ref pills are rounded rects");
  assert.ok(svg.includes("HEAD → main"), "head pill text renders");
  assert.ok(svg.includes("v1.0"), "tag pill renders");
  assert.ok(svg.includes(">AL<"), "initial avatar renders");
  assert.ok(svg.includes(`style="fill:${authorColor("ada@example.com")}"`), "avatar uses the author color");
  assert.ok(svg.includes("5h ago"), "relative time on the meta line");
  assert.ok(svg.includes(`stroke:${laneColor(1)}`), "second lane is colored");
});

test("phase 15: compact rows stay single-line (no pills)", () => {
  const graph = new CommitGraphLayout().build(history());
  const model = createRenderModel(graph, 30, 28, [
    { commitId: "a3", labels: [{ text: "main", kind: "branch" }] }
  ]);
  const { svg } = renderGraphWindowSvg(model, 0, 10, undefined, {}, 30);
  assert.ok(!svg.includes('rx="7.5"'), "no pills in compact density");
  assert.ok(svg.includes("merge feature"), "subject still renders");
});
