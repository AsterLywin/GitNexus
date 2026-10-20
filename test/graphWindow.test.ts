import assert from "node:assert/strict";
import test from "node:test";
import { CommitSummary } from "../src/domain/git";
import { CommitGraphLayout } from "../src/features/graph/graphLayout";
import { createRenderModel } from "../src/features/graph/graphModel";
import { renderGraphWindowSvg } from "../src/features/graph/graphRenderer";

function commits(count: number): CommitSummary[] {
  const list: CommitSummary[] = [];
  for (let i = count; i >= 1; i--) {
    list.push({
      id: `c${i}`,
      parents: i > 1 ? [`c${i - 1}`] : [],
      authorName: "Bench",
      authorEmail: "bench@example.com",
      authorTimestamp: 1767225600,
      committerName: "Bench",
      committerEmail: "bench@example.com",
      committerTimestamp: 1767225600,
      subject: `commit ${i}`
    });
  }
  return list;
}

test("live panel rendering path: model + windowed virtual rendering stays bounded", () => {
  const graph = new CommitGraphLayout().build(commits(1000));
  const model = createRenderModel(graph, 44, 28, [
    { commitId: "c1000", labels: [{ text: "main", kind: "branch" }] }
  ]);
  assert.equal(model.nodes.length, 1000);
  assert.equal(model.nodes[0].refs?.includes("main"), true);

  const window = renderGraphWindowSvg(model, 500, 600);
  assert.equal(window.startRow, 488); // 12-row overscan
  assert.ok(window.endRow - window.startRow <= 124, "window is bounded");
  assert.ok(window.svg.includes('data-id="c500"'), "window contains its rows");
  assert.ok(!window.svg.includes('data-id="c900"'), "window excludes far rows");
  assert.ok(window.svg.includes("commit 500"));

  const selected = renderGraphWindowSvg(model, 0, 10, "c1000");
  assert.ok(selected.svg.includes('data-selected="true"'), "selection is rendered");
});
