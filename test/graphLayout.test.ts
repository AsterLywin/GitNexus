import assert from "node:assert/strict";
import test from "node:test";
import { CommitGraphLayout } from "../src/features/graph/graphLayout";
import { CommitSummary } from "../src/domain/git";

function commit(id: string, parents: string[], subject: string): CommitSummary {
  return {
    id, parents,
    authorName: "Test", authorEmail: "test@example.com",
    authorTimestamp: 1,
    committerName: "Test", committerEmail: "test@example.com",
    committerTimestamp: 1, subject
  };
}

test("builds nodes and parent edges", () => {
  const graph = new CommitGraphLayout().build([
    commit("c", ["b"], "C"),
    commit("b", ["a"], "B"),
    commit("a", [], "A")
  ]);

  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.edges[0].from, "c");
  assert.equal(graph.edges[0].to, "b");
  assert.ok(graph.width > 0);
  assert.ok(graph.height > 0);
});
