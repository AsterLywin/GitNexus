import assert from "node:assert/strict";
import test from "node:test";
import { buildRefDecorations } from "../src/features/graph/refDecorations";

test("decorates commits with refs", () => {
  const graph = {
    nodes: [{
      id: "abc", commit: {} as any, lane: 0, row: 0, x: 0, y: 0, parents: []
    }],
    edges: [], lanes: [{index:0, commitIds:["abc"]}], width: 1, height: 1
  };
  const refs = {
    refs: [{name:"refs/heads/main",shortName:"main",objectId:"abc",kind:"localBranch" as const,isCurrent:true}],
    branches: [], remotes: [], tags: []
  };
  const result = buildRefDecorations(graph, refs);
  assert.equal(result[0].labels[0].text, "HEAD → main");
});
